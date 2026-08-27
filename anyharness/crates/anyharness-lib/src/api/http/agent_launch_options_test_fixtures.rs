//! Shared fixtures for the launch-options `probePhase` tests.
//!
//! Every one of these builds a REAL engine, a real store and a real row: the
//! phase is only meaningful when the slot and the row are two views of one
//! attempt, so a fake of either side would test nothing.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path as AxumPath, State};
use serde_json::Value;

use super::agent_launch_options::get_launch_options;
use crate::app::AppState;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::launch_options::{
    HarnessLaunchModel, HarnessLaunchOptions, HarnessLaunchOptionsService,
};
use crate::domains::agent_auth::launch_probe::test_support::{
    gateway_state, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use crate::domains::agent_auth::launch_probe::{
    LaunchProbeService, ProbeEngineConfig, ProbeEngineMode,
};
use crate::persistence::Db;

pub(super) const HARNESS: &str = "opencode";
/// The harness excluded from every unattended poke, so nothing but a human ever
/// moves its row off a stale basis.
pub(super) const CURSOR: &str = "cursor";
/// A fixed observation timestamp, so a settled response can be asserted exactly.
pub(super) const OBSERVED_AT: &str = "2026-08-21T00:00:00+00:00";

/// Drive one attempt to a terminal, settled row at the CURRENT basis, through
/// the same writes a real probe makes.
pub(super) fn settle_a_row(state: &AppState, harness: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let started = state
        .launch_options_service
        .begin_probe(harness, &now)
        .expect("begin a probe");
    let committed = state
        .launch_options_service
        .record_success(&started, &HarnessLaunchOptions::default(), &now)
        .expect("record the observation");
    assert!(committed, "the observation must land on the row we started");
}

/// Leave the row exactly as an attempt in flight leaves it: `probing`, stamped
/// with the basis at the moment it started.
pub(super) fn begin_a_probe(state: &AppState, harness: &str) {
    state
        .launch_options_service
        .begin_probe(harness, &chrono::Utc::now().to_rfc3339())
        .expect("record a durable probe start");
}

/// A real `AppState` served by an OWNER engine whose runner is gated, so a test can
/// hold an attempt inside the probe and read the wire while it is there. The state
/// and the engine share one launch-option store, which is what makes the row and
/// the slot two views of the same attempt. The startup pass is marked dispatched:
/// these fixtures stand for a running system, not a booting one.
pub(super) fn state_with_a_gated_engine(
    home: &TempRuntimeHome,
    harness: &str,
) -> (
    AppState,
    Arc<LaunchProbeService>,
    tokio::sync::watch::Sender<bool>,
) {
    home.write_manifest(harness, Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[(harness, "test-not-a-real-key")]));

    let store = Arc::new(HarnessLaunchOptionsService::new(
        Db::open_in_memory().expect("in-memory db"),
        home.path().to_path_buf(),
    ));
    let (runner, release) = FakeRunner::gated();
    let engine = Arc::new(
        LaunchProbeService::with_parts(
            home.path().to_path_buf(),
            Arc::new(CountingPlanProducer::new(vec!["m-1"])),
            Arc::new(FixedTargets::single(harness)),
            runner,
            ProbeEngineConfig::default(),
        )
        .with_launch_options(store.clone()),
    );
    assert_eq!(engine.mode(), ProbeEngineMode::Owner);
    engine.mark_startup_pass_dispatched();

    let mut state = app_state(home.path().to_path_buf());
    state.launch_options_service = store;
    state.launch_probe_service = engine.clone();
    (state, engine, release)
}

/// A second runtime over the SAME runtime home and the same document, which finds
/// the engine lock already held and so serves read-only — the sidecar shape.
pub(super) fn read_only_view(home: &TempRuntimeHome, owner: &AppState) -> AppState {
    let mut reader = app_state(home.path().to_path_buf());
    assert_eq!(
        reader.launch_probe_service.mode(),
        ProbeEngineMode::ReadOnly,
        "the owner engine must already hold the lock"
    );
    reader.launch_options_service = owner.launch_options_service.clone();
    reader
}

/// Land a real observation on the row, the way a successful probe does.
pub(super) fn observe_models(state: &AppState, harness: &str) {
    let started = state
        .launch_options_service
        .begin_probe(harness, OBSERVED_AT)
        .expect("begin a probe");
    let options = HarnessLaunchOptions {
        models: vec![HarnessLaunchModel {
            id: "m-1".to_string(),
            observed_name: None,
            observed_description: None,
        }],
        ..HarnessLaunchOptions::default()
    };
    assert!(
        state
            .launch_options_service
            .record_success(&started, &options, OBSERVED_AT)
            .expect("record the observation"),
        "the observation must land on the row we started"
    );
}

pub(super) fn seconds_ago(seconds: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::seconds(seconds)).to_rfc3339()
}

pub(super) fn hours_ago(hours: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::hours(hours)).to_rfc3339()
}

/// The refresh an axum handler awaits — and whose future a disconnecting client
/// drops.
pub(super) fn spawn_refresh(
    engine: &Arc<LaunchProbeService>,
    harness: &str,
) -> tokio::task::JoinHandle<()> {
    let engine = engine.clone();
    let harness = harness.to_string();
    tokio::spawn(async move {
        let _ = engine.refresh_now(&harness).await;
    })
}

pub(super) fn temp_runtime_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("anyharness-launch-phase-{prefix}-{unique}"));
    std::fs::create_dir_all(&path).expect("create runtime home");
    path
}

/// A RUNNING runtime: its startup pass has already dispatched, so an empty slot
/// map means the scheduler has nothing to say rather than nothing yet. Production
/// spawns that pass from `AppState::new`; `cfg(test)` suppresses it, so a fixture
/// that did not mark it would silently be testing a booting runtime.
pub(super) fn app_state(runtime_home: PathBuf) -> AppState {
    let state = booting_app_state(runtime_home);
    state.launch_probe_service.mark_startup_pass_dispatched();
    state
}

/// A runtime whose startup probe pass has NOT dispatched yet — the first seconds
/// after boot, while seed hydration and the reconcile still run ahead of it.
pub(super) fn booting_app_state(runtime_home: PathBuf) -> AppState {
    AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state")
}

/// The SERIALIZED body, so the assertions read the wire and not the projection
/// type — an absent field and a `null` one are the same value in Rust and
/// different bytes to a client.
pub(super) async fn launch_options_payload(state: AppState) -> Value {
    payload_for(state, HARNESS).await
}

pub(super) async fn payload_for(state: AppState, harness: &str) -> Value {
    let response = get_launch_options(State(state), AxumPath(harness.to_string()))
        .await
        .expect("launch options");
    serde_json::to_value(&response.0).expect("serialize launch options")
}
