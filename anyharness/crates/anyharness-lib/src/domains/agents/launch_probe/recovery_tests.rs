//! The probe engine's self-recovery (spec §3 flow 4): a failed attempt arms a
//! one-shot timer that pokes `BackoffExpired` when the window lapses, so a
//! missed or killed probe heals with NO manual poke. Before this event
//! existed, a lapsed backoff waited for the next EXTERNAL event — a harness
//! whose one failure had no follow-up event stayed dark until a human clicked
//! Retry (bug f's second half).

use std::sync::Arc;
use std::time::Duration;

use super::test_support::{
    gateway_state, wait_until, CountingPlanProducer, FakeBehavior, FakeRunner, FixedTargets,
    TempRuntimeHome,
};
use super::{LaunchProbeService, PokeReason, ProbeEngineConfig};
use crate::domains::agents::launch_options::{
    HarnessLaunchOptionsService, HarnessLaunchOptionsState,
};
use crate::persistence::Db;

fn engine_with_tiny_backoff(
    home: &TempRuntimeHome,
    runner: Arc<FakeRunner>,
) -> (Arc<LaunchProbeService>, Arc<HarnessLaunchOptionsService>) {
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"]));
    let targets = Arc::new(FixedTargets::single("opencode"));
    let launch_options = Arc::new(HarnessLaunchOptionsService::new(
        Db::open_in_memory().expect("open db"),
        home.path().to_path_buf(),
    ));
    let engine = Arc::new(
        LaunchProbeService::with_parts(
            home.path().to_path_buf(),
            plan,
            targets,
            runner,
            ProbeEngineConfig {
                // The jitter floor is 1s, so the recovery timer fires within
                // roughly a second of the failure — fast enough to observe.
                backoff_base: Duration::from_secs(1),
                backoff_max: Duration::from_secs(1),
                ..ProbeEngineConfig::default()
            },
        )
        .with_launch_options(launch_options.clone()),
    );
    // The wiring step under test: without it, no timer is ever armed.
    engine.bind_self();
    (engine, launch_options)
}

/// One failed probe, then NOTHING: the armed `BackoffExpired` timer re-probes
/// on its own and the observation lands — no manual poke, no second event.
#[tokio::test]
async fn backoff_expiry_re_probes_without_a_manual_poke() {
    let home = TempRuntimeHome::new("backoff-expiry-recovers");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[("opencode", "test-not-a-real-key")]));

    let runner = Arc::new(FakeRunner::new());
    runner.set_behavior(FakeBehavior::Fail("provider blip".to_string()));
    let (engine, launch_options) = engine_with_tiny_backoff(&home, runner.clone());

    engine
        .clone()
        .poke_harness("opencode", PokeReason::AuthApplied);
    wait_until("the poked probe fails once", || runner.count() == 1).await;

    // The harness heals itself between attempts; the ONLY thing that may
    // re-probe it is the failure-armed BackoffExpired timer.
    runner.set_behavior(FakeBehavior::Ok);
    wait_until("the backoff-expiry poke re-probes", || {
        runner.count() >= 2
    })
    .await;
    wait_until("the recovered observation lands", || {
        launch_options
            .read("opencode")
            .expect("read launch options")
            .is_some_and(|response| response.state == HarnessLaunchOptionsState::Observed)
    })
    .await;
}

/// A success clears the armed window, so the stale timer (which captured the
/// pre-success `next_attempt_at`) dies silently rather than re-probing.
#[tokio::test]
async fn a_success_disarms_the_stale_backoff_timer() {
    let home = TempRuntimeHome::new("backoff-timer-disarmed");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[("opencode", "test-not-a-real-key")]));

    let runner = Arc::new(FakeRunner::new());
    runner.set_behavior(FakeBehavior::Fail("provider blip".to_string()));
    let (engine, _launch_options) = engine_with_tiny_backoff(&home, runner.clone());

    engine
        .clone()
        .poke_harness("opencode", PokeReason::AuthApplied);
    wait_until("the poked probe fails once", || runner.count() == 1).await;

    // A manual refresh bypasses the backoff, succeeds, and clears the window
    // BEFORE the failure's timer fires.
    runner.set_behavior(FakeBehavior::Ok);
    engine
        .refresh_now("opencode")
        .await
        .expect("manual refresh succeeds");
    let count_after_refresh = runner.count();

    // Give the stale timer ample room to fire if it (wrongly) survived.
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert_eq!(
        runner.count(),
        count_after_refresh,
        "a cleared backoff window must not be re-probed by the stale timer"
    );
}
