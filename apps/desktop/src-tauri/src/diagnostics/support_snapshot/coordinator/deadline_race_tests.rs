use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::time::Duration;

use super::super::artifact_store::SupportArtifactStore;
use super::super::schema::enums::SupportSessionOmissionReasonV1;
use super::super::schema::model::manifest::SupportSessionCollectionManifestV1;
use super::control::{PreparationControl, PreparationInterruption};
use super::finish::{check_finish, FinishError, FinishResult};
use super::lifecycle_tests::assert_lifecycle_pair;
use super::model::{
    CancelSupportSnapshotInput, FinishSupportSnapshotInput, PreparedSupportSnapshotOutput,
    PreparedSupportSnapshotSummaryOutput,
};
use super::runtime::CoordinatorRuntime;
use super::state::PreparationPhase;
use super::tests::{
    begin_input, insert_awaiting_preparation, reference, test_coordinator, FakeRuntime,
};

#[tokio::test]
async fn elapsed_deadline_beats_an_unpolled_explicit_cancel() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, _, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;

    runtime.advance(Duration::from_secs(25));
    coordinator
        .cancel_preparation(CancelSupportSnapshotInput {
            client_job_id: begin_input().client_job_id,
            consent_epoch: "epoch-1".to_string(),
            preparation_id: Some(preparation_id),
        })
        .await
        .expect("idempotent cancellation command");

    assert_eq!(control.interruption(), PreparationInterruption::Deadline);
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
}

#[tokio::test]
async fn elapsed_deadline_beats_an_unpolled_shutdown() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, _, _) = insert_awaiting_preparation(&coordinator, &runtime).await;

    runtime.advance(Duration::from_secs(25));
    coordinator.cancel_support().await;

    assert_eq!(control.interruption(), PreparationInterruption::Deadline);
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
}

#[tokio::test]
async fn elapsed_published_finish_deadline_beats_explicit_cancel() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, _, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    {
        let mut state = coordinator.state.lock().await;
        let open = state.preparation.as_mut().expect("admitted preparation");
        open.phase = PreparationPhase::Finishing;
        open.deadline = runtime.instant_now() + Duration::from_secs(10);
    }

    runtime.advance(Duration::from_secs(10));
    coordinator
        .cancel_preparation(CancelSupportSnapshotInput {
            client_job_id: begin_input().client_job_id,
            consent_epoch: "epoch-1".to_string(),
            preparation_id: Some(preparation_id),
        })
        .await
        .expect("idempotent cancellation command");

    assert_eq!(control.interruption(), PreparationInterruption::Deadline);
}

#[tokio::test]
async fn elapsed_published_finish_deadline_beats_shutdown() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, _, _) = insert_awaiting_preparation(&coordinator, &runtime).await;
    {
        let mut state = coordinator.state.lock().await;
        let open = state.preparation.as_mut().expect("admitted preparation");
        open.phase = PreparationPhase::Finishing;
        open.deadline = runtime.instant_now() + Duration::from_secs(10);
    }

    runtime.advance(Duration::from_secs(10));
    coordinator.cancel_support().await;

    assert_eq!(control.interruption(), PreparationInterruption::Deadline);
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
}

#[tokio::test]
async fn finish_watchdog_owns_a_detached_success_until_work_is_idle() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, _, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    let deadline = runtime.instant_now() + Duration::from_secs(10);
    coordinator
        .state
        .lock()
        .await
        .preparation
        .as_mut()
        .expect("admitted preparation")
        .phase = PreparationPhase::Finishing;
    let active_finish = control.begin_work();
    super::watchdog::spawn_preparation_watchdog(
        &coordinator,
        preparation_id,
        deadline,
        Arc::clone(&control),
    );
    let reference = reference();
    control.finish_completion().publish(Ok(FinishResult {
        output: PreparedSupportSnapshotOutput {
            artifact_schema_version: 3,
            artifact_id: reference.artifact_id.clone(),
            snapshot_id: reference.snapshot_id.clone(),
            preparation_operation_id: uuid::Uuid::from_u128(11).to_string(),
            generated_at: "2026-08-12T00:00:00Z".to_string(),
            size_bytes: reference.size_bytes,
            sha256: reference.sha256.clone(),
            summary: PreparedSupportSnapshotSummaryOutput {
                collector_records: 0,
                fallback_records: 0,
                sessions: 0,
                omissions: 0,
                truncations: 0,
            },
        },
        reference,
    }));

    runtime.advance(Duration::from_secs(10));
    for _ in 0..64 {
        if control.interruption() != PreparationInterruption::Running {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert_eq!(control.interruption(), PreparationInterruption::Deadline);
    let closing = wait_for_closing(&coordinator).await;
    assert!(coordinator.state.lock().await.preparation.is_none());
    drop(active_finish);
    tokio::time::timeout(Duration::from_secs(1), closing.wait_completed())
        .await
        .expect("closing owner became idle and completed");
    assert!(coordinator.state.lock().await.preparation.is_none());
    for _ in 0..64 {
        if coordinator.producer.support_lifecycle_snapshot().len() >= 2 {
            break;
        }
        tokio::task::yield_now().await;
    }

    assert!(control.finish_completion().claim_cleanup().is_none());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
}

#[cfg(unix)]
#[tokio::test]
async fn final_publication_lock_rechecks_the_effective_deadline_before_authorization() {
    let (root, store) = ready_store("publication-deadline");
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_finish_publication();
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let (control, _, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    coordinator
        .state
        .lock()
        .await
        .preparation
        .as_mut()
        .expect("preparation")
        .captured = Some(super::test_support::empty_capture("2026-08-12T00:00:00Z"));

    let finish = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        async move {
            coordinator
                .finish_preparation(finish_input(preparation_id))
                .await
        }
    });
    tokio::time::timeout(Duration::from_secs(1), runtime.wait_finish_publication())
        .await
        .expect("finisher reached publication boundary");

    let state_guard = coordinator.state.lock().await;
    runtime.release_finish_publication();
    tokio::task::yield_now().await;
    runtime.advance(Duration::from_secs(10));
    tokio::task::yield_now().await;
    drop(state_guard);

    let error = finish
        .await
        .expect("finish task")
        .expect_err("hard deadline wins");
    assert_eq!(error, "support_snapshot_preparation_timeout");
    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none());
    assert!(state.closing_preparation.is_none());
    assert!(state.artifacts.is_empty());
    drop(state);
    assert_eq!(control.active_work(), 0);
    let artifact_id =
        SupportArtifactStore::artifact_id(&begin_input().client_job_id).expect("artifact id");
    assert!(!store.root().join(format!("{artifact_id}.json")).exists());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn command_finish_timer_retains_cleanup_owner_after_finish_future_is_dropped() {
    let (root, store) = ready_store("detached-command-timer");
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_finish_result();
    runtime.pause_watchdog_deadlines();
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let (control, _, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    coordinator
        .state
        .lock()
        .await
        .preparation
        .as_mut()
        .expect("preparation")
        .captured = Some(super::test_support::empty_capture("2026-08-12T00:00:00Z"));

    let finish = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        async move {
            coordinator
                .finish_preparation(finish_input(preparation_id))
                .await
        }
    });
    tokio::time::timeout(Duration::from_secs(1), runtime.wait_finish_result())
        .await
        .expect("blocking result withheld after staging");
    let artifact_id =
        SupportArtifactStore::artifact_id(&begin_input().client_job_id).expect("artifact id");
    let artifact_path = store.root().join(format!("{artifact_id}.json"));
    assert!(artifact_path.exists());

    runtime.advance(Duration::from_secs(10));
    tokio::time::timeout(Duration::from_secs(1), runtime.wait_finish_timer())
        .await
        .expect("command-local timer fired first");
    let closing = wait_for_closing(&coordinator).await;
    finish.abort();
    let _ = finish.await;
    runtime.release_finish_result();
    tokio::time::timeout(Duration::from_secs(1), closing.wait_completed())
        .await
        .expect("coordinator-owned closing completed");

    assert_eq!(control.active_work(), 0);
    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none());
    assert!(state.closing_preparation.is_none());
    assert!(state.artifacts.is_empty());
    drop(state);
    assert!(!artifact_path.exists());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn blocking_finish_commits_an_observed_deadline_before_later_cancel() {
    let runtime = FakeRuntime::new();
    let control = PreparationControl::new();
    let deadline = runtime.instant_now() + Duration::from_secs(10);
    runtime.advance(Duration::from_secs(10));

    assert_eq!(
        check_finish(&control, deadline, &runtime),
        Err(FinishError::Deadline)
    );
    assert!(!control.request(PreparationInterruption::Cancelled));
    assert_eq!(control.interruption(), PreparationInterruption::Deadline);
}

fn finish_input(preparation_id: String) -> FinishSupportSnapshotInput {
    FinishSupportSnapshotInput {
        preparation_id,
        consent_epoch: "epoch-1".to_string(),
        session_evidence_json: None,
        session_collection: SupportSessionCollectionManifestV1::Omitted {
            reason: SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
        },
    }
}

async fn wait_for_closing(
    coordinator: &Arc<super::SupportSnapshotCoordinator>,
) -> Arc<super::state::ClosingPreparation> {
    for _ in 0..128 {
        if let Some(closing) = coordinator.state.lock().await.closing_preparation.clone() {
            return closing;
        }
        tokio::task::yield_now().await;
    }
    panic!("preparation transferred to closing registry");
}

#[cfg(unix)]
fn ready_store(prefix: &str) -> (std::path::PathBuf, Arc<SupportArtifactStore>) {
    use std::os::unix::fs::PermissionsExt;

    let root = std::env::temp_dir().join(format!("pr6-{prefix}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).expect("app root");
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).expect("app root mode");
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    store
        .reconcile(
            &[],
            &[],
            std::time::Instant::now() + std::time::Duration::from_secs(1),
        )
        .expect("store ready");
    (root, store)
}
