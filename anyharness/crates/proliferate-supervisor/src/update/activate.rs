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

    /// Poll AnyHarness `/health` after a restart.
    async fn anyharness_healthy(&mut self) -> bool;

    /// Confirm the Worker is still live after a restart.
    async fn worker_alive(&mut self) -> bool;
}

/// Drain the mailbox: for each pending request with no result yet, run the
/// state machine and write exactly one result. Idempotent — a request that
/// already has a result is skipped by `next_pending`, so a replayed heartbeat
/// or a Supervisor restart activates each request at most once.
pub async fn run_pending<H: ActivationHost>(
    config: &SupervisorConfig,
    host: &mut H,
) -> Result<(), SupervisorError> {
    while let Some(pending) = request::next_pending(&config.update_request_dir)? {
        let result = activate_one(config, host, &pending).await;
        request::record_result(&config.update_request_dir, &result)?;
    }
    Ok(())
}

async fn activate_one<H: ActivationHost>(
    config: &SupervisorConfig,
    host: &mut H,
    pending: &PendingUpdate,
) -> UpdateResultV1 {
    let request = &pending.request;
    let component = request.component;

    // 1. Download the exact artifact URL (bounded). A failure means nothing was
    //    activated: fail closed with Invalid (the Worker re-emits only when the
    //    desired version changes, matching today's not-retried-until-superseded
    //    behavior).
    let bytes = match host.fetch_artifact(request).await {
        Ok(bytes) => bytes,
        Err(error) => return invalid(request, format!("download failed: {error}")),
    };

    // 2. Re-verify sha256 + size and stage atomically with private permissions.
    //    A wrong-size / wrong-checksum artifact is rejected here (staging runs
    //    `verify_sha256`), leaving no active change.
    let staged = match stage_verified(config, request, &bytes) {
        Ok(staged) => staged,
        Err(error) => return invalid(request, format!("verify/stage failed: {error}")),
    };

    // 3. Activate atomically, retaining `.prev` for rollback. A crash between
    //    the two renames still leaves a runnable binary at a known path.
    let active_path = active_path_for(config, component);
    let plan = match activate_binary(component, &staged.path, &active_path) {
        Ok(plan) => plan,
        Err(error) => return invalid(request, format!("activate failed: {error}")),
    };

    // 4. Restart the changed component(s) in dependency order, then health-gate.
    if let Err(error) = restart_in_order(host, component).await {
        return roll_back(host, request, &plan, format!("restart failed: {error}")).await;
    }
    if health_gate(host).await {
        return activated(request);
    }

    // 5. Unhealthy: restore last-good, restart, re-gate. Never reported active.
    roll_back(host, request, &plan, "unhealthy after activation".to_string()).await
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

async fn health_gate<H: ActivationHost>(host: &mut H) -> bool {
    // The whole runtime must be healthy: AnyHarness answering `/health` and the
    // Worker still live after the restart.
    host.anyharness_healthy().await && host.worker_alive().await
}

async fn roll_back<H: ActivationHost>(
    host: &mut H,
    request: &UpdateRequestV1,
    plan: &RollbackPlan,
    reason: String,
) -> UpdateResultV1 {
    if plan.apply().is_ok() {
        // Best-effort: bring the restored last-good back up and re-gate. The
        // result is RolledBack regardless — the point is that the new version
        // is never reported active.
        let _ = restart_in_order(host, request.component).await;
        let _ = health_gate(host).await;
    }
    UpdateResultV1 {
        request_id: request.request_id.clone(),
        outcome: UpdateOutcome::RolledBack,
        // The prior version string is not tracked in this slice; the Worker
        // reports the converged (restored) version through the heartbeat.
        observed_version: None,
        error: Some(reason),
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

    #[derive(Default)]
    struct FakeHost {
        /// `None` => the fetch errors; `Some(bytes)` => it returns those bytes.
        fetch: Option<Vec<u8>>,
        healthy: bool,
        worker_live: bool,
        restart_log: Vec<&'static str>,
        fetch_count: u32,
    }

    impl ActivationHost for FakeHost {
        async fn fetch_artifact(
            &mut self,
            _request: &UpdateRequestV1,
        ) -> Result<Vec<u8>, SupervisorError> {
            self.fetch_count += 1;
            match &self.fetch {
                Some(bytes) => Ok(bytes.clone()),
                None => Err(SupervisorError::DownloadArtifact {
                    url: "https://downloads.example.test/artifact".to_string(),
                    message: "simulated transport failure".to_string(),
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

        async fn anyharness_healthy(&mut self) -> bool {
            self.healthy
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
            fetch: Some(new_bytes.to_vec()),
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
            fetch: Some(new_bytes.to_vec()),
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
            fetch: Some(b"totally-different-bytes".to_vec()),
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
            fetch: Some(new_bytes.to_vec()),
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
    async fn download_failure_is_invalid_and_never_restarts() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old").expect("seed active");
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", b"new");
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: None, // transport failure
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
    async fn unhealthy_activation_rolls_back_to_last_good() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        let new_bytes = b"new-anyharness";
        let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
        write_request(&config.update_request_dir, &request).expect("write request");

        let mut host = FakeHost {
            fetch: Some(new_bytes.to_vec()),
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
            fetch: Some(new_bytes.to_vec()),
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
            fetch: Some(b"never-used".to_vec()),
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
            fetch: Some(new_bytes.to_vec()),
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
