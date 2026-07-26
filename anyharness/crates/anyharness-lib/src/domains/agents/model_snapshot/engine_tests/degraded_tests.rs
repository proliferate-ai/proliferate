//! T-29 poke fan-out, plus every degraded-input fail-closed case.

use super::*;

// ---------------------------------------------------------------------------
// Adversarial: every degraded input must fail closed
// ---------------------------------------------------------------------------

/// Everything that can be broken about the engine's inputs must fail CLOSED: it
/// declines to probe or records an honest failure, and it never panics, never
/// spins, and never serves a fiction.
///
/// Four degradations, each a state a real user machine reaches.
#[tokio::test]
async fn a_corrupt_state_file_declines_to_probe_and_surfaces_a_typed_error() {
    let home = TempRuntimeHome::new("degraded-state");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let state_path = crate::domains::agents::route_auth::state::state_file_path(home.path());
    std::fs::create_dir_all(state_path.parent().expect("parent")).expect("mkdir");
    std::fs::write(&state_path, b"{not json").expect("corrupt state");

    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );

    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    assert_eq!(
        runner.count(),
        0,
        "a corrupt state.json must not produce a probe"
    );
    // A caller who explicitly asked DOES get told why.
    let error = service
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("typed error");
    assert_eq!(error.code(), "MODEL_SNAPSHOT_MATERIAL_FAILED");
    // And the status surface answers rather than panicking.
    assert_eq!(
        service.status("opencode", chrono::Utc::now()).agent,
        "opencode"
    );
}

/// No `state.json` at all is NOT a degradation — it is a fresh desktop, and its
/// native logins are exactly what the snapshot exists to observe. Declining here
/// would leave every un-enrolled machine with no observation at all.
#[tokio::test]
async fn a_machine_with_no_enrolled_auth_still_observes_its_native_models() {
    let home = TempRuntimeHome::new("degraded-nostate");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let (service, runner, _plan) =
        engine(&home, "opencode", vec![gateway_context()], test_config());

    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    assert!(read_document(home.path(), "opencode").is_some());
}

/// A corrupt snapshot document reads as absent, so the entry is `Missing` and the
/// next poke rewrites the document whole. It is derived state: deleting it loses
/// nothing a re-probe cannot restore, and refusing to serve over it would be
/// strictly worse.
#[tokio::test]
async fn a_corrupt_snapshot_document_is_rewritten_whole_by_the_next_poke() {
    let home = seeded_home("degraded-document", "opencode");
    let document_path = super::super::document::snapshot_path(home.path(), "opencode");
    std::fs::create_dir_all(document_path.parent().expect("parent")).expect("mkdir");
    std::fs::write(&document_path, b"{\"schemaVersion\":1,\"agent\":").expect("corrupt");

    let (service, runner, _plan) =
        engine(&home, "opencode", vec![gateway_context()], test_config());
    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;

    assert_eq!(runner.count(), 1, "a corrupt document must read as absent");
    let healed = read_document(home.path(), "opencode").expect("rewritten whole");
    assert!(healed.entries.contains_key("gateway"));
}

/// A selection the machine cannot honor for a PURE env context: the gate declines
/// silently (an automatic poke must not manufacture failed attempts), an explicit
/// caller gets the typed error, and the status surface shows it stale rather than
/// silently fresh.
#[tokio::test]
async fn an_unsatisfiable_context_is_declined_silently_but_reads_stale() {
    let home = TempRuntimeHome::new("degraded-selection");
    home.write_state_json(&gateway_state(2, &[("opencode", "sk-vk")]));
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");

    let runner = Arc::new(FakeRunner::new());
    let targets = FixedTargets::single(
        "opencode",
        vec![env_context("gemini-api", "gemini", &["GEMINI_API_KEY"])],
    );
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    service
        .probe_if_stale("opencode", "gemini-api", PokeReason::Startup)
        .await;
    assert_eq!(
        runner.count(),
        0,
        "a selection the machine cannot honor must not spawn"
    );
    let error = service
        .refresh_now("opencode", "gemini-api")
        .await
        .expect_err("typed refusal");
    assert_eq!(error.code(), "MODEL_SNAPSHOT_MATERIAL_FAILED");

    let status = service.status("opencode", chrono::Utc::now());
    let context = status
        .contexts
        .iter()
        .find(|context| context.auth_context_id == "gemini-api")
        .expect("gemini-api context");
    assert!(context.stale, "an unresolvable context must read stale");
}
