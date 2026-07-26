//! Test-only helpers for the route-auth module: a self-cleaning temp home, a
//! state-file writer, and a serialized process-`HOME` override for the one apply
//! arm that reads the user's real credential home.

use std::path::{Path, PathBuf};

use super::state::state_file_path;

/// Serialize tests that mutate process-global env. This crate's tests run
/// concurrently, so a `HOME` override has to hold this for its whole scope.
///
/// This is the crate-wide `app::test_support::lock_env`, not a module-local
/// lock: this crate has three other HOME mutators (readiness, sessions,
/// route-aware-read), and a module-local mutex here would not exclude them —
/// narrowing the lock's scope to this module makes it a no-op against the
/// other three.
pub(crate) use crate::app::test_support::lock_env;

/// Point the process `HOME` at a temp dir for the duration, restoring it on drop.
///
/// Needed because `credential-discovery` only honors a credential home that
/// matches the process home (`home_matches_process_home`), so a test that wants
/// the native codex login delivered has to actually BE that user for a moment.
/// Hold [`lock_env`] across the guard's lifetime.
pub(crate) struct HomeEnvGuard {
    previous: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    pub(crate) fn set(home: &Path) -> Self {
        let previous = std::env::var_os("HOME");
        std::env::set_var("HOME", home);
        Self { previous }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }
}

pub(crate) struct TempHome {
    path: PathBuf,
}

impl TempHome {
    pub(crate) fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-route-auth-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp home");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Write raw bytes to the state file location (used for malformed-file
    /// tests).
    pub(crate) fn write_state_raw(&self, bytes: &[u8]) {
        let path = state_file_path(&self.path);
        std::fs::create_dir_all(path.parent().expect("state parent"))
            .expect("create agent-auth dir");
        std::fs::write(&path, bytes).expect("write state file");
    }

    /// Write a JSON value as the state file.
    pub(crate) fn write_state_json(&self, value: &serde_json::Value) {
        self.write_state_raw(serde_json::to_string(value).expect("serialize").as_bytes());
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
