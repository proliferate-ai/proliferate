use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, PrivacyClassificationV1, TerminalOutcomeV1, TypedArgumentV1,
};

use super::super::{LifecycleCorrelation, TauriDiagnosticsProducer};
use super::LifecycleOperation;

const PREPARE_NAME: &str = "desktop.support_snapshot.prepare";
const SUBMIT_NAME: &str = "desktop.support_snapshot.submit";
const SUPPORT_CLASSIFICATIONS: [&str; 15] = [
    "preparation_timeout",
    "preparation_rejected",
    "scrub_failed",
    "manifest_invalid",
    "stage_failed",
    "artifact_verification_failed",
    "local_payload_invalid",
    "upload_conflict",
    "upload_rejected",
    "upload_timeout",
    "auth_required",
    "cloud_unconfigured",
    "dev_auth_bypass",
    "storage_unconfigured",
    "transient",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupportLifecycleAdmissionError {
    ClientJobId,
    PreparationOperationId,
    Attempt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupportSnapshotPreparationFailureClassificationV1 {
    PreparationTimeout,
    PreparationRejected,
    ScrubFailed,
    ManifestInvalid,
    StageFailed,
    ArtifactVerificationFailed,
}

impl SupportSnapshotPreparationFailureClassificationV1 {
    const fn terminal(self) -> (TerminalOutcomeV1, &'static str) {
        match self {
            Self::PreparationTimeout => (TerminalOutcomeV1::TimedOut, "preparation_timeout"),
            Self::PreparationRejected => (TerminalOutcomeV1::Rejected, "preparation_rejected"),
            Self::ScrubFailed => (TerminalOutcomeV1::Failed, "scrub_failed"),
            Self::ManifestInvalid => (TerminalOutcomeV1::Failed, "manifest_invalid"),
            Self::StageFailed => (TerminalOutcomeV1::Failed, "stage_failed"),
            Self::ArtifactVerificationFailed => {
                (TerminalOutcomeV1::Failed, "artifact_verification_failed")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupportSnapshotSubmissionRejectedClassificationV1 {
    LocalPayloadInvalid,
    UploadConflict,
    UploadRejected,
}

impl SupportSnapshotSubmissionRejectedClassificationV1 {
    const fn as_str(self) -> &'static str {
        match self {
            Self::LocalPayloadInvalid => "local_payload_invalid",
            Self::UploadConflict => "upload_conflict",
            Self::UploadRejected => "upload_rejected",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupportSnapshotSubmissionFailedClassificationV1 {
    AuthRequired,
    CloudUnconfigured,
    DevAuthBypass,
    StorageUnconfigured,
    Transient,
}

impl SupportSnapshotSubmissionFailedClassificationV1 {
    const fn as_str(self) -> &'static str {
        match self {
            Self::AuthRequired => "auth_required",
            Self::CloudUnconfigured => "cloud_unconfigured",
            Self::DevAuthBypass => "dev_auth_bypass",
            Self::StorageUnconfigured => "storage_unconfigured",
            Self::Transient => "transient",
        }
    }
}

/// The fixed operational enum arguments that attribute exactly one permit
/// failure stage and reason. They are terminal-only, carry no timestamp,
/// identifier, path, report content, or raw input, and are the complete set.
const FAILURE_STAGE_ARGUMENT: &str = "failure_stage";
const FAILURE_REASON_ARGUMENT: &str = "failure_reason";
const EXPORT_PERMIT_STAGE: &str = "export_permit";
const NONCANONICAL_WINDOW_REASON: &str = "noncanonical_window";

pub(crate) struct SupportPreparationOperation(LifecycleOperation);

impl SupportPreparationOperation {
    pub(crate) fn operation_id(&self) -> &str {
        self.0.operation_id()
    }

    /// Records that the strict export permit refused a noncanonical or nonexact
    /// support window. Only the coordinator's still-running window rejection
    /// calls this, and it may be called at most once per operation.
    pub(crate) fn note_export_permit_noncanonical_window(&mut self) {
        self.0.append_arguments([
            TypedArgumentV1 {
                name: FAILURE_STAGE_ARGUMENT.to_string(),
                privacy: PrivacyClassificationV1::Operational,
                value: ArgumentValueV1::Enum(EXPORT_PERMIT_STAGE.to_string()),
            },
            TypedArgumentV1 {
                name: FAILURE_REASON_ARGUMENT.to_string(),
                privacy: PrivacyClassificationV1::Operational,
                value: ArgumentValueV1::Enum(NONCANONICAL_WINDOW_REASON.to_string()),
            },
        ]);
    }

    pub(crate) fn succeeded(self) {
        self.0.terminal(TerminalOutcomeV1::Succeeded, None);
    }

    pub(crate) fn cancelled(self) {
        self.0.terminal(TerminalOutcomeV1::Cancelled, None);
    }

    pub(crate) fn failed(self, classification: SupportSnapshotPreparationFailureClassificationV1) {
        let (outcome, classification) = classification.terminal();
        self.0.terminal(outcome, Some(classification));
    }

    pub(crate) fn abandoned(self) {
        self.0.terminal(TerminalOutcomeV1::Abandoned, None);
    }
}

pub(crate) struct SupportSubmissionOperation(LifecycleOperation);

impl SupportSubmissionOperation {
    pub(crate) fn operation_id(&self) -> &str {
        self.0.operation_id()
    }

    pub(crate) fn succeeded(self) {
        self.0.terminal(TerminalOutcomeV1::Succeeded, None);
    }

    pub(crate) fn cancelled(self) {
        self.0.terminal(TerminalOutcomeV1::Cancelled, None);
    }

    pub(crate) fn timed_out(self) {
        self.0
            .terminal(TerminalOutcomeV1::TimedOut, Some("upload_timeout"));
    }

    pub(crate) fn rejected(
        self,
        classification: SupportSnapshotSubmissionRejectedClassificationV1,
    ) {
        self.0
            .terminal(TerminalOutcomeV1::Rejected, Some(classification.as_str()));
    }

    pub(crate) fn failed(self, classification: SupportSnapshotSubmissionFailedClassificationV1) {
        self.0
            .terminal(TerminalOutcomeV1::Failed, Some(classification.as_str()));
    }

    pub(crate) fn abandoned(self) {
        self.0.terminal(TerminalOutcomeV1::Abandoned, None);
    }
}

impl TauriDiagnosticsProducer {
    pub(crate) fn begin_support_snapshot_preparation(
        &self,
        client_job_id: &str,
    ) -> Result<SupportPreparationOperation, SupportLifecycleAdmissionError> {
        require_canonical_uuid(client_job_id)
            .map_err(|_| SupportLifecycleAdmissionError::ClientJobId)?;
        let correlation = LifecycleCorrelation {
            item_id: Some(client_job_id.to_owned()),
            ..LifecycleCorrelation::default()
        };
        Ok(SupportPreparationOperation(self.begin_admitted_lifecycle(
            PREPARE_NAME,
            correlation,
            Vec::new(),
            &SUPPORT_CLASSIFICATIONS,
        )))
    }

    pub(crate) fn begin_support_snapshot_submission(
        &self,
        client_job_id: &str,
        preparation_operation_id: &str,
        attempt: u64,
    ) -> Result<SupportSubmissionOperation, SupportLifecycleAdmissionError> {
        require_canonical_uuid(client_job_id)
            .map_err(|_| SupportLifecycleAdmissionError::ClientJobId)?;
        require_canonical_uuid(preparation_operation_id)
            .map_err(|_| SupportLifecycleAdmissionError::PreparationOperationId)?;
        if !(1..=MAX_SAFE_INTEGER).contains(&attempt) {
            return Err(SupportLifecycleAdmissionError::Attempt);
        }
        let correlation = LifecycleCorrelation {
            parent_operation_id: Some(preparation_operation_id.to_owned()),
            item_id: Some(client_job_id.to_owned()),
            ..LifecycleCorrelation::default()
        };
        let arguments = vec![TypedArgumentV1 {
            name: "attempt".to_string(),
            privacy: PrivacyClassificationV1::Operational,
            value: ArgumentValueV1::Integer(attempt as i64),
        }];
        Ok(SupportSubmissionOperation(self.begin_admitted_lifecycle(
            SUBMIT_NAME,
            correlation,
            arguments,
            &SUPPORT_CLASSIFICATIONS,
        )))
    }
}

fn require_canonical_uuid(value: &str) -> Result<(), ()> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| ())?;
    (parsed.to_string() == value).then_some(()).ok_or(())
}
