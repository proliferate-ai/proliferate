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
use tracing::{info, warn};

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

    /// Probe the ACTIVE Worker binary on disk (a fresh `--version` subprocess,
    /// not the running child) and report whether it matches `expected`.
    /// `Some(true)` = the activated bytes really report the requested version;
    /// `Some(false)` = they report a DIFFERENT version (bytes/label mismatch);
    /// `None` = the version could not be determined. Ties a Worker-component
    /// activation's `observed_version` to a real probe rather than the request
    /// label, so bytes that are version A can never be recorded Activated at the
    /// requested version B (R9R-001).
    async fn worker_reports_version(&mut self, expected: &str) -> Option<bool>;
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
                // A successful mailbox-triggered activation deserves the same
                // visibility as the run loop's spawn logging (smoke follow-up:
                // only retries were logged before).
                info!(
                    request_id = %result.request_id,
                    outcome = ?result.outcome,
                    observed_version = ?result.observed_version,
                    "update request reached a terminal result"
                );
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
    //    the two renames is recoverable at startup via the activation journal
    //    (R9R-004).
    let plan = match activate_binary(config, component, &staged.path, &active_path) {
        Ok(plan) => plan,
        Err(error) => {
            return ActivationStep::Terminal(invalid(request, format!("activate failed: {error}")));
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
        roll_back(
            host,
            request,
            &plan,
            "unhealthy after activation".to_string(),
        )
        .await,
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
    if !(host.anyharness_healthy(expected_version).await && host.worker_alive().await) {
        return false;
    }
    // R9R-001 mislabel-close: a Worker-component activation must not be reported
    // Activated at the requested version unless the ACTIVE worker binary really
    // reports that version. `Some(false)` (the bytes report a different version)
    // fails the gate so the mismatch rolls back instead of latching a false
    // Activated; `None` (unprobeable) is tolerated, mirroring the AnyHarness
    // `/health` no-version tolerance. The AnyHarness path is already version-
    // gated above via `anyharness_healthy(expected_version)` (R9-008).
    if request.component == UpdateComponent::Worker
        && host.worker_reports_version(&request.version).await == Some(false)
    {
        return false;
    }
    true
}

async fn roll_back<H: ActivationHost>(
    host: &mut H,
    request: &UpdateRequestV1,
    plan: &RollbackPlan,
    reason: String,
) -> UpdateResultV1 {
    match plan.apply() {
        Ok(()) => {
            // Best-effort: bring the restored last-good back up and wait for
            // plain reachability. Deliberately NOT `health_gate(request)` — that
            // asserts the FAILED request's version, which the restored binary can
            // never report, so it burned a full attempts×delay cycle for nothing
            // (smoke follow-up). The outcome is RolledBack — the point is that
            // the new version is never reported active and last-good is serving.
            let _ = restart_in_order(host, request.component).await;
            let _ = host.anyharness_healthy(None).await;
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

mod journal;

pub use journal::reconcile_activation_journal;
use journal::{activate_binary, prev_path_for};

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
