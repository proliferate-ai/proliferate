use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::time::Duration;

use super::fake_runtime::FakeRuntime;
use super::lifecycle_tests::assert_lifecycle_operation;
use super::model::{
    BeginSupportSnapshotSubmissionInput, FinishSupportSnapshotSubmissionInput as Finish,
    SubmissionFailedClassificationInput, SubmissionRejectedClassificationInput,
    UploadTimeoutClassificationInput,
};
use super::runtime::CoordinatorRuntime;
use super::state::{ArtifactAuthorization, ReadVerificationProof, ReadinessState};
use super::tests::{reference, test_coordinator};

struct SubmissionTerminalCase {
    finish: Finish,
    outcome: TerminalOutcomeV1,
    classification: Option<&'static str>,
}

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

    for (case, build_terminal) in terminal_cases().into_iter().enumerate() {
        coordinator.state.lock().await.read_proofs.insert(
            reference.artifact_id.clone(),
            ReadVerificationProof {
                reference: reference.clone(),
                expires_at: runtime.instant_now() + Duration::from_secs(30),
            },
        );
        let attempt = case as u64 + 1;
        let begun = coordinator
            .begin_submission(BeginSupportSnapshotSubmissionInput {
                artifact_id: reference.artifact_id.clone(),
                client_job_id: reference.client_job_id.clone(),
                attempt,
                parent_operation_id: parent_operation_id.clone(),
            })
            .await
            .expect("submission admission");
        assert!(coordinator.state.lock().await.submission.is_some());
        let terminal = build_terminal(&begun.submission_id);
        coordinator
            .finish_submission(terminal.finish)
            .await
            .expect("submission terminal");
        let state = coordinator.state.lock().await;
        assert!(state.submission.is_none());
        assert!(state.read_proofs.is_empty());
        assert!(state.artifacts.contains_key(&reference.artifact_id));
        drop(state);
        assert_lifecycle_operation(
            &coordinator,
            "desktop.support_snapshot.submit",
            Some(&begun.operation_id),
            &reference.client_job_id,
            Some(&parent_operation_id),
            terminal.outcome,
            terminal.classification,
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

fn terminal_cases() -> [fn(&str) -> SubmissionTerminalCase; 12] {
    [
        succeeded,
        cancelled,
        abandoned,
        timed_out,
        rejected_local_payload_invalid,
        rejected_upload_conflict,
        rejected_upload_rejected,
        failed_auth_required,
        failed_cloud_unconfigured,
        failed_dev_auth_bypass,
        failed_storage_unconfigured,
        failed_transient,
    ]
}

fn succeeded(submission_id: &str) -> SubmissionTerminalCase {
    SubmissionTerminalCase {
        finish: Finish::Succeeded {
            submission_id: submission_id.to_string(),
            report_id: None,
        },
        outcome: TerminalOutcomeV1::Succeeded,
        classification: None,
    }
}

fn cancelled(submission_id: &str) -> SubmissionTerminalCase {
    SubmissionTerminalCase {
        finish: Finish::Cancelled {
            submission_id: submission_id.to_string(),
            report_id: None,
        },
        outcome: TerminalOutcomeV1::Cancelled,
        classification: None,
    }
}

fn abandoned(submission_id: &str) -> SubmissionTerminalCase {
    SubmissionTerminalCase {
        finish: Finish::Abandoned {
            submission_id: submission_id.to_string(),
            report_id: None,
        },
        outcome: TerminalOutcomeV1::Abandoned,
        classification: None,
    }
}

fn timed_out(submission_id: &str) -> SubmissionTerminalCase {
    SubmissionTerminalCase {
        finish: Finish::TimedOut {
            submission_id: submission_id.to_string(),
            error_classification: UploadTimeoutClassificationInput::UploadTimeout,
            report_id: None,
        },
        outcome: TerminalOutcomeV1::TimedOut,
        classification: Some("upload_timeout"),
    }
}

fn rejected(
    submission_id: &str,
    error_classification: SubmissionRejectedClassificationInput,
    classification: &'static str,
) -> SubmissionTerminalCase {
    SubmissionTerminalCase {
        finish: Finish::Rejected {
            submission_id: submission_id.to_string(),
            error_classification,
            report_id: None,
        },
        outcome: TerminalOutcomeV1::Rejected,
        classification: Some(classification),
    }
}

fn rejected_local_payload_invalid(submission_id: &str) -> SubmissionTerminalCase {
    rejected(
        submission_id,
        SubmissionRejectedClassificationInput::LocalPayloadInvalid,
        "local_payload_invalid",
    )
}

fn rejected_upload_conflict(submission_id: &str) -> SubmissionTerminalCase {
    rejected(
        submission_id,
        SubmissionRejectedClassificationInput::UploadConflict,
        "upload_conflict",
    )
}

fn rejected_upload_rejected(submission_id: &str) -> SubmissionTerminalCase {
    rejected(
        submission_id,
        SubmissionRejectedClassificationInput::UploadRejected,
        "upload_rejected",
    )
}

fn failed(
    submission_id: &str,
    error_classification: SubmissionFailedClassificationInput,
    classification: &'static str,
) -> SubmissionTerminalCase {
    SubmissionTerminalCase {
        finish: Finish::Failed {
            submission_id: submission_id.to_string(),
            error_classification,
            report_id: None,
        },
        outcome: TerminalOutcomeV1::Failed,
        classification: Some(classification),
    }
}

macro_rules! failed_case {
    ($function:ident, $variant:ident, $classification:literal) => {
        fn $function(submission_id: &str) -> SubmissionTerminalCase {
            failed(
                submission_id,
                SubmissionFailedClassificationInput::$variant,
                $classification,
            )
        }
    };
}

failed_case!(failed_auth_required, AuthRequired, "auth_required");
failed_case!(
    failed_cloud_unconfigured,
    CloudUnconfigured,
    "cloud_unconfigured"
);
failed_case!(failed_dev_auth_bypass, DevAuthBypass, "dev_auth_bypass");
failed_case!(
    failed_storage_unconfigured,
    StorageUnconfigured,
    "storage_unconfigured"
);
failed_case!(failed_transient, Transient, "transient");
