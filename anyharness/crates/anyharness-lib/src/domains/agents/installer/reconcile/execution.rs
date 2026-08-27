use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;
use uuid::Uuid;

use super::{reconcile_agent_with_progress, AgentReconcileOutcome, AgentReconcileResult};
use crate::domains::agents::catalog::service::{ActiveCatalog, AgentCatalogService};
use crate::domains::agent_auth::launch_probe::{LaunchProbeService, PokeReason};
use crate::domains::agents::installer::progress::{
    InstallProgressPhase, InstallProgressReporter, InstallProgressUpdate,
};
use crate::domains::agents::installer::auto_install::{
    auto_install_decision_with_escape_hatch, AgentInstallFacts,
};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::installer::InstallOptions;
use crate::domains::agents::model::{AgentDescriptor, AgentKind, ArtifactRole, ResolvedArtifact};
use crate::domains::agents::readiness::service::resolve_agent_unrouted;
use crate::domains::agents::runtime::RuntimeSurface;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentReconcileJobStatus {
    Idle,
    Queued,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentReconcileStartError {
    #[error("agent reconcile job {0} is already active")]
    Busy(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentReconcileAdmission {
    ReuseCompatible,
    RequireIdle,
}

#[derive(Debug, Clone)]
pub struct AgentReconcileJobSnapshot {
    pub status: AgentReconcileJobStatus,
    pub job_id: Option<String>,
    pub reinstall: bool,
    pub installed_only: bool,
    pub current_agent: Option<AgentKind>,
    pub agent_kinds: Vec<AgentKind>,
    pub components: Vec<AgentInstallComponentProgress>,
    pub results: Vec<AgentReconcileResult>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentInstallComponentProgress {
    pub agent: AgentKind,
    pub role: ArtifactRole,
    pub phase: InstallProgressPhase,
    pub downloaded_bytes: u64,
    pub download_size_bytes: Option<u64>,
}

#[derive(Debug, Clone)]
struct AgentReconcileJob {
    job_id: String,
    status: AgentReconcileJobStatus,
    reinstall: bool,
    installed_only: bool,
    current_agent: Option<AgentKind>,
    agent_kinds: Vec<AgentKind>,
    components: Arc<std::sync::Mutex<Vec<AgentInstallComponentProgress>>>,
    results: Vec<AgentReconcileResult>,
    started_at: Option<String>,
    finished_at: Option<String>,
    message: Option<String>,
    catalog: Option<ActiveCatalog>,
}

impl AgentReconcileJob {
    fn snapshot(&self) -> AgentReconcileJobSnapshot {
        AgentReconcileJobSnapshot {
            status: self.status.clone(),
            job_id: Some(self.job_id.clone()),
            reinstall: self.reinstall,
            installed_only: self.installed_only,
            current_agent: self.current_agent.clone(),
            agent_kinds: self.agent_kinds.clone(),
            components: self
                .components
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone(),
            results: self.results.clone(),
            started_at: self.started_at.clone(),
            finished_at: self.finished_at.clone(),
            message: self.message.clone(),
        }
    }
}

pub struct AgentReconcileService {
    job: Arc<Mutex<Option<AgentReconcileJob>>>,
    execution_lock: Arc<Mutex<()>>,
}

impl AgentReconcileService {
    pub fn new() -> Self {
        Self {
            job: Arc::new(Mutex::new(None)),
            execution_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn snapshot(&self) -> AgentReconcileJobSnapshot {
        let job = self.job.lock().await;
        job.as_ref()
            .map(AgentReconcileJob::snapshot)
            .unwrap_or_else(AgentReconcileJobSnapshot::idle)
    }

    pub(crate) async fn start_with_admission(
        &self,
        registry: Vec<AgentDescriptor>,
        runtime_home: PathBuf,
        reinstall: bool,
        installed_only: bool,
        requested_agent_kinds: Vec<AgentKind>,
        agent_seed_store: Option<AgentSeedStore>,
        catalog: Option<AgentCatalogService>,
        // The probe engine, poked per agent as each install finishes. Threaded in
        // exactly as `agent_seed_store` and `catalog` are, and `None` in tests for
        // the same reason: a job that pokes nothing must stay constructible.
        launch_probe: Option<Arc<LaunchProbeService>>,
        surface: RuntimeSurface,
        admission: AgentReconcileAdmission,
    ) -> Result<AgentReconcileJobSnapshot, AgentReconcileStartError> {
        let (snapshot, progress) = {
            let mut current = self.job.lock().await;
            if let Some(existing) = current.as_ref() {
                if matches!(
                    existing.status,
                    AgentReconcileJobStatus::Queued | AgentReconcileJobStatus::Running
                ) {
                    // Public callers reuse covering jobs; internal admission requires idle.
                    let covers_install_mode = existing.reinstall || !reinstall;
                    let covers_installed_scope = !existing.installed_only || installed_only;
                    let covers_agent_scope = existing.agent_kinds.is_empty()
                        || (!requested_agent_kinds.is_empty()
                            && requested_agent_kinds
                                .iter()
                                .all(|kind| existing.agent_kinds.contains(kind)));
                    let covers_request =
                        covers_install_mode && covers_installed_scope && covers_agent_scope;
                    if admission == AgentReconcileAdmission::ReuseCompatible && covers_request {
                        tracing::info!(
                            job_id = %existing.job_id,
                            requested_reinstall = reinstall,
                            job_reinstall = existing.reinstall,
                            requested_installed_only = installed_only,
                            job_installed_only = existing.installed_only,
                            "agent reconcile request reused active job"
                        );
                        return Ok(existing.snapshot());
                    }
                    tracing::warn!(
                        active_job_id = %existing.job_id,
                        job_installed_only = existing.installed_only,
                        requested_installed_only = installed_only,
                        "agent reconcile request rejected while a job is active"
                    );
                    return Err(AgentReconcileStartError::Busy(existing.job_id.clone()));
                }
            }

            let catalog = catalog.map(|service| service.active_catalog());
            let job_id = Uuid::new_v4().to_string();
            let components = Arc::new(std::sync::Mutex::new(progress_components(&registry)));
            let next_job = AgentReconcileJob {
                job_id: job_id.clone(),
                status: AgentReconcileJobStatus::Queued,
                reinstall,
                installed_only,
                current_agent: None,
                agent_kinds: requested_agent_kinds,
                components: components.clone(),
                results: Vec::new(),
                started_at: Some(chrono::Utc::now().to_rfc3339()),
                finished_at: None,
                message: None,
                catalog,
            };
            let snapshot = next_job.snapshot();
            *current = Some(next_job);
            (snapshot, components)
        };
        let job_id = snapshot.job_id.clone().unwrap_or_default();

        tracing::info!(
            job_id = %job_id,
            reinstall,
            agent_count = registry.len(),
            runtime_home = %runtime_home.display(),
            "agent reconcile job queued"
        );

        let jobs = self.job.clone();
        let execution_lock = self.execution_lock.clone();
        tokio::spawn(async move {
            run_reconcile_job(
                jobs,
                execution_lock,
                job_id,
                registry,
                runtime_home,
                reinstall,
                installed_only,
                surface,
                progress,
                agent_seed_store,
                launch_probe,
            )
            .await;
        });

        Ok(snapshot)
    }
}

impl AgentReconcileJobSnapshot {
    fn idle() -> Self {
        Self {
            status: AgentReconcileJobStatus::Idle,
            job_id: None,
            reinstall: false,
            installed_only: false,
            current_agent: None,
            agent_kinds: Vec::new(),
            components: Vec::new(),
            results: Vec::new(),
            started_at: None,
            finished_at: None,
            message: None,
        }
    }
}

async fn run_reconcile_job(
    jobs: Arc<Mutex<Option<AgentReconcileJob>>>,
    execution_lock: Arc<Mutex<()>>,
    job_id: String,
    registry: Vec<AgentDescriptor>,
    runtime_home: PathBuf,
    reinstall: bool,
    installed_only: bool,
    surface: RuntimeSurface,
    progress: Arc<std::sync::Mutex<Vec<AgentInstallComponentProgress>>>,
    agent_seed_store: Option<AgentSeedStore>,
    launch_probe: Option<Arc<LaunchProbeService>>,
) {
    // Defense in depth around the single visible job slot: even if future
    // callers change admission policy, blocking installers never mutate the
    // managed artifact tree concurrently.
    let _execution_guard = execution_lock.lock_owned().await;
    let started = Instant::now();
    let Some(catalog) = update_job(&jobs, &job_id, |job| {
        job.status = AgentReconcileJobStatus::Running;
        job.catalog.clone()
    })
    .await
    else {
        return;
    };

    tracing::info!(
        job_id = %job_id,
        reinstall,
        agent_count = registry.len(),
        "agent reconcile job started"
    );

    let options = InstallOptions {
        reinstall,
        ..Default::default()
    };

    for descriptor in registry {
        let kind = descriptor.kind.clone();
        let _ = update_job(&jobs, &job_id, |job| {
            job.current_agent = Some(kind.clone());
        })
        .await;

        let agent_started = Instant::now();
        tracing::info!(
            job_id = %job_id,
            agent = kind.as_str(),
            reinstall,
            "agent reconcile install started"
        );

        let agent_runtime_home = runtime_home.clone();
        let options = options.clone();
        let agent_catalog = catalog.clone();
        let agent_progress = progress.clone();
        let progress_kind = kind.clone();
        let result = match tokio::task::spawn_blocking(move || {
            // Should this pass touch this agent at all? One carve-out (cursor in
            // cloud) plus the installed-only scope and the always-managed escape
            // hatch (R2.0: a user's PATH copy no longer skips), decided by one
            // named predicate rather than inferred from a boolean — see
            // `installer::auto_install` for why that distinction matters.
            //
            // Resolution is side-effect-free, and unrouted because this reads
            // ARTIFACTS only: an enrolled agent-auth route cannot change whether a
            // binary is on PATH or managed-installed, so consulting it would be a
            // state-file read per agent per pass with no effect on the decision.
            {
                let source_is = |artifact: &ResolvedArtifact, source: &str| {
                    artifact.installed && artifact.source.as_deref() == Some(source)
                };
                let resolved = resolve_agent_unrouted(&descriptor, &agent_runtime_home);
                let any_artifact_is = |source: &str| {
                    source_is(&resolved.agent_process, source)
                        || resolved
                            .native
                            .as_ref()
                            .is_some_and(|native| source_is(native, source))
                };
                let facts = AgentInstallFacts {
                    has_path_artifact: any_artifact_is("path"),
                    has_managed_artifact: any_artifact_is("managed"),
                };
                if let Err(skip) = auto_install_decision_with_escape_hatch(
                    &descriptor.kind,
                    surface,
                    installed_only,
                    facts,
                ) {
                    tracing::debug!(
                        agent_kind = descriptor.kind.as_str(),
                        ?surface,
                        installed_only,
                        reason = skip.message(),
                        "reconcile skipping agent"
                    );
                    return AgentReconcileResult {
                        kind: descriptor.kind.clone(),
                        outcome: AgentReconcileOutcome::Skipped,
                        message: Some(skip.message().to_string()),
                        failure_kind: None,
                        installed_artifacts: vec![],
                    };
                }
            }
            let pins = agent_catalog
                .as_ref()
                .and_then(|catalog| catalog.pin_overrides(descriptor.kind.as_str()));
            let reporter = InstallProgressReporter::new(move |update| {
                apply_progress_update(&agent_progress, &progress_kind, update);
            });
            reconcile_agent_with_progress(
                &descriptor,
                &agent_runtime_home,
                &options,
                pins.as_ref(),
                Some(&reporter),
            )
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                let message = format!("agent reconcile task failed: {error}");
                finish_agent_components(&progress, &kind, InstallProgressPhase::Failed);
                let _ = update_job(&jobs, &job_id, |job| {
                    job.status = AgentReconcileJobStatus::Failed;
                    job.current_agent = None;
                    job.finished_at = Some(chrono::Utc::now().to_rfc3339());
                    job.message = Some(message.clone());
                })
                .await;
                tracing::error!(
                    job_id = %job_id,
                    agent = kind.as_str(),
                    error = %error,
                    "agent reconcile job failed"
                );
                return;
            }
        };

        tracing::info!(
            job_id = %job_id,
            agent = kind.as_str(),
            outcome = reconcile_outcome_label(&result.outcome),
            elapsed_ms = agent_started.elapsed().as_millis(),
            "agent reconcile install completed"
        );

        if !result.installed_artifacts.is_empty() {
            if let Some(store) = &agent_seed_store {
                store.refresh_from_state(&runtime_home);
            }
        }

        let terminal_phase = match result.outcome {
            AgentReconcileOutcome::Failed => InstallProgressPhase::Failed,
            AgentReconcileOutcome::Skipped => InstallProgressPhase::Skipped,
            AgentReconcileOutcome::Installed | AgentReconcileOutcome::AlreadyInstalled => {
                InstallProgressPhase::Completed
            }
        };
        finish_agent_components(&progress, &kind, terminal_phase);
        // Install-completed launch-options poke, per agent. This is the SOLE
        // guarantor of probe-after-install ordering:
        // the startup poke returns at admission and so cannot promise it, while this
        // fires after the one harness that just converged, naming only that harness.
        //
        // Only on `Completed`. A `Failed` install leaves the previous binary in place
        // and nothing to re-observe; a `Skipped` one installed nothing at all. Poking
        // either would spend a real harness spawn to re-confirm unchanged state.
        if probe_after_install(terminal_phase) {
            LaunchProbeService::poke_optional(
                &launch_probe,
                kind.as_str(),
                PokeReason::InstallCompleted,
            );
        }

        let _ = update_job(&jobs, &job_id, |job| {
            job.results.push(result);
            job.current_agent = None;
        })
        .await;
    }

    let completion = update_job(&jobs, &job_id, |job| {
        job.status = AgentReconcileJobStatus::Completed;
        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
        let failed_count = job
            .results
            .iter()
            .filter(|result| result.outcome == AgentReconcileOutcome::Failed)
            .count();
        (job.results.len(), failed_count)
    })
    .await;
    let Some((result_count, failed_count)) = completion else {
        tracing::info!(
            job_id = %job_id,
            reinstall,
            elapsed_ms = started.elapsed().as_millis(),
            "agent reconcile job completed after its tracking state disappeared"
        );
        return;
    };

    tracing::info!(
        job_id = %job_id,
        reinstall,
        result_count,
        failed_count,
        elapsed_ms = started.elapsed().as_millis(),
        "agent reconcile job completed"
    );
}

fn progress_components(registry: &[AgentDescriptor]) -> Vec<AgentInstallComponentProgress> {
    registry
        .iter()
        .flat_map(|descriptor| {
            let mut roles = Vec::with_capacity(2);
            if descriptor.native.is_some() {
                roles.push(ArtifactRole::NativeCli);
            }
            roles.push(ArtifactRole::AgentProcess);
            roles.into_iter().map(|role| AgentInstallComponentProgress {
                agent: descriptor.kind.clone(),
                role,
                phase: InstallProgressPhase::Queued,
                downloaded_bytes: 0,
                download_size_bytes: None,
            })
        })
        .collect()
}

fn apply_progress_update(
    progress: &Arc<std::sync::Mutex<Vec<AgentInstallComponentProgress>>>,
    kind: &AgentKind,
    update: InstallProgressUpdate,
) {
    let mut components = progress
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(component) = components
        .iter_mut()
        .find(|component| component.agent == *kind && component.role == update.role)
    else {
        return;
    };
    component.phase = update.phase;
    component.downloaded_bytes = component.downloaded_bytes.max(update.downloaded_bytes);
    component.download_size_bytes = update.download_size_bytes.or(component.download_size_bytes);
}

/// Does this terminal install phase warrant a re-probe?
///
/// Only `Completed`. A `Failed` install leaves the previous binary in place and a
/// `Skipped` one installed nothing, so neither changed the install identity a
/// snapshot entry is bound to — poking either would spend a real harness spawn to
/// re-confirm an identity the gate would then call fresh anyway.
fn probe_after_install(phase: InstallProgressPhase) -> bool {
    matches!(phase, InstallProgressPhase::Completed)
}

/// The predicate above, for the poke-wiring suite. Exposed rather than duplicated so
/// the assertion cannot drift from the branch the job actually takes.
#[cfg(test)]
pub(crate) fn probe_after_install_for_test(phase: InstallProgressPhase) -> bool {
    probe_after_install(phase)
}

fn finish_agent_components(
    progress: &Arc<std::sync::Mutex<Vec<AgentInstallComponentProgress>>>,
    kind: &AgentKind,
    phase: InstallProgressPhase,
) {
    let mut components = progress
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for component in components
        .iter_mut()
        .filter(|component| component.agent == *kind)
    {
        if !matches!(
            component.phase,
            InstallProgressPhase::Completed
                | InstallProgressPhase::Skipped
                | InstallProgressPhase::Failed
        ) {
            component.phase = phase;
        }
    }
}

async fn update_job<T>(
    jobs: &Arc<Mutex<Option<AgentReconcileJob>>>,
    job_id: &str,
    update: impl FnOnce(&mut AgentReconcileJob) -> T,
) -> Option<T> {
    let mut job = jobs.lock().await;
    let current = job.as_mut()?;
    if current.job_id != job_id {
        return None;
    }
    Some(update(current))
}

fn reconcile_outcome_label(outcome: &AgentReconcileOutcome) -> &'static str {
    match outcome {
        AgentReconcileOutcome::Installed => "installed",
        AgentReconcileOutcome::AlreadyInstalled => "already_installed",
        AgentReconcileOutcome::Skipped => "skipped",
        AgentReconcileOutcome::Failed => "failed",
    }
}

#[cfg(test)]
#[path = "execution_tests.rs"]
mod tests;
