//! T-37, T-24: the completed-attempt floor and exponential backoff — the two
//! brakes that bound a runaway independently of the gate being correct.

use super::*;

// ---------------------------------------------------------------------------
// T-37, T-24: the anti-storm floor and backoff
// ---------------------------------------------------------------------------

/// T-37 — **the structural anti-storm assertion.** With the identity rule
/// deliberately broken so the gate ALWAYS answers stale (the entry records one
/// manifest identity while the machine reports another, refreshed every round), 50
/// pokes still produce at most a handful of probes rather than 50.
///
/// This is independent of the identity fix being correct, which is the point: it
/// bounds the damage of any future mis-stated rule to one probe per minute per key.
#[tokio::test]
async fn a_permanently_stale_gate_still_cannot_storm() {
    let home = seeded_home("floor", "opencode");
    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        test_config(),
    );

    for round in 0..50 {
        // Make the gate answer HarnessMoved every single time by moving the
        // manifest identity out from under whatever the last entry recorded.
        home.write_manifest(
            "opencode",
            Some(&format!("1.0.{round}")),
            Some(&format!("sha-{round}")),
            "pinned_archive",
        );
        service.probe_if_stale("opencode", "gateway", PokeReason::SessionLaunch).await;
    }

    let count = runner.count();
    assert!(
        count <= 2,
        "the 60s completed-attempt floor must bound a permanently-stale gate; got {count} probes"
    );
    assert!(count >= 1, "the first poke must genuinely probe");
}

/// T-24 — backoff: consecutive failures schedule 1m/2m/4m, a poke inside the window
/// does nothing, and a success resets the counter.
///
/// The window is asserted through the status surface's `nextAttemptAt` rather than
/// by sleeping, so the schedule is checked without a real clock.
#[tokio::test]
async fn failures_arm_exponential_backoff_and_a_success_resets_it() {
    let home = seeded_home("backoff", "opencode");
    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );
    runner.set_behavior(FakeBehavior::Fail("provider down".to_string()));

    // First failure.
    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    let now = chrono::Utc::now();
    let status = service.status("opencode", now);
    let context = &status.contexts[0];
    assert_eq!(context.state, super::super::status::LiveState::Backoff);
    let first_next = context.next_attempt_at.clone().expect("nextAttemptAt");
    let first_delay = chrono::DateTime::parse_from_rfc3339(&first_next)
        .expect("parse")
        .signed_duration_since(now)
        .num_seconds();
    assert!(
        (55..=65).contains(&first_delay),
        "the first backoff must be ~60s, got {first_delay}s"
    );

    // A poke inside the window does nothing.
    service.probe_if_stale("opencode", "gateway", PokeReason::SessionLaunch).await;
    assert_eq!(runner.count(), 1, "a poke inside the backoff window is a no-op");

    // A forced refresh bypasses the window (T-25a) and, still failing, doubles it.
    let error = service
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("still failing");
    assert!(matches!(error, RefreshError::Probe(ProbeError::Failed { .. })));
    assert_eq!(runner.count(), 2, "a forced refresh must bypass backoff");
    let now = chrono::Utc::now();
    let second_delay = chrono::DateTime::parse_from_rfc3339(
        service.status("opencode", now).contexts[0]
            .next_attempt_at
            .as_ref()
            .expect("nextAttemptAt"),
    )
    .expect("parse")
    .signed_duration_since(now)
    .num_seconds();
    assert!(
        (115..=125).contains(&second_delay),
        "the second backoff must double to ~120s, got {second_delay}s"
    );

    // A success clears it.
    runner.set_behavior(FakeBehavior::Ok);
    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("success");
    let cleared = service.status("opencode", chrono::Utc::now());
    assert_eq!(cleared.contexts[0].state, super::super::status::LiveState::Idle);
    assert_eq!(cleared.contexts[0].next_attempt_at, None);
}
