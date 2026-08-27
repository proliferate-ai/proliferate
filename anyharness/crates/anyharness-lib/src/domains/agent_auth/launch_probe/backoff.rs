//! The retry ladder's jitter.
//!
//! Split out of the reconciler for the same reason as `detail.rs`: it is pure
//! arithmetic with a specific failure mode it exists to prevent, and it is asserted
//! directly.

/// Spread a backoff delay by a deterministic ±20%, keyed on (harness, attempt).
///
/// **Why jitter at all**: the failures that matter arrive in groups. A provider
/// outage or an expired org key fails EVERY harness that depends on it, within one
/// startup pass. A flat ladder then holds all of them to the same window, forever
/// — a self-synchronizing burst on whichever event next admits them.
///
/// **Why deterministic**: the schedule has to stay assertable. The backoff test
/// pins the 1m/2m sequence, and an RNG would turn that into a flaky range check.
/// Mixing the attempt number in means successive retries of the same harness land
/// on different offsets rather than drifting in lockstep with each other.
///
/// Clamped to at least 1s: a sub-second backoff is not a brake.
pub(super) fn jittered_backoff_seconds(harness_kind: &str, attempt: u32, base_seconds: u64) -> i64 {
    // ±20%, as twentieths, so the offset is integer arithmetic with no float
    // rounding to reason about.
    const SPREAD_NUMERATOR: u64 = 4;
    const SPREAD_DENOMINATOR: u64 = 20;

    let span = base_seconds.saturating_mul(SPREAD_NUMERATOR) / SPREAD_DENOMINATOR;
    if span == 0 {
        return base_seconds.max(1) as i64;
    }
    let hash = stable_backoff_hash(harness_kind, attempt);
    // Map into [-span, +span].
    let offset = (hash % (span * 2 + 1)) as i64 - span as i64;
    (base_seconds as i64 + offset).max(1)
}

/// FNV-1a over the harness kind, mixed with the attempt number.
///
/// Chosen over `DefaultHasher` deliberately: `std`'s hasher is explicitly not
/// guaranteed stable across releases, and this value must be the same on every
/// build or a toolchain bump silently re-schedules every machine's retries at
/// once.
fn stable_backoff_hash(harness_kind: &str, attempt: u32) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET_BASIS;
    for byte in harness_kind.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    for byte in attempt.to_le_bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}
