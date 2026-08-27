//! Shared test-only support for the checkpoints suites: the process-global
//! capture-flag guard and its lock.
//!
//! Extracted from `tests.rs` so a test OUTSIDE this subdomain (the runtime
//! prompt-dispatch suite in
//! `sessions/runtime/checkpoint_linkage_tests.rs`, which drives `send_prompt`
//! under `ANYHARNESS_CHECKPOINT_CAPTURE=on`) can share the SAME lock. The flag
//! is process-global and tests run in parallel, so a second, independent lock
//! would let two suites race the same env var; `pub(crate)` here keeps every
//! setter behind one mutex.

/// Holds the shared env lock for its whole lifetime and sets/clears the capture
/// flag. `pub(crate)` (rather than `pub(super)`) so suites in other subdomains
/// can share the crate-wide lock required for every process-global variable.
pub(crate) struct EnvGuard {
    _lock: tokio::sync::MutexGuard<'static, ()>,
}

impl EnvGuard {
    pub(crate) async fn on() -> Self {
        let lock = crate::app::test_support::lock_env().await;
        std::env::set_var("ANYHARNESS_CHECKPOINT_CAPTURE", "on");
        EnvGuard { _lock: lock }
    }

    pub(crate) async fn off() -> Self {
        let lock = crate::app::test_support::lock_env().await;
        std::env::remove_var("ANYHARNESS_CHECKPOINT_CAPTURE");
        EnvGuard { _lock: lock }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        std::env::remove_var("ANYHARNESS_CHECKPOINT_CAPTURE");
    }
}
