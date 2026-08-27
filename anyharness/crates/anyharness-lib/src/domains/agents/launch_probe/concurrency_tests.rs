//! Engine-level reachability proof for the status-store read-modify-write race:
//! nothing here touches the store directly. Only real pokes against a real
//! (fake-runner) engine, then a settled-state assertion on the served document.
//! Born in an adversarial review; kept on the branch because the races they pin
//! are permanent invariants, not review scaffolding.

use std::sync::Arc;
use std::time::Duration;

use super::test_support::{
    gateway_state, wait_until, CountingPlanProducer, FakeBehavior, FakeRunner, FixedTargets,
    TempRuntimeHome,
};
use super::{LaunchProbeService, PokeReason, ProbeEngineConfig, ProbePhase};
use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agents::status::{AgentStatusService, ProbeVerdict};
use crate::persistence::Db;

fn engine(
    home: &TempRuntimeHome,
    runner: Arc<FakeRunner>,
) -> (Arc<LaunchProbeService>, Arc<AgentStatusService>) {
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"]));
    let targets = Arc::new(FixedTargets::single("opencode"));
    let db = Db::open_in_memory().expect("open db");
    let launch_options = Arc::new(HarnessLaunchOptionsService::new(
        db.clone(),
        home.path().to_path_buf(),
    ));
    let agent_status = Arc::new(AgentStatusService::with_parts(
        db,
        home.path().to_path_buf(),
        Arc::new(FixedTargets::single("opencode")),
        vec!["opencode".to_string()],
        home.path().join("detection-home"),
    ));
    let engine = Arc::new(
        LaunchProbeService::with_parts(
            home.path().to_path_buf(),
            plan,
            targets,
            runner,
            ProbeEngineConfig::default(),
        )
        .with_launch_options(launch_options)
        .with_agent_status(agent_status.clone()),
    );
    engine.bind_self();
    (engine, agent_status)
}

/// ATTACK: every probe SUCCEEDS, and after all activity settles the served
/// document must show fresh verified evidence — `stale` is the "a re-probe is
/// running" bit, and no re-probe is running once the engine is quiescent.
///
/// `probe_on_event` calls `notify_probe_admitted` (an `ObservationWrite::Keep`
/// writer) BEFORE queueing on the single-flight gate, concurrently with an
/// in-flight attempt's `notify_probe_verified` (a `Set` writer). Because
/// `AgentStatusService::persist` is read-then-write with `compose`'s file I/O
/// in between, the admission write can land AFTER the verification and clobber
/// it — and the coalesce (`attempt_covers`) then guarantees the loser never
/// re-probes, so `stale=true` is never cleared again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn adversarial_concurrent_pokes_can_wedge_the_document_stale() {
    let home = TempRuntimeHome::new("adv-wedge-stale");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[("opencode", "test-not-a-real-key")]));

    let runner = Arc::new(FakeRunner::new());
    // A probe that takes a few ms, so admissions and completions overlap the
    // way they do against a real harness process.
    runner.set_behavior(FakeBehavior::Sleep(Duration::from_millis(3)));
    let (engine, agent_status) = engine(&home, runner.clone());

    // Poke CONTINUOUSLY, so admissions keep landing while attempts complete —
    // the production shape (a burst of auth applies / login-terminal exits
    // against a harness whose probe takes milliseconds).
    // INVARIANT I2: the served document's `probe.at` never moves BACKWARDS.
    // Serially it cannot: every writer carries the stored evidence timestamp
    // forward or stamps a fresh one. A regression is a lost update, full stop.
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let regressions = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let monitor = {
        let agent_status = agent_status.clone();
        let stop = stop.clone();
        let regressions = regressions.clone();
        std::thread::spawn(move || {
            let mut high_water: Option<String> = None;
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                if let Some(doc) = agent_status.read("opencode") {
                    if let Some(at) = doc.probe.at.clone() {
                        match high_water.as_ref() {
                            Some(previous) if at.as_str() < previous.as_str() => {
                                regressions.lock().expect("lock").push(format!(
                                    "probe.at regressed from {previous} to {at} (stale={})",
                                    doc.probe.stale
                                ));
                                high_water = Some(at);
                            }
                            _ => high_water = Some(at),
                        }
                    }
                }
            }
        })
    };

    let poker = {
        let engine = engine.clone();
        tokio::spawn(async move {
            for _ in 0..3_000u32 {
                engine
                    .clone()
                    .poke_harness("opencode", PokeReason::AuthApplied);
                tokio::time::sleep(Duration::from_micros(700)).await;
            }
        })
    };
    poker.await.expect("poker");

    // Settle: nothing is left in flight, and every attempt that ran succeeded.
    //
    // A quiet RUNNER is not a quiescent engine, and the difference is the whole
    // point of this test: 3_000 pokes produce a few hundred attempts, and every
    // coalescing poke is ADMITTED — holding the document's stale mark, exactly as
    // the spec requires — without ever reaching the runner. Under load that
    // backlog can take longer than one polling window to drain the single-flight
    // gate, so waiting on the count alone asserts "quiescent" while attempts are
    // genuinely still admitted. (Diagnosed, not guessed: with every probe
    // succeeding, `restore` is false, so any release that HAS run writes
    // `stale = false`; a settled `stale = true` therefore means an admitted
    // attempt had not let go yet.) The slot's live phase is the engine's own
    // answer to "is anything admitted", and it is the very counter the document's
    // mark mirrors — so quiescence is `Idle` there, and the document must agree.
    let mut settled = runner.count();
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let now = runner.count();
        let idle = matches!(
            engine
                .live_probe_phase("opencode", chrono::Utc::now())
                .phase(),
            Some(ProbePhase::Idle)
        );
        if now == settled && idle {
            break;
        }
        settled = now;
    }

    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    monitor.join().expect("monitor");
    let regressions = regressions.lock().expect("lock").clone();
    assert!(
        regressions.is_empty(),
        "the served document's evidence timestamp moved BACKWARDS {} time(s) over \
         {} real probe attempts — a concurrent admission write clobbered a completed \
         verification; first: {}",
        regressions.len(),
        runner.count(),
        regressions.first().map(String::as_str).unwrap_or("")
    );

    let doc = agent_status.read("opencode").expect("status document");
    assert_eq!(
        doc.probe.verdict,
        ProbeVerdict::Verified,
        "every attempt succeeded ({} attempts), so the document must be verified: {doc:?}",
        runner.count()
    );
    assert!(
        !doc.probe.stale,
        "the engine is quiescent and every one of {} probes succeeded, yet the served \
         document is still stale-marked — an admission write clobbered the verification, \
         and the coalesce means it is never re-probed: {doc:?}",
        runner.count()
    );
}

/// ATTACK: `notify_probe_admitted` sets `stale = true` and has NO
/// corresponding release. `LiveStateGuard` (F-036) covers the slot's live phase
/// on every abnormal exit; nothing covers the status document. Drop the
/// `refresh_now` future mid-probe — exactly what axum does when the client of
/// `POST /v1/agents/{kind}/launch-options/refresh` disconnects, which
/// `live_state.rs:63` already names as a reachable case — and the harness's
/// status document is left stale-marked forever: no probe is running, and no
/// self-recovery timer exists (a success arms none, and no failure was
/// recorded).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn adversarial_aborted_refresh_leaves_the_document_stale_forever() {
    let home = TempRuntimeHome::new("adv-aborted-refresh");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[("opencode", "test-not-a-real-key")]));

    // A gated runner, released once so the baseline document is fresh verified.
    let (runner, gate) = FakeRunner::gated();
    let (engine, agent_status) = engine(&home, runner.clone());
    gate.send(true).expect("open the gate");
    engine
        .refresh_now("opencode")
        .await
        .expect("baseline refresh verifies");
    let baseline = agent_status.read("opencode").expect("doc");
    assert!(
        !baseline.probe.stale,
        "baseline must be fresh verified: {baseline:?}"
    );

    // Re-gate: the next attempt blocks inside the runner, mid-probe.
    let (_closed_gate, closed_rx) = tokio::sync::watch::channel(false);
    *runner.release.lock().expect("release poisoned") = Some(closed_rx);

    let task = {
        let engine = engine.clone();
        tokio::spawn(async move { engine.refresh_now("opencode").await })
    };
    wait_until("the admitted attempt marks the document stale", || {
        agent_status
            .read("opencode")
            .is_some_and(|doc| doc.probe.stale)
    })
    .await;

    // The client disconnects: axum drops the handler future.
    task.abort();
    let _ = task.await;

    // Ample room for every self-recovery path to run.
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    let doc = agent_status.read("opencode").expect("doc");
    assert!(
        !doc.probe.stale,
        "the aborted refresh left the status document stale-marked with no probe in \
         flight and no recovery armed: {doc:?}"
    );
}

/// ATTACK: the MATERIALIZATION-failure arm of `run_attempt`
/// (`attempt.rs:31-49`) now notifies the status document (`notify_probe_failed`,
/// new in this slice) but still does NOT call `self.record_failure(..)`. So on
/// that arm the slot's `last_attempt_at` is never stamped and `next_attempt_at`
/// is never armed, which disables BOTH brakes `mod.rs:24-31` claims:
///
/// 1. single-flight coalescing — `attempt_covers(None, poked_at)` is always
///    false, so N simultaneous pokes each run their own full attempt instead of
///    coalescing onto one, each writing a failure to the launch-options store
///    and publishing its own status event;
/// 2. the failure backoff and its `BackoffExpired` self-recovery timer — never
///    armed, so `config.rs`'s "the set contains its own recovery" does not hold
///    for this arm.
///
/// The trigger is an ordinary production state, not an exotic one: a
/// present-but-empty harness entry (an unsatisfied selection — exhausted
/// gateway budget, revoked seat) makes `resolve_profile` return
/// `SelectionMissing`, which is exactly this arm.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn adversarial_materialization_failure_neither_coalesces_nor_backs_off() {
    let home = TempRuntimeHome::new("adv-materialization-failure");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "managed");
    // Present-but-empty: an unsatisfied selection. `resolve_profile` returns
    // `SelectionMissing`, so `probe_auth_material` errors out.
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "lineage": "test-lineage",
        "sequence": 1,
        "harnesses": [{
            "harness_kind": "opencode",
            "sources": [],
            "unsatisfied_reason": "the gateway budget is exhausted",
        }],
    }));

    let runner = Arc::new(FakeRunner::new());
    let (engine, agent_status) = engine(&home, runner.clone());
    let mut events = agent_status.subscribe();

    // Ten simultaneous pokes for ONE harness. Brake 1 says they coalesce onto a
    // single attempt.
    for _ in 0..10 {
        engine
            .clone()
            .poke_harness("opencode", PokeReason::AuthApplied);
    }
    tokio::time::sleep(Duration::from_millis(1_200)).await;

    let mut failed_events = 0;
    while let Ok(doc) = events.try_recv() {
        if matches!(doc.probe.verdict, ProbeVerdict::Failed) {
            failed_events += 1;
        }
    }
    assert_eq!(
        runner.count(),
        0,
        "the runner must never be reached on the materialization-failure arm"
    );
    assert!(
        failed_events <= 1,
        "ten simultaneous pokes produced {failed_events} distinct failure \
         observations: the materialization-failure arm never stamps \
         `last_attempt_at`, so `attempt_covers` can never coalesce them"
    );
}
