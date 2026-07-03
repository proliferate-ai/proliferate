//! Heartbeat-driven binary self-convergence.
//!
//! Sandbox / self-managed workers converge onto the server's pinned worker
//! version reported in each heartbeat ack (`desiredVersions`). The desktop
//! worker must never self-swap — the app bundle owns that binary — so the
//! whole path is gated on `self_update_enabled` in the worker config, which
//! only the sandbox bootstrap turns on.
//!
//! Safety model:
//! - the artifact and its `.sha256` both come from the server's pinned
//!   artifact redirect; the download is rejected unless the digest matches;
//! - the new binary is staged next to the current one, preflighted with
//!   `--version`, then atomically renamed over the current path — a crash at
//!   any point leaves a runnable binary on disk;
//! - the swap finishes with an `exec` of the (replaced) binary path rather
//!   than an exit: the sandbox sidecar is launched with plain `nohup`, so an
//!   exiting worker would never come back. `exec` replaces the process image
//!   in place — the pid, and therefore any supervising parent, never sees an
//!   exit. `Drop` never runs across `exec`, but the process lock needs no
//!   explicit release: it is an `flock` on a file descriptor Rust opened with
//!   `O_CLOEXEC`, so the kernel closes the fd (releasing the lock) exactly at
//!   the exec boundary and the new image re-acquires it during startup;
//! - an env marker carried across the re-exec prevents a hot swap loop when
//!   the published artifact does not actually carry the pinned version (e.g.
//!   the server fell back to an unpinned `stable` artifact).

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, HeartbeatResponse},
    config::WorkerConfig,
    error::WorkerError,
    versions,
};

/// Carried across the re-exec so a swap that failed to change the running
/// version is not retried on every heartbeat.
const ATTEMPTED_VERSION_ENV: &str = "PROLIFERATE_WORKER_SELF_UPDATE_ATTEMPTED";

const BINARY_ASSET: &str = "proliferate-worker";
const CHECKSUM_ASSET: &str = "proliferate-worker.sha256";

#[derive(Debug, PartialEq, Eq)]
pub struct UpdatePlan {
    pub desired_version: String,
}

/// Decide whether this heartbeat ack requires a binary swap. `None` means
/// stay on the current binary (gate off, no/equal pin, or already attempted).
pub fn plan(config: &WorkerConfig, response: &HeartbeatResponse) -> Option<UpdatePlan> {
    if !config.self_update_enabled {
        return None;
    }
    let desired = response
        .desired_versions
        .as_ref()?
        .worker
        .as_deref()?
        .trim()
        .to_string();
    let running = versions::worker_version()?;
    plan_for_versions(&running, &desired, attempted_version().as_deref())
}

fn plan_for_versions(running: &str, desired: &str, attempted: Option<&str>) -> Option<UpdatePlan> {
    if desired.is_empty() || running == desired {
        return None;
    }
    if attempted == Some(desired) {
        warn!(
            running,
            desired,
            "already swapped for this pinned version but still running another; \
             the published artifact likely lags the pin — not retrying"
        );
        return None;
    }
    Some(UpdatePlan {
        desired_version: desired.to_string(),
    })
}

fn attempted_version() -> Option<String> {
    std::env::var(ATTEMPTED_VERSION_ENV)
        .ok()
        .filter(|value| !value.is_empty())
}

/// Download, verify, swap, and re-exec. On success this never returns: the
/// final step replaces the process image with the new binary. Every error
/// path leaves the currently-running binary intact on disk.
pub async fn converge(cloud: &CloudClient, update: &UpdatePlan) -> Result<(), WorkerError> {
    let target = artifact_target()?;
    info!(
        desired = %update.desired_version,
        target,
        "worker version diverged from server pin; starting self-update"
    );
    let binary = cloud
        .download_worker_artifact(&target, BINARY_ASSET)
        .await?;
    let checksum = cloud
        .download_worker_artifact(&target, CHECKSUM_ASSET)
        .await?;
    verify_sha256(&binary, &String::from_utf8_lossy(&checksum))?;

    // Resolve the exe path before touching the filesystem: on Linux,
    // /proc/self/exe stops resolving cleanly once the original inode is
    // replaced underneath the running process.
    let exe_path = std::env::current_exe().map_err(WorkerError::SelfUpdateCurrentExe)?;
    let staged = stage_binary(&binary, &exe_path)?;
    if let Err(error) = preflight(&staged).and_then(|()| {
        std::fs::rename(&staged, &exe_path).map_err(|source| WorkerError::SelfUpdateSwap {
            path: exe_path.clone(),
            source,
        })
    }) {
        let _ = std::fs::remove_file(&staged);
        return Err(error);
    }
    info!(
        desired = %update.desired_version,
        "worker binary swapped; re-exec'ing into the new version"
    );
    // Give queued telemetry a bounded chance to leave: exec never runs Drop,
    // so the sentry guard's usual flush-on-drop will not happen.
    if let Some(client) = sentry::Hub::current().client() {
        client.flush(Some(std::time::Duration::from_secs(2)));
    }
    Err(reexec(&exe_path, &update.desired_version))
}

fn artifact_target() -> Result<String, WorkerError> {
    let unsupported = || WorkerError::SelfUpdateUnsupported {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    };
    let os = match std::env::consts::OS {
        "linux" => "linux",
        "macos" => "macos",
        _ => return Err(unsupported()),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        _ => return Err(unsupported()),
    };
    Ok(format!("{os}-{arch}"))
}

/// Verify `bytes` against the published `.sha256` file contents (either a
/// bare hex digest or the `sha256sum` "digest  filename" form).
pub(crate) fn verify_sha256(bytes: &[u8], checksum_file: &str) -> Result<(), WorkerError> {
    let expected = checksum_file
        .split_whitespace()
        .next()
        .ok_or(WorkerError::SelfUpdateChecksumMalformed)?
        .to_ascii_lowercase();
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorkerError::SelfUpdateChecksumMalformed);
    }
    let actual: String = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if actual != expected {
        return Err(WorkerError::SelfUpdateChecksumMismatch { expected, actual });
    }
    Ok(())
}

/// Write the verified bytes to a temp path in the same directory as the
/// running binary (same filesystem, so the final rename is atomic) and mark
/// it executable.
fn stage_binary(bytes: &[u8], exe_path: &Path) -> Result<PathBuf, WorkerError> {
    let file_name = exe_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(BINARY_ASSET);
    let staged = exe_path.with_file_name(format!(".{file_name}.next.{}", std::process::id()));
    let stage_err = |source: std::io::Error| WorkerError::SelfUpdateStage {
        path: staged.clone(),
        source,
    };
    std::fs::write(&staged, bytes).map_err(stage_err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
            .map_err(stage_err)?;
    }
    Ok(staged)
}

/// Cheap sanity check that the staged file is actually a runnable worker
/// before it replaces the binary we know works: a checksum only proves we
/// downloaded what was published, not that what was published runs here.
fn preflight(staged: &Path) -> Result<(), WorkerError> {
    let output = std::process::Command::new(staged)
        .arg("--version")
        .output()
        .map_err(|error| WorkerError::SelfUpdatePreflight {
            detail: format!("failed to spawn staged binary: {error}"),
        })?;
    if !output.status.success() {
        return Err(WorkerError::SelfUpdatePreflight {
            detail: format!("--version exited with {}", output.status),
        });
    }
    Ok(())
}

/// Replace this process image with the swapped binary, preserving argv. Only
/// returns (with the underlying error) if `exec` itself fails, in which case
/// the old image keeps running and the swap is retried on a later heartbeat.
#[cfg(unix)]
fn reexec(exe_path: &Path, desired_version: &str) -> WorkerError {
    use std::os::unix::process::CommandExt;

    let source = std::process::Command::new(exe_path)
        .args(std::env::args_os().skip(1))
        .env(ATTEMPTED_VERSION_ENV, desired_version)
        .exec();
    WorkerError::SelfUpdateExec {
        path: exe_path.to_path_buf(),
        source,
    }
}

#[cfg(not(unix))]
fn reexec(_exe_path: &Path, _desired_version: &str) -> WorkerError {
    WorkerError::SelfUpdateUnsupported {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::{plan_for_versions, verify_sha256};
    use crate::error::WorkerError;

    fn digest_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    #[test]
    fn plan_is_noop_when_versions_match() {
        assert_eq!(plan_for_versions("0.2.16", "0.2.16", None), None);
    }

    #[test]
    fn plan_swaps_on_any_divergence_including_downgrades() {
        let upgrade = plan_for_versions("0.2.16", "0.3.0", None).expect("upgrade plan");
        assert_eq!(upgrade.desired_version, "0.3.0");
        let downgrade = plan_for_versions("0.3.0", "0.2.16", None).expect("downgrade plan");
        assert_eq!(downgrade.desired_version, "0.2.16");
    }

    #[test]
    fn plan_skips_empty_pin_and_already_attempted_version() {
        assert_eq!(plan_for_versions("0.2.16", "", None), None);
        // Already swapped for this pin once and still diverged: published
        // artifact lags the pin. Never hot-loop.
        assert_eq!(plan_for_versions("0.2.16", "0.3.0", Some("0.3.0")), None);
        // A newer pin supersedes the stale attempt marker.
        assert!(plan_for_versions("0.2.16", "0.4.0", Some("0.3.0")).is_some());
    }

    #[test]
    fn verify_sha256_accepts_bare_and_sha256sum_formats() {
        let payload = b"worker binary bytes";
        let hex = digest_hex(payload);
        verify_sha256(payload, &hex).expect("bare digest");
        verify_sha256(payload, &format!("{hex}  proliferate-worker\n")).expect("sha256sum format");
        verify_sha256(payload, &format!("{}  x", hex.to_ascii_uppercase()))
            .expect("uppercase digest");
    }

    #[test]
    fn verify_sha256_rejects_mismatch() {
        let expected = digest_hex(b"published bytes");
        let error = verify_sha256(b"tampered bytes", &expected).expect_err("mismatch");
        assert!(matches!(
            error,
            WorkerError::SelfUpdateChecksumMismatch { .. }
        ));
    }

    #[test]
    fn verify_sha256_rejects_malformed_checksum_files() {
        for malformed in ["", "   \n", "not-hex", "abc123", "<html>404</html>"] {
            let error = verify_sha256(b"payload", malformed).expect_err("malformed");
            assert!(matches!(error, WorkerError::SelfUpdateChecksumMalformed));
        }
    }
}
