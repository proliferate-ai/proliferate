use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::time::Duration;

use super::control::{PreparationControl, PreparationInterruption};
use super::finish::{check_finish, FinishError, FinishResult};
use super::lifecycle_tests::assert_lifecycle_pair;
use super::model::{
    CancelSupportSnapshotInput, PreparedSupportSnapshotOutput, PreparedSupportSnapshotSummaryOutput,
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
    assert!(coordinator.state.lock().await.preparation.is_some());
    drop(active_finish);
    tokio::time::timeout(Duration::from_secs(1), control.wait_idle())
        .await
        .expect("watchdogs became idle");
    for _ in 0..64 {
        if coordinator.state.lock().await.preparation.is_none() {
            break;
        }
        tokio::task::yield_now().await;
    }
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
