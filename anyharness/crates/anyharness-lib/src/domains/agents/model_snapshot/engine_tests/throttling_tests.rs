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

/// T-24 — backoff: consecutive failures schedule 1m then 2m, a poke inside the
/// window does nothing, and a success resets the counter.
///
/// The window is asserted through the status surface's `nextAttemptAt` rather than by
/// sleeping, so the schedule is checked without a real clock.
///
/// The bounds are the LADDER's rung ±20%, because `record_failure` spreads each delay
/// by a deterministic per-slot offset (see `jittered_backoff_seconds`). Asserting the
/// exact rung would pin the ABSENCE of jitter — which is precisely the drift a review
/// caught between this module's doc comment and its code. The doubling stays exact
/// anyway: the two envelopes below do not overlap, so a ladder that failed to double
/// could not pass.
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
        (48..=72).contains(&first_delay),
        "the first backoff must be 60s +/-20%, got {first_delay}s"
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
    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("success");
    let cleared = service.status("opencode", chrono::Utc::now());
    assert_eq!(cleared.contexts[0].state, super::super::status::LiveState::Idle);
    assert_eq!(cleared.contexts[0].next_attempt_at, None);
}

/// The backoff jitter itself: deterministic, inside ±20%, and actually spreading.
///
/// It exists because the failures that matter arrive in groups — one provider outage,
/// one expired org key, one revoked enrollment fails EVERY dependent context inside a
/// single poke. A flat ladder then retries all of them at the same instant forever,
/// the same self-synchronizing burst the TTL jitter prevents one layer up.
///
/// Deterministic rather than random so the ladder above stays exactly assertable,
/// which is also why this property can be checked exactly rather than statistically.
#[test]
fn backoff_jitter_is_deterministic_bounded_and_spreads_sibling_contexts() {
    let base = 600_u64;
    let low = (base * 4 / 5) as i64;
    let high = (base * 6 / 5) as i64;

    // Pure: the same key and attempt always answer the same.
    let once = ModelSnapshotService::test_jittered_backoff("opencode", "gateway", 1, base);
    assert_eq!(
        once,
        ModelSnapshotService::test_jittered_backoff("opencode", "gateway", 1, base)
    );

    // Every context of one harness — the group that fails together — must land on a
    // different offset inside the envelope.
    let contexts = [
        "anthropic-api",
        "openai-api",
        "gemini-api",
        "opencode-zen",
        "baseline",
        "gateway",
    ];
    let mut delays: Vec<i64> = contexts
        .iter()
        .map(|context| ModelSnapshotService::test_jittered_backoff("opencode", context, 1, base))
        .collect();
    for delay in &delays {
        assert!(
            (low..=high).contains(delay),
            "{delay}s is outside the +/-20% envelope [{low}, {high}]"
        );
    }
    delays.sort_unstable();
    // The guarantee is SPREAD, not uniqueness. Six offsets drawn over a 241-second
    // envelope collide sometimes by simple pigeonhole, and demanding uniqueness would
    // pin a property the hash cannot provide — the same over-claim that made the
    // TTL-jitter test assert a per-pair minimum it did not have. What matters is that
    // the group does not retry as one: the observed spread must cover a real fraction
    // of the envelope.
    let spread = delays.last().expect("delays") - delays.first().expect("delays");
    let envelope = high - low;
    assert!(
        spread * 2 >= envelope,
        "sibling contexts must spread across at least half the envelope \
         (spread {spread}s of {envelope}s): {delays:?}"
    );
    let mut deduped = delays.clone();
    deduped.dedup();
    assert!(
        deduped.len() >= delays.len() - 1,
        "at most one collision is acceptable among siblings: {delays:?}"
    );

    // Successive attempts on the SAME key also move, so two contexts cannot stay
    // locked together as the ladder climbs.
    let attempts: Vec<i64> = (1..=4)
        .map(|attempt| {
            ModelSnapshotService::test_jittered_backoff("opencode", "gateway", attempt, base)
        })
        .collect();
    let mut deduped_attempts = attempts.clone();
    deduped_attempts.dedup();
    assert!(
        deduped_attempts.len() > 1,
        "the attempt number must affect the offset: {attempts:?}"
    );

    // A delay too small to spread degrades to itself rather than to zero: a
    // sub-second backoff would not be a brake at all.
    assert_eq!(
        ModelSnapshotService::test_jittered_backoff("opencode", "gateway", 1, 1),
        1
    );
}
