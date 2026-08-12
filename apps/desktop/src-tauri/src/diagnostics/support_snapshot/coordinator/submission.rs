use crate::diagnostics::support_snapshot::schema::validate::validate_id;
use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::{
    SupportSnapshotSubmissionFailedClassificationV1 as Failed,
    SupportSnapshotSubmissionRejectedClassificationV1 as Rejected, SupportSubmissionOperation,
};

use super::model::{
    FinishSupportSnapshotSubmissionInput as Input,
    SubmissionFailedClassificationInput as FailedInput,
    SubmissionRejectedClassificationInput as RejectedInput, UploadTimeoutClassificationInput,
};

pub(super) fn finish_submission(operation: SupportSubmissionOperation, input: &Input) {
    match input {
        Input::Succeeded { .. } => operation.succeeded(),
        Input::Cancelled { .. } => operation.cancelled(),
        Input::Abandoned { .. } => operation.abandoned(),
        Input::TimedOut {
            error_classification: UploadTimeoutClassificationInput::UploadTimeout,
            ..
        } => operation.timed_out(),
        Input::Rejected {
            error_classification,
            ..
        } => operation.rejected(match error_classification {
            RejectedInput::LocalPayloadInvalid => Rejected::LocalPayloadInvalid,
            RejectedInput::UploadConflict => Rejected::UploadConflict,
            RejectedInput::UploadRejected => Rejected::UploadRejected,
        }),
        Input::Failed {
            error_classification,
            ..
        } => operation.failed(match error_classification {
            FailedInput::AuthRequired => Failed::AuthRequired,
            FailedInput::CloudUnconfigured => Failed::CloudUnconfigured,
            FailedInput::DevAuthBypass => Failed::DevAuthBypass,
            FailedInput::StorageUnconfigured => Failed::StorageUnconfigured,
            FailedInput::Transient => Failed::Transient,
        }),
    }
}

pub(super) fn valid_finish_input(input: &Input) -> bool {
    valid_report_id(input.report_id())
}

pub(super) fn valid_report_id(value: Option<&str>) -> bool {
    value.map_or(true, |value| validate_id(value).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_id_is_bounded() {
        assert!(valid_report_id(None));
        assert!(valid_report_id(Some("report")));
        assert!(!valid_report_id(Some("")));
        assert!(!valid_report_id(Some(&"x".repeat(129))));
    }
}
