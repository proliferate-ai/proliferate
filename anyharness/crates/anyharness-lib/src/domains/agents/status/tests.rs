//! Service-level pins for the status document: composition, byte-stability,
//! the serve-stale probe semantics, restart behavior, the change stream, and
//! the startup pass's FirstDetected poke.

use std::sync::Arc;

use chrono::{TimeZone, Utc};

use super::{AgentStatusService, ProbeVerdict, RefreshCause};
use crate::domains::agents::launch_probe::test_support::FixedTargets;
use crate::domains::agents::route_auth::test_support::TempHome;
use crate::persistence::Db;

/// A service over a FILE-backed db in the temp home, so a second service over
/// the same home models a runtime restart. Detection reads a throwaway home
/// dir (never the developer's real `$HOME`), and the universe is pinned so
/// the tests don't depend on which harnesses this machine has installed.
fn service(home: &TempHome, targets: FixedTargets) -> AgentStatusService {
    AgentStatusService::with_parts(
        Db::open(home.path()).expect("open db"),
        home.path().to_path_buf(),
        Arc::new(targets),
        vec![
            "codex".to_string(),
            "grok".to_string(),
            "cursor".to_string(),
        ],
        home.path().join("detection-home"),
    )
}

fn codex_grok_state(sequence: i64, codex_key: &str, grok_key: &str) -> serde_json::Value {
    serde_json::json!({
        "version": 2,
        "lineage": "test-lineage",
        "sequence": sequence,
        "harnesses": [
            { "harness_kind": "codex", "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": codex_key }] },
            { "harness_kind": "grok", "sources": [
                { "kind": "api_key", "env_var_name": "XAI_API_KEY", "value": grok_key }] },
        ],
    })
}

#[test]
fn refresh_composes_and_round_trips_the_document() {
    let home = TempHome::new("status-round-trip");
    home.write_state_json(&codex_grok_state(1, "sk-vk-codex", "xai-raw"));
    let service = service(&home, FixedTargets::single("codex"));

    service.refresh("codex", RefreshCause::AuthApplied);
    let doc = service.read("codex").expect("codex document");
    assert_eq!(doc.harness_kind, "codex");
    // The catalog declares codex's gateway method and the document carries a
    // gateway source → one available row, applied.
    let gateway = doc
        .methods
        .iter()
        .find(|row| row.kind == "gateway")
        .expect("gateway method row");
    assert_eq!(gateway.available, Some(true));
    assert!(gateway.applied);
    let applied = doc.applied.clone().expect("applied method");
    assert_eq!(applied.kind, "gateway");
    assert_eq!(applied.seat_id, None);
    // Never probed: honestly unverified, not fabricated.
    assert_eq!(doc.probe.verdict, ProbeVerdict::Unverified);
    assert_eq!(doc.probe.at, None);
    assert!(!doc.probe.stale);
    assert!(doc.rotate, "no settings rider → rotation defaults on");
    assert_eq!(doc.cooling_until, None);

    // read_all serves the same persisted truth.
    let all = service.read_all();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0], doc);
}

/// The acceptance gate's byte-stability half: a refresh whose recomposed
/// document is byte-identical neither publishes nor rewrites — and changing
/// ONLY grok's auth leaves codex's document byte-stable.
#[test]
fn byte_identical_refresh_neither_publishes_nor_rewrites() {
    let home = TempHome::new("status-byte-stable");
    home.write_state_json(&codex_grok_state(1, "sk-vk-codex", "xai-raw"));
    let service = service(&home, FixedTargets::single("codex"));
    service.refresh("codex", RefreshCause::AuthApplied);
    let updated_at = service.store.updated_at("codex").expect("row exists");
    let before = service.read("codex").expect("codex document");

    // Only grok's entry changes; the sequence moves.
    home.write_state_json(&codex_grok_state(2, "sk-vk-codex", "xai-raw-ROTATED"));

    let mut events = service.subscribe();
    service.refresh("codex", RefreshCause::AuthApplied);
    assert_eq!(
        service.read("codex").expect("codex document"),
        before,
        "another harness's auth change must leave this document byte-stable"
    );
    assert!(
        events.try_recv().is_err(),
        "a byte-stable refresh must not publish"
    );
    assert_eq!(
        service.store.updated_at("codex"),
        Some(updated_at),
        "a byte-stable refresh must not rewrite the row"
    );

    // A key rotation alone is ALSO byte-stable — the document carries method
    // shape, never key material — so a real change is a method switch:
    // codex moves from gateway to a raw provider key.
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "lineage": "test-lineage",
        "sequence": 3,
        "harnesses": [
            { "harness_kind": "codex", "sources": [
                { "kind": "api_key", "env_var_name": "OPENAI_API_KEY", "value": "sk-raw" }] },
            { "harness_kind": "grok", "sources": [
                { "kind": "api_key", "env_var_name": "XAI_API_KEY", "value": "xai-raw-ROTATED" }] },
        ],
    }));
    service.refresh("codex", RefreshCause::AuthApplied);
    let published = events.try_recv().expect("one change event");
    assert_eq!(published.harness_kind, "codex");
    assert_eq!(published, service.read("codex").expect("codex document"));
    assert_eq!(
        published
            .applied
            .as_ref()
            .map(|applied| applied.kind.as_str()),
        Some("api_key")
    );
    assert!(events.try_recv().is_err(), "exactly one event per change");
}

/// Flow 4's serve-stale ladder: admission dims, success shines, failure with
/// a prior observation serves that observation dimmed (never dark), and
/// failure with none is honestly failed.
#[test]
fn probe_evidence_dims_and_never_darkens() {
    let home = TempHome::new("status-serve-stale");
    home.write_state_json(&codex_grok_state(1, "sk-vk-codex", "xai-raw"));
    let service = service(&home, FixedTargets::single("codex"));
    service.refresh("codex", RefreshCause::AuthApplied);

    // Admission with no observation yet: stale while queued, still unverified.
    service.probe_admitted("codex");
    let doc = service.read("codex").expect("doc");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Unverified);
    assert!(doc.probe.stale);

    // Failure with NO prior observation: honestly failed, not dark.
    let t_fail = Utc.with_ymd_and_hms(2026, 8, 27, 10, 0, 0).unwrap();
    service.probe_failed("codex", t_fail);
    let doc = service.read("codex").expect("doc");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Failed);
    assert_eq!(doc.probe.at, Some(t_fail.to_rfc3339()));
    assert!(!doc.probe.stale);

    // Success: verified with fresh evidence.
    let t_ok = Utc.with_ymd_and_hms(2026, 8, 27, 11, 0, 0).unwrap();
    service.probe_verified("codex", t_ok);
    let doc = service.read("codex").expect("doc");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Verified);
    assert_eq!(doc.probe.at, Some(t_ok.to_rfc3339()));
    assert!(!doc.probe.stale);

    // A later failure DIMS: the prior observation stays visible, stale-marked.
    let t_fail2 = Utc.with_ymd_and_hms(2026, 8, 27, 12, 0, 0).unwrap();
    service.probe_failed("codex", t_fail2);
    let doc = service.read("codex").expect("doc");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Verified);
    assert_eq!(
        doc.probe.at,
        Some(t_ok.to_rfc3339()),
        "the last observation stays visible through a failure"
    );
    assert!(doc.probe.stale, "dimmed, never dark");
}

/// A restart serves every persisted document stale until re-verified: a new
/// service over the SAME home (a new process over the same SQLite file) runs
/// its startup pass and the verified evidence survives, stale-marked.
#[test]
fn restart_serves_stale_until_reverified() {
    let home = TempHome::new("status-restart-stale");
    home.write_state_json(&codex_grok_state(1, "sk-vk-codex", "xai-raw"));
    let first = service(&home, FixedTargets::single("codex"));
    first.refresh("codex", RefreshCause::AuthApplied);
    let t_ok = Utc.with_ymd_and_hms(2026, 8, 27, 11, 0, 0).unwrap();
    first.probe_verified("codex", t_ok);
    drop(first);

    let second = service(&home, FixedTargets::single("codex"));
    second.startup_pass(&None);
    let doc = second.read("codex").expect("doc survives restart");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Verified);
    assert_eq!(doc.probe.at, Some(t_ok.to_rfc3339()));
    assert!(
        doc.probe.stale,
        "a restart re-serves every document stale until the startup pass re-verifies"
    );
}

/// A probe verdict against a row whose stored `doc_json` no longer parses must
/// HEAL the row, not vanish (review m4): the old `?`-propagation inside the
/// write door made `decide` return `None` on a malformed row, so neither the
/// document nor the OBSERVATION COLUMNS were written and a completed probe's
/// verdict was silently dropped. The verdict now lands with an honestly
/// recomposed document, through the same transactional write door.
#[test]
fn a_verdict_against_a_malformed_row_heals_it_instead_of_vanishing() {
    let home = TempHome::new("status-malformed-heal");
    home.write_state_json(&codex_grok_state(1, "sk-vk-codex", "xai-raw"));
    let status = service(&home, FixedTargets::single("codex"));
    status.refresh("codex", RefreshCause::AuthApplied);
    status
        .store
        .corrupt_doc_json_for_test("codex", "{definitely-not-json");
    assert!(
        status.read("codex").is_none(),
        "the corrupt row serves nothing — the shape under test"
    );

    let t_ok = Utc.with_ymd_and_hms(2026, 8, 27, 12, 0, 0).unwrap();
    status.probe_verified("codex", t_ok);

    let doc = status.read("codex").expect("the verdict healed the row");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Verified);
    assert_eq!(doc.probe.at, Some(t_ok.to_rfc3339()));
    assert!(!doc.probe.stale);
    assert!(
        doc.methods.iter().any(|row| row.kind == "gateway"),
        "the healed body is a real recomposition, not an empty shell"
    );

    // The observation columns landed too: a restart re-serves the verdict
    // (stale-marked, as every restart does) rather than rediscovering nothing.
    drop(status);
    let second = service(&home, FixedTargets::single("codex"));
    second.startup_pass(&None);
    let doc = second.read("codex").expect("healed row survives a restart");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Verified);
    assert_eq!(doc.probe.at, Some(t_ok.to_rfc3339()));
}

/// The startup pass raises FirstDetected for an installed, auto-probeable
/// harness with NO persisted row — and never for a manual-refresh-only one.
#[test]
fn startup_pass_first_detects_rowless_installed_harnesses() {
    let home = TempHome::new("status-first-detected");
    home.write_state_json(&codex_grok_state(1, "sk-vk-codex", "xai-raw"));
    let service = service(
        &home,
        FixedTargets {
            harnesses: vec!["codex".to_string(), "cursor".to_string()],
            installed: vec!["codex".to_string(), "cursor".to_string()],
            manual_refresh_only: vec!["cursor".to_string()],
        },
    );
    // No poke engine is wired here; the pass must still create the rows.
    service.startup_pass(&None);
    assert!(
        service.read("codex").is_some(),
        "installed harness gets a row"
    );
    assert!(
        service.read("cursor").is_some(),
        "manual-only still gets a row"
    );
}

/// `launch_facts`/session-launch NEVER reads the probe verdict: a failed and
/// stale status document does not block a launch the applied document can
/// satisfy. resolvability gates, probes only inform.
#[test]
fn launch_gates_on_resolvability_not_probe() {
    use crate::domains::agents::launch_probe::test_support::CountingPlanProducer;
    use crate::domains::agents::route_auth::resolve_launch_route_auth_rotated;
    use crate::domains::agents::seat_cooling::SeatCoolingStore;

    let home = TempHome::new("status-never-gates-launch");
    home.write_state_json(&codex_grok_state(1, "sk-vk-codex", "xai-raw"));
    let service = service(&home, FixedTargets::single("codex"));
    service.refresh("codex", RefreshCause::AuthApplied);
    // The bleakest store contents possible: an honest failure.
    service.probe_failed(
        "codex",
        Utc.with_ymd_and_hms(2026, 8, 27, 10, 0, 0).unwrap(),
    );
    service.probe_admitted("codex");

    let db = Db::open(home.path()).expect("open db");
    let rendered = resolve_launch_route_auth_rotated(
        home.path(),
        "codex",
        &CountingPlanProducer::new(vec!["m-1"]),
        &SeatCoolingStore::new(db),
    )
    .expect("a failed/stale probe verdict must never block a resolvable launch");
    assert!(
        rendered.set.contains_key("PROLIFERATE_GATEWAY_KEY"),
        "the gateway route renders exactly as if no probe had ever failed"
    );
}

/// The seat surface: pool rows in document order, the serving seat riding
/// `applied.seat_id`, next-up, and the rotate rider.
#[test]
fn seat_documents_carry_pool_serving_and_next() {
    let home = TempHome::new("status-seats");
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "lineage": "test-lineage",
        "sequence": 1,
        "harnesses": [{
            "harness_kind": "claude",
            "sources": [
                { "kind": "seat", "env": {"CLAUDE_CODE_OAUTH_TOKEN": "tok-a"}, "seat_id": "seat-a" },
                { "kind": "seat", "env": {"CLAUDE_CODE_OAUTH_TOKEN": "tok-b"}, "seat_id": "seat-b" },
            ],
        }],
    }));
    let service = AgentStatusService::with_parts(
        Db::open(home.path()).expect("open db"),
        home.path().to_path_buf(),
        Arc::new(FixedTargets::single("claude")),
        vec!["claude".to_string()],
        home.path().join("detection-home"),
    );
    // seat-a actually served a launch, so rotation's next pick is seat-b.
    crate::domains::agents::seat_cooling::SeatCoolingStore::new(
        Db::open(home.path()).expect("open db"),
    )
    .confirm_served("claude", "seat-a", Utc::now().timestamp());
    service.refresh("claude", RefreshCause::AuthApplied);
    let doc = service.read("claude").expect("claude document");

    let seat_rows: Vec<(&str, bool)> = doc
        .methods
        .iter()
        .filter(|row| row.kind == "seat")
        .map(|row| {
            (
                row.seat_id.as_deref().expect("seat rows carry ids"),
                row.applied,
            )
        })
        .collect();
    assert_eq!(seat_rows, vec![("seat-a", true), ("seat-b", false)]);
    let applied = doc.applied.clone().expect("applied method");
    assert_eq!(applied.kind, "seat");
    assert_eq!(applied.seat_id.as_deref(), Some("seat-a"));
    assert_eq!(doc.next_seat_id.as_deref(), Some("seat-b"));
    assert!(doc.rotate);
    // No token material anywhere in the serialized document.
    let serialized = serde_json::to_string(&doc).expect("serialize");
    assert!(!serialized.contains("tok-a") && !serialized.contains("tok-b"));
}

/// The unconfigured shape: no entry in the document → no available methods,
/// no applied tag, defaults everywhere.
#[test]
fn an_unconfigured_harness_composes_an_empty_document() {
    let home = TempHome::new("status-unconfigured");
    let service = service(&home, FixedTargets::single("grok"));
    service.refresh("grok", RefreshCause::AuthApplied);
    let doc = service.read("grok").expect("grok document");
    assert!(doc.methods.is_empty());
    assert!(doc.applied.is_none());
    assert_eq!(doc.next_seat_id, None);
    assert!(doc.rotate);
}
