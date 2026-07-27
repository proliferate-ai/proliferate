//! The document -> universe projection, and its one rule: **any observation
//! serves — age never disqualifies.**
//!
//! Real filesystem, because the observation is state on disk. Fake runner,
//! because none of this needs a harness.

use std::sync::Arc;
use std::time::Duration;

use super::test_support::{
    gateway_state, wait_until, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use super::{ModelSnapshotService, ProbeEngineConfig};

fn engine(
    home: &TempRuntimeHome,
    config: ProbeEngineConfig,
) -> (Arc<ModelSnapshotService>, Arc<FakeRunner>) {
    let runner = Arc::new(FakeRunner::new());
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode")),
        runner.clone(),
        config,
    ));
    (service, runner)
}

fn seeded(prefix: &str) -> TempRuntimeHome {
    let home = TempRuntimeHome::new(prefix);
    home.write_state_json(&gateway_state(3, &[("opencode", "sk-vk")]));
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    home
}

/// A machine that has never probed has an EMPTY universe, so launch validation is
/// exactly the shipped catalog's. This is the state of every machine at first boot
/// and it must cost nothing and change nothing.
#[tokio::test]
async fn a_machine_with_no_document_has_an_empty_universe() {
    let home = seeded("universe-empty");
    let (service, _runner) = engine(&home, ProbeEngineConfig::default());

    assert!(service.observed_universe("opencode").is_empty());
    // And an unknown harness is empty rather than an error.
    assert!(service.observed_universe("not-a-harness").is_empty());
}

/// The composed observation contributes its observed ids — one flat list, no
/// context key.
#[tokio::test]
async fn an_observation_contributes_its_observed_models() {
    let home = seeded("universe-fresh");
    let (service, runner) = engine(&home, ProbeEngineConfig::default());
    *runner.models.lock().expect("models") = vec!["live-a".to_string(), "live-b".to_string()];

    service.refresh_now("opencode").await.expect("probe");

    let universe = service.observed_universe("opencode");
    assert!(universe.has_observation());
    assert!(universe.observes_id("live-a"));
    assert!(universe.observes_id("live-b"));
    assert!(!universe.observes_id("never-observed"));
}

/// **Age and auth churn never disqualify an observation.** Freshness is
/// event-driven: rotating the key or upgrading the harness makes the next EVENT
/// re-probe, but until that probe lands the last good observation keeps serving —
/// there is no fingerprint or identity comparison silently emptying the universe.
///
/// (This inverts the superseded design's staleness tests, deliberately: the old
/// behavior — an auth-moved entry dropping out of validation — is exactly what
/// the re-cut deletes.)
#[tokio::test]
async fn an_observation_keeps_serving_across_auth_and_install_churn() {
    let home = seeded("universe-not-staleness");
    let (service, runner) = engine(&home, ProbeEngineConfig::default());
    *runner.models.lock().expect("models") = vec!["live-a".to_string()];

    service.refresh_now("opencode").await.expect("probe");
    assert!(service.observed_universe("opencode").observes_id("live-a"));

    // Rotate the key: the observation still serves until an event re-probes.
    home.write_state_json(&gateway_state(4, &[("opencode", "sk-rotated")]));
    assert!(
        service.observed_universe("opencode").observes_id("live-a"),
        "an auth change must not silently empty the universe; the auth-apply \
         EVENT re-probes"
    );

    // Upgrade the harness: same rule.
    home.write_manifest("opencode", Some("2.0.0"), Some("sha-2"), "pinned_archive");
    assert!(
        service.observed_universe("opencode").observes_id("live-a"),
        "an install change must not silently empty the universe; the \
         install-completed EVENT re-probes"
    );

    // And when the event-driven re-probe lands, the universe follows it.
    *runner.models.lock().expect("models") = vec!["live-b".to_string()];
    service.refresh_now("opencode").await.expect("re-probe");
    let universe = service.observed_universe("opencode");
    assert!(universe.observes_id("live-b"));
    assert!(!universe.observes_id("live-a"));
}

/// The universe read is available in READ-ONLY mode.
///
/// A runtime that does not own the probe engine still has to validate launches, and the
/// owner's observations are the right truth for it — serving is not probing. Making
/// this ownership-gated would mean a dev sidecar rejected models the desktop can launch.
#[tokio::test]
async fn a_read_only_engine_still_serves_the_universe() {
    let home = seeded("universe-readonly");
    let (owner, runner) = engine(&home, ProbeEngineConfig::default());
    *runner.models.lock().expect("models") = vec!["live-a".to_string()];
    owner.refresh_now("opencode").await.expect("probe");

    let (second, _second_runner) = engine(&home, ProbeEngineConfig::default());
    assert_eq!(second.mode(), super::ProbeEngineMode::ReadOnly);
    assert!(
        second.observed_universe("opencode").observes_id("live-a"),
        "a read-only runtime validates against the owner's observations"
    );
}

/// An in-flight probe never gates anything: the universe read never blocks on one and
/// never consults the engine's live state.
///
/// model-catalog.md: *"Nothing ever blocks on a probe: launching during a refresh
/// window validates against the current observation (or the seed, before the first
/// one), so switching auth or updating a harness never locks the user out of
/// starting a session while the probe catches up."*
#[tokio::test]
async fn the_universe_read_never_waits_on_an_in_flight_probe() {
    let home = seeded("universe-inflight");
    let (runner, release) = FakeRunner::gated();
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode")),
        runner.clone(),
        ProbeEngineConfig::default(),
    ));

    let probing = tokio::spawn({
        let service = service.clone();
        async move { service.refresh_now("opencode").await }
    });
    // Wait for the attempt to actually reach the blocked runner. A fixed yield count
    // cannot establish that: the spawn above may be on another worker, so the window
    // this test needs (a probe genuinely in flight) would not be open.
    wait_until("a probe in flight", || runner.count() >= 1).await;

    // The read returns immediately with the pre-probe answer rather than waiting.
    let during = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::task::spawn_blocking({
            let service = service.clone();
            move || service.observed_universe("opencode").is_empty()
        }),
    )
    .await
    .expect("the universe read must not block on an in-flight probe")
    .expect("join");
    assert!(during, "no observation exists yet, so the shipped catalog fills in");

    release.send(true).expect("release the probe");
    probing.await.expect("join").expect("probe");
    assert!(service.observed_universe("opencode").has_observation());
}
