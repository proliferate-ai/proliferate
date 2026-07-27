//! Proof B6 plus every degraded-input fail-closed case.

use super::*;

/// Everything that can be broken about the engine's inputs must fail CLOSED: it
/// declines to probe or records an honest failure, and it never panics, never
/// spins, and never serves a fiction.
#[tokio::test]
async fn a_corrupt_state_file_declines_to_probe_and_surfaces_a_typed_error() {
    let home = TempRuntimeHome::new("degraded-state");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let state_path = crate::domains::agents::route_auth::state::state_file_path(home.path());
    std::fs::create_dir_all(state_path.parent().expect("parent")).expect("mkdir");
    std::fs::write(&state_path, b"{not json").expect("corrupt state");

    let (service, runner, _plan) = engine(&home, "opencode", test_config());

    service.probe_on_event("opencode", PokeReason::Startup).await;
    assert_eq!(
        runner.count(),
        0,
        "a corrupt state.json must not produce a probe"
    );
    // A caller who explicitly asked DOES get told why — as a typed code, and NOT as a
    // 502: a malformed local `state.json` is this machine's configuration fault, not
    // an upstream failure, and no upstream was reached. The transport maps it to 409
    // and never echoes the state file's absolute path (see `refresh_error`).
    let error = service
        .refresh_now("opencode")
        .await
        .expect_err("typed error");
    assert_eq!(error.code(), "MODEL_SNAPSHOT_MATERIAL_FAILED");
    assert!(
        matches!(error, RefreshError::Material(_)),
        "a local-config fault must stay distinguishable from a probe failure"
    );
    // And the status surface answers rather than panicking.
    assert_eq!(
        service.status("opencode", chrono::Utc::now()).agent,
        "opencode"
    );
}

/// No `state.json` at all is NOT a degradation — it is a fresh desktop, and its
/// native logins are exactly what the composed probe observes (native is not a
/// special case: the empty profile IS the user's real login). The recorded
/// `stateRevision` is 0: no document = native.
#[tokio::test]
async fn a_machine_with_no_enrolled_auth_still_observes_its_native_models() {
    let home = TempRuntimeHome::new("degraded-nostate");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let (service, runner, _plan) = engine(&home, "opencode", test_config());

    service.probe_on_event("opencode", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    let document = read_document(home.path(), "opencode").expect("document");
    assert_eq!(
        document.state_revision, 0,
        "no state document reads as revision 0 (native)"
    );
}

/// A corrupt snapshot document reads as absent, so the next poke rewrites the
/// document whole. It is derived state: deleting it loses nothing a re-probe
/// cannot restore, and refusing to serve over it would be strictly worse.
#[tokio::test]
async fn a_corrupt_snapshot_document_is_rewritten_whole_by_the_next_poke() {
    let home = seeded_home("degraded-document", "opencode");
    let document_path = super::super::document::snapshot_path(home.path(), "opencode");
    std::fs::create_dir_all(document_path.parent().expect("parent")).expect("mkdir");
    std::fs::write(&document_path, b"{\"schemaVersion\":2,\"agent\":").expect("corrupt");

    let (service, runner, _plan) = engine(&home, "opencode", test_config());
    service.probe_on_event("opencode", PokeReason::Startup).await;

    assert_eq!(runner.count(), 1, "a corrupt document must read as absent");
    let healed = read_document(home.path(), "opencode").expect("rewritten whole");
    assert_eq!(healed.schema_version, 2);
    assert!(!healed.models.is_empty());
}

/// **Proof B2's migration leg.** A schemaVersion-1 document — the superseded
/// per-context `entries` map — is treated as ABSENT: it never parses into an
/// observation, and the next probe rewrites the file whole as v2.
#[tokio::test]
async fn a_v1_per_context_document_reads_as_absent_and_is_rewritten_as_v2() {
    let home = seeded_home("degraded-v1", "opencode");
    let document_path = super::super::document::snapshot_path(home.path(), "opencode");
    std::fs::create_dir_all(document_path.parent().expect("parent")).expect("mkdir");
    // A faithful v1 shape: entries keyed by auth context, with a fingerprint.
    std::fs::write(
        &document_path,
        serde_json::json!({
            "schemaVersion": 1,
            "agent": "opencode",
            "entries": {
                "gateway": {
                    "probedAt": "2026-07-01T00:00:00Z",
                    "mechanism": "acp",
                    "authFingerprint": "sha256:dead",
                    "models": [{ "id": "old-model", "name": "old-model" }],
                    "modes": [],
                    "warnings": [],
                    "lastAttempt": { "at": "2026-07-01T00:00:00Z", "outcome": "ok" }
                }
            }
        })
        .to_string(),
    )
    .expect("write v1 document");

    let (service, runner, _plan) = engine(&home, "opencode", test_config());
    assert!(
        read_document(home.path(), "opencode").is_none(),
        "a v1 document must read as absent"
    );
    assert!(
        service.observed_universe("opencode").is_empty(),
        "a v1 document must not feed the universe"
    );

    service.probe_on_event("opencode", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    let healed = read_document(home.path(), "opencode").expect("rewritten whole as v2");
    assert_eq!(healed.schema_version, 2);
    let raw = std::fs::read_to_string(&document_path).expect("raw");
    assert!(!raw.contains("entries"), "the v1 shape must be gone: {raw}");
    assert!(!raw.contains("authFingerprint"));
}

/// **Proof B6 (reduced observation).** A dead provider INSIDE the composed world
/// is truth, not failure: the spawn succeeds and the observation honestly records
/// the reduced menu — which is exactly what a session would show. No seed
/// backfill fills the gap with fiction.
#[tokio::test]
async fn a_dead_provider_inside_the_composed_world_yields_a_reduced_observation() {
    let home = TempRuntimeHome::new("degraded-reduced");
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "revision": 5,
        "harnesses": [{
            "harness_kind": "opencode",
            "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "sk-vk" },
                { "kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "sk-dead" },
            ],
        }],
    }));
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let (service, runner, _plan) = engine(&home, "opencode", test_config());
    // The harness composes both sources but the anthropic key is dead, so it
    // advertises only the gateway's models — the reduced-but-honest menu.
    *runner.models.lock().expect("models") = vec!["proliferate/claude-fable-5".to_string()];

    let document = service.refresh_now("opencode").await.expect(
        "a dead provider inside the composed world is a SUCCESSFUL reduced observation",
    );
    assert_eq!(document.last_attempt.outcome, AttemptOutcome::Ok);
    assert_eq!(document.models.len(), 1);

    // The universe serves the reduced menu — never the seed.
    let universe = service.observed_universe("opencode");
    assert!(universe.has_observation());
    assert!(universe.observes_id("proliferate/claude-fable-5"));
    assert!(!universe.observes_id("anthropic/claude-fable-5"));
}
