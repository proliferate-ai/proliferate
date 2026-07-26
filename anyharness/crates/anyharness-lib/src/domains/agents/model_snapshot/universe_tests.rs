//! The document -> universe projection, and its one rule: FRESH entries only.
//!
//! Real filesystem, because what makes an entry fresh is state on disk (the document,
//! the install manifest, `state.json`). Fake runner, because none of this needs a
//! harness.

use std::sync::Arc;
use std::time::Duration;

use super::test_support::{
    gateway_context, gateway_state, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
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
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
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

/// A fresh entry contributes its observed ids under its own context id.
#[tokio::test]
async fn a_fresh_entry_contributes_its_observed_models() {
    let home = seeded("universe-fresh");
    let (service, runner) = engine(
        &home,
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..ProbeEngineConfig::default()
        },
    );
    *runner.models.lock().expect("models") =
        vec!["live-a".to_string(), "live-b".to_string()];

    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("probe");

    let universe = service.observed_universe("opencode");
    assert!(universe.has_observation("gateway"));
    assert!(universe.observes_id("gateway", "live-a"));
    assert!(universe.observes_id("gateway", "live-b"));
    assert!(!universe.observes_id("gateway", "never-observed"));
    assert!(
        !universe.has_observation("anthropic-api"),
        "a context with no entry contributes nothing"
    );
}

/// **A STALE entry contributes nothing.**
///
/// model-catalog.md, "Failure modes" is explicit: a stale entry renders as "needs
/// refresh" and *"launch validation falls back to the shipped catalog for that context
/// until a fresh entry lands"*. Staled here by rotating the credential, which is the
/// realistic trigger — the user switched auth, so what the old credential could serve
/// says nothing about what the new one can.
#[tokio::test]
async fn a_stale_entry_drops_out_of_the_universe() {
    let home = seeded("universe-stale");
    let (service, runner) = engine(
        &home,
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..ProbeEngineConfig::default()
        },
    );
    *runner.models.lock().expect("models") = vec!["live-a".to_string()];

    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("probe");
    assert!(service.observed_universe("opencode").has_observation("gateway"));

    // Rotate the key: the entry's fingerprint no longer matches the machine.
    home.write_state_json(&gateway_state(4, &[("opencode", "sk-rotated")]));
    assert!(
        service.observed_universe("opencode").is_empty(),
        "an auth-moved entry must stop being trusted for launch validation"
    );

    // A re-probe restores it.
    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("re-probe");
    assert!(service.observed_universe("opencode").has_observation("gateway"));
}

/// A harness that MOVED stales its entries the same way, and for the same reason: the
/// model list a snapshot records is bound to the binary that advertised it.
#[tokio::test]
async fn an_entry_recorded_on_another_install_drops_out() {
    let home = seeded("universe-harness-moved");
    let (service, _runner) = engine(
        &home,
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..ProbeEngineConfig::default()
        },
    );

    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("probe");
    assert!(service.observed_universe("opencode").has_observation("gateway"));

    // A harness upgrade: same role, different installed bytes.
    home.write_manifest("opencode", Some("2.0.0"), Some("sha-2"), "pinned_archive");
    assert!(
        service.observed_universe("opencode").is_empty(),
        "a harness-moved entry must stop being trusted"
    );
}

/// The universe read is available in READ-ONLY mode.
///
/// A runtime that does not own the probe engine still has to validate launches, and the
/// owner's observations are the right truth for it — serving is not probing. Making
/// this ownership-gated would mean a dev sidecar rejected models the desktop can launch.
#[tokio::test]
async fn a_read_only_engine_still_serves_the_universe() {
    let home = seeded("universe-readonly");
    let (owner, runner) = engine(
        &home,
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..ProbeEngineConfig::default()
        },
    );
    *runner.models.lock().expect("models") = vec!["live-a".to_string()];
    owner
        .refresh_now("opencode", "gateway")
        .await
        .expect("probe");

    let (second, _second_runner) = engine(&home, ProbeEngineConfig::default());
    assert_eq!(second.mode(), super::ProbeEngineMode::ReadOnly);
    assert!(
        second.observed_universe("opencode").observes_id("gateway", "live-a"),
        "a read-only runtime validates against the owner's observations"
    );
}

/// An in-flight probe never gates anything: the universe read never blocks on one and
/// never consults the engine's live state.
///
/// model-catalog.md, "Staleness": *"An in-flight probe never gates anything: launching
/// during the re-probe window validates against the fallback, so switching auth or
/// updating a harness never locks the user out of starting a session"*.
#[tokio::test]
async fn the_universe_read_never_waits_on_an_in_flight_probe() {
    let home = seeded("universe-inflight");
    let (runner, release) = FakeRunner::gated();
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
        runner.clone(),
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..ProbeEngineConfig::default()
        },
    ));

    let probing = tokio::spawn({
        let service = service.clone();
        async move { service.refresh_now("opencode", "gateway").await }
    });
    // Let the attempt reach the blocked runner.
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }

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
    assert!(during, "no entry exists yet, so the shipped catalog fills in");

    release.send(true).expect("release the probe");
    probing.await.expect("join").expect("probe");
    assert!(service.observed_universe("opencode").has_observation("gateway"));
}
