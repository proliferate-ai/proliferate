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
use super::state::SubmissionTerminal;

pub(super) fn terminal_for_input(input: &Input) -> SubmissionTerminal {
    match input {
        Input::Succeeded { .. } => SubmissionTerminal::Succeeded,
        Input::Cancelled { .. } => SubmissionTerminal::Cancelled,
        Input::Abandoned { .. } => SubmissionTerminal::Abandoned,
        Input::TimedOut {
            error_classification: UploadTimeoutClassificationInput::UploadTimeout,
            ..
        } => SubmissionTerminal::TimedOut,
        Input::Rejected {
            error_classification,
            ..
        } => SubmissionTerminal::Rejected(match error_classification {
            RejectedInput::LocalPayloadInvalid => Rejected::LocalPayloadInvalid,
            RejectedInput::UploadConflict => Rejected::UploadConflict,
            RejectedInput::UploadRejected => Rejected::UploadRejected,
        }),
        Input::Failed {
            error_classification,
            ..
        } => SubmissionTerminal::Failed(match error_classification {
            FailedInput::AuthRequired => Failed::AuthRequired,
            FailedInput::CloudUnconfigured => Failed::CloudUnconfigured,
            FailedInput::DevAuthBypass => Failed::DevAuthBypass,
            FailedInput::StorageUnconfigured => Failed::StorageUnconfigured,
            FailedInput::Transient => Failed::Transient,
        }),
    }
}

pub(super) fn emit_submission(
    operation: &std::sync::Mutex<Option<SupportSubmissionOperation>>,
    terminal: SubmissionTerminal,
) {
    let operation = match operation.lock() {
        Ok(mut operation) => operation.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    let Some(operation) = operation else {
        return;
    };
    match terminal {
        SubmissionTerminal::Succeeded => operation.succeeded(),
        SubmissionTerminal::Cancelled => operation.cancelled(),
        SubmissionTerminal::Abandoned => operation.abandoned(),
        SubmissionTerminal::TimedOut => operation.timed_out(),
        SubmissionTerminal::Rejected(classification) => operation.rejected(classification),
        SubmissionTerminal::Failed(classification) => operation.failed(classification),
    }
}

pub(super) fn valid_finish_input(input: &Input) -> bool {
    valid_report_id(input.report_id())
}

pub(super) fn valid_report_id(value: Option<&str>) -> bool {
    value.is_none_or(|value| validate_id(value).is_ok())
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
