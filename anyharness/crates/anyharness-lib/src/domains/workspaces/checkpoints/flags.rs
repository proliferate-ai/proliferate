//! The capture flag and the turn-start capture-failure policy point.

/// `ANYHARNESS_CHECKPOINT_CAPTURE=on` turns on turn-start checkpoint capture
/// (and, with it, retention policy culling). DEFAULT OFF: capture is a
/// cost-observation feature this rung ships behind an operator flag, and
/// flag-off means literally zero capture work (no store reads, no git) at the
/// dispatch seam. Expired/rowless convergence remains active so turning the
/// flag off cannot strand prior cleanup. A plain env read, no caching, so tests
/// can set/unset per-case — the same idiom as
/// `agents/installer/auto_install.rs`'s `always_managed_install_enabled`.
pub fn checkpoint_capture_enabled() -> bool {
    std::env::var("ANYHARNESS_CHECKPOINT_CAPTURE")
        .map(|value| value == "on")
        .unwrap_or(false)
}

/// What a turn-start capture failure does to the prompt that triggered it.
/// One constant selects the policy; both arms stay explicit so an owner-approved
/// policy change remains localized.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureFailurePolicy {
    /// A capture failure fails the prompt with a typed error. A checkpoint a
    /// user thinks they have but do not is worse than a refused, retryable turn.
    Abort,
    /// A capture failure logs a warning and lets the turn proceed uncheckpointed.
    Degrade,
}

/// The selected turn-start capture-failure policy: abort cleanly. This governs
/// prompt-dispatch capture only. Fork linkage is an exact lookup of an existing
/// turn-start checkpoint and has no fallback capture path.
pub const TURN_START_CAPTURE_FAILURE_POLICY: CaptureFailurePolicy = CaptureFailurePolicy::Abort;
