#![cfg(unix)]

use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

use super::fake_runtime::FakeRuntime;
use super::finalizer_fence_tests::{
    assert_only_started, ready_store, spawn_shutdown, wait_for_shutdown_arm,
};
use super::lifecycle_tests::assert_lifecycle_operation;
use super::state::{PreparationCleanup, PreparationPhase, PreparationTerminal, ReadinessState};
use super::tests::{begin_input, test_coordinator};
use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::SupportSnapshotPreparationFailureClassificationV1 as Failure;

#[tokio::test]
async fn invalid_capture_finalizer_remains_visible_to_every_shutdown_until_rejection() {
    let (root, store) = ready_store("invalid-capture-finalizer");
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_invalid_capture_result();
    runtime.pause_preparation_terminal();
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    coordinator.state.lock().await.readiness = ReadinessState::Ready;
    let input = begin_input();
    let job_item_id = input.client_job_id.clone();

    let begin = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        async move { coordinator.begin_preparation(input).await }
    });
    runtime.wait_invalid_capture_result().await;
    let (control, operation, operation_id) = {
        let state = coordinator.state.lock().await;
        let open = state.preparation.as_ref().expect("admitted capture");
        assert_eq!(open.phase, PreparationPhase::Capturing);
        assert!(open.captured.is_none());
        let operation_id = open
            .operation
            .lock()
            .expect("operation")
            .as_ref()
            .expect("admitted operation")
            .operation_id()
            .to_string();
        (
            Arc::clone(&open.control),
            Arc::clone(&open.operation),
            operation_id,
        )
    };
    assert!(control.active_work() > 0);

    runtime.release_invalid_capture_result();
    runtime.wait_preparation_terminal().await;
    let closing = {
        let state = coordinator.state.lock().await;
        assert!(state.preparation.is_none());
        assert!(state.artifacts.is_empty());
        assert!(state.read_proofs.is_empty());
        state
            .closing_preparation
            .clone()
            .expect("invalid capture closing owner")
    };
    assert!(Arc::ptr_eq(&control, &closing.control));
    assert!(Arc::ptr_eq(&operation, &closing.operation));
    assert_eq!(closing.control.active_work(), 0);
    assert_eq!(closing.cleanup, PreparationCleanup::None);
    assert_eq!(
        closing.terminal,
        PreparationTerminal::Failed(Failure::PreparationRejected)
    );
    assert!(operation.lock().expect("operation").is_some());
    assert!(!store
        .root()
        .join(format!("{}.json", closing.artifact_id))
        .exists());
    assert_only_started(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &operation_id,
    );

    let mut second_input = begin_input();
    second_input.client_job_id = uuid::Uuid::from_u128(71).to_string();
    second_input.consent_epoch = "epoch-2".to_string();
    assert_eq!(
        coordinator
            .begin_preparation(second_input)
            .await
            .expect_err("closing capture blocks new admission"),
        "support_snapshot_preparation_busy"
    );

    let first = spawn_shutdown(&coordinator);
    let second = spawn_shutdown(&coordinator);
    wait_for_shutdown_arm(&coordinator).await;
    assert!(!begin.is_finished());
    assert!(!first.is_finished());
    assert!(!second.is_finished());

    runtime.release_preparation_terminal();
    assert_eq!(
        begin
            .await
            .expect("begin task")
            .expect_err("invalid capture is rejected"),
        "support_snapshot_preparation_rejected"
    );
    first.await.expect("first shutdown");
    second.await.expect("second shutdown");

    let state = coordinator.state.lock().await;
    assert!(state.closing_preparation.is_none());
    assert!(state.artifacts.is_empty());
    assert!(state.read_proofs.is_empty());
    drop(state);
    assert!(operation.lock().expect("operation").is_none());
    assert_lifecycle_operation(
        &coordinator,
        "desktop.support_snapshot.prepare",
        Some(&operation_id),
        &job_item_id,
        None,
        TerminalOutcomeV1::Rejected,
        Some("preparation_rejected"),
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}
