//! T-25, T-26: forced refresh (the pre-queue fingerprint re-check) and the
//! not-installed filter.

use super::*;

// ---------------------------------------------------------------------------
// T-25: forced refresh
// ---------------------------------------------------------------------------

/// T-25(b)(c) — **the forced-refresh fingerprint re-check.**
///
/// (b) Two concurrent forced refreshes with the credential UNCHANGED produce one
/// spawn: the second adopts the winner's result, which genuinely covers its
/// request.
///
/// (c) Two forced refreshes straddling a key rotation produce TWO spawns. Without
/// the pre-queue fingerprint capture, the second caller — who pressed Refresh
/// BECAUSE their key changed — would be handed the pre-change observation labelled
/// "refreshed just now", and no surface could detect the lie.
#[tokio::test]
async fn a_forced_refresh_adopts_a_coalesced_winner_only_when_the_credential_matches() {
    // (b) unchanged credential: one spawn, both callers served.
    let home = seeded_home("refresh-adopt", "opencode");
    let (runner, release) = FakeRunner::gated();
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
        runner.clone(),
        test_config(),
    ));

    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.refresh_now("opencode", "gateway").await })
    };
    let second = {
        let service = service.clone();
        tokio::spawn(async move { service.refresh_now("opencode", "gateway").await })
    };
    tokio::task::yield_now().await;
    release.send(true).expect("release");
    let first = first.await.expect("join").expect("first ok");
    let second = second.await.expect("join").expect("second ok");
    assert_eq!(
        runner.count(),
        1,
        "an unchanged credential must coalesce onto one spawn"
    );
    assert_eq!(
        first.auth_fingerprint, second.auth_fingerprint,
        "both callers were served the same observation"
    );

    // (c) rotation between the two requests: two spawns, and the second carries the
    // NEW fingerprint.
    let home = seeded_home("refresh-rotate", "opencode");
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
        runner.clone(),
        test_config(),
    ));

    let before = service
        .refresh_now("opencode", "gateway")
        .await
        .expect("first refresh");
    home.write_state_json(&gateway_state(4, &[("opencode", "sk-ROTATED")]));
    let after = service
        .refresh_now("opencode", "gateway")
        .await
        .expect("second refresh");

    assert_eq!(runner.count(), 2, "a rotation must force a second spawn");
    assert_ne!(
        before.auth_fingerprint, after.auth_fingerprint,
        "the second entry must carry the ROTATED credential's fingerprint"
    );
}

/// A forced refresh on an unknown or not-installed target is a typed refusal, not
/// a spawn.
#[tokio::test]
async fn a_forced_refresh_refuses_unknown_contexts_and_uninstalled_harnesses() {
    let home = seeded_home("refresh-refusals", "opencode");
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("opencode", vec![gateway_context()]);
    targets.harnesses.push("grok".to_string());
    targets
        .contexts
        .insert("grok".to_string(), vec!["gateway".to_string()]);
    let service = ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    );

    let unknown = service
        .refresh_now("opencode", "not-a-context")
        .await
        .expect_err("unknown context");
    assert!(matches!(unknown, RefreshError::UnknownContext { .. }));
    assert_eq!(unknown.code(), "MODEL_SNAPSHOT_UNKNOWN_CONTEXT");

    // `grok` is a target but not installed.
    let not_installed = service
        .refresh_now("grok", "gateway")
        .await
        .expect_err("not installed");
    assert!(matches!(not_installed, RefreshError::NotInstalled(_)));
    assert_eq!(runner.count(), 0, "neither refusal may spawn");
}

// ---------------------------------------------------------------------------
// T-26: the not-installed filter
// ---------------------------------------------------------------------------

/// T-26 — a not-installed harness is filtered BEFORE spawning, and no
/// `lastAttempt` is written: `probe_agent`'s install precondition is never reached,
/// and a missing install must not render as a probe error.
#[tokio::test]
async fn a_not_installed_harness_is_filtered_before_spawning() {
    let home = TempRuntimeHome::new("not-installed");
    home.write_state_json(&gateway_state(1, &[("grok", "sk-vk")]));
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("grok", vec![gateway_context()]);
    targets.installed.clear();
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    service.clone().poke_all(PokeReason::Startup);
    service.clone().poke_harness("grok", PokeReason::InstallCompleted);
    tokio::task::yield_now().await;

    assert_eq!(runner.count(), 0, "no spawn for an uninstalled harness");
    assert!(
        read_document(home.path(), "grok").is_none(),
        "no lastAttempt entry may be written for an uninstalled harness"
    );
}
