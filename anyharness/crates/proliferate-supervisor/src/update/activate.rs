//! The activation state machine: the Supervisor's core update primitive.
//!
//! Per drained mailbox request, exactly one `UpdateResultV1` is produced:
//!
//! ```text
//! next_pending (skip if a result already exists)
//!   -> download (bounded, only this URL)      | fail -> Invalid (nothing activated)
//!   -> re-verify sha256 + size, stage (0700)  | fail -> Invalid
//!   -> activate atomically (active -> .prev, staged -> active)
//!   -> restart changed component(s) in dependency order (AnyHarness before Worker)
//!   -> health-gate (/health + Worker liveness)
//!        pass -> Activated (observed = new version)
//!        fail -> roll back to .prev, restart, re-gate -> RolledBack
//! ```
//!
//! Fail-closed at every gate; a runnable component always keeps serving, and a
//! last-good version is never reported active. The side effects the machine
//! cannot own itself — the network fetch, restarting the live child processes,
//! and probing their health — are abstracted behind [`ActivationHost`] so the
//! machine is exercised by deterministic tests with fake seams. The production
//! adapter lives in `process/mod.rs`, where the child handles, `download`, and
//! `process/health` are in scope.

use std::{
    fs,
    path::{Path, PathBuf},
};

use proliferate_runtime_update_protocol::{
    UpdateComponent, UpdateOutcome, UpdateRequestV1, UpdateResultV1,
};
use sha2::{Digest, Sha256};
use tracing::warn;

use crate::{
    config::SupervisorConfig,
    error::SupervisorError,
    update::{
        manifest::UpdateArtifact,
        request::{self, PendingUpdate},
        rollback::RollbackPlan,
        staging::{self, StagedArtifact},
    },
};

/// The side effects the activation machine delegates: the bounded artifact
/// fetch, restarting the live children (which the Supervisor's process loop
/// owns), and probing their health. The production adapter wires
/// `download::download_artifact`, `process::child` restarts, and
/// `process::health`; tests inject deterministic fakes.
#[allow(async_fn_in_trait)]
pub trait ActivationHost {
    /// Download only `request.artifact_url`, bounded by config size/timeout.
    async fn fetch_artifact(
        &mut self,
        request: &UpdateRequestV1,
    ) -> Result<Vec<u8>, SupervisorError>;

    /// Restart AnyHarness so it picks up the newly-activated binary.
    async fn restart_anyharness(&mut self) -> Result<(), SupervisorError>;

    /// Restart the Worker so it picks up the newly-activated binary (also used
    /// after an AnyHarness restart, since the Worker depends on it).
    async fn restart_worker(&mut self) -> Result<(), SupervisorError>;

    /// Poll AnyHarness `/health` after a restart. When `expected_version` is
    /// `Some`, a lagging-but-2xx artifact (answers healthy on the prior version)
    /// must fail the gate too — not just a non-2xx (R9-008).
    async fn anyharness_healthy(&mut self, expected_version: Option<&str>) -> bool;

    /// Confirm the Worker is still live after a restart.
    async fn worker_alive(&mut self) -> bool;
}

/// The disposition of one drained request. A terminal result is recorded and
/// the request is never actioned again; a transient failure leaves NO result on
/// disk so the request stays pending and the next drain retries it (R9-002).
enum ActivationStep {
    Terminal(UpdateResultV1),
    Retry(String),
}

/// Drain the mailbox: for each pending request with no result yet, run the
/// state machine and write exactly one result. Idempotent — a request that
/// already has a result is skipped by `next_pending`, so a replayed heartbeat
/// or a Supervisor restart activates each request at most once.
///
/// A transport-class download blip does not write a terminal result: the
/// request is left pending and the drain returns (breaks) so the next poll tick
/// retries it, instead of latching a permanent `Invalid` that only a version
/// change could clear (R9-002).
pub async fn run_pending<H: ActivationHost>(
    config: &SupervisorConfig,
    host: &mut H,
) -> Result<(), SupervisorError> {
    while let Some(pending) = request::next_pending(&config.update_request_dir)? {
        match activate_one(config, host, &pending).await {
            ActivationStep::Terminal(result) => {
                request::record_result(&config.update_request_dir, &result)?;
            }
            ActivationStep::Retry(reason) => {
                warn!(
                    request_id = %pending.request.request_id,
                    reason,
                    "update left pending after a transient failure; the next drain retries"
                );
                // No result written: `next_pending` would return the SAME
                // request again, so stop this pass and let the next poll tick
                // retry rather than spin.
                break;
            }
        }
    }
    Ok(())
}

async fn activate_one<H: ActivationHost>(
    config: &SupervisorConfig,
    host: &mut H,
    pending: &PendingUpdate,
) -> ActivationStep {
    let request = &pending.request;
    let component = request.component;
    let active_path = active_path_for(config, component);

    // 0. Crash-recovery fast path (R9-004): if the active binary already hashes
    //    to the requested artifact, a prior attempt activated it and the
    //    Supervisor crashed before recording a result. Do NOT re-stage or move
    //    `active -> .prev` again — that second rename would push the NEW binary
    //    into `.prev` and destroy the true last-good, so a later health-fail
    //    would "roll back" onto the bad binary. Restart + health-gate against
    //    the EXISTING `.prev` instead.
    if active_matches(&active_path, &request.sha256) {
        let plan = RollbackPlan::new(
            component.as_str(),
            active_path.clone(),
            prev_path_for(&active_path),
        );
        return finish_activation(host, request, component, plan).await;
    }

    // 1. Download the exact artifact URL (bounded). A transport-class failure is
    //    transient — leave the request pending to retry (R9-002). A definitive
    //    failure (bad status, too large) fails closed with a terminal Invalid.
    let bytes = match host.fetch_artifact(request).await {
        Ok(bytes) => bytes,
        Err(error) if is_transient(&error) => {
            return ActivationStep::Retry(format!("transient download failure: {error}"));
        }
        Err(error) => {
            return ActivationStep::Terminal(invalid(request, format!("download failed: {error}")));
        }
    };

    // 2. Re-verify sha256 + size and stage atomically with private permissions.
    //    A wrong-size / wrong-checksum artifact is rejected here (staging runs
    //    `verify_sha256`), leaving no active change.
    let staged = match stage_verified(config, request, &bytes) {
        Ok(staged) => staged,
        Err(error) => {
            return ActivationStep::Terminal(invalid(
                request,
                format!("verify/stage failed: {error}"),
            ));
        }
    };

    // 3. Activate atomically, retaining `.prev` for rollback. A crash between
    //    the two renames still leaves a runnable binary at a known path.
    let plan = match activate_binary(component, &staged.path, &active_path) {
        Ok(plan) => plan,
        Err(error) => {
            return ActivationStep::Terminal(invalid(
                request,
                format!("activate failed: {error}"),
            ));
        }
    };

    finish_activation(host, request, component, plan).await
}

/// Restart the changed component(s), health-gate, and roll back on failure.
/// Shared by the normal activation path and the crash-recovery fast path.
async fn finish_activation<H: ActivationHost>(
    host: &mut H,
    request: &UpdateRequestV1,
    component: UpdateComponent,
    plan: RollbackPlan,
) -> ActivationStep {
    if let Err(error) = restart_in_order(host, component).await {
        return ActivationStep::Terminal(
            roll_back(host, request, &plan, format!("restart failed: {error}")).await,
        );
    }
    if health_gate(host, request).await {
        return ActivationStep::Terminal(activated(request));
    }
    // Unhealthy: restore last-good, restart, re-gate. Never reported active.
    ActivationStep::Terminal(
        roll_back(host, request, &plan, "unhealthy after activation".to_string()).await,
    )
}

/// Whether a fetch error is transport-class (transient) and should leave the
/// request pending for a retry rather than latch a terminal `Invalid`.
fn is_transient(error: &SupervisorError) -> bool {
    matches!(error, SupervisorError::DownloadTransport { .. })
}

/// Does the active binary already hash to `expected_sha256`? Used by the
/// crash-recovery fast path to detect an already-activated artifact.
fn active_matches(active: &Path, expected_sha256: &str) -> bool {
    let Ok(bytes) = fs::read(active) else {
        return false;
    };
    let actual = format!("{:x}", Sha256::digest(&bytes));
    actual.eq_ignore_ascii_case(expected_sha256)
}

/// Dependency order: AnyHarness before Worker. An AnyHarness update also
/// restarts the Worker (its dependent); a Worker update restarts only itself.
async fn restart_in_order<H: ActivationHost>(
    host: &mut H,
    component: UpdateComponent,
) -> Result<(), SupervisorError> {
    match component {
        UpdateComponent::Anyharness => {
            host.restart_anyharness().await?;
            host.restart_worker().await?;
        }
        UpdateComponent::Worker => {
            host.restart_worker().await?;
        }
    }
    Ok(())
}

async fn health_gate<H: ActivationHost>(host: &mut H, request: &UpdateRequestV1) -> bool {
    // The whole runtime must be healthy: AnyHarness answering `/health` and the
    // Worker still live after the restart. For an AnyHarness update the gate
    // also requires the `/health` version to be the one we activated, so a
    // lagging-but-checksum-valid artifact that answers 2xx on the prior version
    // still fails the gate (R9-008). A Worker update leaves AnyHarness
    // untouched, so no version is asserted there.
    let expected_version = match request.component {
        UpdateComponent::Anyharness => Some(request.version.as_str()),
        UpdateComponent::Worker => None,
    };
    host.anyharness_healthy(expected_version).await && host.worker_alive().await
}

async fn roll_back<H: ActivationHost>(
    host: &mut H,
    request: &UpdateRequestV1,
    plan: &RollbackPlan,
    reason: String,
) -> UpdateResultV1 {
    match plan.apply() {
        Ok(()) => {
            // Best-effort: bring the restored last-good back up and re-gate. The
            // outcome is RolledBack — the point is that the new version is never
            // reported active and a genuine last-good is now serving.
            let _ = restart_in_order(host, request.component).await;
            let _ = health_gate(host, request).await;
            UpdateResultV1 {
                request_id: request.request_id.clone(),
                outcome: UpdateOutcome::RolledBack,
                // The prior version string is not tracked in this slice; the
                // Worker reports the converged (restored) version via heartbeat.
                observed_version: None,
                error: Some(reason),
            }
        }
        Err(apply_error) => {
            // Nothing was restored (a first activation with no `.prev`, or a
            // `.prev` that is missing/unmovable): the unhealthy NEW binary is
            // STILL ACTIVE. Never claim RolledBack — the protocol has no
            // dedicated variant, so report Invalid with the honest state
            // (R9-005).
            UpdateResultV1 {
                request_id: request.request_id.clone(),
                outcome: UpdateOutcome::Invalid,
                observed_version: None,
                error: Some(format!(
                    "{reason}; rollback failed: {apply_error}; new binary still active"
                )),
            }
        }
    }
}

fn activated(request: &UpdateRequestV1) -> UpdateResultV1 {
    UpdateResultV1 {
        request_id: request.request_id.clone(),
        outcome: UpdateOutcome::Activated,
        observed_version: Some(request.version.clone()),
        error: None,
    }
}

fn invalid(request: &UpdateRequestV1, error: String) -> UpdateResultV1 {
    UpdateResultV1 {
        request_id: request.request_id.clone(),
        outcome: UpdateOutcome::Invalid,
        observed_version: None,
        error: Some(error),
    }
}

/// Re-verify the downloaded bytes against the request's sha256 + size and stage
/// them atomically (private permissions) under `staging_dir`. Reuses
/// `staging::stage_artifact_bytes`, whose `verify_sha256` is the checksum
/// authority; the request's own sha256/size stand in for the manifest here.
fn stage_verified(
    config: &SupervisorConfig,
    request: &UpdateRequestV1,
    bytes: &[u8],
) -> Result<StagedArtifact, SupervisorError> {
    let (os, arch) = split_target_triple(&request.target_triple);
    let artifact = UpdateArtifact {
        component: request.component.as_str().to_string(),
        version: request.version.clone(),
        os,
        arch,
        url: request.artifact_url.clone(),
        sha256: request.sha256.clone(),
        size_bytes: Some(request.size_bytes),
    };
    staging::stage_artifact_bytes(&config.staging_dir, &artifact, bytes)
}

fn active_path_for(config: &SupervisorConfig, component: UpdateComponent) -> PathBuf {
    match component {
        UpdateComponent::Anyharness => config.anyharness_binary.clone(),
        UpdateComponent::Worker => config.worker_binary.clone(),
    }
}

fn prev_path_for(active: &Path) -> PathBuf {
    let mut raw = active.as_os_str().to_os_string();
    raw.push(".prev");
    PathBuf::from(raw)
}

/// Atomically swap `staged` onto `active`, moving the current active binary to
/// `active.prev` first. Returns the plan that restores `.prev` on an unhealthy
/// activation. If the second rename fails, the prior binary is put back so a
/// runnable component keeps serving.
fn activate_binary(
    component: UpdateComponent,
    staged: &Path,
    active: &Path,
) -> Result<RollbackPlan, SupervisorError> {
    let previous = prev_path_for(active);
    let moved_previous = if active.exists() {
        fs::rename(active, &previous).map_err(|source| SupervisorError::Activate {
            component: component.as_str().to_string(),
            source,
        })?;
        true
    } else {
        false
    };
    if let Err(source) = fs::rename(staged, active) {
        if moved_previous {
            let _ = fs::rename(&previous, active);
        }
        return Err(SupervisorError::Activate {
            component: component.as_str().to_string(),
            source,
        });
    }
    set_executable(active);
    Ok(RollbackPlan::new(
        component.as_str(),
        active.to_path_buf(),
        previous,
    ))
}

/// Split a target token like `linux-x86_64` into `(os, arch)` for the staged
/// artifact record. The value is only used to satisfy the staging identifier
/// checks and the `{component}-{version}` staging filename; `target_triple` is
/// already validated path-safe by the protocol crate, so each half is too.
fn split_target_triple(triple: &str) -> (String, String) {
    match triple.split_once('-') {
        Some((os, arch)) if !os.is_empty() && !arch.is_empty() => {
            (os.to_string(), arch.to_string())
        }
        _ => (triple.to_string(), triple.to_string()),
    }
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

    use std::{collections::BTreeMap, sync::atomic::{AtomicU64, Ordering}};

    use proliferate_runtime_update_protocol::{
        read_result, result_exists, result_file_name, write_request,
    };
    use sha2::{Digest, Sha256};

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "proliferate-supervisor-activate-{}-{}",
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

    fn make_request(component: UpdateComponent, version: &str, bytes: &[u8]) -> UpdateRequestV1 {
        UpdateRequestV1 {
            request_id: format!("{}-{}", component.as_str(), version),
            component,
            version: version.to_string(),
            target_triple: "linux-x86_64".to_string(),
            artifact_url: "https://downloads.example.test/artifact".to_string(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            size_bytes: bytes.len() as u64,
            requested_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    fn result_for(dir: &Path, request_id: &str) -> UpdateResultV1 {
        read_result(&dir.join(result_file_name(request_id))).expect("read result")
    }

    /// How the fake download behaves: hands back bytes, a transient transport
    /// blip (leaves the request pending), or a definitive bad status (terminal).
    #[derive(Default)]
    enum FetchMode {
        Bytes(Vec<u8>),
        #[default]
        Transient,
        Status,
    }

    #[derive(Default)]
    struct FakeHost {
        fetch: FetchMode,
        healthy: bool,
        worker_live: bool,
        /// The version the modeled AnyHarness `/health` reports (`None` => the
        /// body carries no version, so any 2xx passes — mirrors real health.rs).
        anyharness_version: Option<String>,
        restart_log: Vec<&'static str>,
        fetch_count: u32,
        /// The `expected_version` values passed to each health probe, so a test
        /// can assert the gate was asked to check a version (R9-008).
        health_expected: Vec<Option<String>>,
    }

    impl ActivationHost for FakeHost {
        async fn fetch_artifact(
            &mut self,
            _request: &UpdateRequestV1,
        ) -> Result<Vec<u8>, SupervisorError> {
            self.fetch_count += 1;
            match &self.fetch {
                FetchMode::Bytes(bytes) => Ok(bytes.clone()),
                FetchMode::Transient => Err(SupervisorError::DownloadTransport {
                    url: "https://downloads.example.test/artifact".to_string(),
                    message: "simulated transient transport failure".to_string(),
                }),
                FetchMode::Status => Err(SupervisorError::DownloadArtifact {
                    url: "https://downloads.example.test/artifact".to_string(),
                    message: "unexpected status 404 Not Found".to_string(),
                }),
            }
        }

        async fn restart_anyharness(&mut self) -> Result<(), SupervisorError> {
            self.restart_log.push("anyharness");
            Ok(())
        }

        async fn restart_worker(&mut self) -> Result<(), SupervisorError> {
            self.restart_log.push("worker");
            Ok(())
        }

        async fn anyharness_healthy(&mut self, expected_version: Option<&str>) -> bool {
            self.health_expected
                .push(expected_version.map(str::to_string));
            if !self.healthy {
                return false;
            }
            match expected_version {
                None => true,
                Some(expected) => match &self.anyharness_version {
                    Some(running) => running == expected,
                    None => true,
                },
            }
        }

        async fn worker_alive(&mut self) -> bool {
            self.worker_live
        }
    }

    #[tokio::test]
    async fn anyharness_update_activates_restarts_in_order_and_retains_prev() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        fs::write(&config.worker_binary, b"worker-bin").expect("seed worker");
        let new_bytes = b"new-anyharness-binary";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
        let previous = prev_path_for(&config.anyharness_binary);
        assert_eq!(fs::read(&previous).unwrap(), b"old-anyharness");
        // AnyHarness restarts before the dependent Worker.
        assert_eq!(host.restart_log, vec!["anyharness", "worker"]);
        assert_eq!(host.fetch_count, 1);
        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Activated);
        assert_eq!(result.observed_version.as_deref(), Some("0.2.16"));
    }

    #[tokio::test]
    async fn duplicate_request_activates_exactly_once() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old").expect("seed active");
        let new_bytes = b"new";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("first drain");
        // A replayed heartbeat rewrites the same file; a second drain must not
        // re-activate.
        write_request(&config.update_request_dir, &request).expect("replay request");
        run_pending(&config, &mut host).await.expect("second drain");

        assert_eq!(host.fetch_count, 1, "exactly one activation");
    }

    #[tokio::test]
    async fn wrong_checksum_is_invalid_and_leaves_no_active_change() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        // The request's sha256/size describe "declared", but the fetch returns
        // different bytes.
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", b"declared-bytes");
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(b"totally-different-bytes".to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Invalid);
        assert!(host.restart_log.is_empty(), "no restart on a rejected artifact");
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old-anyharness");
        assert!(!prev_path_for(&config.anyharness_binary).exists());
    }

    #[tokio::test]
    async fn wrong_size_is_invalid() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old").expect("seed active");
        let new_bytes = b"new-bytes";
        let mut request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        request.size_bytes += 1; // correct checksum, wrong declared size
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Invalid);
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old");
    }

    #[tokio::test]
    async fn download_status_failure_is_invalid_and_never_restarts() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old").expect("seed active");
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", b"new");
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Status, // definitive non-2xx: terminal
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Invalid);
        assert_eq!(host.fetch_count, 1);
        assert!(host.restart_log.is_empty());
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old");
    }

    #[tokio::test]
    async fn transient_download_failure_stays_pending_then_next_drain_converges() {
        // R9-002: a transport blip must NOT latch a terminal Invalid — the
        // request stays pending and the next drain retries and converges.
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        let new_bytes = b"new-anyharness";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        // First drain: the fetch fails transiently, so no result is written.
        let mut host = FakeHost {
            fetch: FetchMode::Transient,
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("first drain");
        assert!(
            !result_exists(&config.update_request_dir, &request.request_id),
            "a transient failure must not write a terminal result"
        );
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old-anyharness");

        // Next drain: the network recovered — the same still-pending request now
        // converges to Activated.
        host.fetch = FetchMode::Bytes(new_bytes.to_vec());
        run_pending(&config, &mut host).await.expect("retry drain");
        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Activated);
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
    }

    #[tokio::test]
    async fn crash_after_activate_on_unhealthy_path_preserves_last_good() {
        // R9-004: a crash after activate but before result must not let the
        // re-drain clobber the true last-good. On the UNHEALTHY path the drain
        // must roll back onto the ORIGINAL last-good, not the new bad binary.
        let dir = temp_dir();
        let config = test_config(&dir.0);
        let new_bytes = b"new-bad-anyharness";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        // On-disk state a crash-after-activate leaves: the two renames already
        // happened (active = new, .prev = the true last-good) and NO result.
        fs::write(&config.anyharness_binary, new_bytes).expect("active = activated new");
        fs::write(prev_path_for(&config.anyharness_binary), b"old-good").expect(".prev = last-good");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: false, // the new binary is unhealthy
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("recovery drain");

        // The fast path recognized the already-activated artifact and never
        // re-downloaded or re-moved active->.prev; the health-fail restored the
        // genuine last-good, not the bad binary.
        assert_eq!(host.fetch_count, 0, "already-activated artifact is not re-fetched");
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old-good");
        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::RolledBack);
    }

    #[tokio::test]
    async fn version_mismatch_fails_the_health_gate_and_rolls_back() {
        // R9-008: a checksum-valid but lagging artifact that answers /health 2xx
        // on the PRIOR version must still fail the gate.
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        let new_bytes = b"new-anyharness-binary";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: true,
            worker_live: true,
            // The runtime answers 2xx but on the LAGGING version, not 0.2.16.
            anyharness_version: Some("0.2.15".to_string()),
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::RolledBack);
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old-anyharness");
        // The gate was asked to check the activated version, not just 2xx.
        assert!(host
            .health_expected
            .iter()
            .any(|expected| expected.as_deref() == Some("0.2.16")));
    }

    #[tokio::test]
    async fn staging_interruption_leaves_no_active_change_and_rerequest_converges() {
        // R9-013: a staging interruption (here modeled as a wrong-size artifact
        // that fails re-verify at stage time) must leave the active binary
        // untouched and no `.prev`; a corrected re-request then converges.
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        let new_bytes = b"new-anyharness";
        let mut request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        request.size_bytes += 1; // declared size disagrees: staging re-verify fails

        write_request(&config.update_request_dir, &request).expect("write request");
        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("first drain");
        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Invalid);
        assert!(host.restart_log.is_empty(), "no restart on a rejected stage");
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old-anyharness");
        assert!(!prev_path_for(&config.anyharness_binary).exists(), "no active change staged");

        // A corrected re-request (same version, now with the honest size) mints
        // the same request_id; drop the stale Invalid result so the re-request
        // is actionable, then confirm it converges.
        fs::remove_file(
            config
                .update_request_dir
                .join(result_file_name(&request.request_id)),
        )
        .expect("clear stale result");
        let good = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &good).expect("re-request");
        run_pending(&config, &mut host).await.expect("re-request drain");
        let result = result_for(&config.update_request_dir, &good.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Activated);
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
    }

    #[tokio::test]
    async fn unhealthy_activation_rolls_back_to_last_good() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        let new_bytes = b"new-anyharness";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: false, // unhealthy after activation
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        // Last-good restored; the new version is never left active.
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old-anyharness");
        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::RolledBack);
        // Restart for the activation, then again for the rollback.
        assert_eq!(
            host.restart_log,
            vec!["anyharness", "worker", "anyharness", "worker"]
        );
    }

    #[tokio::test]
    async fn worker_component_update_replaces_only_the_worker() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"anyharness-untouched").expect("seed anyharness");
        fs::write(&config.worker_binary, b"old-worker").expect("seed worker");
        let new_bytes = b"new-worker-binary";
        let request = make_request(UpdateComponent::Worker, "0.3.0", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        assert_eq!(fs::read(&config.worker_binary).unwrap(), new_bytes);
        assert_eq!(
            fs::read(prev_path_for(&config.worker_binary)).unwrap(),
            b"old-worker"
        );
        // AnyHarness is left entirely alone; only the Worker is restarted.
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"anyharness-untouched");
        assert_eq!(host.restart_log, vec!["worker"]);
        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Activated);
    }

    #[tokio::test]
    async fn unrepresentable_component_is_invalid_without_fetching() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old").expect("seed active");
        // "supervisor" is not a representable component: the read fails, so the
        // machine records Invalid and never downloads or activates.
        let path = config
            .update_request_dir
            .join("request-supervisor-9.9.9.json");
        fs::create_dir_all(&config.update_request_dir).expect("create updates dir");
        fs::write(
            &path,
            br#"{"requestId":"supervisor-9.9.9","component":"supervisor","version":"9.9.9","targetTriple":"linux-x86_64","artifactUrl":"https://x.test/a","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":1,"requestedAt":"2026-07-15T00:00:00Z"}"#,
        )
        .expect("write malformed request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(b"never-used".to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };
        run_pending(&config, &mut host).await.expect("run pending");

        assert_eq!(host.fetch_count, 0, "a rejected request is never fetched");
        assert!(result_exists(&config.update_request_dir, "supervisor-9.9.9"));
        let result = result_for(&config.update_request_dir, "supervisor-9.9.9");
        assert_eq!(result.outcome, UpdateOutcome::Invalid);
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old");
    }

    #[tokio::test]
    async fn crash_before_result_reprocesses_and_converges_once() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        let new_bytes = b"new-anyharness";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: FetchMode::Bytes(new_bytes.to_vec()),
            healthy: true,
            worker_live: true,
            ..Default::default()
        };

        // First attempt: run the machine but "crash" before the result is
        // recorded (simulating a Supervisor restart mid-activation).
        let pending = request::next_pending(&config.update_request_dir)
            .expect("scan")
            .expect("pending");
        let _crashed = activate_one(&config, &mut host, &pending).await;
        assert!(!result_exists(&config.update_request_dir, &request.request_id));

        // Recovery: the request has no result, so it is reprocessed and
        // converges, writing exactly one terminal Activated result.
        run_pending(&config, &mut host).await.expect("recovery drain");

        let result = result_for(&config.update_request_dir, &request.request_id);
        assert_eq!(result.outcome, UpdateOutcome::Activated);
        assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
        // A second drain is a no-op (idempotent).
        let fetches_after_recovery = host.fetch_count;
        run_pending(&config, &mut host).await.expect("idempotent drain");
        assert_eq!(host.fetch_count, fetches_after_recovery);
    }
}
