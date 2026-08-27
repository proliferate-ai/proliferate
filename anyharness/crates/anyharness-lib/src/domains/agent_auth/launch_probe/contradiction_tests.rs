use std::sync::Arc;

use super::test_support::{
    gateway_state, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use super::{LaunchProbeService, PokeReason, ProbeEngineConfig};
use crate::domains::agents::launch_options::{
    HarnessLaunchOptionsService, HarnessLaunchOptionsState,
};
use crate::persistence::Db;

#[tokio::test]
async fn live_contradictions_queue_and_coalesce_one_target_refresh() {
    let home = TempRuntimeHome::new("live-contradiction");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[("opencode", "test-not-a-real-key")]));

    let (runner, release) = FakeRunner::gated();
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"]));
    let targets = Arc::new(FixedTargets {
        harnesses: vec!["opencode".to_string()],
        installed: vec!["opencode".to_string()],
        // A live contradiction must repair even a target excluded from routine
        // unattended probes.
        manual_refresh_only: vec!["opencode".to_string()],
    });
    let launch_options = Arc::new(HarnessLaunchOptionsService::new(
        Db::open_in_memory().expect("open db"),
        home.path().to_path_buf(),
    ));
    let engine = Arc::new(
        LaunchProbeService::with_parts(
            home.path().to_path_buf(),
            plan,
            targets,
            runner.clone(),
            ProbeEngineConfig::default(),
        )
        .with_launch_options(launch_options.clone()),
    );

    engine
        .clone()
        .poke_harness("opencode", PokeReason::LiveContradiction);
    engine
        .clone()
        .poke_harness("opencode", PokeReason::LiveContradiction);
    wait_until(|| runner.count() == 1).await;
    release.send(true).expect("release fake probe");
    wait_until(|| {
        launch_options
            .read("opencode")
            .expect("read launch options")
            .is_some_and(|response| response.state == HarnessLaunchOptionsState::Observed)
    })
    .await;

    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        runner.count(),
        1,
        "simultaneous contradiction reports must share the target's single-flight refresh"
    );
}

async fn wait_until(mut predicate: impl FnMut() -> bool) {
    for _ in 0..1_000 {
        if predicate() {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("timed out waiting for contradiction refresh state");
}
