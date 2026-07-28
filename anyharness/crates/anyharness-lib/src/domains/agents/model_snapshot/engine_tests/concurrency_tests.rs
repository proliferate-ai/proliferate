//! Proof B7's first leg: concurrent triggers coalesce to one spawn, the
//! machine-wide cap holds, and a dropped refresh cannot wedge a harness.

use super::*;

/// **Proof B7 (coalescing).** Eight concurrent pokes for one harness against a
/// runner that blocks on a barrier produce exactly ONE invocation, and every
/// caller ends up observing the winner's written document.
#[tokio::test]
async fn eight_concurrent_pokes_for_one_harness_produce_one_probe() {
    let home = seeded_home("coalesce", "opencode");
    let (runner, release) = FakeRunner::gated();
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode")),
        runner.clone(),
        test_config(),
    ));

    let mut handles = Vec::new();
    for _ in 0..8 {
        let service = service.clone();
        handles.push(tokio::spawn(async move {
            service.probe_on_event("opencode", PokeReason::Startup).await;
        }));
    }
    // Let all eight reach the gate before the single winner is allowed to finish.
    tokio::task::yield_now().await;
    release.send(true).expect("release");
    for handle in handles {
        handle.await.expect("join");
    }

    assert_eq!(
        runner.count(),
        1,
        "eight simultaneous pokes must produce exactly one spawn"
    );
    let document = read_document(home.path(), "opencode").expect("document written");
    assert!(
        !document.models.is_empty(),
        "every caller observes the winner's written observation"
    );
    assert_eq!(document.last_attempt.outcome, AttemptOutcome::Ok);
}

/// A probe admitted but still waiting for the machine-wide semaphore reports
/// `queued`, never `idle`.
///
/// At `max_concurrent_probes = 1` that wait is the COMMON case: the second
/// harness of any startup pass spends its whole admitted life behind the
/// semaphore. Reporting `idle` there would tell a polling UI "nothing is
/// happening" about work the engine has already accepted — so the surface would
/// hide its own spinner and a user would press Refresh again.
#[tokio::test]
async fn a_probe_waiting_for_the_semaphore_reports_queued_not_idle() {
    let home = TempRuntimeHome::new("queued");
    home.write_state_json(&gateway_state(
        4,
        &[("opencode", "sk-vk"), ("grok", "sk-vk")],
    ));
    for kind in ["opencode", "grok"] {
        home.write_manifest(kind, Some("1.0.0"), Some("sha-1"), "pinned_archive");
    }

    let (runner, release) = FakeRunner::gated();
    let mut targets = FixedTargets::single("opencode");
    targets.harnesses.push("grok".to_string());
    targets.installed.push("grok".to_string());
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    // Two harnesses, a semaphore of one: the second cannot run until the first
    // releases.
    let first = {
        let service = service.clone();
        tokio::spawn(async move {
            service.probe_on_event("opencode", PokeReason::Startup).await;
        })
    };
    let second = {
        let service = service.clone();
        tokio::spawn(async move {
            service.probe_on_event("grok", PokeReason::Startup).await;
        })
    };
    // Wait for both to reach the engine while the runner is still gated. A fixed
    // yield count cannot do this: the spawns above may be on other workers.
    wait_until("both harnesses admitted", || {
        let states = [
            service.status("opencode", chrono::Utc::now()).state,
            service.status("grok", chrono::Utc::now()).state,
        ];
        states
            .iter()
            .filter(|state| **state != super::super::status::LiveState::Idle)
            .count()
            == 2
    })
    .await;

    let states = [
        service.status("opencode", chrono::Utc::now()).state,
        service.status("grok", chrono::Utc::now()).state,
    ];
    assert!(
        states
            .iter()
            .any(|state| *state == super::super::status::LiveState::Running),
        "one harness must be running: {states:?}"
    );
    assert!(
        states
            .iter()
            .any(|state| *state == super::super::status::LiveState::Queued),
        "the harness waiting for the semaphore must report queued, not idle: {states:?}"
    );

    release.send(true).expect("release");
    first.await.expect("join");
    second.await.expect("join");

    // And both settle back to idle once the work is done.
    for kind in ["opencode", "grok"] {
        assert_eq!(
            service.status(kind, chrono::Utc::now()).state,
            super::super::status::LiveState::Idle,
            "{kind} must settle to idle"
        );
    }
}

/// The machine-wide cap holds ACROSS harnesses. Every probe is a real harness
/// process, so this is a memory bound, not a nicety — and simultaneous pokes per
/// harness still coalesce to one spawn each.
#[tokio::test]
async fn the_global_cap_bounds_concurrency_across_harnesses() {
    let home = TempRuntimeHome::new("global-cap");
    let harnesses = ["claude", "codex", "grok", "opencode"];
    home.write_state_json(&gateway_state(2, &harnesses.map(|kind| (kind, "sk-vk"))));
    for kind in harnesses {
        home.write_manifest(kind, Some("1.0.0"), Some("sha-1"), "pinned_archive");
    }
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("claude");
    for kind in &harnesses[1..] {
        targets.harnesses.push(kind.to_string());
        targets.installed.push(kind.to_string());
    }
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    let mut handles = Vec::new();
    for kind in harnesses {
        for _ in 0..3 {
            let service = service.clone();
            let kind = kind.to_string();
            handles.push(tokio::spawn(async move {
                service.probe_on_event(&kind, PokeReason::Startup).await;
            }));
        }
    }
    for handle in handles {
        handle.await.expect("join");
    }

    assert_eq!(
        runner.peak_concurrency(),
        1,
        "the machine-wide semaphore must never be exceeded"
    );
    assert_eq!(
        runner.count(),
        4,
        "one probe per harness: the three simultaneous pokes per harness coalesce"
    );
}

/// **Proof B7 (no wedge).** F-036 — a dropped `refresh_now` must not wedge the
/// slot at `Running` forever.
///
/// This spawns a `refresh_now` against a gated fake runner, waits for the
/// attempt to actually be `Running` (inside the probe, past the semaphore),
/// aborts the task, and asserts both halves of the fix: (a) the slot's live
/// state settles back to `Idle`, not stuck `Running`; and (b) the harness is not
/// wedged — a subsequent poke still reaches the runner.
#[tokio::test]
async fn an_aborted_refresh_settles_to_idle_and_leaves_the_harness_pokeable() {
    let home = seeded_home("abort-wedge", "opencode");
    let (runner, release) = FakeRunner::gated();
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode")),
        runner.clone(),
        test_config(),
    ));

    // Mirrors the axum handler: a manual refresh, spawned so it can be
    // cancelled independently, exactly as a dropped request future would be.
    let refresh_service = service.clone();
    let handle = tokio::spawn(async move {
        let _ = refresh_service.refresh_now("opencode").await;
    });

    // Wait for the attempt to be genuinely IN the probe — past the semaphore —
    // not merely queued, so the abort lands inside the window F-036 identified
    // as droppable.
    wait_until("the refresh reaches the gated runner as Running", || {
        service.status("opencode", chrono::Utc::now()).state
            == super::super::status::LiveState::Running
    })
    .await;

    handle.abort();
    // `abort()` only schedules cancellation; join before asserting so the
    // guard's `Drop` has actually run.
    let _ = handle.await;

    assert_eq!(
        runner.count(),
        1,
        "the aborted attempt reached the runner exactly once"
    );

    assert_eq!(
        service.status("opencode", chrono::Utc::now()).state,
        super::super::status::LiveState::Idle,
        "a dropped refresh must not leave the harness pinned at Running (F-036)"
    );

    // The harness must not be wedged: release the (now-abandoned) gate and poke
    // again — a real probe has to land, proving the single-flight gate does not
    // still see this harness as in-flight.
    release.send(true).expect("release");
    service.probe_on_event("opencode", PokeReason::Startup).await;
    assert_eq!(
        runner.count(),
        2,
        "subsequent pokes for this harness must still reach the runner after the abort"
    );
}
