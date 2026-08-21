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

/// Why the ROW outranks a missing slot. An owner admits before `begin_probe`, so
/// for an owner the slot always leads the row — but a read-only runtime never
/// admits anything, so its slot map is empty for a harness the OWNER is probing
/// right now. The row is the only source it has, and without it the response would
/// be `detecting` with no phase, which a client reads as terminal.
#[tokio::test]
async fn a_read_only_runtime_has_no_slot_to_read_so_the_row_answers() {
    let home = temp_runtime_home("row-outranks-missing-slot");
    let _owner = ProbeEngineLock::try_acquire(&home).expect("take the engine lock first");
    let state = app_state(home.clone());
    assert_eq!(state.launch_probe_service.mode(), ProbeEngineMode::ReadOnly);
    state
        .launch_options_service
        .begin_probe(HARNESS, &chrono::Utc::now().to_rfc3339())
        .expect("record a durable probe start");
    assert_eq!(
        state
            .launch_probe_service
            .probe_phase(HARNESS, chrono::Utc::now(), false),
        None,
        "no slot to read, so the slot alone answers nothing at all"
    );

    let payload = launch_options_payload(state).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("queued"),
        "the row the owner wrote is what makes this response legible: {payload}"
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

/// A probe stamps the basis it STARTED at, and any auth apply moves the basis
/// under it — `apply_state_file` writes `state.json` BEFORE it pokes, so the
/// interleaving is the designed one, not a rare race. A genuinely running attempt
/// must keep reporting a live phase across it: judging the basis first would serve
/// the running probe as settled, the client would stop polling, and the
/// observation it is waiting for would land unseen.
#[tokio::test]
async fn an_in_flight_probe_survives_a_basis_move_under_it() {
    let home = TempRuntimeHome::new("basis-move-mid-probe");
    let (state, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), false) == Some(ProbePhase::Running)
    })
    .await;

    let before = payload_for(state.clone(), HARNESS).await;
    assert_eq!(before["probePhase"], Value::from("running"));

    // The auth apply that lands mid-probe: the state file moves first, so every
    // harness's basis moves while this harness's attempt is still inside the probe.
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let after = payload_for(state, HARNESS).await;
    assert_eq!(after["state"], Value::from("detecting"));
    assert_eq!(
        after["probePhase"],
        Value::from("running"),
        "the probe did not stop running because the basis moved under it: {after}"
    );
    let _ = release.send(true);
    let _ = attempt.await;
}

/// An ORPHANED row: `begin_probe` is durable and the three awaits after it have no
/// compensating write, so dropping the attempt future — an ordinary client
/// disconnect from `refresh_now`, no crash required — strands the row at `probing`
/// forever. Nothing is in flight, so reporting the row would poll a client every
/// 1.5s against an attempt that no longer exists. The owner's slot is what tells
/// the two apart, and it can only do so because admission precedes `begin_probe`.
#[tokio::test]
async fn an_orphaned_probing_row_reports_the_owners_idle_slot() {
    let home = TempRuntimeHome::new("orphaned-probing-row");
    let (state, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), false) == Some(ProbePhase::Running)
    })
    .await;

    // The client goes away mid-refresh. The guard releases the slot; nothing
    // releases the row.
    attempt.abort();
    wait_until("the dropped future releases the slot", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), false) == Some(ProbePhase::Idle)
    })
    .await;
    assert!(
        state
            .launch_options_service
            .read_with_probe_state(HARNESS)
            .expect("read")
            .expect("a row exists")
            .probe_in_flight,
        "the premise: the row is stranded at probing, with no attempt behind it"
    );

    let payload = payload_for(state.clone(), HARNESS).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "an orphan must read as an answer, or nothing ever stops the polling: {payload}"
    );

    // And at a moved basis, which is where this row will spend the rest of its life.
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));
    let moved = payload_for(state, HARNESS).await;
    assert_eq!(moved["state"], Value::from("detecting"));
    assert_eq!(
        moved["probePhase"],
        Value::from("idle"),
        "the basis moving does not resurrect the attempt: {moved}"
    );
    let _ = release.send(true);
}

/// The orphan that matters most, on the harness no unattended poke may refresh: a
/// spinning client here can never be converged by anything but a human.
///
/// The row is left by `begin_probe` — the same durable write `run_attempt` makes
/// (`attempt.rs`), not a hand-edited field — because cursor's credential is not
/// gateway-backed and so cannot be materialized into a probe by this fixture at
/// all. That inability is the point: nothing in this runtime will ever move this
/// row, so the phase must not ask a client to wait for it.
#[tokio::test]
async fn an_orphaned_cursor_row_never_asks_a_client_to_keep_waiting() {
    let home = temp_runtime_home("orphaned-cursor-row");
    let state = app_state(home.clone());
    assert_eq!(state.launch_probe_service.mode(), ProbeEngineMode::Owner);
    begin_a_probe(&state, CURSOR);
    assert_eq!(
        state
            .launch_probe_service
            .probe_phase(CURSOR, chrono::Utc::now(), false),
        Some(ProbePhase::Idle),
        "the owner admits before it writes the row, so an idle slot means orphan"
    );

    let payload = payload_for(state, CURSOR).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "a harness only a human can refresh must never be served as queued: {payload}"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// The same interleaving on a runtime that cannot read a slot at all. Its only
/// source is the row, so a basis-gated read would omit the field entirely — which
/// the client also treats as terminal.
#[tokio::test]
async fn a_read_only_runtime_keeps_reporting_a_probe_across_a_basis_move() {
    let home = TempRuntimeHome::new("basis-move-read-only");
    home.write_manifest(HARNESS, Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[(HARNESS, "test-not-a-real-key")]));
    let _owner = ProbeEngineLock::try_acquire(home.path()).expect("take the engine lock first");

    let state = app_state(home.path().to_path_buf());
    assert_eq!(state.launch_probe_service.mode(), ProbeEngineMode::ReadOnly);
    begin_a_probe(&state, HARNESS);
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let payload = launch_options_payload(state).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("queued"),
        "absent reads as terminal to a client, so it must not be absent here: {payload}"
    );
}

/// Leave the row exactly as an attempt in flight leaves it: `probing`, stamped
/// with the basis at the moment it started.
fn begin_a_probe(state: &AppState, harness: &str) {
    state
        .launch_options_service
        .begin_probe(harness, &chrono::Utc::now().to_rfc3339())
        .expect("record a durable probe start");
}

/// A real `AppState` served by an OWNER engine whose runner is gated, so a test can
/// hold an attempt inside the probe and read the wire while it is there. The state
/// and the engine share one launch-option store, which is what makes the row and
/// the slot two views of the same attempt.
fn state_with_a_gated_engine(
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

    let mut state = app_state(home.path().to_path_buf());
    state.launch_options_service = store;
    state.launch_probe_service = engine.clone();
    (state, engine, release)
}

/// The refresh an axum handler awaits — and whose future a disconnecting client
/// drops.
fn spawn_refresh(engine: &Arc<LaunchProbeService>, harness: &str) -> tokio::task::JoinHandle<()> {
    let engine = engine.clone();
    let harness = harness.to_string();
    tokio::spawn(async move {
        let _ = engine.refresh_now(&harness).await;
    })
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
