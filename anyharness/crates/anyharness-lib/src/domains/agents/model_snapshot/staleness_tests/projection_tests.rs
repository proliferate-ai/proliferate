//! T-27, T-28: document round-trip and the status projection.

use super::*;

// ---------------------------------------------------------------------------
// T-27, T-28: document round-trip and the status projection
// ---------------------------------------------------------------------------

/// T-27 — the document round-trips as camelCase, an unreadable or
/// schema-mismatched document reads as absent, and a truncated tmp file is never
/// mistaken for the document.
#[test]
fn the_document_round_trips_and_degrades_to_absent() {
    use super::super::document::{
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
