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
use crate::domains::agents::launch_options::{HarnessLaunchOptions, HarnessLaunchOptionsService};
use crate::domains::agents::launch_probe::lock::ProbeEngineLock;
use crate::domains::agents::launch_probe::targets::{ProbeTargets, RuntimeProbeTargets};
use crate::domains::agents::launch_probe::test_support::{
    gateway_state, wait_until, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use crate::domains::agents::launch_probe::{
    LaunchProbeService, PokeReason, ProbeEngineConfig, ProbeEngineMode,
};
use crate::persistence::Db;

const HARNESS: &str = "opencode";
/// The harness excluded from every unattended poke, so nothing but a human ever
/// moves its row off a stale basis.
const CURSOR: &str = "cursor";

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

/// A settled row whose BASIS has moved is not an in-flight probe, however it
/// projects. `read` synthesizes `detecting` for it without consulting
/// `probe_state` at all, so a phase re-derived from the projection would say
/// `queued` and a client would poll every 1.5s forever. The basis folds in the
/// GLOBAL auth revision, so logging into any other harness reaches this arm.
#[tokio::test]
async fn a_stale_basis_reports_settled_rather_than_queued() {
    let home = TempRuntimeHome::new("stale-basis");
    home.write_manifest(HARNESS, Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[(HARNESS, "test-not-a-real-key")]));
    let state = app_state(home.path().to_path_buf());
    settle_a_row(&state, HARNESS);

    let settled = launch_options_payload(state.clone()).await;
    assert_eq!(settled["state"], Value::from("observed_empty"));
    assert_eq!(settled["probePhase"], Value::from("idle"));

    // Any other harness's login bumps the shared auth revision, which moves EVERY
    // harness's basis — this harness's row is now about a basis nobody asked about.
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let stale = launch_options_payload(state).await;
    assert_eq!(
        stale["state"],
        Value::from("detecting"),
        "the projection synthesizes detecting for a moved basis: {stale}"
    );
    assert_eq!(
        stale["probePhase"],
        Value::from("idle"),
        "nothing is in flight, so this must read as an answer, not as a wait: {stale}"
    );
}

/// The same path for the harness that can never dig itself out: every automatic
/// poke for Cursor is refused, so a `queued` it never earned is a poll with no
/// end — 1.5s apart, each one recomputing a SHA-256 over the manifest, the
/// resolved artifacts and the auth state file.
#[tokio::test]
async fn a_stale_basis_does_not_spin_the_harness_no_poke_can_converge() {
    let home = TempRuntimeHome::new("stale-basis-cursor");
    home.write_manifest(CURSOR, Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[(CURSOR, "test-not-a-real-key")]));
    assert!(
        !RuntimeProbeTargets::new(home.path().to_path_buf()).allows_automatic_probe(CURSOR),
        "the premise: no unattended poke will ever refresh this harness"
    );

    let state = app_state(home.path().to_path_buf());
    settle_a_row(&state, CURSOR);
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let payload = payload_for(state, CURSOR).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "a harness only a human can refresh must never be served as queued: {payload}"
    );
}

/// Drive one attempt to a terminal, settled row at the CURRENT basis, through
/// the same writes a real probe makes.
fn settle_a_row(state: &AppState, harness: &str) {
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
    payload_for(state, HARNESS).await
}

async fn payload_for(state: AppState, harness: &str) -> Value {
    let response = get_launch_options(State(state), AxumPath(harness.to_string()))
        .await
        .expect("launch options");
    serde_json::to_value(&response.0).expect("serialize launch options")
}
