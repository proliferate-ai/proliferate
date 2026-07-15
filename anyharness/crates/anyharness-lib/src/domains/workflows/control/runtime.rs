//! The durable cancellation use case (spec workflow-run-control §5) with the
//! same detached main-runtime handoff discipline as PUT: dropping the HTTP
//! future cannot cancel the intent-CAS -> live-request -> final-snapshot
//! sequence.

use std::sync::Arc;

use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workflows::service::{
    VersionedWorkflowRunView, WorkflowCancelOutcome, WorkflowRunService,
    WorkflowRunValidationError, WorkflowServiceError,
};

use super::WorkflowRunGates;

/// The cancel failure arm (success is always a truthful snapshot).
#[derive(Debug)]
pub enum WorkflowCancelError {
    /// The path `runId` is not a canonical UUID (coded 400, like PUT/GET).
    InvalidRunId(WorkflowRunValidationError),
    /// No run with this id exists.
    NotFound,
    Store(WorkflowServiceError),
    /// Blocking-pool/handoff join failure (task panic/cancel).
    Internal(anyhow::Error),
}

/// One durable cancel request: intent CAS under the run gate, a best-effort
/// exact-active-turn live request while still holding the gate, then the
/// latest durable snapshot. Runs inside the caller's detached handoff task.
pub(in crate::domains::workflows) async fn cancel_workflow_run(
    service: Arc<WorkflowRunService>,
    session_runtime: Arc<SessionRuntime>,
    gates: Arc<WorkflowRunGates>,
    run_id: String,
) -> Result<VersionedWorkflowRunView, WorkflowCancelError> {
    if let Err(error) = crate::domains::workflows::service::validate_run_id(&run_id) {
        return Err(WorkflowCancelError::InvalidRunId(error));
    }

    // Cancellation holds the same per-run gate across the cancel-intent CAS
    // and the live-cancel request (spec §6.2): if cancellation wins, stale
    // execution cannot send a prompt; if prompt acceptance won, cancellation
    // observes the accepted state.
    let gate = gates.slot(&run_id).map_err(WorkflowCancelError::Internal)?;
    #[cfg(test)]
    crate::domains::workflows::test_barriers::at_cancel_gate(&run_id);
    let guard = gate.clone().lock_owned().await;

    let intent_service = service.clone();
    let intent_run_id = run_id.clone();
    let outcome = tokio::task::spawn_blocking(move || intent_service.cancel_intent(&intent_run_id))
        .await
        .map_err(|error| WorkflowCancelError::Internal(error.into()))?
        .map_err(WorkflowCancelError::Store)?;

    match outcome {
        WorkflowCancelOutcome::Missing => Err(WorkflowCancelError::NotFound),
        // Terminal and pre-dispatch-cancelled snapshots are already current.
        WorkflowCancelOutcome::Terminal(view) => Ok(view),
        WorkflowCancelOutcome::CancelledBeforeDispatch(view) => Ok(view),
        WorkflowCancelOutcome::CancellationPending {
            session_id,
            turn_id,
            ..
        } => {
            // Best-effort live cancel: only the exact stored turn in the bound
            // session; a null stored turn (queued, lost acknowledgement, or
            // unpersisted correlation) records intent only — never cancel
            // unrelated active work. Repeated requests re-attempt so an
            // earlier missing actor can recover. No result terminalizes the
            // workflow; only the exact correlated callback can.
            if let (Some(session_id), Some(turn_id)) = (session_id, turn_id) {
                let outcome = session_runtime
                    .request_live_turn_cancel(&session_id, &turn_id)
                    .await;
                tracing::info!(
                    run_id = %run_id,
                    session_id = %session_id,
                    live_cancel = ?outcome,
                    "workflow live turn cancel requested"
                );
            } else {
                tracing::info!(
                    run_id = %run_id,
                    "workflow cancel intent recorded without a stored turn; awaiting correlated outcome or fencing"
                );
            }
            drop(guard);

            // Return the latest durable snapshot: correlated evidence may
            // already have won. A read failure here is a 500, but the
            // committed intent remains and exact repetition is safe.
            let read_service = service.clone();
            let read_run_id = run_id.clone();
            let view =
                tokio::task::spawn_blocking(move || read_service.get_versioned(&read_run_id))
                    .await
                    .map_err(|error| WorkflowCancelError::Internal(error.into()))?
                    .map_err(WorkflowCancelError::Store)?;
            view.ok_or(WorkflowCancelError::NotFound)
        }
    }
}
