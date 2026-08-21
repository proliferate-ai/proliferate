//! `probePhase` on the launch-options wire.
//!
//! `detecting` alone cannot tell an active probe apart from a provisional row
//! nothing will ever refresh — a manual-refresh-only harness sits `detecting`
//! forever by design. These pin the three answers the field exists to give:
//! `running` while an attempt is in flight, `idle` when settled-unobserved, and
//! ABSENT only when nothing is in flight durably and this runtime does not own
//! the probe engine, so the phase is genuinely unknowable here.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path as AxumPath, State};
use serde_json::Value;

use super::agent_launch_options::get_launch_options;
use crate::app::AppState;
use crate::domains::agents::auth_state::ProbePhase;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agents::launch_probe::lock::ProbeEngineLock;
use crate::domains::agents::launch_probe::test_support::{
    gateway_state, wait_until, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use crate::domains::agents::launch_probe::{
    LaunchProbeService, PokeReason, ProbeEngineConfig, ProbeEngineMode,
};
use crate::persistence::Db;

const HARNESS: &str = "opencode";

/// A probe that has cleared both concurrency waits and is inside the harness
/// reports `running`, so a `detecting` response is legible as "wait, this is
/// converging" rather than "this is as good as it gets".
#[tokio::test]
async fn probe_phase_is_running_while_an_attempt_is_in_flight() {
    let home = TempRuntimeHome::new("probe-phase-running");
    home.write_manifest(HARNESS, Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[(HARNESS, "test-not-a-real-key")]));

    let (runner, release) = FakeRunner::gated();
    let engine = Arc::new(
        LaunchProbeService::with_parts(
            home.path().to_path_buf(),
            Arc::new(CountingPlanProducer::new(vec!["m-1"])),
            Arc::new(FixedTargets::single(HARNESS)),
            runner.clone(),
            ProbeEngineConfig::default(),
        )
        .with_launch_options(Arc::new(HarnessLaunchOptionsService::new(
            Db::open_in_memory().expect("in-memory db"),
            home.path().to_path_buf(),
        ))),
    );
    assert_eq!(engine.mode(), ProbeEngineMode::Owner);
    assert_eq!(
        engine.probe_phase(HARNESS, chrono::Utc::now(), false),
        Some(ProbePhase::Idle),
        "no attempt has been admitted yet"
    );

    engine.clone().poke_harness(HARNESS, PokeReason::Startup);
    wait_until("the attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), false) == Some(ProbePhase::Running)
    })
    .await;

    release.send(true).expect("release the fake probe");
    wait_until("the attempt settles", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), false) == Some(ProbePhase::Idle)
    })
    .await;
}

/// The settled-unobserved case the bug report describes: nothing is in flight,
/// so the phase is `idle` and a client can stop waiting for a probe that is not
/// coming.
#[tokio::test]
async fn launch_options_report_idle_when_settled_unobserved() {
    let home = temp_runtime_home("idle");
    let payload = launch_options_payload(app_state(home.clone())).await;

    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "a runtime that owns the probe engine and has no attempt in flight is idle"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// A runtime that lost the probe-engine lock never admits an attempt, so every
/// slot it could read is one it never wrote. It omits the field rather than
/// reporting another process's scheduler as settled.
#[tokio::test]
async fn launch_options_omit_probe_phase_when_the_runtime_does_not_own_the_engine() {
    let home = temp_runtime_home("read-only");
    let _owner = ProbeEngineLock::try_acquire(&home).expect("take the engine lock first");

    let state = app_state(home.clone());
    assert_eq!(
        state.launch_probe_service.mode(),
        ProbeEngineMode::ReadOnly,
        "the lock above must have degraded this runtime to read-only"
    );

    let payload = launch_options_payload(state).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert!(
        payload.get("probePhase").is_none(),
        "an unknown phase is omitted, never null and never a settled value: {payload}"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// THE REGRESSION. An attempt writes `probing` durably before its live slot ever
/// says so — and between the two the runtime resolves a gateway model plan, which
/// for a gateway harness is a real HTTP round trip. A client that polls inside that
/// window used to be told `detecting` + `idle`: an in-flight probe reported as a
/// settled one, so polling stopped and never restarted. The durable row is what
/// answers now, so the two fields cannot say opposite things.
#[tokio::test]
async fn durable_probing_reports_a_live_phase_before_the_slot_is_admitted() {
    let home = temp_runtime_home("durable-probing");
    let state = app_state(home.clone());
    assert_eq!(
        state.launch_probe_service.mode(),
        ProbeEngineMode::Owner,
        "this runtime owns the engine, so its live slot is readable and says idle"
    );
    state
        .launch_options_service
        .begin_probe(HARNESS, &chrono::Utc::now().to_rfc3339())
        .expect("record a durable probe start");
    assert_eq!(
        state
            .launch_probe_service
            .probe_phase(HARNESS, chrono::Utc::now(), false),
        Some(ProbePhase::Idle),
        "no attempt is admitted to the live slot: this is exactly the window"
    );

    let payload = launch_options_payload(state).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("queued"),
        "a row that says probing must never be served with a settled phase: {payload}"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// A read-only runtime shares the document with the owner that is probing it. It
/// cannot read the owner's slot, but it can read the row the owner wrote — so it
/// converges instead of stalling on an absent field its client reads as terminal.
#[tokio::test]
async fn read_only_runtimes_report_the_durable_phase_the_owner_wrote() {
    let home = temp_runtime_home("read-only-probing");
    let _owner = ProbeEngineLock::try_acquire(&home).expect("take the engine lock first");

    let state = app_state(home.clone());
    assert_eq!(state.launch_probe_service.mode(), ProbeEngineMode::ReadOnly);
    state
        .launch_options_service
        .begin_probe(HARNESS, &chrono::Utc::now().to_rfc3339())
        .expect("record a durable probe start");

    let payload = launch_options_payload(state).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("queued"),
        "the row is a fact about the harness, not about who owns the engine: {payload}"
    );
    let _ = std::fs::remove_dir_all(&home);
}

fn temp_runtime_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("anyharness-launch-phase-{prefix}-{unique}"));
    std::fs::create_dir_all(&path).expect("create runtime home");
    path
}

fn app_state(runtime_home: PathBuf) -> AppState {
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
async fn launch_options_payload(state: AppState) -> Value {
    let response = get_launch_options(State(state), AxumPath(HARNESS.to_string()))
        .await
        .expect("launch options");
    serde_json::to_value(&response.0).expect("serialize launch options")
}
