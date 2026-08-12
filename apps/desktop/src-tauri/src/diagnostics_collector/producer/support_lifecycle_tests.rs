use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, LifecyclePhaseV1, PrivacyClassificationV1, TerminalOutcomeV1,
};

use super::lifecycle::support_lifecycle::SupportLifecycleAdmissionError;
use super::lifecycle::support_lifecycle::{
    SupportSnapshotPreparationFailureClassificationV1,
    SupportSnapshotSubmissionFailedClassificationV1,
    SupportSnapshotSubmissionRejectedClassificationV1,
};
use super::*;

fn producer() -> TauriDiagnosticsProducer {
    TauriDiagnosticsProducer::new(
        FallbackDiagnosticsWriter::default(),
        "test".to_string(),
        "test".to_string(),
    )
}

#[test]
fn stringly_entrypoint_rejects_unknown_and_support_names_without_emission() {
    let producer = producer();
    producer
        .begin_lifecycle("desktop.unknown")
        .terminal(TerminalOutcomeV1::Succeeded, None);
    producer
        .begin_lifecycle("desktop.support_snapshot.prepare")
        .terminal(TerminalOutcomeV1::Succeeded, None);
    assert_eq!(producer.queue_snapshot().0, 0);
}

#[test]
fn preparation_maps_only_canonical_job_id_and_exposes_operation_id_read_only() {
    let producer = producer();
    let job_id = uuid::Uuid::new_v4().to_string();
    let operation = producer
        .begin_support_snapshot_preparation(&job_id)
        .expect("admitted preparation");
    assert_eq!(
        uuid::Uuid::parse_str(operation.operation_id())
            .expect("operation UUID")
            .to_string(),
        operation.operation_id()
    );
    operation.succeeded();

    let state = producer.inner.state.lock().expect("producer state");
    assert_eq!(state.queued.len(), 2);
    for item in &state.queued {
        let record = &item.record;
        assert_eq!(record.name, "desktop.support_snapshot.prepare");
        assert_eq!(record.item_id.as_deref(), Some(job_id.as_str()));
        assert!(record.parent_operation_id.is_none());
        assert!(record.trace_id.is_none());
        assert!(record.workspace_id.is_none());
        assert!(record.session_id.is_none());
        assert!(record.turn_id.is_none());
        assert!(record.request_id.is_none());
        assert!(record.target_id.is_none());
        assert!(record.prompt_id.is_none());
        assert!(record.workflow_id.is_none());
        assert!(record.arguments.is_empty());
    }
}

#[test]
fn lifecycle_admission_rejects_noncanonical_ids_and_unsafe_attempts() {
    let producer = producer();
    let job_id = uuid::Uuid::new_v4().to_string();
    let parent = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        producer.begin_support_snapshot_preparation("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
        Err(SupportLifecycleAdmissionError::InvalidClientJobId)
    ));
    assert!(matches!(
        producer.begin_support_snapshot_submission(&job_id, "not-a-uuid", 1),
        Err(SupportLifecycleAdmissionError::InvalidPreparationOperationId)
    ));
    for attempt in [0, MAX_SAFE_INTEGER + 1] {
        assert!(matches!(
            producer.begin_support_snapshot_submission(&job_id, &parent, attempt),
            Err(SupportLifecycleAdmissionError::InvalidAttempt)
        ));
    }
    assert_eq!(producer.queue_snapshot().0, 0);
}

#[test]
fn submission_start_and_terminal_pin_parent_item_and_sole_attempt_argument() {
    let producer = producer();
    let job_id = uuid::Uuid::new_v4().to_string();
    let parent = uuid::Uuid::new_v4().to_string();
    let operation = producer
        .begin_support_snapshot_submission(&job_id, &parent, MAX_SAFE_INTEGER)
        .expect("admitted submission");
    let operation_id = operation.operation_id().to_string();
    operation.timed_out();

    let state = producer.inner.state.lock().expect("producer state");
    assert_eq!(state.queued.len(), 2);
    for item in &state.queued {
        let record = &item.record;
        assert_eq!(record.name, "desktop.support_snapshot.submit");
        assert_eq!(record.operation_id, operation_id);
        assert_eq!(record.parent_operation_id.as_deref(), Some(parent.as_str()));
        assert_eq!(record.item_id.as_deref(), Some(job_id.as_str()));
        assert_eq!(record.arguments.len(), 1);
        assert_eq!(record.arguments[0].name, "attempt");
        assert_eq!(
            record.arguments[0].privacy,
            PrivacyClassificationV1::Operational
        );
        assert_eq!(
            record.arguments[0].value,
            ArgumentValueV1::Integer(MAX_SAFE_INTEGER as i64)
        );
    }
    assert_eq!(
        state.queued[0]
            .record
            .lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.phase),
        Some(LifecyclePhaseV1::Started)
    );
    assert_eq!(
        state.queued[1].record.error_classification.as_deref(),
        Some("upload_timeout")
    );
    assert_eq!(
        state.queued[1]
            .record
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        Some(TerminalOutcomeV1::TimedOut)
    );
}

#[test]
fn preparation_classifications_have_fixed_outcome_pairs() {
    let producer = producer();
    let cases = [
        (
            SupportSnapshotPreparationFailureClassificationV1::PreparationTimeout,
            TerminalOutcomeV1::TimedOut,
            "preparation_timeout",
        ),
        (
            SupportSnapshotPreparationFailureClassificationV1::PreparationRejected,
            TerminalOutcomeV1::Rejected,
            "preparation_rejected",
        ),
        (
            SupportSnapshotPreparationFailureClassificationV1::ScrubFailed,
            TerminalOutcomeV1::Failed,
            "scrub_failed",
        ),
        (
            SupportSnapshotPreparationFailureClassificationV1::ManifestInvalid,
            TerminalOutcomeV1::Failed,
            "manifest_invalid",
        ),
        (
            SupportSnapshotPreparationFailureClassificationV1::StageFailed,
            TerminalOutcomeV1::Failed,
            "stage_failed",
        ),
        (
            SupportSnapshotPreparationFailureClassificationV1::ArtifactVerificationFailed,
            TerminalOutcomeV1::Failed,
            "artifact_verification_failed",
        ),
    ];
    for (classification, _, _) in cases {
        producer
            .begin_support_snapshot_preparation(&uuid::Uuid::new_v4().to_string())
            .expect("admitted preparation")
            .failed(classification);
    }
    let state = producer.inner.state.lock().expect("producer state");
    for (terminal, (_, outcome, classification)) in
        state.queued.iter().skip(1).step_by(2).zip(cases)
    {
        assert_eq!(
            terminal.record.error_classification.as_deref(),
            Some(classification)
        );
        assert_eq!(
            terminal
                .record
                .lifecycle
                .as_ref()
                .and_then(|lifecycle| lifecycle.outcome),
            Some(outcome)
        );
    }
}

#[test]
fn submission_classification_types_cannot_cross_outcome_pairs() {
    let producer = producer();
    let job_id = uuid::Uuid::new_v4().to_string();
    let parent = uuid::Uuid::new_v4().to_string();
    let rejected = [
        (
            SupportSnapshotSubmissionRejectedClassificationV1::LocalPayloadInvalid,
            "local_payload_invalid",
        ),
        (
            SupportSnapshotSubmissionRejectedClassificationV1::UploadConflict,
            "upload_conflict",
        ),
        (
            SupportSnapshotSubmissionRejectedClassificationV1::UploadRejected,
            "upload_rejected",
        ),
    ];
    let failed = [
        (
            SupportSnapshotSubmissionFailedClassificationV1::AuthRequired,
            "auth_required",
        ),
        (
            SupportSnapshotSubmissionFailedClassificationV1::CloudUnconfigured,
            "cloud_unconfigured",
        ),
        (
            SupportSnapshotSubmissionFailedClassificationV1::DevAuthBypass,
            "dev_auth_bypass",
        ),
        (
            SupportSnapshotSubmissionFailedClassificationV1::StorageUnconfigured,
            "storage_unconfigured",
        ),
        (
            SupportSnapshotSubmissionFailedClassificationV1::Transient,
            "transient",
        ),
    ];
    for (index, (classification, _)) in rejected.into_iter().enumerate() {
        producer
            .begin_support_snapshot_submission(&job_id, &parent, index as u64 + 1)
            .expect("submission")
            .rejected(classification);
    }
    for (index, (classification, _)) in failed.into_iter().enumerate() {
        producer
            .begin_support_snapshot_submission(&job_id, &parent, index as u64 + 4)
            .expect("submission")
            .failed(classification);
    }
    let state = producer.inner.state.lock().expect("producer state");
    let terminals = state.queued.iter().skip(1).step_by(2).collect::<Vec<_>>();
    for (terminal, (_, expected)) in terminals[..3].iter().zip(rejected) {
        assert_eq!(
            terminal.record.error_classification.as_deref(),
            Some(expected)
        );
        assert_eq!(
            terminal
                .record
                .lifecycle
                .as_ref()
                .and_then(|lifecycle| lifecycle.outcome),
            Some(TerminalOutcomeV1::Rejected)
        );
    }
    for (terminal, (_, expected)) in terminals[3..].iter().zip(failed) {
        assert_eq!(
            terminal.record.error_classification.as_deref(),
            Some(expected)
        );
        assert_eq!(
            terminal
                .record
                .lifecycle
                .as_ref()
                .and_then(|lifecycle| lifecycle.outcome),
            Some(TerminalOutcomeV1::Failed)
        );
    }
}
