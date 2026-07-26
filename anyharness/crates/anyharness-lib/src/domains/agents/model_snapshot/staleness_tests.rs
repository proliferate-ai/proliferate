//! The staleness law, the C8 storm regression, TTL boundaries and jitter, the
//! fingerprint's stability/sensitivity, and the status projection — all pure, all
//! with an injected clock.

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{TimeZone, Utc};
use serde_json::json;

use super::document::{
    AttemptOutcome, InstallIdentity, ModelSnapshotDocument, SnapshotAttempt, SnapshotAttestation,
    SnapshotEntry, SnapshotMode, SnapshotModel,
};
use super::fingerprint::fingerprint;
use super::staleness::{
    compare_identity, evaluate, ttl_for_entry, ttl_for_entry_with, Freshness, IdentityComparison,
    StaleReason, DEFAULT_TTL_BASE, DEFAULT_TTL_JITTER_SPAN,
};
use super::status::{self, ContextStatusInputs, LiveState};
use super::ProbeEngineMode;
use crate::domains::agents::route_auth::probe_materialization::probe_auth_material_for_server;
use crate::domains::agents::route_auth::test_support::TempHome;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 26, 12, 0, 0).unwrap()
}

fn identity(version: Option<&str>, sha: Option<&str>, source: &str) -> InstallIdentity {
    InstallIdentity {
        role: "agent_process".to_string(),
        version: version.map(str::to_string),
        sha256: sha.map(str::to_string),
        source: source.to_string(),
    }
}

fn entry(
    probed_ago: Duration,
    install_identity: Option<InstallIdentity>,
    fingerprint: &str,
) -> SnapshotEntry {
    let probed_at = now() - chrono::Duration::seconds(probed_ago.as_secs() as i64);
    SnapshotEntry {
        probed_at: probed_at.to_rfc3339(),
        mechanism: "acp".to_string(),
        attestation: Some(SnapshotAttestation {
            name: "claude".to_string(),
            // The ACP namespace, deliberately unrelated to the manifest's.
            version: "0.59.0-proliferate.1".to_string(),
            title: None,
        }),
        install_identity,
        auth_fingerprint: fingerprint.to_string(),
        models: vec![SnapshotModel {
            id: "m-1".to_string(),
            provider: None,
            name: "M1".to_string(),
            description: None,
            config_options: None,
        }],
        modes: vec![SnapshotMode {
            id: "build".to_string(),
            name: "Build".to_string(),
        }],
        observed_defaults: None,
        warnings: Vec::new(),
        last_attempt: SnapshotAttempt {
            at: probed_at.to_rfc3339(),
            outcome: AttemptOutcome::Ok,
            detail: None,
        },
    }
}

const HOUR: Duration = Duration::from_secs(3600);
const FP: &str = "sha256:aaaa";

// ---------------------------------------------------------------------------
// T-16, T-17: the gate matrix and the TTL boundary
// ---------------------------------------------------------------------------

/// T-16 — every reason, plus precedence. Identity before auth before time, so a
/// surface names the real cause rather than "it got old".
#[test]
fn the_gate_names_every_reason_and_orders_them() {
    let ttl = 24 * HOUR;
    let current = identity(Some("1.0.0"), Some("sha-new"), "pinned_archive");

    // No entry.
    assert_eq!(
        evaluate(None, Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::Missing)
    );

    // sha differs while versions AGREE: sha is the stronger signal and wins.
    let moved_sha = entry(
        HOUR,
        Some(identity(Some("1.0.0"), Some("sha-old"), "pinned_archive")),
        FP,
    );
    assert_eq!(
        evaluate(Some(&moved_sha), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::HarnessMoved)
    );

    // versions differ with no shas on either side: the fallback comparison.
    let no_sha_current = identity(Some("2.0.0"), None, "pinned_git");
    let moved_version = entry(HOUR, Some(identity(Some("1.0.0"), None, "pinned_git")), FP);
    assert_eq!(
        evaluate(Some(&moved_version), Some(&no_sha_current), FP, now(), ttl),
        Freshness::Stale(StaleReason::HarnessMoved)
    );

    // Fingerprint moved.
    let same_identity = entry(HOUR, Some(current.clone()), "sha256:OLD");
    assert_eq!(
        evaluate(Some(&same_identity), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::AuthMoved)
    );

    // Age beyond the TTL.
    let old = entry(25 * HOUR, Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&old), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::TtlExpired)
    );

    // Everything matches inside the TTL.
    let fresh = entry(HOUR, Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&fresh), Some(&current), FP, now(), ttl),
        Freshness::Fresh
    );

    // Precedence: all three hold at once -> the identity reason is reported.
    let all_three = entry(
        99 * HOUR,
        Some(identity(Some("0.1.0"), Some("sha-ancient"), "pinned_archive")),
        "sha256:OLD",
    );
    assert_eq!(
        evaluate(Some(&all_three), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::HarnessMoved),
        "identity must be reported before auth or time"
    );
    // Auth before time when identity agrees.
    let auth_and_time = entry(99 * HOUR, Some(current.clone()), "sha256:OLD");
    assert_eq!(
        evaluate(Some(&auth_and_time), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::AuthMoved)
    );
}

/// T-35 — **the C8 storm regression.** Every unobservable-identity case must be
/// NOT stale. Getting this wrong made three of five harnesses permanently
/// `HarnessMoved`, re-spawning a real harness on every startup, every launch and
/// every auth apply — with backoff powerless, because those probes SUCCEED.
#[test]
fn an_unobservable_install_identity_is_never_a_staleness_reason() {
    let ttl = 24 * HOUR;
    let manifest = identity(
        Some("26f9ee7a0049507bff5476ce390695515ce92840"),
        Some("b206d72da2ff"),
        "pinned_git",
    );

    // (a) The entry predates the field, with a present manifest.
    let pre_field = entry(HOUR, None, FP);
    assert_eq!(
        evaluate(Some(&pre_field), Some(&manifest), FP, now(), ttl),
        Freshness::Fresh,
        "an entry with no recorded identity must not be stale"
    );

    // (b) No manifest at all.
    let recorded = entry(HOUR, Some(manifest.clone()), FP);
    assert_eq!(
        evaluate(Some(&recorded), None, FP, now(), ttl),
        Freshness::Fresh,
        "an absent manifest must not be stale"
    );

    // (c) A `source: "path"` dev install: manifest present, version absent.
    let path_install = identity(None, None, "path");
    let recorded_path = entry(HOUR, Some(identity(None, None, "path")), FP);
    assert_eq!(
        evaluate(Some(&recorded_path), Some(&path_install), FP, now(), ttl),
        Freshness::Fresh,
        "a version-less path install must not be stale"
    );

    // The positive control, which is the exact pair rev 1 got wrong: the entry's
    // ACP attestation says `0.59.0-proliferate.1` while the manifest says the
    // pinned git sha. Same manifest on both sides => Fresh.
    assert_eq!(
        recorded.attestation.as_ref().map(|a| a.version.as_str()),
        Some("0.59.0-proliferate.1"),
        "the fixture really does carry the divergent ACP version"
    );
    assert_eq!(
        evaluate(Some(&recorded), Some(&manifest), FP, now(), ttl),
        Freshness::Fresh,
        "an entry recorded from the manifest must be fresh against that manifest, \
         regardless of what the ACP attestation says"
    );

    // A cursor/grok-shaped entry (attestation: null) with a matching identity.
    let mut attestation_less = entry(HOUR, Some(manifest.clone()), FP);
    attestation_less.attestation = None;
    assert_eq!(
        evaluate(Some(&attestation_less), Some(&manifest), FP, now(), ttl),
        Freshness::Fresh
    );
}

/// The comparison rule itself, including the "both present but no comparable
/// field" case, which is Indeterminate rather than Different.
#[test]
fn identity_comparison_prefers_sha_then_version_then_gives_up() {
    assert_eq!(
        compare_identity(
            Some(&identity(Some("1.0"), Some("sha"), "npm")),
            Some(&identity(Some("2.0"), Some("sha"), "npm")),
        ),
        IdentityComparison::Same,
        "a matching sha wins even when the version strings differ"
    );
    assert_eq!(
        compare_identity(
            Some(&identity(Some("1.0"), Some("sha-a"), "npm")),
            Some(&identity(Some("1.0"), Some("sha-b"), "npm")),
        ),
        IdentityComparison::Different,
        "a differing sha is a move even when the version string was reused"
    );
    assert_eq!(
        compare_identity(
            Some(&identity(Some("1.0"), None, "npm")),
            Some(&identity(Some("1.0"), Some("sha"), "npm")),
        ),
        IdentityComparison::Same,
        "one-sided sha falls back to the version comparison"
    );
    assert_eq!(
        compare_identity(
            Some(&identity(None, None, "path")),
            Some(&identity(None, None, "path")),
        ),
        IdentityComparison::Indeterminate,
        "two identities with nothing comparable are indeterminate, not equal"
    );
    assert_eq!(
        compare_identity(None, None),
        IdentityComparison::Indeterminate
    );
}

/// T-17 — the TTL boundary, exactly. One second under is fresh; one second over
/// expires.
#[test]
fn the_ttl_boundary_is_exact_and_a_backwards_clock_does_not_expire() {
    let ttl = Duration::from_secs(90_000);
    let current = identity(Some("1.0"), Some("sha"), "npm");

    let just_inside = entry(ttl - Duration::from_secs(1), Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&just_inside), Some(&current), FP, now(), ttl),
        Freshness::Fresh
    );

    let just_outside = entry(ttl + Duration::from_secs(1), Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&just_outside), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::TtlExpired)
    );

    // A `probedAt` in the future (clock correction, or a document copied from a
    // machine ahead of this one) must not expire: expiring on it would re-probe
    // everything after any clock adjustment.
    let mut future = entry(Duration::ZERO, Some(current.clone()), FP);
    future.probed_at = (now() + chrono::Duration::hours(5)).to_rfc3339();
    assert_eq!(
        evaluate(Some(&future), Some(&current), FP, now(), ttl),
        Freshness::Fresh
    );

    // An unparseable timestamp IS a defect in the entry (unlike an unobservable
    // identity), and one re-probe repairs it permanently.
    let mut broken = entry(Duration::ZERO, Some(current.clone()), FP);
    broken.probed_at = "not-a-timestamp".to_string();
    assert_eq!(
        evaluate(Some(&broken), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::TtlExpired)
    );
}

/// T-36 — TTL jitter is deterministic, bounded, and actually spreading.
///
/// Without it, a startup pass writes all 17 entries in one pass, they co-expire to
/// the same instant, and every boot ≥24h later queues 17 real harness spawns. The
/// design created that herd itself.
#[test]
fn ttl_jitter_is_deterministic_bounded_and_spreads_every_catalog_context() {
    let seventeen: Vec<(&str, &str)> = vec![
        ("claude", "bedrock"),
        ("claude", "anthropic-api"),
        ("claude", "anthropic-oauth"),
        ("claude", "gateway"),
        ("codex", "bedrock"),
        ("codex", "openai-oauth"),
        ("codex", "openai-api"),
        ("codex", "gateway"),
        ("cursor", "cursor-login"),
        ("grok", "xai-api"),
        ("grok", "gateway"),
        ("opencode", "anthropic-api"),
        ("opencode", "openai-api"),
        ("opencode", "gemini-api"),
        ("opencode", "opencode-zen"),
        ("opencode", "baseline"),
        ("opencode", "gateway"),
    ];
    assert_eq!(seventeen.len(), 17);

    let mut ttls: Vec<u64> = Vec::new();
    for (harness, context) in &seventeen {
        let ttl = ttl_for_entry(harness, context);
        // Pure: the same key always answers the same.
        assert_eq!(ttl, ttl_for_entry(harness, context));
        assert!(
            ttl >= DEFAULT_TTL_BASE && ttl < DEFAULT_TTL_BASE + DEFAULT_TTL_JITTER_SPAN,
            "{harness}:{context} ttl {ttl:?} outside [24h, 30h)"
        );
        ttls.push(ttl.as_secs());
    }
    ttls.sort_unstable();
    let span = ttls.last().unwrap() - ttls.first().unwrap();
    assert!(
        span >= 5 * 3600,
        "the 17 contexts must span at least 5h of the 6h window, got {span}s"
    );
    // No two entries co-expire, which is the property that matters: co-expiry is
    // what turns a startup pass into 17 back-to-back spawns.
    let mut deduped = ttls.clone();
    deduped.dedup();
    assert_eq!(
        deduped.len(),
        ttls.len(),
        "no two contexts may share a TTL"
    );
    // The AVERAGE spacing is what the design's "~21 minutes apart" refers to. A
    // hash-mod cannot guarantee a per-pair minimum, and this asserts the real
    // guarantee rather than an aspirational one: the closest pair on the shipped
    // catalog is 232s apart (just under the 240s probe timeout), so at
    // `semaphore = 1` the worst case is ONE probe waiting briefly on the gate —
    // not a herd. Asserting a 5-minute floor here would pin a property the design
    // does not actually provide.
    let average_gap = span / (ttls.len() as u64 - 1);
    assert!(
        average_gap >= 15 * 60,
        "the average spacing must stay in the tens of minutes, got {average_gap}s"
    );
    let min_gap = ttls
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .min()
        .expect("gaps");
    assert!(
        min_gap >= 120,
        "even the closest pair must not effectively co-expire, got {min_gap}s"
    );

    // A zero jitter span degrades to the flat base rather than dividing by zero.
    assert_eq!(
        ttl_for_entry_with("claude", "gateway", DEFAULT_TTL_BASE, Duration::ZERO),
        DEFAULT_TTL_BASE
    );
}

// ---------------------------------------------------------------------------
// T-18, T-19: fingerprint scoping, stability and sensitivity
// ---------------------------------------------------------------------------

fn contexts_for(id: &str) -> Vec<crate::domains::agents::catalog::schema::AgentCatalogAuthContext> {
    use crate::domains::agents::catalog::schema::{AgentCatalogAuthContext, AgentCatalogAuthSignal};
    vec![AgentCatalogAuthContext {
        id: id.to_string(),
        auth_slot_id: Some("gateway".to_string()),
        description: None,
        signals: Some(AgentCatalogAuthSignal::Route("gateway".to_string())),
    }]
}

fn state_json(revision: i64, harnesses: serde_json::Value) -> serde_json::Value {
    json!({ "version": 2, "revision": revision, "harnesses": harnesses })
}

fn gateway_harness(kind: &str, key: &str) -> serde_json::Value {
    json!({
        "harness_kind": kind,
        "sources": [{ "kind": "gateway", "base_url": "https://gw.example", "key": key }],
    })
}

fn fingerprint_of(home: &TempHome, harness: &str, context_id: &str) -> String {
    let material = probe_auth_material_for_server(
        home.path(),
        harness,
        context_id,
        &contexts_for(context_id),
        None,
    )
    .expect("material");
    fingerprint(&material)
}

/// T-18 — **the per-context scoping property.** Rotating ONE harness's key must
/// move only that harness's fingerprint. This fails under revision keying (the
/// global revision bumps for both) and passes under fingerprint keying.
#[test]
fn rotating_one_harnesss_key_leaves_the_other_harness_fresh() {
    let home = TempHome::new("fingerprint-scope");
    home.write_state_json(&state_json(
        4,
        json!([gateway_harness("claude", "sk-a"), gateway_harness("codex", "sk-b")]),
    ));
    let claude_before = fingerprint_of(&home, "claude", "gateway");
    let codex_before = fingerprint_of(&home, "codex", "gateway");

    // Rotate claude's key only. Note the revision ALSO bumps, exactly as the real
    // control plane would — which is what makes revision keying wrong.
    home.write_state_json(&state_json(
        5,
        json!([gateway_harness("claude", "sk-a-ROTATED"), gateway_harness("codex", "sk-b")]),
    ));
    let claude_after = fingerprint_of(&home, "claude", "gateway");
    let codex_after = fingerprint_of(&home, "codex", "gateway");

    assert_ne!(claude_before, claude_after, "the rotated harness must go stale");
    assert_eq!(
        codex_before, codex_after,
        "the untouched harness must stay fresh even though the global revision moved"
    );

    // And the gate agrees, not just the digests.
    let identity = identity(Some("1.0"), Some("sha"), "npm");
    let codex_entry = entry(HOUR, Some(identity.clone()), &codex_before);
    assert_eq!(
        evaluate(
            Some(&codex_entry),
            Some(&identity),
            &codex_after,
            now(),
            24 * HOUR
        ),
        Freshness::Fresh
    );
    let claude_entry = entry(HOUR, Some(identity.clone()), &claude_before);
    assert_eq!(
        evaluate(
            Some(&claude_entry),
            Some(&identity),
            &claude_after,
            now(),
            24 * HOUR
        ),
        Freshness::Stale(StaleReason::AuthMoved)
    );
}

/// T-19 — stability and sensitivity: identical material digests identically, and
/// each input that could change what a launch resolves to moves the digest.
#[test]
fn the_fingerprint_is_stable_and_sensitive_to_every_input() {
    let home = TempHome::new("fingerprint-sensitivity");
    home.write_state_json(&state_json(1, json!([gateway_harness("claude", "sk-1")])));

    let baseline = fingerprint_of(&home, "claude", "gateway");
    assert_eq!(
        baseline,
        fingerprint_of(&home, "claude", "gateway"),
        "identical material must digest identically"
    );
    assert!(baseline.starts_with("sha256:"));

    // The key.
    home.write_state_json(&state_json(1, json!([gateway_harness("claude", "sk-2")])));
    let key_changed = fingerprint_of(&home, "claude", "gateway");
    assert_ne!(baseline, key_changed);

    // The base URL.
    home.write_state_json(&state_json(
        1,
        json!([{
            "harness_kind": "claude",
            "sources": [{ "kind": "gateway", "base_url": "https://other.example", "key": "sk-1" }],
        }]),
    ));
    assert_ne!(baseline, fingerprint_of(&home, "claude", "gateway"));

    // Reordering equivalent env pairs must NOT change it (phase A sorts).
    let home = TempHome::new("fingerprint-order");
    let a_then_b = json!([{
        "harness_kind": "opencode",
        "sources": [
            { "kind": "api_key", "env_var_name": "A_KEY", "value": "1" },
            { "kind": "api_key", "env_var_name": "B_KEY", "value": "2" },
        ],
    }]);
    let b_then_a = json!([{
        "harness_kind": "opencode",
        "sources": [
            { "kind": "api_key", "env_var_name": "B_KEY", "value": "2" },
            { "kind": "api_key", "env_var_name": "A_KEY", "value": "1" },
        ],
    }]);
    let both_context = {
        use crate::domains::agents::catalog::schema::{
            AgentCatalogAuthContext, AgentCatalogAuthSignal,
        };
        vec![AgentCatalogAuthContext {
            id: "multi".to_string(),
            auth_slot_id: Some("anthropic".to_string()),
            description: None,
            signals: Some(AgentCatalogAuthSignal::AnyOf(vec![
                AgentCatalogAuthSignal::Env("A_KEY".into()),
                AgentCatalogAuthSignal::Env("B_KEY".into()),
            ])),
        }]
    };
    home.write_state_json(&state_json(1, a_then_b));
    let forward = fingerprint(
        &probe_auth_material_for_server(home.path(), "opencode", "multi", &both_context, None)
            .expect("material"),
    );
    home.write_state_json(&state_json(1, b_then_a));
    let reversed = fingerprint(
        &probe_auth_material_for_server(home.path(), "opencode", "multi", &both_context, None)
            .expect("material"),
    );
    assert_eq!(
        forward, reversed,
        "source order must not change the fingerprint"
    );
}

// ---------------------------------------------------------------------------
// T-27, T-28: document round-trip and the status projection
// ---------------------------------------------------------------------------

/// T-27 — the document round-trips as camelCase, an unreadable or
/// schema-mismatched document reads as absent, and a truncated tmp file is never
/// mistaken for the document.
#[test]
fn the_document_round_trips_and_degrades_to_absent() {
    use super::document::{
        read_document, snapshot_path, write_document, write_entry, MODEL_SNAPSHOT_SCHEMA_VERSION,
    };

    let home = TempHome::new("document");
    let identity = identity(Some("1.0"), Some("sha"), "pinned_archive");
    let written = entry(HOUR, Some(identity), FP);

    write_entry(home.path(), "opencode", "gateway", written.clone()).expect("write");
    let read = read_document(home.path(), "opencode").expect("document");
    assert_eq!(read.agent, "opencode");
    assert_eq!(read.schema_version, MODEL_SNAPSHOT_SCHEMA_VERSION);
    assert_eq!(read.entries.get("gateway"), Some(&written));

    // camelCase on the wire, like the sibling install-manifest.json.
    let raw = std::fs::read_to_string(snapshot_path(home.path(), "opencode")).expect("raw");
    assert!(raw.contains("\"probedAt\""));
    assert!(raw.contains("\"authFingerprint\""));
    assert!(raw.contains("\"installIdentity\""));
    assert!(raw.contains("\"lastAttempt\""));
    assert!(!raw.contains("probed_at"));

    // A second entry merges rather than replacing the document.
    write_entry(home.path(), "opencode", "baseline", written.clone()).expect("write second");
    let merged = read_document(home.path(), "opencode").expect("document");
    assert_eq!(merged.entries.len(), 2);

    // Unparseable => absent.
    std::fs::write(snapshot_path(home.path(), "opencode"), b"{not json").expect("corrupt");
    assert!(read_document(home.path(), "opencode").is_none());

    // Schema mismatch => absent (the next trigger rewrites it whole).
    let mut future = ModelSnapshotDocument::empty("opencode");
    future.schema_version = MODEL_SNAPSHOT_SCHEMA_VERSION + 1;
    write_document(home.path(), "opencode", &future).expect("write future");
    assert!(read_document(home.path(), "opencode").is_none());

    // A truncated tmp file left by a crash is never read as the document.
    write_entry(home.path(), "grok", "gateway", written).expect("write grok");
    let tmp = snapshot_path(home.path(), "grok").with_extension("json.tmp-abandoned");
    std::fs::write(&tmp, b"{\"schemaVersion\":1,\"agent\":\"grok\"").expect("write tmp");
    assert!(
        read_document(home.path(), "grok").is_some(),
        "the real document still reads"
    );
    assert!(tmp.exists(), "and the abandoned tmp is simply ignored");
}

/// T-28 — the status projection: ages, staleness, `identityComparable`, the live
/// state, and — the contract rule — no `authFingerprint` on the wire.
#[test]
fn the_status_projection_shapes_every_field_and_never_exposes_the_fingerprint() {
    let current = identity(Some("1.0"), Some("sha-1"), "pinned_archive");
    let secret_fingerprint = "sha256:deadbeefdeadbeef";
    let fresh_entry = entry(HOUR, Some(current.clone()), secret_fingerprint);

    let status = status::context_status(ContextStatusInputs {
        auth_context_id: "gateway".to_string(),
        active: true,
        entry: Some(fresh_entry.clone()),
        current_identity: Some(current.clone()),
        current_fingerprint: Some(secret_fingerprint.to_string()),
        now: now(),
        ttl: 24 * HOUR,
        live_state: LiveState::Idle,
        next_attempt_at: None,
    });
    assert_eq!(status.snapshot_age_seconds, Some(3600));
    assert!(!status.stale);
    assert_eq!(status.stale_reason, None);
    assert!(status.identity_comparable);
    assert_eq!(status.state, LiveState::Idle);
    assert_eq!(status.model_count, 1);
    assert_eq!(status.mode_count, 1);
    assert_eq!(status.last_error, None);
    assert_eq!(status.next_attempt_at, None);

    let serialized = serde_json::to_string(&status).expect("serialize");
    assert!(
        !serialized.contains(secret_fingerprint),
        "the credential-derived fingerprint must never reach the wire"
    );
    assert!(!serialized.contains("authFingerprint"));
    assert!(serialized.contains("\"snapshotAgeSeconds\":3600"));
    assert!(serialized.contains("\"identityComparable\":true"));
    assert!(serialized.contains("\"state\":\"idle\""));

    // An indeterminate identity must tell the UI to claim no version binding.
    let pre_field = entry(HOUR, None, secret_fingerprint);
    let indeterminate = status::context_status(ContextStatusInputs {
        auth_context_id: "gateway".to_string(),
        active: true,
        entry: Some(pre_field),
        current_identity: Some(current.clone()),
        current_fingerprint: Some(secret_fingerprint.to_string()),
        now: now(),
        ttl: 24 * HOUR,
        live_state: LiveState::Running,
        next_attempt_at: None,
    });
    assert!(!indeterminate.identity_comparable);
    assert!(!indeterminate.stale, "indeterminate is not stale");
    assert_eq!(indeterminate.state, LiveState::Running);

    // A failed last attempt lifts its detail to `lastError` while `probedAt` and
    // the model list keep serving.
    let mut failed = entry(2 * HOUR, Some(current.clone()), secret_fingerprint);
    let failed_probed_at = failed.probed_at.clone();
    failed.last_attempt = SnapshotAttempt {
        at: now().to_rfc3339(),
        outcome: AttemptOutcome::Failed,
        detail: Some("timeout".to_string()),
    };
    let next = now() + chrono::Duration::minutes(2);
    let backoff = status::context_status(ContextStatusInputs {
        auth_context_id: "gateway".to_string(),
        active: false,
        entry: Some(failed),
        current_identity: Some(current.clone()),
        current_fingerprint: Some(secret_fingerprint.to_string()),
        now: now(),
        ttl: 24 * HOUR,
        live_state: LiveState::Backoff,
        next_attempt_at: Some(next),
    });
    assert_eq!(backoff.last_error.as_deref(), Some("timeout"));
    assert_eq!(backoff.probed_at.as_deref(), Some(failed_probed_at.as_str()));
    assert_eq!(backoff.model_count, 1, "the last good list keeps serving");
    assert_eq!(backoff.state, LiveState::Backoff);
    assert_eq!(backoff.next_attempt_at, Some(next.to_rfc3339()));
    assert!(!backoff.active);

    // An unresolvable context reads authMoved rather than silently fresh.
    let unresolvable = status::context_status(ContextStatusInputs {
        auth_context_id: "gateway".to_string(),
        active: true,
        entry: Some(entry(HOUR, Some(current.clone()), secret_fingerprint)),
        current_identity: Some(current),
        current_fingerprint: None,
        now: now(),
        ttl: 24 * HOUR,
        live_state: LiveState::Idle,
        next_attempt_at: None,
    });
    assert!(unresolvable.stale);
    assert_eq!(unresolvable.stale_reason.as_deref(), Some("authMoved"));

    // The engine mode serializes as the documented strings.
    assert_eq!(
        serde_json::to_string(&ProbeEngineMode::Owner).expect("serialize"),
        "\"owner\""
    );
    assert_eq!(
        serde_json::to_string(&ProbeEngineMode::ReadOnly).expect("serialize"),
        "\"readonly\""
    );
}

/// A missing entry projects as `missing`, with zero counts and no invented age —
/// the state a machine is in before its first probe.
#[test]
fn a_context_with_no_entry_projects_as_missing() {
    let status = status::context_status(ContextStatusInputs {
        auth_context_id: "baseline".to_string(),
        active: true,
        entry: None,
        current_identity: Some(identity(Some("1.0"), Some("sha"), "npm")),
        current_fingerprint: Some(FP.to_string()),
        now: now(),
        ttl: 24 * HOUR,
        live_state: LiveState::Idle,
        next_attempt_at: None,
    });
    assert!(status.stale);
    assert_eq!(status.stale_reason.as_deref(), Some("missing"));
    assert!(!status.identity_comparable);
    assert_eq!(status.probed_at, None);
    assert_eq!(status.snapshot_age_seconds, None);
    assert_eq!(status.model_count, 0);
    let _unused: BTreeMap<String, String> = BTreeMap::new();
}
