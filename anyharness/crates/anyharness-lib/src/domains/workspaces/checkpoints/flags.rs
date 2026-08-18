//! The capture flag and the turn-start capture-failure policy point.

/// `ANYHARNESS_CHECKPOINT_CAPTURE=on` turns on turn-start checkpoint capture
/// (and, with it, the retention duty). DEFAULT OFF: capture is a cost-observation
/// feature this rung ships behind an operator flag, and flag-off means literally
/// zero capture work (no store reads, no git) at the dispatch seam. A plain env
/// read, no caching, so tests can set/unset per-case — the same idiom as
/// `agents/installer/auto_install.rs`'s `always_managed_install_enabled`.
pub fn checkpoint_capture_enabled() -> bool {
    std::env::var("ANYHARNESS_CHECKPOINT_CAPTURE")
        .map(|value| value == "on")
        .unwrap_or(false)
}

/// What a turn-start capture FAILURE does to the prompt that triggered it.
/// ADR H Q-H1's open abort-vs-degrade sub-choice is built as a policy point
/// rather than hard-coded: one constant selects the arm, both arms are
/// implemented, and flipping [`TURN_START_CAPTURE_FAILURE_POLICY`] is the whole
/// change when the final ruling lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureFailurePolicy {
    /// A capture failure fails the prompt with a typed error. The working-lean
    /// choice: a checkpoint a user thinks they have but do not is worse than a
    /// refused turn they can retry.
    Abort,
    /// A capture failure logs a warning and lets the turn proceed uncheckpointed.
    Degrade,
}

/// The selected turn-start capture-failure policy. Working lean is abort
/// cleanly (Q-H1); flip this one constant when the ruling settles. In the
/// primary turn-start mode the fork path is lookup-only (it never captures), so
/// Q-H1's abort-vs-degrade choice is moot there; this const stays live for the
/// fork_boundary fallback cadence, which is the path that can capture and fail.
pub const TURN_START_CAPTURE_FAILURE_POLICY: CaptureFailurePolicy = CaptureFailurePolicy::Abort;
