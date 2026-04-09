use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;
use uuid::Uuid;

use super::installer::InstallOptions;
use super::model::{AgentDescriptor, AgentKind};
use super::reconcile::{reconcile_agent, AgentReconcileOutcome, AgentReconcileResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentReconcileJobStatus {
    Idle,
    Queued,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone)]
pub struct AgentReconcileJobSnapshot {
    pub status: AgentReconcileJobStatus,
    pub job_id: Option<String>,
    pub reinstall: bool,
    pub current_agent: Option<AgentKind>,
    pub results: Vec<AgentReconcileResult>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct AgentReconcileJob {
    job_id: String,
    status: AgentReconcileJobStatus,
    reinstall: bool,
    current_agent: Option<AgentKind>,
    results: Vec<AgentReconcileResult>,
    started_at: Option<String>,
    finished_at: Option<String>,
    message: Option<String>,
}

impl AgentReconcileJob {
    fn snapshot(&self) -> AgentReconcileJobSnapshot {
        AgentReconcileJobSnapshot {
            status: self.status.clone(),
            job_id: Some(self.job_id.clone()),
            reinstall: self.reinstall,
            current_agent: self.current_agent.clone(),
            results: self.results.clone(),
            started_at: self.started_at.clone(),
            finished_at: self.finished_at.clone(),
            message: self.message.clone(),
        }
    }
}

pub struct AgentReconcileService {
    job: Arc<Mutex<Option<AgentReconcileJob>>>,
}

impl AgentReconcileService {
    pub fn new() -> Self {
        Self {
            job: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn snapshot(&self) -> AgentReconcileJobSnapshot {
        let job = self.job.lock().await;
        job.as_ref()
            .map(AgentReconcileJob::snapshot)
            .unwrap_or_else(AgentReconcileJobSnapshot::idle)
    }

    pub async fn start_or_get(
        &self,
        registry: Vec<AgentDescriptor>,
        runtime_home: PathBuf,
        reinstall: bool,
    ) -> AgentReconcileJobSnapshot {
        let snapshot = {
            let mut current = self.job.lock().await;
            if let Some(existing) = current.as_ref() {
                if matches!(
                    existing.status,
                    AgentReconcileJobStatus::Queued | AgentReconcileJobStatus::Running
                ) {
                    tracing::info!(
                        job_id = %existing.job_id,
                        requested_reinstall = reinstall,
                        job_reinstall = existing.reinstall,
                        "agent reconcile request reused active job"
                    );
                    return existing.snapshot();
                }
            }

            let job_id = Uuid::new_v4().to_string();
            let next_job = AgentReconcileJob {
                job_id: job_id.clone(),
                status: AgentReconcileJobStatus::Queued,
                reinstall,
                current_agent: None,
                results: Vec::new(),
                started_at: Some(chrono::Utc::now().to_rfc3339()),
                finished_at: None,
                message: None,
            };
            let snapshot = next_job.snapshot();
            *current = Some(next_job);
            snapshot
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
        tokio::spawn(async move {
            run_reconcile_job(jobs, job_id, registry, runtime_home, reinstall).await;
        });

        snapshot
    }
}

impl AgentReconcileJobSnapshot {
    fn idle() -> Self {
        Self {
            status: AgentReconcileJobStatus::Idle,
            job_id: None,
            reinstall: false,
            current_agent: None,
            results: Vec::new(),
            started_at: None,
            finished_at: None,
            message: None,
        }
    }
}

async fn run_reconcile_job(
    jobs: Arc<Mutex<Option<AgentReconcileJob>>>,
    job_id: String,
    registry: Vec<AgentDescriptor>,
    runtime_home: PathBuf,
    reinstall: bool,
) {
    let started = Instant::now();
    if update_job(&jobs, &job_id, |job| {
        job.status = AgentReconcileJobStatus::Running;
    })
    .await
    .is_none()
    {
        return;
    }

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
        if update_job(&jobs, &job_id, |job| {
            job.current_agent = Some(kind.clone());
        })
        .await
        .is_none()
        {
            return;
        }

        let agent_started = Instant::now();
        tracing::info!(
            job_id = %job_id,
            agent = kind.as_str(),
            reinstall,
            "agent reconcile install started"
        );

        let runtime_home = runtime_home.clone();
        let options = options.clone();
        let result = match tokio::task::spawn_blocking(move || {
            reconcile_agent(&descriptor, &runtime_home, &options)
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                let message = format!("agent reconcile task failed: {error}");
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

        if update_job(&jobs, &job_id, |job| {
            job.results.push(result);
            job.current_agent = None;
        })
        .await
        .is_none()
        {
            return;
        }
    }

    let Some((result_count, failed_count)) = update_job(&jobs, &job_id, |job| {
        job.status = AgentReconcileJobStatus::Completed;
        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
        let failed_count = job
            .results
            .iter()
            .filter(|result| result.outcome == AgentReconcileOutcome::Failed)
            .count();
        (job.results.len(), failed_count)
    })
    .await
    else {
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
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use tokio::time::{sleep, timeout};

    use super::*;

    #[tokio::test]
    async fn snapshot_defaults_to_idle() {
        let service = AgentReconcileService::new();

        let snapshot = service.snapshot().await;

        assert_eq!(snapshot.status, AgentReconcileJobStatus::Idle);
        assert_eq!(snapshot.job_id, None);
        assert!(!snapshot.reinstall);
        assert!(snapshot.results.is_empty());
    }

    #[tokio::test]
    async fn start_or_get_reuses_active_job() {
        let service = AgentReconcileService::new();
        {
            let mut job = service.job.lock().await;
            *job = Some(AgentReconcileJob {
                job_id: "existing-job".into(),
                status: AgentReconcileJobStatus::Running,
                reinstall: false,
                current_agent: Some(AgentKind::Codex),
                results: Vec::new(),
                started_at: Some(chrono::Utc::now().to_rfc3339()),
                finished_at: None,
                message: None,
            });
        }

        let snapshot = service
            .start_or_get(Vec::new(), PathBuf::from("/tmp/anyharness-test"), true)
            .await;

        assert_eq!(snapshot.job_id.as_deref(), Some("existing-job"));
        assert_eq!(snapshot.status, AgentReconcileJobStatus::Running);
        assert!(!snapshot.reinstall);
        assert_eq!(snapshot.current_agent, Some(AgentKind::Codex));
    }

    #[tokio::test]
    async fn empty_registry_job_completes() {
        let service = AgentReconcileService::new();

        let snapshot = service
            .start_or_get(Vec::new(), PathBuf::from("/tmp/anyharness-empty"), true)
            .await;
        assert_eq!(snapshot.status, AgentReconcileJobStatus::Queued);

        let completed = timeout(Duration::from_secs(2), async {
            loop {
                let snapshot = service.snapshot().await;
                if snapshot.status == AgentReconcileJobStatus::Completed {
                    return snapshot;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("expected reconcile job to complete");

        assert_eq!(completed.status, AgentReconcileJobStatus::Completed);
        assert!(completed.results.is_empty());
        assert!(completed.finished_at.is_some());
    }
}
