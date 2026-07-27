//! Forced refresh: coalescing, and the typed refusals.

use super::*;

/// Two CONCURRENT forced refreshes coalesce onto one spawn — the loser adopts the
/// winner's observation, because it completed after the loser asked — while two
/// SEQUENTIAL refreshes produce two spawns, because "refreshed just now" must
/// never label a result that predates the press.
#[tokio::test]
async fn concurrent_refreshes_coalesce_and_sequential_refreshes_do_not() {
    // (a) concurrent: one spawn, both callers served.
    let home = seeded_home("refresh-coalesce", "opencode");
    let (runner, release) = FakeRunner::gated();
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode")),
        runner.clone(),
        test_config(),
    ));

    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.refresh_now("opencode").await })
    };
    let second = {
        let service = service.clone();
        tokio::spawn(async move { service.refresh_now("opencode").await })
    };
    tokio::task::yield_now().await;
    release.send(true).expect("release");
    let first = first.await.expect("join").expect("first ok");
    let second = second.await.expect("join").expect("second ok");
    assert_eq!(
        runner.count(),
        1,
        "concurrent forced refreshes must coalesce onto one spawn"
    );
    assert_eq!(
        first.probed_at, second.probed_at,
        "both callers were served the same observation"
    );

    // (b) sequential: the second press postdates the first observation, so it
    // genuinely re-probes — the auth world may have changed between them.
    let before = service.refresh_now("opencode").await.expect("third refresh");
    assert_eq!(runner.count(), 2, "a later refresh must spawn again");
    let after = service.refresh_now("opencode").await.expect("fourth refresh");
    assert_eq!(runner.count(), 3);
    assert!(
        after.probed_at >= before.probed_at,
        "the newer observation postdates the older one"
    );
}

/// A forced refresh on a not-installed target is a typed refusal, not a spawn.
#[tokio::test]
async fn a_forced_refresh_refuses_an_uninstalled_harness() {
    let home = seeded_home("refresh-refusals", "opencode");
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("opencode");
    // `grok` is a target but not installed.
    targets.harnesses.push("grok".to_string());
    let service = ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    );

    let not_installed = service
        .refresh_now("grok")
        .await
        .expect_err("not installed");
    assert!(matches!(not_installed, RefreshError::NotInstalled(_)));
    assert_eq!(not_installed.code(), "MODEL_SNAPSHOT_NOT_INSTALLED");
    assert_eq!(runner.count(), 0, "the refusal may not spawn");
}

/// A not-installed harness is filtered BEFORE spawning, and no `lastAttempt` is
/// written: `probe_agent`'s install precondition is never reached, and a missing
/// install must not render as a probe error.
#[tokio::test]
async fn a_not_installed_harness_is_filtered_before_spawning() {
    let home = TempRuntimeHome::new("not-installed");
    home.write_state_json(&gateway_state(1, &[("grok", "sk-vk")]));
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("grok");
    targets.installed.clear();
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    service.clone().poke_all(PokeReason::Startup);
    service
        .clone()
        .poke_harness("grok", PokeReason::InstallCompleted);
    tokio::task::yield_now().await;

    assert_eq!(runner.count(), 0, "no spawn for an uninstalled harness");
    assert!(
        read_document(home.path(), "grok").is_none(),
        "no lastAttempt document may be written for an uninstalled harness"
    );
}
