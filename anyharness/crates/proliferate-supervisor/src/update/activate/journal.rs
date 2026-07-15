//! Crash-safe binary activation: the atomic swap and the durable *activation
//! journal* that makes a crash between the two renames recoverable (R9R-004).
//!
//! `activate_binary` writes a journal naming the `active`/`.prev`/`staged` paths
//! BEFORE the two renames, then removes it once the swap completes. On the next
//! startup the Supervisor calls [`reconcile_activation_journal`], which completes
//! or reverses an interrupted swap so `active` is never left absent — otherwise
//! the run loop would livelock trying to spawn a missing binary.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::{config::SupervisorConfig, error::SupervisorError, update::rollback::RollbackPlan};
use proliferate_runtime_update_protocol::UpdateComponent;

pub(super) fn prev_path_for(active: &Path) -> PathBuf {
    let mut raw = active.as_os_str().to_os_string();
    raw.push(".prev");
    PathBuf::from(raw)
}

/// Atomically swap `staged` onto `active`, moving the current active binary to
/// `active.prev` first. Returns the plan that restores `.prev` on an unhealthy
/// activation. If the second rename fails, the prior binary is put back so a
/// runnable component keeps serving.
///
/// Crash-safety (R9R-004): the two renames have a window where `active` is
/// absent (moved to `.prev`, `staged` not yet renamed in). A crash there would
/// otherwise leave the Supervisor unable to spawn the component and livelocked
/// on the missing binary. Before the renames we write a durable *activation
/// journal* naming the three paths; on the next startup
/// [`reconcile_activation_journal`] completes or reverses the interrupted swap
/// so `active` always exists. The journal is removed once the swap completes.
pub(super) fn activate_binary(
    config: &SupervisorConfig,
    component: UpdateComponent,
    staged: &Path,
    active: &Path,
) -> Result<RollbackPlan, SupervisorError> {
    let previous = prev_path_for(active);
    let journal = ActivationJournal {
        component: component.as_str().to_string(),
        active_path: active.to_path_buf(),
        prev_path: previous.clone(),
        staged_path: staged.to_path_buf(),
    };
    write_activation_journal(config, &journal)?;
    let activate_err = |source| SupervisorError::Activate {
        component: component.as_str().to_string(),
        source,
    };
    let moved_previous = if active.exists() {
        fs::rename(active, &previous).map_err(activate_err)?;
        true
    } else {
        false
    };
    if let Err(source) = fs::rename(staged, active) {
        if moved_previous {
            let _ = fs::rename(&previous, active);
        }
        // The swap did not happen: `active` is back to its prior state, so the
        // journal is no longer describing an in-flight swap. Clear it.
        remove_activation_journal(config);
        return Err(activate_err(source));
    }
    set_executable(active);
    // The swap completed cleanly: no recovery needed, drop the journal.
    remove_activation_journal(config);
    Ok(RollbackPlan::new(
        component.as_str(),
        active.to_path_buf(),
        previous,
    ))
}

/// A durable record of an in-flight activation swap, written before the two
/// renames and reconciled at startup so a crash between them cannot leave the
/// `active` binary absent (R9R-004).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ActivationJournal {
    pub(super) component: String,
    pub(super) active_path: PathBuf,
    pub(super) prev_path: PathBuf,
    pub(super) staged_path: PathBuf,
}

const ACTIVATION_JOURNAL_FILE: &str = "activation.journal";

pub(super) fn activation_journal_path(config: &SupervisorConfig) -> PathBuf {
    config.update_request_dir.join(ACTIVATION_JOURNAL_FILE)
}

/// Atomically write the activation journal (temp + rename + fsync) so a crash
/// mid-write never leaves a partial journal.
pub(super) fn write_activation_journal(
    config: &SupervisorConfig,
    journal: &ActivationJournal,
) -> Result<(), SupervisorError> {
    let dir = &config.update_request_dir;
    fs::create_dir_all(dir).map_err(|source| SupervisorError::CreateUpdateStagingDir {
        path: dir.clone(),
        source,
    })?;
    let bytes = serde_json::to_vec(journal).map_err(SupervisorError::ParseUpdateManifest)?;
    let path = activation_journal_path(config);
    let tmp = dir.join(format!(
        ".{ACTIVATION_JOURNAL_FILE}.tmp.{}",
        std::process::id()
    ));
    fs::write(&tmp, &bytes).map_err(|source| SupervisorError::WriteUpdateArtifact {
        path: tmp.clone(),
        source,
    })?;
    if let Ok(file) = fs::File::open(&tmp) {
        let _ = file.sync_all();
    }
    fs::rename(&tmp, &path).map_err(|source| {
        let _ = fs::remove_file(&tmp);
        SupervisorError::WriteUpdateArtifact { path, source }
    })?;
    // Durably persist the rename itself: fsync the directory so the journal
    // entry survives a power loss between here and the two activation renames
    // (R9R3-001). Best-effort — a platform that cannot open a dir for sync
    // still has the crash-recovery `.prev` fallback.
    if let Ok(dir_handle) = fs::File::open(dir) {
        let _ = dir_handle.sync_all();
    }
    Ok(())
}

fn read_activation_journal(
    config: &SupervisorConfig,
) -> Result<Option<ActivationJournal>, SupervisorError> {
    let path = activation_journal_path(config);
    let contents = match fs::read(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(SupervisorError::ReadUpdateArtifact { path, source }),
    };
    let journal =
        serde_json::from_slice(&contents).map_err(SupervisorError::ParseUpdateManifest)?;
    Ok(Some(journal))
}

fn remove_activation_journal(config: &SupervisorConfig) {
    let _ = fs::remove_file(activation_journal_path(config));
}

/// Reconcile a crash-interrupted activation at startup (R9R-004). If a journal
/// exists and its `active` path is absent — the crash landed in the window
/// between `active -> .prev` and `staged -> active` — complete the interrupted
/// swap (`staged -> active`) or, if the staged binary is gone, restore last-good
/// (`.prev -> active`). Either way `active` exists afterward, so the run loop can
/// spawn the component instead of livelocking on a missing binary; the request
/// keeps its no-result state and the next drain re-activates and health-gates it.
/// The journal is cleared once reconciled.
pub fn reconcile_activation_journal(config: &SupervisorConfig) -> Result<(), SupervisorError> {
    let Some(journal) = read_activation_journal(config)? else {
        return Ok(());
    };
    if !journal.active_path.exists() {
        let restore_from = if journal.staged_path.exists() {
            Some(journal.staged_path.as_path())
        } else if journal.prev_path.exists() {
            Some(journal.prev_path.as_path())
        } else {
            None
        };
        if let Some(source) = restore_from {
            fs::rename(source, &journal.active_path).map_err(|source| {
                SupervisorError::Activate {
                    component: journal.component.clone(),
                    source,
                }
            })?;
            set_executable(&journal.active_path);
            warn!(
                component = %journal.component,
                active = %journal.active_path.display(),
                "reconciled a crash-interrupted activation to a consistent active binary"
            );
        }
    }
    remove_activation_journal(config);
    Ok(())
}

fn set_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "proliferate-supervisor-journal-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }

    fn test_config(base: &Path) -> SupervisorConfig {
        fs::create_dir_all(base.join("bin")).expect("create bin dir");
        SupervisorConfig {
            anyharness_binary: base.join("bin/anyharness"),
            worker_binary: base.join("bin/worker"),
            worker_config: base.join("worker.toml"),
            anyharness_args: vec!["serve".to_string()],
            anyharness_env: BTreeMap::new(),
            process_env: BTreeMap::new(),
            restart_delay_seconds: 1,
            update_request_dir: base.join("updates"),
            staging_dir: base.join("staging"),
            anyharness_health_url: "http://127.0.0.1:8457/health".to_string(),
            health_check_attempts: 1,
            health_check_delay_seconds: 0,
            max_artifact_bytes: 1024,
            download_timeout_seconds: 5,
            update_poll_interval_seconds: 1,
        }
    }

    #[test]
    fn reconcile_restores_last_good_when_staged_is_gone() {
        // The other between-renames variant: `active` absent and `staged` already
        // gone (crash after the staged file was consumed/lost). Reconcile must
        // restore last-good from `.prev` so a runnable binary exists.
        let dir = temp_dir();
        let config = test_config(&dir.0);
        let active = config.anyharness_binary.clone();
        let prev = prev_path_for(&active);
        fs::write(&prev, b"old-good").expect("seed .prev");
        let staged = config.staging_dir.join("anyharness-0.2.16"); // never created
        write_activation_journal(
            &config,
            &ActivationJournal {
                component: "anyharness".to_string(),
                active_path: active.clone(),
                prev_path: prev.clone(),
                staged_path: staged,
            },
        )
        .expect("write journal");

        reconcile_activation_journal(&config).expect("reconcile");
        assert_eq!(
            fs::read(&active).unwrap(),
            b"old-good",
            "active restored from .prev"
        );
        assert!(!activation_journal_path(&config).exists());
    }
}
