use std::sync::Arc;

use crate::domains::agents::model::ArtifactRole;

/// User-visible stages for one managed harness artifact. Byte counts describe
/// bytes transferred from the artifact source; they are deliberately absent
/// for package-manager work whose dependency downloads are not owned by the
/// runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallProgressPhase {
    Queued,
    Downloading,
    Verifying,
    Extracting,
    Installing,
    Finalizing,
    Completed,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallProgressUpdate {
    pub role: ArtifactRole,
    pub phase: InstallProgressPhase,
    pub downloaded_bytes: u64,
    pub download_size_bytes: Option<u64>,
}

/// Sync reporter used from the installer's `spawn_blocking` boundary. The
/// callback only updates a small in-memory snapshot; it never performs IO.
#[derive(Clone)]
pub struct InstallProgressReporter {
    callback: Arc<dyn Fn(InstallProgressUpdate) + Send + Sync>,
}

impl InstallProgressReporter {
    pub fn new(callback: impl Fn(InstallProgressUpdate) + Send + Sync + 'static) -> Self {
        Self {
            callback: Arc::new(callback),
        }
    }

    pub fn report(
        &self,
        role: &ArtifactRole,
        phase: InstallProgressPhase,
        downloaded_bytes: u64,
        download_size_bytes: Option<u64>,
    ) {
        (self.callback)(InstallProgressUpdate {
            role: role.clone(),
            phase,
            downloaded_bytes,
            download_size_bytes,
        });
    }
}
