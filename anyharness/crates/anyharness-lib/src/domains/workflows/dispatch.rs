//! The workflow execution effect boundary, split out of `runtime.rs` (per its
//! ratchet note) so the facade keeps only acceptance and the execution
//! sequence: the abort contract, the guarded blocking CAS/write helpers, the
//! step-8 dispatch decision, and creation-failure classification.

use std::sync::Arc;

use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, InternalSessionCreateError, SendPromptOutcome,
    TextPromptDispatchError,
};
use crate::domains::workflows::model::WorkflowRunFailureCode;
use crate::domains::workflows::service::{WorkflowRunService, WorkflowServiceError};

/// How execution stopped when it did not reach the extension-driven completion.
#[derive(Debug)]
pub(crate) enum ExecutionAbort {
    /// A classified effect failure: attempt one guarded durable failure write.
    Fail(WorkflowRunFailureCode),
    /// A store/join infrastructure failure, already logged. Leave rows
    /// nonterminal and let the next startup fence handle them, mirroring the
    /// terminal-write-failure rule.
    Infra,
}

/// The step-8 dispatch decision, isolated so its production semantics are
/// directly testable: only a verifiably failed dispatch may terminalize the
/// run; a queued acceptance or a lost acknowledgement leaves the running step
/// (null turn id) for the extension or the startup fence to resolve.
pub(crate) async fn apply_prompt_dispatch_outcome(
    service: &Arc<WorkflowRunService>,
    run_id: &str,
    session_id: &str,
    acceptance: Result<SendPromptOutcome, TextPromptDispatchError>,
) -> Result<(), ExecutionAbort> {
    match acceptance {
        Ok(SendPromptOutcome::Running { turn_id, .. }) => {
            record_turn(service, run_id, session_id, turn_id).await;
        }
        Ok(SendPromptOutcome::Queued { .. }) => {
            // Stay running with a null turn id; no queue model, no retry.
        }
        Err(TextPromptDispatchError::AcknowledgementLost) => {
            // Same posture as Queued: no failure write, no retry.
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                "workflow prompt acknowledgement lost; leaving step running for the extension or fence"
            );
        }
        Err(TextPromptDispatchError::Dispatch(_error)) => {
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                "workflow prompt dispatch failed"
            );
            return Err(ExecutionAbort::Fail(
                WorkflowRunFailureCode::PromptDispatchFailed,
            ));
        }
    }
    Ok(())
}

/// Record the post-send turn id on the running step. A store failure here does
/// not fail the run: the prompt is already dispatched and the extension owns
/// completion.
async fn record_turn(
    service: &Arc<WorkflowRunService>,
    run_id: &str,
    session_id: &str,
    turn_id: String,
) {
    let service = service.clone();
    let run_id_owned = run_id.to_string();
    let joined =
        tokio::task::spawn_blocking(move || service.record_turn(&run_id_owned, &turn_id)).await;
    match joined {
        Ok(Ok(_)) => {}
        Ok(Err(_error)) => {
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                "workflow record_turn failed; completion still owned by the extension"
            );
        }
        Err(join_error) => {
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                error = %join_error,
                "workflow record_turn task join failed"
            );
        }
    }
}

/// Run one guarded synchronous CAS transition on the blocking pool. `Ok(bool)`
/// reports whether the row moved; a store/join infra failure becomes
/// [`ExecutionAbort::Infra`] (logged, nonterminal).
pub(crate) async fn blocking_bool<F>(
    run_id: &str,
    step: &'static str,
    call: F,
) -> Result<bool, ExecutionAbort>
where
    F: FnOnce() -> Result<bool, WorkflowServiceError> + Send + 'static,
{
    match tokio::task::spawn_blocking(call).await {
        Ok(Ok(moved)) => Ok(moved),
        Ok(Err(_error)) => {
            tracing::error!(run_id = %run_id, step, "workflow transition store failure");
            Err(ExecutionAbort::Infra)
        }
        Err(join_error) => {
            tracing::error!(
                run_id = %run_id,
                step,
                error = %join_error,
                "workflow transition task join failed"
            );
            Err(ExecutionAbort::Infra)
        }
    }
}

/// The one guarded durable failure write for a classified effect failure.
pub(crate) async fn guarded_fail(
    service: &Arc<WorkflowRunService>,
    run_id: &str,
    code: WorkflowRunFailureCode,
) {
    let service = service.clone();
    let run_id_owned = run_id.to_string();
    let joined =
        tokio::task::spawn_blocking(move || service.fail_nonterminal(&run_id_owned, code)).await;
    match joined {
        Ok(Ok(())) => {}
        Ok(Err(_error)) => {
            tracing::error!(
                run_id = %run_id,
                failure_code = code.as_str(),
                "workflow durable failure write failed; rows left nonterminal for fencing"
            );
        }
        Err(join_error) => {
            tracing::error!(
                run_id = %run_id,
                failure_code = code.as_str(),
                error = %join_error,
                "workflow durable failure write task join failed"
            );
        }
    }
}

/// Classify a creation-seam failure (ruling C2A-DEC-01): "missing or
/// unavailable supplied workspace" covers every access-gate refusal (missing,
/// retired, mutation-blocked) plus the service-level workspace-not-found;
/// everything else at this step is a session creation failure.
pub(crate) fn map_create_error(error: &InternalSessionCreateError) -> WorkflowRunFailureCode {
    match error {
        InternalSessionCreateError::WorkspaceUnavailable(_)
        | InternalSessionCreateError::Create(CreateAndStartSessionError::WorkspaceNotFound) => {
            WorkflowRunFailureCode::WorkspaceUnavailable
        }
        InternalSessionCreateError::Create(_) => WorkflowRunFailureCode::SessionCreateFailed,
    }
}
