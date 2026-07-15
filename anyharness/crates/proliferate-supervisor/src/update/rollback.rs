use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use crate::error::SupervisorError;

/// A record of how to undo a single component activation: restore the retained
/// `.prev` binary over the active path when a post-activation health gate
/// fails. The staged/new binary was already renamed into `active_path`, so
/// rollback simply moves `previous_path` back on top of it.
#[derive(Debug, Clone)]
pub struct RollbackPlan {
    pub component: String,
    /// The live binary path the runtime executes (`active_path`).
    pub active_path: PathBuf,
    /// The retained last-good binary (`<active>.prev`).
    pub previous_path: PathBuf,
}

impl RollbackPlan {
    pub fn new(
        component: impl Into<String>,
        active_path: PathBuf,
        previous_path: PathBuf,
    ) -> Self {
        Self {
            component: component.into(),
            active_path,
            previous_path,
        }
    }

    /// Restore the retained `.prev` binary over the active path so the last-good
    /// version keeps serving. Fails closed if there is no previous binary to
    /// restore (a first activation had no prior to keep).
    pub fn apply(&self) -> Result<(), SupervisorError> {
        if !self.previous_path.exists() {
            return Err(SupervisorError::Rollback {
                component: self.component.clone(),
                source: io::Error::new(
                    io::ErrorKind::NotFound,
                    "no previous binary to restore",
                ),
            });
        }
        fs::rename(&self.previous_path, &self.active_path).map_err(|source| {
            SupervisorError::Rollback {
                component: self.component.clone(),
                source,
            }
        })?;
        restore_executable(&self.active_path);
        Ok(())
    }
}

fn restore_executable(path: &Path) {
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::RollbackPlan;

    struct TempDir(std::path::PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_dir(tag: &str) -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "proliferate-supervisor-rollback-{tag}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }

    #[test]
    fn apply_restores_previous_over_active() {
        let dir = temp_dir("restore");
        let active = dir.0.join("worker");
        let previous = dir.0.join("worker.prev");
        fs::write(&active, b"new").expect("write active");
        fs::write(&previous, b"old").expect("write previous");

        let plan = RollbackPlan::new("worker", active.clone(), previous.clone());
        plan.apply().expect("rollback applies");

        assert_eq!(fs::read(&active).expect("read active"), b"old");
        assert!(!previous.exists(), "previous consumed by the restore");
    }

    #[test]
    fn apply_fails_closed_without_a_previous_binary() {
        let dir = temp_dir("missing");
        let active = dir.0.join("worker");
        let previous = dir.0.join("worker.prev");
        fs::write(&active, b"new").expect("write active");

        let plan = RollbackPlan::new("worker", active.clone(), previous);
        assert!(plan.apply().is_err());
        // The active path is left untouched when there is nothing to restore.
        assert_eq!(fs::read(&active).expect("read active"), b"new");
    }
}
