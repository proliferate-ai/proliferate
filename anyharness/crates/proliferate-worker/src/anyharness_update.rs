//! Heartbeat-driven in-place AnyHarness runtime binary self-update.
//!
//! The sandbox worker converges the co-located AnyHarness runtime binary onto
//! the server's pinned version (`desiredVersions.anyharness`). Unlike the
//! worker's own self-update — which ends in `exec` because a `nohup`'d worker
//! that exits never comes back (`self_update.rs`) — the runtime is a *separate*
//! process, so the worker does **not** exec: it stops the runtime, swaps the
//! binary at the fixed path (keeping a `.prev` rollback copy), relaunches via
//! the existing on-disk launcher, health-gates the relaunched runtime, and
//! keeps heartbeating. Staying up is what lets the worker report success,
//! roll back, and never crash-loop the box.
//!
//! Safety model (shared with `self_update.rs` where noted):
//! - the binary comes from the server's *runtime* artifact redirect and its
//!   `.sha256` is fetched from the same resolved directory (checksum URL
//!   derived from the binary's post-redirect URL, so the pair shares a
//!   version); the download is rejected unless the digest matches;
//! - the staged binary is preflighted with `--version`, which must both
//!   succeed and report the pinned version, so the unpinned `stable` fallback
//!   serving a lagging build aborts the swap instead of downgrading;
//! - only the AnyHarness process is stopped — by its fixed binary path, with
//!   the `[/]`-escaped pgrep pattern used by the server bootstrap — never the
//!   worker (the orchestrator) or the shell;
//! - the swap keeps a `.prev` copy: a crash between renames leaves a runnable
//!   binary at the fixed path (old or new), and stale `.next`/`.prev` are swept
//!   on the next attempt;
//! - the relaunched runtime is health-gated on the runtime's `/health` version;
//!   an unhealthy runtime is rolled back to `.prev`, the pin is marked
//!   attempted-and-failed in the worker store, and it is not retried until a
//!   newer pin supersedes it. Every failure keeps a runnable runtime serving.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, HeartbeatResponse},
    config::WorkerConfig,
    error::WorkerError,
    self_update::{artifact_target, checksum_url_for, verify_sha256, version_output_matches},
    store::WorkerStore,
    versions,
};

/// The runtime binary asset name published on the downloads CDN.
const RUNTIME_BINARY_ASSET: &str = "anyharness";

/// Health-gate window after a relaunch: attempts × delay. Mirrors the server's
/// `wait_for_runtime_health` defaults (30 × 0.5s = 15s).
const HEALTH_ATTEMPTS: u32 = 30;
const HEALTH_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, PartialEq, Eq)]
pub struct RuntimeUpdatePlan {
    pub desired_version: String,
}

/// The runtime version the worker believes is running: the last swap it
/// health-verified (store) if any, else the boot-time launcher export (env).
/// The heartbeat reports this so `cloud_runtime_worker.anyharness_version`
/// reflects what actually runs within one interval of a swap.
pub fn running_anyharness_version(store: &WorkerStore) -> Option<String> {
    match store.anyharness_converged_version() {
        Ok(Some(version)) => Some(version),
        Ok(None) => versions::anyharness_version(),
        Err(error) => {
            warn!(
                ?error,
                "anyharness update: failed to read converged version; falling back to env"
            );
            versions::anyharness_version()
        }
    }
}

/// Decide whether this heartbeat ack requires a runtime swap. `None` means
/// stay on the current runtime (gate off, no/equal pin, or already
/// attempted-and-failed for this exact pin).
pub fn plan(
    config: &WorkerConfig,
    store: &WorkerStore,
    response: &HeartbeatResponse,
) -> Option<RuntimeUpdatePlan> {
    if !config.anyharness_update_enabled {
        return None;
    }
    let desired = response
        .desired_versions
        .as_ref()?
        .anyharness
        .as_deref()?
        .trim()
        .to_string();
    let running = running_anyharness_version(store);
    let failed = store.anyharness_failed_pin().ok().flatten();
    plan_for_versions(running.as_deref(), &desired, failed.as_deref())
}

fn plan_for_versions(
    running: Option<&str>,
    desired: &str,
    failed_pin: Option<&str>,
) -> Option<RuntimeUpdatePlan> {
    if desired.is_empty() || running == Some(desired) {
        return None;
    }
    if failed_pin == Some(desired) {
        warn!(
            running = running.unwrap_or("<unknown>"),
            desired,
            "anyharness update: already attempted this pin and it failed; the published \
             artifact likely lags the pin — not retrying until a newer pin supersedes it"
        );
        return None;
    }
    Some(RuntimeUpdatePlan {
        desired_version: desired.to_string(),
    })
}

/// Resolve the three paths the swap needs from config, or a descriptive error
/// if the gate is on but a path is missing (a misconfigured sandbox, never
/// desktop — which leaves the gate off).
fn resolve_paths(config: &WorkerConfig) -> Result<(&Path, &Path, &Path), WorkerError> {
    let binary = config.anyharness_binary_path.as_deref().ok_or(
        WorkerError::AnyharnessUpdateMissingPath {
            field: "anyharness_binary_path",
        },
    )?;
    let launcher = config.anyharness_launcher_path.as_deref().ok_or(
        WorkerError::AnyharnessUpdateMissingPath {
            field: "anyharness_launcher_path",
        },
    )?;
    let workdir =
        config
            .anyharness_workdir
            .as_deref()
            .ok_or(WorkerError::AnyharnessUpdateMissingPath {
                field: "anyharness_workdir",
            })?;
    Ok((binary, launcher, workdir))
}

/// Download, verify, stop, swap, relaunch, and health-gate. On any failure the
/// currently-running (or rolled-back) runtime keeps serving and the pin is
/// recorded so it is not retried until superseded.
pub async fn converge(
    config: &WorkerConfig,
    cloud: &CloudClient,
    store: &WorkerStore,
    update: &RuntimeUpdatePlan,
) -> Result<(), WorkerError> {
    let (binary_path, launcher_path, workdir) = resolve_paths(config)?;
    let target = artifact_target()?;
    info!(
        desired = %update.desired_version,
        target,
        "anyharness runtime diverged from server pin; starting in-place update"
    );

    // 1. Download the runtime binary and its sibling checksum (same resolved
    //    directory → same version), then verify.
    let binary = cloud
        .download_runtime_artifact(&target, RUNTIME_BINARY_ASSET)
        .await?;
    let checksum_url = checksum_url_for(&binary.resolved_url);
    let checksum = cloud.download_from_url(&checksum_url).await?;
    verify_sha256(&binary.bytes, &String::from_utf8_lossy(&checksum))?;

    // 2. Stage next to the fixed binary path and preflight.
    sweep_stale_staged(binary_path);
    let staged = stage_binary(&binary.bytes, binary_path)?;
    if let Err(error) = preflight(&staged, &update.desired_version) {
        let _ = std::fs::remove_file(&staged);
        return Err(error);
    }

    // 3. Stop only the AnyHarness process. Sessions on the box end here; that
    //    is the accepted restart.
    if let Err(error) = stop_runtime(binary_path) {
        let _ = std::fs::remove_file(&staged);
        return Err(error);
    }

    // 4. Swap atomically, keeping a rollback copy.
    let prev = match swap_with_rollback(&staged, binary_path) {
        Ok(prev) => prev,
        Err(error) => {
            // A rename failure leaves the current binary in place; relaunch it
            // so the box does not sit with a stopped runtime.
            let _ = relaunch(launcher_path, workdir);
            let _ = std::fs::remove_file(&staged);
            return Err(error);
        }
    };

    // 5. Relaunch via the on-disk launcher (it exec's the swapped fixed path).
    if let Err(error) = relaunch(launcher_path, workdir) {
        rollback(&prev, binary_path, launcher_path, workdir);
        store.record_anyharness_failed(&update.desired_version)?;
        return Err(error);
    }

    // 6. Health-gate the relaunched runtime.
    if health_gate(config, &update.desired_version).await {
        let _ = std::fs::remove_file(&prev);
        store.record_anyharness_converged(&update.desired_version)?;
        info!(
            version = %update.desired_version,
            "anyharness runtime swapped and healthy on the new version"
        );
        Ok(())
    } else {
        warn!(
            version = %update.desired_version,
            "anyharness runtime unhealthy after swap; rolling back to the previous binary"
        );
        rollback(&prev, binary_path, launcher_path, workdir);
        store.record_anyharness_failed(&update.desired_version)?;
        Err(WorkerError::AnyharnessUpdateHealthGate {
            expected: update.desired_version.clone(),
        })
    }
}

/// Remove leftover staged/rollback files from earlier attempts so a repeated
/// failure never accumulates full binary copies. Best-effort.
fn sweep_stale_staged(binary_path: &Path) {
    let Some(file_name) = binary_path.file_name().and_then(|value| value.to_str()) else {
        return;
    };
    let Some(dir) = binary_path.parent() else {
        return;
    };
    let next_prefix = format!(".{file_name}.next.");
    let prev_name = format!(".{file_name}.prev");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with(&next_prefix) || name == prev_name {
            warn!(staged = %entry.path().display(), "removing stale staged anyharness binary");
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Write verified bytes to `.<name>.next.<pid>` beside the fixed binary path
/// (same filesystem → atomic rename) and mark it executable.
fn stage_binary(bytes: &[u8], binary_path: &Path) -> Result<PathBuf, WorkerError> {
    let file_name = binary_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(RUNTIME_BINARY_ASSET);
    let staged = binary_path.with_file_name(format!(".{file_name}.next.{}", std::process::id()));
    let stage_err = |source: std::io::Error| WorkerError::AnyharnessUpdateStage {
        path: staged.clone(),
        source,
    };
    let mut file = std::fs::File::create(&staged).map_err(stage_err)?;
    file.write_all(bytes).map_err(stage_err)?;
    file.sync_all().map_err(stage_err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
            .map_err(stage_err)?;
    }
    Ok(staged)
}

/// Sanity-check the staged file is a runnable AnyHarness *carrying the pinned
/// version* before it replaces the binary we know works — same rationale as
/// `self_update::preflight`. `anyharness --version` prints `anyharness X`.
fn preflight(staged: &Path, desired_version: &str) -> Result<(), WorkerError> {
    let output = std::process::Command::new(staged)
        .arg("--version")
        .output()
        .map_err(|error| WorkerError::AnyharnessUpdatePreflight {
            detail: format!("failed to spawn staged binary: {error}"),
        })?;
    if !output.status.success() {
        return Err(WorkerError::AnyharnessUpdatePreflight {
            detail: format!("--version exited with {}", output.status),
        });
    }
    let reported = String::from_utf8_lossy(&output.stdout);
    if !version_output_matches(&reported, desired_version) {
        return Err(WorkerError::AnyharnessUpdatePreflight {
            detail: format!(
                "staged binary reports {:?}, expected version {desired_version}; \
                 the published artifact likely lags the pin — not swapping",
                reported.trim()
            ),
        });
    }
    Ok(())
}

/// Escape a path for a `pgrep -f` pattern so the pgrep/kill shell does not
/// match its own command line — identical to the server bootstrap's
/// `_pgrep_pattern_for_path` (`[/]` is a regex class matching `/`, so the
/// literal pattern string never contains the target substring).
fn pgrep_pattern_for_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix('/') {
        format!("[/]{rest}")
    } else {
        path.to_string()
    }
}

/// Shell script that kills *only* the AnyHarness process (by its fixed binary
/// path), never the worker or the shell running this. Excludes `$$`/`$PPID`
/// defensively, matching the server's stop command shape.
fn stop_runtime_script(binary_path: &str) -> String {
    let pattern = pgrep_pattern_for_path(binary_path);
    let quoted = shell_single_quote(&pattern);
    [
        "set -eu",
        "current_pid=$$",
        "parent_pid=$PPID",
        &format!("pids=$(pgrep -f {quoted} || true)"),
        "if [ -n \"$pids\" ]; then",
        "  for pid in $pids; do",
        "    if [ \"$pid\" != \"$current_pid\" ] && [ \"$pid\" != \"$parent_pid\" ]; then",
        "      kill \"$pid\" || true",
        "    fi",
        "  done",
        "  sleep 1",
        "fi",
    ]
    .join("\n")
}

fn stop_runtime(binary_path: &Path) -> Result<(), WorkerError> {
    let script = stop_runtime_script(&binary_path.to_string_lossy());
    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(&script)
        .status()
        .map_err(|error| WorkerError::AnyharnessUpdateStop {
            detail: format!("failed to spawn stop shell: {error}"),
        })?;
    if !status.success() {
        return Err(WorkerError::AnyharnessUpdateStop {
            detail: format!("stop shell exited with {status}"),
        });
    }
    Ok(())
}

/// Rename current → `.<name>.prev`, then staged → the fixed path. Returns the
/// `.prev` path for rollback. A crash between the two renames leaves a runnable
/// binary at a known location.
fn swap_with_rollback(staged: &Path, binary_path: &Path) -> Result<PathBuf, WorkerError> {
    let file_name = binary_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(RUNTIME_BINARY_ASSET);
    let prev = binary_path.with_file_name(format!(".{file_name}.prev"));
    let swap_err = |path: PathBuf| {
        move |source: std::io::Error| WorkerError::AnyharnessUpdateSwap { path, source }
    };
    std::fs::rename(binary_path, &prev).map_err(swap_err(binary_path.to_path_buf()))?;
    if let Err(error) = std::fs::rename(staged, binary_path) {
        // Restore the original so the fixed path is runnable again.
        let _ = std::fs::rename(&prev, binary_path);
        return Err(WorkerError::AnyharnessUpdateSwap {
            path: binary_path.to_path_buf(),
            source: error,
        });
    }
    Ok(prev)
}

/// Restore `.prev` over the fixed path and relaunch. Best-effort: a failure
/// here is already logged by the caller's failure path.
fn rollback(prev: &Path, binary_path: &Path, launcher_path: &Path, workdir: &Path) {
    if let Err(error) = std::fs::rename(prev, binary_path) {
        warn!(
            ?error,
            "anyharness update: failed to restore previous binary during rollback"
        );
    }
    if let Err(error) = relaunch(launcher_path, workdir) {
        warn!(
            ?error,
            "anyharness update: failed to relaunch after rollback"
        );
    }
}

/// Re-run the on-disk launcher under `nohup`, detached, in `workdir`. The
/// launcher `exec`s the fixed binary path, so it launches the swapped binary
/// with the same env (including the version export) and no server round-trip.
fn relaunch(launcher_path: &Path, workdir: &Path) -> Result<(), WorkerError> {
    let launcher = launcher_path.to_string_lossy();
    let log = launcher_path
        .parent()
        .map(|parent| parent.join("anyharness.log"))
        .unwrap_or_else(|| PathBuf::from("anyharness.log"));
    let script = format!(
        "nohup {} > {} 2>&1 < /dev/null &",
        shell_single_quote(&launcher),
        shell_single_quote(&log.to_string_lossy()),
    );
    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(&script)
        .current_dir(workdir)
        .status()
        .map_err(|error| WorkerError::AnyharnessUpdateRelaunch {
            path: launcher_path.to_path_buf(),
            detail: format!("failed to spawn launcher shell: {error}"),
        })?;
    if !status.success() {
        return Err(WorkerError::AnyharnessUpdateRelaunch {
            path: launcher_path.to_path_buf(),
            detail: format!("launcher shell exited with {status}"),
        });
    }
    Ok(())
}

#[derive(Deserialize)]
struct RuntimeHealth {
    #[serde(default)]
    version: String,
}

/// Poll the runtime's `/health` until it reports the desired version (200 +
/// matching version) or the window elapses. Confirms the *new* binary is
/// serving, not merely that something answers the port.
async fn health_gate(config: &WorkerConfig, desired_version: &str) -> bool {
    let base = config.runtime_base_url.trim_end_matches('/');
    let url = format!("{base}/health");
    let client = reqwest::Client::new();
    for _ in 0..HEALTH_ATTEMPTS {
        if let Ok(response) = client.get(&url).send().await {
            if response.status().is_success() {
                if let Ok(health) = response.json::<RuntimeHealth>().await {
                    if version_output_matches(&health.version, desired_version) {
                        return true;
                    }
                }
            }
        }
        sleep(HEALTH_DELAY).await;
    }
    false
}

/// Wrap a value in POSIX single quotes for safe interpolation into a shell
/// script (embedded single quotes become `'\''`).
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_is_noop_when_versions_match() {
        assert_eq!(plan_for_versions(Some("0.5.0"), "0.5.0", None), None);
    }

    #[test]
    fn plan_swaps_on_divergence_and_when_running_is_unknown() {
        let upgrade = plan_for_versions(Some("0.5.0"), "0.6.0", None).expect("upgrade");
        assert_eq!(upgrade.desired_version, "0.6.0");
        // No known running version (env not exported, no converged record):
        // converge onto the pin; preflight + health gate protect the swap.
        let unknown = plan_for_versions(None, "0.6.0", None).expect("unknown running");
        assert_eq!(unknown.desired_version, "0.6.0");
    }

    #[test]
    fn plan_skips_empty_pin() {
        // An unstamped/old server advertises no anyharness pin: no-op. This is
        // the new-worker-vs-old-server compat direction.
        assert_eq!(plan_for_versions(Some("0.5.0"), "", None), None);
    }

    #[test]
    fn plan_skips_failed_pin_until_superseded() {
        // Attempted once and failed (lagging artifact): never retry the same pin.
        assert_eq!(
            plan_for_versions(Some("0.5.0"), "0.6.0", Some("0.6.0")),
            None
        );
        // A newer pin supersedes the stale failure marker.
        assert!(plan_for_versions(Some("0.5.0"), "0.7.0", Some("0.6.0")).is_some());
    }

    #[test]
    fn pgrep_pattern_escapes_leading_slash() {
        // The escaped pattern must not contain the raw target substring, so the
        // pgrep/kill shell never matches its own command line.
        let pattern = pgrep_pattern_for_path("/home/user/.proliferate/bin/anyharness");
        assert_eq!(pattern, "[/]home/user/.proliferate/bin/anyharness");
        assert!(!pattern.contains("/home/user/.proliferate/bin/anyharness"));
    }

    #[test]
    fn stop_script_targets_only_the_runtime_and_guards_self() {
        let script = stop_runtime_script("/home/user/.proliferate/bin/anyharness");
        // Only the anyharness path is pgrep'd — never the worker or supervisor.
        assert!(script.contains("[/]home/user/.proliferate/bin/anyharness"));
        assert!(!script.contains("proliferate-worker"));
        assert!(!script.contains("proliferate-supervisor"));
        // The current shell and its parent are excluded from the kill.
        assert!(script.contains("current_pid=$$"));
        assert!(script.contains("parent_pid=$PPID"));
    }

    #[test]
    fn shell_single_quote_escapes_embedded_quotes() {
        assert_eq!(shell_single_quote("a'b"), "'a'\\''b'");
        assert_eq!(shell_single_quote("/plain/path"), "'/plain/path'");
    }

    #[test]
    fn stage_swap_and_rollback_roundtrip() {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "proliferate-anyharness-swap-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let binary = dir.join("anyharness");
        std::fs::write(&binary, b"OLD").expect("write old binary");

        // Stage the new bytes and confirm the staged file is executable.
        let staged = stage_binary(b"NEW", &binary).expect("stage");
        assert!(staged.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&staged).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755);
        }

        // Swap keeps a `.prev` copy of the old binary at a known path.
        let prev = swap_with_rollback(&staged, &binary).expect("swap");
        assert_eq!(std::fs::read(&binary).unwrap(), b"NEW");
        assert_eq!(std::fs::read(&prev).unwrap(), b"OLD");
        assert!(!staged.exists());

        // Rollback restores the previous binary over the fixed path. (Relaunch
        // is best-effort and no-ops here — the launcher path does not exist.)
        let missing_launcher = dir.join("start-anyharness.sh");
        rollback(&prev, &binary, &missing_launcher, &dir);
        assert_eq!(std::fs::read(&binary).unwrap(), b"OLD");

        // Sweep removes leftover staged/prev files.
        std::fs::write(dir.join(".anyharness.next.999"), b"x").unwrap();
        std::fs::write(dir.join(".anyharness.prev"), b"x").unwrap();
        sweep_stale_staged(&binary);
        assert!(!dir.join(".anyharness.next.999").exists());
        assert!(!dir.join(".anyharness.prev").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
