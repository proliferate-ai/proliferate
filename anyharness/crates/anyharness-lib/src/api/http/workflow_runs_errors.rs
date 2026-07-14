//! The single HTTP mapping for workflow-run runtime and decode errors. `From`
//! impls let handlers ride `?`. Storage/internal failures collapse to a generic
//! 500 body — raw error chains, prompts, and arguments never reach the wire.

use super::error::ApiError;
use super::workflow_runs_contract::WorkflowRunDecodeError;
use crate::domains::workflows::runtime::{WorkflowGetError, WorkflowPutError};

impl From<WorkflowRunDecodeError> for ApiError {
    fn from(_error: WorkflowRunDecodeError) -> Self {
        ApiError::bad_request(
            "The request body does not match the workflow run schema.",
            "WORKFLOW_RUN_INVALID",
        )
    }
}

impl From<WorkflowPutError> for ApiError {
    fn from(error: WorkflowPutError) -> Self {
        match error {
            WorkflowPutError::Invalid(error) => {
                ApiError::bad_request(error.to_string(), "WORKFLOW_RUN_INVALID")
            }
            WorkflowPutError::Conflict => ApiError::conflict(
                "A workflow run with this ID already exists with a different invocation.",
                "WORKFLOW_RUN_CONFLICT",
            ),
            WorkflowPutError::Store(_) | WorkflowPutError::Internal(_) => {
                ApiError::internal("workflow run storage failure")
            }
        }
    }
}

impl From<WorkflowGetError> for ApiError {
    fn from(error: WorkflowGetError) -> Self {
        match error {
            WorkflowGetError::InvalidRunId(error) => {
                ApiError::bad_request(error.to_string(), "WORKFLOW_RUN_INVALID")
            }
            WorkflowGetError::Store(_) | WorkflowGetError::Internal(_) => {
                ApiError::internal("workflow run storage failure")
            }
        }
    }
}
