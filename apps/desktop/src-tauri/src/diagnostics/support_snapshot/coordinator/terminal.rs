use std::sync::{Arc, Mutex};

use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::{
    SupportPreparationOperation, SupportSnapshotPreparationFailureClassificationV1 as Failure,
};

use super::control::PreparationInterruption;
use super::finish::FinishError;
use super::state::PreparationTerminal;

fn take_operation(
    operation: &Arc<Mutex<Option<SupportPreparationOperation>>>,
) -> Option<SupportPreparationOperation> {
    match operation.lock() {
        Ok(mut operation) => operation.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    }
}

pub(super) fn succeeded(operation: &Arc<Mutex<Option<SupportPreparationOperation>>>) {
    if let Some(operation) = take_operation(operation) {
        operation.succeeded();
    }
}

pub(super) fn cancelled(operation: &Arc<Mutex<Option<SupportPreparationOperation>>>) {
    if let Some(operation) = take_operation(operation) {
        operation.cancelled();
    }
}

pub(super) fn abandoned(operation: &Arc<Mutex<Option<SupportPreparationOperation>>>) {
    if let Some(operation) = take_operation(operation) {
        operation.abandoned();
    }
}

pub(super) fn failed(
    operation: &Arc<Mutex<Option<SupportPreparationOperation>>>,
    classification: Failure,
) {
    if let Some(operation) = take_operation(operation) {
        operation.failed(classification);
    }
}

pub(super) fn interruption_error_code(interruption: PreparationInterruption) -> &'static str {
    match interruption {
        PreparationInterruption::Deadline => "support_snapshot_preparation_timeout",
        PreparationInterruption::Cancelled | PreparationInterruption::Abandoned => {
            "support_snapshot_preparation_cancelled"
        }
        PreparationInterruption::Running => "support_snapshot_stale_preparation",
    }
}

pub(super) fn terminal_for_interruption(
    interruption: PreparationInterruption,
) -> PreparationTerminal {
    match interruption {
        PreparationInterruption::Deadline => {
            PreparationTerminal::Failed(Failure::PreparationTimeout)
        }
        PreparationInterruption::Abandoned | PreparationInterruption::Running => {
            PreparationTerminal::Abandoned
        }
        PreparationInterruption::Cancelled => PreparationTerminal::Cancelled,
    }
}

pub(super) fn terminal_for_finish_error(error: FinishError) -> PreparationTerminal {
    match error {
        FinishError::Cancelled => PreparationTerminal::Cancelled,
        FinishError::Deadline => PreparationTerminal::Failed(Failure::PreparationTimeout),
        FinishError::Scrub => PreparationTerminal::Failed(Failure::ScrubFailed),
        FinishError::Manifest => PreparationTerminal::Failed(Failure::ManifestInvalid),
        FinishError::Stage => PreparationTerminal::Failed(Failure::StageFailed),
        FinishError::Verification => {
            PreparationTerminal::Failed(Failure::ArtifactVerificationFailed)
        }
    }
}

pub(super) fn emit(
    operation: &Arc<Mutex<Option<SupportPreparationOperation>>>,
    terminal: PreparationTerminal,
) {
    match terminal {
        PreparationTerminal::Succeeded => succeeded(operation),
        PreparationTerminal::Cancelled => cancelled(operation),
        PreparationTerminal::Abandoned => abandoned(operation),
        PreparationTerminal::Failed(classification) => failed(operation, classification),
    }
}

pub(super) fn finish_error_code(error: FinishError) -> &'static str {
    match error {
        FinishError::Cancelled => "support_snapshot_preparation_cancelled",
        FinishError::Deadline => "support_snapshot_preparation_timeout",
        FinishError::Scrub => "support_snapshot_scrub_failed",
        FinishError::Manifest => "support_snapshot_manifest_invalid",
        FinishError::Stage => "support_snapshot_stage_failed",
        FinishError::Verification => "support_snapshot_artifact_verification_failed",
    }
}
