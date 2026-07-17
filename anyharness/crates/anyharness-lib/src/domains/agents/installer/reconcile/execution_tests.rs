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
            installed_only: false,
            current_agent: Some(AgentKind::Codex),
            agent_kinds: Vec::new(),
            components: Arc::new(std::sync::Mutex::new(Vec::new())),
            results: Vec::new(),
            started_at: Some(chrono::Utc::now().to_rfc3339()),
            finished_at: None,
            message: None,
        });
    }

    let snapshot = service
        .start_or_get(
            Vec::new(),
            PathBuf::from("/tmp/anyharness-test"),
            false,
            false,
            Vec::new(),
            None,
            None,
        )
        .await
        .expect("covered request reuses active job");

    assert_eq!(snapshot.job_id.as_deref(), Some("existing-job"));
    assert_eq!(snapshot.status, AgentReconcileJobStatus::Running);
    assert!(!snapshot.reinstall);
    assert_eq!(snapshot.current_agent, Some(AgentKind::Codex));
}

#[tokio::test]
async fn reinstall_request_is_rejected_while_non_reinstall_job_runs() {
    let service = AgentReconcileService::new();
    {
        let mut job = service.job.lock().await;
        *job = Some(AgentReconcileJob {
            job_id: "non-reinstall-job".into(),
            status: AgentReconcileJobStatus::Running,
            reinstall: false,
            installed_only: false,
            current_agent: Some(AgentKind::Codex),
            agent_kinds: Vec::new(),
            components: Arc::new(std::sync::Mutex::new(Vec::new())),
            results: Vec::new(),
            started_at: Some(chrono::Utc::now().to_rfc3339()),
            finished_at: None,
            message: None,
        });
    }

    let error = service
        .start_or_get(
            Vec::new(),
            PathBuf::from("/tmp/anyharness-reinstall-supersede"),
            true,
            false,
            vec![AgentKind::Codex],
            None,
            None,
        )
        .await
        .expect_err("incompatible reinstall must not hide the active job");

    assert!(matches!(error, AgentReconcileStartError::Busy(job) if job == "non-reinstall-job"));
    assert_eq!(
        service.snapshot().await.job_id.as_deref(),
        Some("non-reinstall-job")
    );
}

#[test]
fn component_progress_keeps_bytes_monotonic_and_preserves_total() {
    let descriptor = crate::domains::agents::registry::built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Codex)
        .expect("codex descriptor");
    let progress = Arc::new(std::sync::Mutex::new(progress_components(&[descriptor])));

    apply_progress_update(
        &progress,
        &AgentKind::Codex,
        InstallProgressUpdate {
            role: ArtifactRole::NativeCli,
            phase: InstallProgressPhase::Downloading,
            downloaded_bytes: 10,
            download_size_bytes: Some(100),
        },
    );
    apply_progress_update(
        &progress,
        &AgentKind::Codex,
        InstallProgressUpdate {
            role: ArtifactRole::NativeCli,
            phase: InstallProgressPhase::Verifying,
            downloaded_bytes: 5,
            download_size_bytes: None,
        },
    );
    finish_agent_components(
        &progress,
        &AgentKind::Codex,
        InstallProgressPhase::Completed,
    );

    let components = progress.lock().expect("progress lock");
    let native = components
        .iter()
        .find(|component| component.role == ArtifactRole::NativeCli)
        .expect("native component");
    assert_eq!(native.downloaded_bytes, 10);
    assert_eq!(native.download_size_bytes, Some(100));
    assert_eq!(native.phase, InstallProgressPhase::Completed);
}

#[tokio::test]
async fn empty_registry_job_completes() {
    let service = AgentReconcileService::new();

    let snapshot = service
        .start_or_get(
            Vec::new(),
            PathBuf::from("/tmp/anyharness-empty"),
            true,
            false,
            Vec::new(),
            None,
            None,
        )
        .await
        .expect("start empty reconcile");
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

#[tokio::test]
async fn reconcile_job_remains_queued_while_another_disk_writer_runs() {
    let service = AgentReconcileService::new();
    let writer = service.execution_lock.clone().lock_owned().await;

    service
        .start_or_get(
            Vec::new(),
            PathBuf::from("/tmp/anyharness-serialized"),
            true,
            false,
            vec![AgentKind::Codex],
            None,
            None,
        )
        .await
        .expect("queue serialized reconcile");
    sleep(Duration::from_millis(25)).await;
    assert_eq!(
        service.snapshot().await.status,
        AgentReconcileJobStatus::Queued
    );

    drop(writer);
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
    .expect("queued reconcile should run after the writer releases the lock");
    assert!(completed.finished_at.is_some());
}

#[tokio::test]
async fn installed_only_skips_uninstalled_agents() {
    // In a fresh empty runtime home no agent_process (ACP adapter) is installed —
    // those are managed-only, never on system PATH — so installed-only reconcile must
    // SKIP every agent and never attempt a (network) install.
    let service = AgentReconcileService::new();
    let home = std::env::temp_dir().join(format!("anyharness-installed-only-{}", Uuid::new_v4()));
    let registry = crate::domains::agents::registry::built_in_registry();
    assert!(!registry.is_empty(), "built-in registry must have agents");

    service
        .start_or_get(registry, home.clone(), false, true, Vec::new(), None, None)
        .await
        .expect("start installed-only reconcile");

    let completed = timeout(Duration::from_secs(5), async {
        loop {
            let snapshot = service.snapshot().await;
            if snapshot.status == AgentReconcileJobStatus::Completed {
                return snapshot;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("installed-only reconcile should complete without network installs");

    assert!(
        completed
            .results
            .iter()
            .all(|result| result.outcome == AgentReconcileOutcome::Skipped),
        "installed_only must skip agents with no installed agent_process; got {:?}",
        completed
            .results
            .iter()
            .map(|result| (result.kind.as_str(), result.outcome.clone()))
            .collect::<Vec<_>>()
    );
    let _ = std::fs::remove_dir_all(&home);
}

#[tokio::test]
async fn full_reconcile_is_rejected_while_installed_only_job_runs() {
    let service = AgentReconcileService::new();
    {
        let mut job = service.job.lock().await;
        *job = Some(AgentReconcileJob {
            job_id: "startup-installed-only".into(),
            status: AgentReconcileJobStatus::Running,
            reinstall: false,
            installed_only: true,
            current_agent: None,
            agent_kinds: Vec::new(),
            components: Arc::new(std::sync::Mutex::new(Vec::new())),
            results: Vec::new(),
            started_at: Some(chrono::Utc::now().to_rfc3339()),
            finished_at: None,
            message: None,
        });
    }

    let error = service
        .start_or_get(
            Vec::new(),
            PathBuf::from("/tmp/anyharness-supersede"),
            false,
            false, // full scope
            Vec::new(),
            None,
            None,
        )
        .await
        .expect_err("incompatible full request must not hide startup progress");

    assert!(matches!(
        error,
        AgentReconcileStartError::Busy(job) if job == "startup-installed-only"
    ));
    assert_eq!(
        service.snapshot().await.job_id.as_deref(),
        Some("startup-installed-only")
    );
}

#[tokio::test]
async fn installed_only_reuses_in_flight_installed_only_job() {
    // Startup-style coalescing still holds: an installed-only request reuses
    // a running installed-only job.
    let service = AgentReconcileService::new();
    {
        let mut job = service.job.lock().await;
        *job = Some(AgentReconcileJob {
            job_id: "running-installed-only".into(),
            status: AgentReconcileJobStatus::Running,
            reinstall: false,
            installed_only: true,
            current_agent: None,
            agent_kinds: Vec::new(),
            components: Arc::new(std::sync::Mutex::new(Vec::new())),
            results: Vec::new(),
            started_at: Some(chrono::Utc::now().to_rfc3339()),
            finished_at: None,
            message: None,
        });
    }

    let snapshot = service
        .start_or_get(
            Vec::new(),
            PathBuf::from("/tmp/anyharness-reuse"),
            false,
            true, // installed-only scope
            Vec::new(),
            None,
            None,
        )
        .await
        .expect("covered installed-only request reuses active job");

    assert_eq!(snapshot.job_id.as_deref(), Some("running-installed-only"));
}
