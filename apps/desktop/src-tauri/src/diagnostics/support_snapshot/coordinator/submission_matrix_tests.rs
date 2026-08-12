use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::time::Duration;

use super::lifecycle_tests::assert_lifecycle_operation;
use super::model::{
    BeginSupportSnapshotSubmissionInput, FinishSupportSnapshotSubmissionInput as Finish,
    SubmissionFailedClassificationInput, SubmissionRejectedClassificationInput,
    UploadTimeoutClassificationInput,
};
use super::runtime::CoordinatorRuntime;
use super::state::{ArtifactAuthorization, ReadVerificationProof, ReadinessState};
use super::tests::{reference, test_coordinator, FakeRuntime};

#[tokio::test]
async fn every_admitted_submission_has_exact_correlation_and_one_terminal() {
    let runtime = Arc::new(FakeRuntime::new());
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
    }

    for case in 0..6_u64 {
        coordinator.state.lock().await.read_proofs.insert(
            reference.artifact_id.clone(),
            ReadVerificationProof {
                reference: reference.clone(),
                expires_at: runtime.instant_now() + Duration::from_secs(30),
            },
        );
        let attempt = case + 1;
        let begun = coordinator
            .begin_submission(BeginSupportSnapshotSubmissionInput {
                artifact_id: reference.artifact_id.clone(),
                client_job_id: reference.client_job_id.clone(),
                attempt,
                parent_operation_id: parent_operation_id.clone(),
            })
            .await
            .expect("submission admission");
        let (finish, outcome, classification) = terminal_case(case, &begun.submission_id);
        coordinator
            .finish_submission(finish)
            .await
            .expect("submission terminal");
        assert_lifecycle_operation(
            &coordinator,
            "desktop.support_snapshot.submit",
            Some(&begun.operation_id),
            &reference.client_job_id,
            Some(&parent_operation_id),
            outcome,
            classification,
            Some(attempt),
        );
    }
}

#[tokio::test]
async fn shutdown_abandons_an_admitted_submission_with_original_correlation() {
    let runtime = Arc::new(FakeRuntime::new());
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

    coordinator.cancel_support().await;

    assert_lifecycle_operation(
        &coordinator,
        "desktop.support_snapshot.submit",
        Some(&begun.operation_id),
        &reference.client_job_id,
        Some(&parent_operation_id),
        TerminalOutcomeV1::Abandoned,
        None,
        Some(1),
    );
}

fn terminal_case(
    case: u64,
    submission_id: &str,
) -> (Finish, TerminalOutcomeV1, Option<&'static str>) {
    let submission_id = submission_id.to_string();
    match case {
        0 => (
            Finish::Succeeded {
                submission_id,
                report_id: None,
            },
            TerminalOutcomeV1::Succeeded,
            None,
        ),
        1 => (
            Finish::Cancelled {
                submission_id,
                report_id: None,
            },
            TerminalOutcomeV1::Cancelled,
            None,
        ),
        2 => (
            Finish::Abandoned {
                submission_id,
                report_id: None,
            },
            TerminalOutcomeV1::Abandoned,
            None,
        ),
        3 => (
            Finish::TimedOut {
                submission_id,
                error_classification: UploadTimeoutClassificationInput::UploadTimeout,
                report_id: None,
            },
            TerminalOutcomeV1::TimedOut,
            Some("upload_timeout"),
        ),
        4 => (
            Finish::Rejected {
                submission_id,
                error_classification: SubmissionRejectedClassificationInput::LocalPayloadInvalid,
                report_id: None,
            },
            TerminalOutcomeV1::Rejected,
            Some("local_payload_invalid"),
        ),
        _ => (
            Finish::Failed {
                submission_id,
                error_classification: SubmissionFailedClassificationInput::Transient,
                report_id: None,
            },
            TerminalOutcomeV1::Failed,
            Some("transient"),
        ),
    }
}
