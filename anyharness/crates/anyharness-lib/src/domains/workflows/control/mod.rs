//! Workflow run control (spec `workflow-run-control.md`): per-run
//! serialization and the durable cancellation use case.

mod gate;
mod runtime;

pub use gate::WorkflowRunGates;
pub(super) use runtime::cancel_workflow_run;
pub use runtime::WorkflowCancelError;
