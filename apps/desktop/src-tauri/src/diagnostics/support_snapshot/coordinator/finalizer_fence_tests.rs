#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::{LifecyclePhaseV1, TerminalOutcomeV1};
use tokio::time::Duration;

use super::super::artifact_store::SupportArtifactStore;
use super::fake_runtime::FakeRuntime;
use super::lifecycle_tests::assert_lifecycle_operation;
use super::model::{
    BeginSupportSnapshotSubmissionInput, CancelSupportSnapshotInput,
    DeleteStagedSupportSnapshotInput, FinishSupportSnapshotInput,
    FinishSupportSnapshotSubmissionInput, SubmissionFailedClassificationInput,
};
use super::runtime::CoordinatorRuntime;
use super::state::{ArtifactAuthorization, ReadVerificationProof, ReadinessState};
use super::tests::{begin_input, insert_awaiting_preparation, reference, test_coordinator};
use super::SupportSnapshotCoordinator;
use crate::diagnostics::support_snapshot::schema::enums::SupportSessionOmissionReasonV1;
use crate::diagnostics::support_snapshot::schema::model::manifest::SupportSessionCollectionManifestV1;

#[tokio::test]
async fn manifest_finalizer_remains_visible_to_every_shutdown_until_exact_terminal() {
    let (root, store) = ready_store("manifest-finalizer");
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_preparation_terminal();
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let (control, operation, preparation_id) =
        insert_awaiting_preparation(&coordinator, &runtime).await;
    let operation_id = operation
        .lock()
        .expect("operation")
        .as_ref()
        .expect("admitted operation")
        .operation_id()
        .to_string();
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
                .finish_preparation(FinishSupportSnapshotInput {
                    preparation_id,
                    consent_epoch: "epoch-1".to_string(),
                    session_evidence_json: Some("{}".to_string()),
                    session_collection: omitted_session_collection(),
                })
                .await
        }
    });
    runtime.wait_preparation_terminal().await;
    {
        let state = coordinator.state.lock().await;
        assert!(state.preparation.is_none());
        assert!(state.closing_preparation.is_some());
        assert!(state.artifacts.is_empty());
        assert!(state.read_proofs.is_empty());
    }
    assert_eq!(control.active_work(), 0);
    assert!(operation.lock().expect("operation").is_some());
    assert_only_started(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &operation_id,
    );

    let first = spawn_shutdown(&coordinator);
    let second = spawn_shutdown(&coordinator);
    wait_for_shutdown_arm(&coordinator).await;
    assert!(!finish.is_finished());
    assert!(!first.is_finished());
    assert!(!second.is_finished());

    runtime.release_preparation_terminal();
    assert_eq!(
        finish
            .await
            .expect("finish task")
            .expect_err("manifest is invalid"),
        "support_snapshot_manifest_invalid"
    );
    first.await.expect("first shutdown");
    second.await.expect("second shutdown");

    let state = coordinator.state.lock().await;
    assert!(state.closing_preparation.is_none());
    assert!(state.artifacts.is_empty());
    assert!(state.read_proofs.is_empty());
    drop(state);
    assert_lifecycle_operation(
        &coordinator,
        "desktop.support_snapshot.prepare",
        Some(&operation_id),
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Failed,
        Some("manifest_invalid"),
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn missing_capture_finalizer_remains_visible_to_every_shutdown_until_rejection() {
    let (root, store) = ready_store("missing-capture-finalizer");
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_preparation_terminal();
    let coordinator = test_coordinator(Some(store), Arc::clone(&runtime));
    let (_, operation, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    let operation_id = operation
        .lock()
        .expect("operation")
        .as_ref()
        .expect("admitted operation")
        .operation_id()
        .to_string();

    let finish = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        async move {
            coordinator
                .finish_preparation(FinishSupportSnapshotInput {
                    preparation_id,
                    consent_epoch: "epoch-1".to_string(),
                    session_evidence_json: None,
                    session_collection: omitted_session_collection(),
                })
                .await
        }
    });
    runtime.wait_preparation_terminal().await;
    {
        let state = coordinator.state.lock().await;
        assert!(state.preparation.is_none());
        assert!(state.closing_preparation.is_some());
        assert!(state.artifacts.is_empty());
        assert!(state.read_proofs.is_empty());
    }
    assert!(operation.lock().expect("operation").is_some());
    assert_only_started(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &operation_id,
    );

    let first = spawn_shutdown(&coordinator);
    let second = spawn_shutdown(&coordinator);
    wait_for_shutdown_arm(&coordinator).await;
    assert!(!finish.is_finished());
    assert!(!first.is_finished());
    assert!(!second.is_finished());

    runtime.release_preparation_terminal();
    assert_eq!(
        finish
            .await
            .expect("finish task")
            .expect_err("missing capture is rejected"),
        "support_snapshot_preparation_rejected"
    );
    first.await.expect("first shutdown");
    second.await.expect("second shutdown");

    assert!(coordinator.state.lock().await.closing_preparation.is_none());
    assert_lifecycle_operation(
        &coordinator,
        "desktop.support_snapshot.prepare",
        Some(&operation_id),
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Rejected,
        Some("preparation_rejected"),
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn successful_finalizer_stays_visible_until_shutdown_observes_terminal_and_cleanup() {
    let (root, store) = ready_store("successful-finalizer");
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_preparation_terminal();
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let (_, operation, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    let operation_id = operation
        .lock()
        .expect("operation")
        .as_ref()
        .expect("admitted operation")
        .operation_id()
        .to_string();
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
                .finish_preparation(FinishSupportSnapshotInput {
                    preparation_id,
                    consent_epoch: "epoch-1".to_string(),
                    session_evidence_json: None,
                    session_collection: omitted_session_collection(),
                })
                .await
        }
    });
    runtime.wait_preparation_terminal().await;
    let artifact_id =
        SupportArtifactStore::artifact_id(&begin_input().client_job_id).expect("artifact identity");
    assert!(coordinator
        .state
        .lock()
        .await
        .artifacts
        .contains_key(&artifact_id));
    assert_only_started(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &operation_id,
    );

    let first = spawn_shutdown(&coordinator);
    let second = spawn_shutdown(&coordinator);
    wait_for_shutdown_arm(&coordinator).await;
    assert!(!finish.is_finished() && !first.is_finished() && !second.is_finished());

    runtime.release_preparation_terminal();
    let output = finish
        .await
        .expect("finish task")
        .expect("prepared artifact");
    assert_eq!(output.artifact_id, artifact_id);
    first.await.expect("first shutdown");
    second.await.expect("second shutdown");

    let state = coordinator.state.lock().await;
    assert!(state.closing_preparation.is_none());
    assert!(state.artifacts.is_empty());
    drop(state);
    assert!(!store.root().join(format!("{artifact_id}.json")).exists());
    assert_lifecycle_operation(
        &coordinator,
        "desktop.support_snapshot.prepare",
        Some(&operation_id),
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Succeeded,
        None,
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn classified_stage_failure_preserves_a_previously_authorized_artifact() {
    let (root, store) = ready_store("stage-preserves-authorized");
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let existing = store
        .stage(
            &begin_input().client_job_id,
            &uuid::Uuid::from_u128(90).to_string(),
            &uuid::Uuid::from_u128(91).to_string(),
            b"existing-authorized-artifact",
        )
        .expect("existing artifact");
    let existing = super::model::reference_from_stored(&existing);
    {
        let mut state = coordinator.state.lock().await;
        state.artifacts.insert(
            existing.artifact_id.clone(),
            ArtifactAuthorization {
                reference: existing.clone(),
                preparation_id: None,
                preparation_operation_id: None,
                consent_epoch: None,
            },
        );
        state.read_proofs.insert(
            existing.artifact_id.clone(),
            ReadVerificationProof {
                reference: existing.clone(),
                expires_at: runtime.instant_now() + Duration::from_secs(30),
            },
        );
    }
    let (_, operation, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    let operation_id = operation
        .lock()
        .expect("operation")
        .as_ref()
        .expect("admitted operation")
        .operation_id()
        .to_string();
    coordinator
        .state
        .lock()
        .await
        .preparation
        .as_mut()
        .expect("preparation")
        .captured = Some(super::test_support::empty_capture("2026-08-12T00:00:00Z"));

    let error = coordinator
        .finish_preparation(FinishSupportSnapshotInput {
            preparation_id,
            consent_epoch: "epoch-1".to_string(),
            session_evidence_json: None,
            session_collection: omitted_session_collection(),
        })
        .await
        .expect_err("existing final prevents replacement");

    assert_eq!(error, "support_snapshot_stage_failed");
    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none());
    assert!(state.closing_preparation.is_none());
    assert_eq!(
        state
            .artifacts
            .get(&existing.artifact_id)
            .map(|item| &item.reference),
        Some(&existing)
    );
    assert_eq!(
        state
            .read_proofs
            .get(&existing.artifact_id)
            .map(|item| &item.reference),
        Some(&existing)
    );
    drop(state);
    assert!(store
        .root()
        .join(format!("{}.json", existing.artifact_id))
        .exists());
    assert_lifecycle_operation(
        &coordinator,
        "desktop.support_snapshot.prepare",
        Some(&operation_id),
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Failed,
        Some("stage_failed"),
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn interrupted_preparation_preserves_a_different_authorized_artifact() {
    let (root, store) = ready_store("cancel-preserves-authorized");
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let existing = store
        .stage(
            &begin_input().client_job_id,
            &uuid::Uuid::from_u128(92).to_string(),
            &uuid::Uuid::from_u128(93).to_string(),
            b"existing-authorized-artifact",
        )
        .expect("existing artifact");
    let existing = super::model::reference_from_stored(&existing);
    {
        let mut state = coordinator.state.lock().await;
        state.artifacts.insert(
            existing.artifact_id.clone(),
            ArtifactAuthorization {
                reference: existing.clone(),
                preparation_id: None,
                preparation_operation_id: None,
                consent_epoch: None,
            },
        );
        state.read_proofs.insert(
            existing.artifact_id.clone(),
            ReadVerificationProof {
                reference: existing.clone(),
                expires_at: runtime.instant_now() + Duration::from_secs(30),
            },
        );
    }
    let (_, operation, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;

    coordinator
        .cancel_preparation(CancelSupportSnapshotInput {
            client_job_id: begin_input().client_job_id,
            consent_epoch: "epoch-1".to_string(),
            preparation_id: Some(preparation_id),
        })
        .await
        .expect("preparation cancellation");

    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none());
    assert!(state.closing_preparation.is_none());
    assert_eq!(
        state
            .artifacts
            .get(&existing.artifact_id)
            .map(|item| &item.reference),
        Some(&existing)
    );
    assert_eq!(
        state
            .read_proofs
            .get(&existing.artifact_id)
            .map(|item| &item.reference),
        Some(&existing)
    );
    drop(state);
    assert!(store
        .root()
        .join(format!("{}.json", existing.artifact_id))
        .exists());
    assert!(operation.lock().expect("operation").is_none());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn submission_finalizer_remains_visible_to_every_shutdown_until_exact_terminal() {
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_submission_terminal();
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let reference = reference();
    let parent_operation_id = uuid::Uuid::from_u128(11).to_string();
    {
        let mut state = coordinator.state.lock().await;
        state.readiness = ReadinessState::Ready;
        state.artifacts.insert(
            reference.artifact_id.clone(),
            ArtifactAuthorization {
                reference: reference.clone(),
                preparation_id: Some(uuid::Uuid::from_u128(9).to_string()),
                preparation_operation_id: Some(parent_operation_id.clone()),
                consent_epoch: None,
            },
        );
        state.read_proofs.insert(
            reference.artifact_id.clone(),
            ReadVerificationProof {
                reference: reference.clone(),
                expires_at: runtime.instant_now() + Duration::from_secs(30),
            },
        );
    }
    let begun = coordinator
        .begin_submission(BeginSupportSnapshotSubmissionInput {
            artifact_id: reference.artifact_id.clone(),
            client_job_id: reference.client_job_id.clone(),
            attempt: 1,
            parent_operation_id: parent_operation_id.clone(),
        })
        .await
        .expect("submission admission");
    let submission_id = begun.submission_id.clone();
    let finish = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        async move {
            coordinator
                .finish_submission(FinishSupportSnapshotSubmissionInput::Failed {
                    submission_id,
                    error_classification: SubmissionFailedClassificationInput::Transient,
                    report_id: None,
                })
                .await
        }
    });
    runtime.wait_submission_terminal().await;
    let closing = {
        let state = coordinator.state.lock().await;
        assert!(state.submission.is_none());
        state
            .closing_submission
            .clone()
            .expect("submission closing owner")
    };
    assert!(closing.operation.lock().expect("operation").is_some());
    assert_only_started(
        &coordinator,
        "desktop.support_snapshot.submit",
        &begun.operation_id,
    );
    assert_eq!(
        coordinator
            .delete_artifact(DeleteStagedSupportSnapshotInput {
                artifact_id: reference.artifact_id.clone(),
            })
            .await
            .expect_err("closing submission retains artifact ownership"),
        "support_snapshot_submission_busy"
    );

    let first = spawn_shutdown(&coordinator);
    let second = spawn_shutdown(&coordinator);
    wait_for_shutdown_arm(&coordinator).await;
    assert!(!finish.is_finished());
    assert!(!first.is_finished());
    assert!(!second.is_finished());

    runtime.release_submission_terminal();
    finish
        .await
        .expect("finish task")
        .expect("submission terminal");
    first.await.expect("first shutdown");
    second.await.expect("second shutdown");

    assert!(coordinator.state.lock().await.closing_submission.is_none());
    assert!(closing.operation.lock().expect("operation").is_none());
    assert_lifecycle_operation(
        &coordinator,
        "desktop.support_snapshot.submit",
        Some(&begun.operation_id),
        &reference.client_job_id,
        Some(&parent_operation_id),
        TerminalOutcomeV1::Failed,
        Some("transient"),
        Some(1),
    );
}

fn omitted_session_collection() -> SupportSessionCollectionManifestV1 {
    SupportSessionCollectionManifestV1::Omitted {
        reason: SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
    }
}

fn assert_only_started(coordinator: &SupportSnapshotCoordinator, name: &str, operation_id: &str) {
    let records = coordinator
        .producer
        .support_lifecycle_snapshot()
        .into_iter()
        .filter(|record| record.name == name && record.operation_id == operation_id)
        .collect::<Vec<_>>();
    assert_eq!(records.len(), 1, "terminal must remain gated");
    assert_eq!(
        records[0].lifecycle.as_ref().map(|value| value.phase),
        Some(LifecyclePhaseV1::Started)
    );
}

fn spawn_shutdown(coordinator: &Arc<SupportSnapshotCoordinator>) -> tokio::task::JoinHandle<()> {
    let coordinator = Arc::clone(coordinator);
    tokio::spawn(async move {
        coordinator.cancel_support().await;
    })
}

async fn wait_for_shutdown_arm(coordinator: &Arc<SupportSnapshotCoordinator>) {
    for _ in 0..128 {
        if coordinator.state.lock().await.shutdown_armed {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("shutdown reached support cancellation");
}

fn ready_store(prefix: &str) -> (std::path::PathBuf, Arc<SupportArtifactStore>) {
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
