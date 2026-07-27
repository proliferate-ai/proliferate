//! The retry ladder's jitter.
//!
//! Split out of the reconciler for the same reason as `detail.rs`: it is pure
//! arithmetic with a specific failure mode it exists to prevent, and it is asserted
//! directly.

use super::staleness;

/// Spread a backoff delay by a deterministic ±20%, keyed on (harness, context,
/// attempt).
///
/// **Why jitter at all**: the failures that matter arrive in groups. A provider
/// outage, an expired org key, or a revoked gateway enrollment fails EVERY context
/// that depends on it, within one poke. A flat ladder then retries all of them at
/// the same instant, forever — the same self-synchronizing burst the TTL jitter
/// exists to prevent, one layer down.
///
/// **Why deterministic**: the schedule has to stay assertable. T-24 pins the 1m/2m
/// sequence, and an RNG would turn that into a flaky range check. Mixing the attempt
/// number in means successive retries of the same key land on different offsets
/// rather than drifting in lockstep with each other.
///
/// Clamped to at least 1s: a sub-second backoff is not a brake.
pub(super) fn jittered_backoff_seconds(
    harness_kind: &str,
    auth_context_id: &str,
    attempt: u32,
    base_seconds: u64,
) -> i64 {
    // ±20%, as twentieths, so the offset is integer arithmetic with no float
    // rounding to reason about.
    const SPREAD_NUMERATOR: u64 = 4;
    const SPREAD_DENOMINATOR: u64 = 20;

    let span = base_seconds.saturating_mul(SPREAD_NUMERATOR) / SPREAD_DENOMINATOR;
    if span == 0 {
        return base_seconds.max(1) as i64;
    }
    let hash = staleness::stable_backoff_hash(harness_kind, auth_context_id, attempt);
    // Map into [-span, +span].
    let offset = (hash % (span * 2 + 1)) as i64 - span as i64;
    (base_seconds as i64 + offset).max(1)
}
