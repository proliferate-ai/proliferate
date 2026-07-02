//! Test-only helpers for the route-auth module: a self-cleaning temp home and
//! a state-file writer.

use std::path::{Path, PathBuf};

use super::state::state_file_path;

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
