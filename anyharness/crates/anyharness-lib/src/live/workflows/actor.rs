//! The per-run actor loop. One actor drives one run: it repeatedly asks the
//! service to run the next step, advancing the cursor, until the run suspends on
//! an approval or reaches a terminal state. The service persists the step run
//! before/after each step, so a crash simply respawns the actor at the cursor.

use anyharness_contract::v1::WorkflowRunStatus;

use crate::domains::workflows::engine::{CancelToken, EngineProgress, WorkflowStepExecutor};
use crate::domains::workflows::service::WorkflowService;

/// Drive the run to a resting point (terminal or suspended-for-approval),
/// returning how it came to rest. A driver-level error (a malformed plan
/// surfacing mid-run, or a store failure) fails the run with `engine_error`.
pub async fn drive_run(
    service: &WorkflowService,
    executor: &dyn WorkflowStepExecutor,
    run_id: &str,
    cancel: &CancelToken,
) -> EngineProgress {
    loop {
        match service.run_next_step(run_id, executor, cancel).await {
            Ok(EngineProgress::Advanced) => continue,
            Ok(other) => return other,
            Err(error) => {
                let _ = service.mark_run_terminal(
                    run_id,
                    WorkflowRunStatus::Failed,
                    Some("engine_error".to_string()),
                    Some(error.to_string()),
                );
                return EngineProgress::Finished(WorkflowRunStatus::Failed);
            }
        }
    }
}
