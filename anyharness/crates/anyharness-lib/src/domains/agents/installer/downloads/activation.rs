use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::InstallError;

const JOURNAL_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivationJournal {
    version: u8,
    transaction_id: String,
    tree_existed: bool,
    launcher_existed: bool,
}

#[derive(Debug)]
struct ActivationPaths {
    parent: PathBuf,
    dest_dir: PathBuf,
    backup_dir: PathBuf,
    journal_path: PathBuf,
    journal_temp_path: PathBuf,
    marker_path: PathBuf,
    marker_temp_path: PathBuf,
    launcher_path: Option<PathBuf>,
    launcher_backup_path: Option<PathBuf>,
}

#[derive(Debug)]
pub(in crate::domains::agents::installer) struct ArchiveTreeActivation {
    paths: ActivationPaths,
    staging_dir: PathBuf,
    journal: ActivationJournal,
    committed: bool,
    finished: bool,
}

impl ArchiveTreeActivation {
    pub(super) fn recover(
        dest_dir: &Path,
        launcher_path: Option<&Path>,
    ) -> Result<(), InstallError> {
        let paths = activation_paths(dest_dir, launcher_path)?;
        recover_previous_activation(dest_dir, &paths)?;
        Ok(())
    }

    pub(super) fn activate_tree(
        dest_dir: &Path,
        staging_dir: &Path,
        launcher_path: Option<&Path>,
    ) -> Result<Self, InstallError> {
        let paths = activation_paths(dest_dir, launcher_path)?;
        // Recovery runs again immediately before the first rename. This is the
        // fail-closed boundary: no new generation starts while an older journal
        // or commit marker remains unresolved.
        recover_previous_activation(dest_dir, &paths)?;

        let journal = ActivationJournal {
            version: JOURNAL_VERSION,
            transaction_id: uuid::Uuid::new_v4().to_string(),
            tree_existed: dest_dir.exists(),
            launcher_existed: launcher_path.is_some_and(Path::exists),
        };
        write_prepared_journal(&paths, &journal)?;

        let activation = Self {
            paths,
            staging_dir: staging_dir.to_path_buf(),
            journal,
            committed: false,
            finished: false,
        };

        if dest_dir.exists() {
            if let Err(error) = std::fs::rename(dest_dir, &activation.paths.backup_dir) {
                return Err(activation.rollback_after(InstallError::Io(error)));
            }
            if let Err(error) = sync_directory(&activation.paths.parent) {
                return Err(activation.rollback_after(InstallError::Io(error)));
            }
        }
        if let Err(error) = std::fs::rename(staging_dir, dest_dir) {
            return Err(activation.rollback_after(InstallError::Io(error)));
        }
        if let Err(error) = sync_directory(&activation.paths.parent) {
            return Err(activation.rollback_after(InstallError::Io(error)));
        }
        Ok(activation)
    }

    pub(in crate::domains::agents::installer) fn activate_launcher(
        &mut self,
        staged_launcher: &Path,
    ) -> Result<(), InstallError> {
        let Some(launcher_path) = self.paths.launcher_path.as_ref() else {
            return Err(InstallError::InvalidInstallSpec(
                "archive activation has no launcher path".into(),
            ));
        };
        let launcher_backup = self.paths.launcher_backup_path.as_ref().ok_or_else(|| {
            InstallError::InvalidInstallSpec("archive activation has no launcher backup".into())
        })?;
        if launcher_backup.exists() {
            return Err(InstallError::InvalidInstallSpec(format!(
                "unresolved launcher backup blocks activation: {}",
                launcher_backup.display()
            )));
        }
        if launcher_path.exists() {
            std::fs::rename(launcher_path, launcher_backup)?;
            sync_parent(launcher_path)?;
        }
        std::fs::rename(staged_launcher, launcher_path)?;
        sync_parent(launcher_path)?;
        Ok(())
    }

    pub(in crate::domains::agents::installer) fn commit(mut self) -> Result<(), InstallError> {
        if let Err(error) = prepare_commit_marker(&self.paths, &self.journal) {
            return Err(self.rollback_after(InstallError::Io(error)));
        }
        if let Err(error) = std::fs::rename(&self.paths.marker_temp_path, &self.paths.marker_path) {
            return Err(self.rollback_after(InstallError::Io(error)));
        }
        // Publication is the irrevocable commit point. If the following parent
        // sync fails, leave the matching marker, journal, and backups intact so
        // recovery chooses either the fully published commit or the prepared
        // rollback state after a crash. Never roll back a visible marker.
        self.committed = true;
        sync_directory(&self.paths.parent)?;

        // Once the matching marker is durable, recovery must preserve the new
        // generation. Cleanup is checked; residue keeps the journal/marker and
        // blocks the next generation until recovery can finish it.
        cleanup_committed_activation(&self.paths)?;
        self.finished = true;
        Ok(())
    }

    pub(in crate::domains::agents::installer) fn rollback_after(
        mut self,
        install_error: InstallError,
    ) -> InstallError {
        match self.rollback() {
            Ok(()) => install_error,
            Err(rollback_error) => InstallError::CommandFailed {
                program: "archive activation rollback".into(),
                message: format!(
                    "install failed: {install_error}; rollback also failed: {rollback_error}"
                ),
            },
        }
    }

    fn rollback(&mut self) -> io::Result<()> {
        rollback_prepared_activation(&self.paths, &self.journal, Some(&self.staging_dir))?;
        self.finished = true;
        Ok(())
    }
}

impl Drop for ArchiveTreeActivation {
    fn drop(&mut self) {
        if self.finished || self.committed {
            return;
        }
        if let Err(error) = self.rollback() {
            // Drop cannot return an error. The prepared journal is intentionally
            // retained on failure so the next install retries recovery instead
            // of silently accepting a partial activation.
            eprintln!("archive activation rollback failed; recovery journal retained: {error}");
        }
    }
}

fn activation_paths(
    dest_dir: &Path,
    launcher_path: Option<&Path>,
) -> Result<ActivationPaths, InstallError> {
    let parent = dest_dir.parent().ok_or_else(|| {
        InstallError::InvalidInstallSpec("archive destination has no parent".into())
    })?;
    let name = dest_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("archive-tree");
    let launcher_backup_path = launcher_path.map(|path| {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("launcher");
        path.with_file_name(format!(".{name}.previous"))
    });
    Ok(ActivationPaths {
        parent: parent.to_path_buf(),
        dest_dir: dest_dir.to_path_buf(),
        backup_dir: parent.join(format!(".{name}.previous")),
        journal_path: parent.join(format!(".{name}.activation-journal")),
        journal_temp_path: parent.join(format!(".{name}.activation-journal.next")),
        marker_path: parent.join(format!(".{name}.activation-committed")),
        marker_temp_path: parent.join(format!(".{name}.activation-committed.next")),
        launcher_path: launcher_path.map(Path::to_path_buf),
        launcher_backup_path,
    })
}

fn recover_previous_activation(dest_dir: &Path, paths: &ActivationPaths) -> io::Result<()> {
    if paths.journal_path.exists() {
        let journal = read_journal(&paths.journal_path)?;
        if paths.marker_path.exists() {
            let marker_transaction = std::fs::read_to_string(&paths.marker_path)?;
            if marker_transaction.trim() != journal.transaction_id {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "activation marker transaction {} does not match journal {}",
                        marker_transaction.trim(),
                        journal.transaction_id
                    ),
                ));
            }
            cleanup_committed_activation(paths)?;
        } else {
            rollback_prepared_activation(paths, &journal, None)?;
        }
        return Ok(());
    }

    // An atomic journal/marker write may leave only its fully-synced temporary
    // file if the process dies before rename. No live rename can depend on a
    // journal temp, and a marker temp without its journal cannot establish a
    // commit, so both are safe to remove before legacy recovery/new admission.
    remove_file_if_exists(&paths.journal_temp_path)?;
    remove_file_if_exists(&paths.marker_temp_path)?;
    sync_directory(&paths.parent)?;

    if paths.marker_path.exists() {
        // Legacy marker-only committed activation, or a new committed cleanup
        // interrupted after journal removal. Both preserve the live tree.
        remove_dir_all_if_exists(&paths.backup_dir)?;
        if let Some(launcher_backup) = &paths.launcher_backup_path {
            remove_file_if_exists(launcher_backup)?;
            sync_parent(launcher_backup)?;
        }
        sync_directory(&paths.parent)?;
        remove_file_if_exists(&paths.marker_path)?;
        sync_directory(&paths.parent)?;
        return Ok(());
    }

    // Backward-compatible recovery for the previous marker-less journal shape.
    if paths.backup_dir.exists() {
        remove_dir_all_if_exists(dest_dir)?;
        std::fs::rename(&paths.backup_dir, dest_dir)?;
        sync_directory(&paths.parent)?;
    }
    if let (Some(launcher), Some(launcher_backup)) =
        (&paths.launcher_path, &paths.launcher_backup_path)
    {
        if launcher_backup.exists() {
            remove_file_if_exists(launcher)?;
            std::fs::rename(launcher_backup, launcher)?;
            sync_parent(launcher)?;
        }
    }
    Ok(())
}

fn write_prepared_journal(paths: &ActivationPaths, journal: &ActivationJournal) -> io::Result<()> {
    if paths.journal_path.exists()
        || paths.journal_temp_path.exists()
        || paths.marker_path.exists()
        || paths.marker_temp_path.exists()
    {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "unresolved archive activation journal blocks a new transaction",
        ));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&paths.journal_temp_path)?;
    serde_json::to_writer(&mut file, journal).map_err(io::Error::other)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    std::fs::rename(&paths.journal_temp_path, &paths.journal_path)?;
    sync_directory(&paths.parent)
}

fn prepare_commit_marker(paths: &ActivationPaths, journal: &ActivationJournal) -> io::Result<()> {
    let mut marker = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&paths.marker_temp_path)?;
    marker.write_all(journal.transaction_id.as_bytes())?;
    marker.write_all(b"\n")?;
    marker.sync_all()
}

fn read_journal(path: &Path) -> io::Result<ActivationJournal> {
    let file = File::open(path)?;
    let journal: ActivationJournal = serde_json::from_reader(file).map_err(io::Error::other)?;
    if journal.version != JOURNAL_VERSION || journal.transaction_id.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unsupported or incomplete archive activation journal",
        ));
    }
    Ok(journal)
}

fn rollback_prepared_activation(
    paths: &ActivationPaths,
    journal: &ActivationJournal,
    staging_dir: Option<&Path>,
) -> io::Result<()> {
    if journal.tree_existed {
        if paths.backup_dir.exists() {
            remove_dir_all_if_exists(&paths.dest_dir)?;
            std::fs::rename(&paths.backup_dir, &paths.dest_dir)?;
        } else if !paths.dest_dir.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "neither live archive tree nor rollback backup exists",
            ));
        }
    } else {
        remove_dir_all_if_exists(&paths.dest_dir)?;
    }
    if let Some(staging_dir) = staging_dir {
        remove_dir_all_if_exists(staging_dir)?;
    }
    sync_directory(&paths.parent)?;

    if let (Some(launcher), Some(launcher_backup)) =
        (&paths.launcher_path, &paths.launcher_backup_path)
    {
        if journal.launcher_existed {
            if launcher_backup.exists() {
                remove_file_if_exists(launcher)?;
                std::fs::rename(launcher_backup, launcher)?;
            } else if !launcher.exists() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "neither live launcher nor rollback backup exists",
                ));
            }
        } else {
            remove_file_if_exists(launcher)?;
        }
        sync_parent(launcher)?;
    }

    remove_file_if_exists(&paths.marker_temp_path)?;
    remove_file_if_exists(&paths.marker_path)?;
    sync_directory(&paths.parent)?;
    remove_file_if_exists(&paths.journal_temp_path)?;
    remove_file_if_exists(&paths.journal_path)?;
    sync_directory(&paths.parent)
}

fn cleanup_committed_activation(paths: &ActivationPaths) -> io::Result<()> {
    remove_dir_all_if_exists(&paths.backup_dir)?;
    sync_directory(&paths.parent)?;
    if let Some(launcher_backup) = &paths.launcher_backup_path {
        remove_file_if_exists(launcher_backup)?;
        sync_parent(launcher_backup)?;
    }

    remove_file_if_exists(&paths.journal_temp_path)?;
    remove_file_if_exists(&paths.marker_temp_path)?;
    sync_directory(&paths.parent)?;
    // Remove the journal first. If marker removal then fails, marker-only
    // recovery is unambiguously committed and can safely retry cleanup.
    remove_file_if_exists(&paths.journal_path)?;
    sync_directory(&paths.parent)?;
    remove_file_if_exists(&paths.marker_path)?;
    sync_directory(&paths.parent)
}

fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn remove_dir_all_if_exists(path: &Path) -> io::Result<()> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn sync_parent(path: &Path) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    sync_directory(parent)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    // Windows does not expose a documented FlushFileBuffers contract for a
    // directory handle. Journal/marker files themselves are still sync_all'd;
    // directory ordering is additionally enforced on Unix, where fsync(dir)
    // is the supported durability primitive.
    Ok(())
}
