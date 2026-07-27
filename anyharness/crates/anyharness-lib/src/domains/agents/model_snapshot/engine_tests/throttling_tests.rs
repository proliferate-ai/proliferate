//! The failure backoff — the one brake that bounds a hard-down harness
//! independently of how many events fire at it.

use super::*;

/// Backoff: consecutive failures schedule 1m then 2m, an automatic poke inside the
/// window does nothing, and a success resets the counter.
///
/// The window is asserted through the status surface's `nextAttemptAt` rather than by
/// sleeping, so the schedule is checked without a real clock.
///
/// The bounds are the LADDER's rung ±20%, because `record_failure` spreads each delay
/// by a deterministic per-harness offset (see `jittered_backoff_seconds`). Asserting
/// the exact rung would pin the ABSENCE of jitter. The doubling stays exact anyway:
/// the two envelopes below do not overlap, so a ladder that failed to double could
/// not pass.
#[tokio::test]
async fn failures_arm_exponential_backoff_and_a_success_resets_it() {
    let home = seeded_home("backoff", "opencode");
    let (service, runner, _plan) = engine(&home, "opencode", test_config());
    runner.set_behavior(FakeBehavior::Fail("provider down".to_string()));

    // First failure.
    service.probe_on_event("opencode", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    let now = chrono::Utc::now();
    let status = service.status("opencode", now);
    assert_eq!(status.state, super::super::status::LiveState::Backoff);
    let first_next = status.next_attempt_at.clone().expect("nextAttemptAt");
    let first_delay = chrono::DateTime::parse_from_rfc3339(&first_next)
        .expect("parse")
        .signed_duration_since(now)
        .num_seconds();
    assert!(
        (48..=72).contains(&first_delay),
        "the first backoff must be 60s +/-20%, got {first_delay}s"
    );

    // An automatic poke inside the window does nothing — a hard-down harness is
    // not re-spawned by every event.
    service
        .probe_on_event("opencode", PokeReason::InstallCompleted)
        .await;
    assert_eq!(runner.count(), 1, "a poke inside the backoff window is a no-op");

    // A forced refresh bypasses the window and, still failing, doubles it.
    let error = service
        .refresh_now("opencode")
        .await
        .expect_err("still failing");
    assert!(matches!(error, RefreshError::Probe(ProbeError::Failed { .. })));
    assert_eq!(runner.count(), 2, "a forced refresh must bypass backoff");
    let now = chrono::Utc::now();
    let second_delay = chrono::DateTime::parse_from_rfc3339(
        service
            .status("opencode", now)
            .next_attempt_at
            .as_ref()
            .expect("nextAttemptAt"),
    )
    .expect("parse")
    .signed_duration_since(now)
    .num_seconds();
    assert!(
        (96..=144).contains(&second_delay),
        "the second backoff must double to 120s +/-20%, got {second_delay}s"
    );
    assert!(
        second_delay > first_delay,
        "and the doubling must remain observable through the jitter: \
         {first_delay}s -> {second_delay}s"
    );

    // A success clears it.
    runner.set_behavior(FakeBehavior::Ok);
    service.refresh_now("opencode").await.expect("success");
    let cleared = service.status("opencode", chrono::Utc::now());
    assert_eq!(cleared.state, super::super::status::LiveState::Idle);
    assert_eq!(cleared.next_attempt_at, None);
}

/// The backoff jitter itself: deterministic, inside ±20%, and actually spreading.
///
/// It exists because the failures that matter arrive in groups — one provider outage
/// or one expired org key fails EVERY dependent harness inside a single startup
/// pass. A flat ladder then holds all of them to the same window, forever — a
/// self-synchronizing burst on whichever event next admits them.
///
/// Deterministic rather than random so the ladder above stays exactly assertable,
/// which is also why this property can be checked exactly rather than statistically.
#[test]
fn backoff_jitter_is_deterministic_bounded_and_spreads_sibling_harnesses() {
    let base = 600_u64;
    let low = (base * 4 / 5) as i64;
    let high = (base * 6 / 5) as i64;

    // Pure: the same harness and attempt always answer the same.
    let once = ModelSnapshotService::test_jittered_backoff("opencode", 1, base);
    assert_eq!(
        once,
        ModelSnapshotService::test_jittered_backoff("opencode", 1, base)
    );

    // Every harness on one machine — the group that fails together — must land
    // inside the envelope, and the group must spread rather than retry as one.
    let harnesses = ["claude", "codex", "cursor", "grok", "opencode", "amp"];
    let mut delays: Vec<i64> = harnesses
        .iter()
        .map(|harness| ModelSnapshotService::test_jittered_backoff(harness, 1, base))
        .collect();
    for delay in &delays {
        assert!(
            (low..=high).contains(delay),
            "{delay}s is outside the +/-20% envelope [{low}, {high}]"
        );
    }
    delays.sort_unstable();
    // The guarantee is SPREAD, not uniqueness: offsets drawn over a 241-second
    // envelope collide sometimes by simple pigeonhole. What matters is that the
    // group does not retry as one.
    let spread = delays.last().expect("delays") - delays.first().expect("delays");
    let envelope = high - low;
    assert!(
        spread * 2 >= envelope,
        "sibling harnesses must spread across at least half the envelope \
         (spread {spread}s of {envelope}s): {delays:?}"
    );
    let mut deduped = delays.clone();
    deduped.dedup();
    assert!(
        deduped.len() >= delays.len() - 1,
        "at most one collision is acceptable among siblings: {delays:?}"
    );

    // Successive attempts on the SAME harness also move, so two harnesses cannot
    // stay locked together as the ladder climbs.
    let attempts: Vec<i64> = (1..=4)
        .map(|attempt| ModelSnapshotService::test_jittered_backoff("opencode", attempt, base))
        .collect();
    let mut deduped_attempts = attempts.clone();
    deduped_attempts.dedup();
    assert!(
        deduped_attempts.len() > 1,
        "the attempt number must affect the offset: {attempts:?}"
    );

    // A delay too small to spread degrades to itself rather than to zero: a
    // sub-second backoff would not be a brake at all.
    assert_eq!(ModelSnapshotService::test_jittered_backoff("opencode", 1, 1), 1);
}
