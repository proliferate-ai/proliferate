//! The single HTTP mapping for workflow-run runtime and decode errors. `From`
//! impls let handlers ride `?`. Storage/internal failures collapse to a generic
//! 500 body — raw error chains, prompts, and arguments never reach the wire.

use axum::http::StatusCode;

use super::access::map_access_error;
use super::error::ApiError;
use super::workflow_runs_contract::{WorkflowRunDecodeError, WorkflowRunEncodeError};
use crate::domains::workflows::control::WorkflowCancelError;
use crate::domains::workflows::runtime::{WorkflowGetError, WorkflowPutError};
use crate::domains::workspaces::access_gate::WorkspaceAccessError;

impl From<WorkflowRunDecodeError> for ApiError {
    fn from(_error: WorkflowRunDecodeError) -> Self {
        ApiError::bad_request(
            "The request body does not match the workflow run schema.",
            "WORKFLOW_RUN_INVALID",
        )
    }
}

impl From<WorkflowRunEncodeError> for ApiError {
    fn from(_error: WorkflowRunEncodeError) -> Self {
        ApiError::internal("workflow run response mapping failure")
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
            WorkflowPutError::WorkspaceAccess(WorkspaceAccessError::Unexpected(_)) => {
                ApiError::internal("workflow workspace access could not be verified")
            }
            WorkflowPutError::WorkspaceAccess(error) => map_access_error(error),
            WorkflowPutError::TargetUnresolvable(_) => ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Unprocessable entity",
                Some("The workflow target cannot be resolved in this workspace.".into()),
                Some("WORKFLOW_RUN_TARGET_UNRESOLVABLE"),
            ),
            WorkflowPutError::WorkspaceNotReady => ApiError::conflict(
                "The Workflow workspace for this run is not ready.",
                "workflow_workspace_not_ready",
            ),
            WorkflowPutError::WorkspaceMismatch => ApiError::conflict(
                "The request workspace does not match the ready Workflow materialization.",
                "workflow_workspace_mismatch",
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

impl From<WorkflowCancelError> for ApiError {
    fn from(error: WorkflowCancelError) -> Self {
        match error {
            WorkflowCancelError::InvalidRunId(error) => {
                ApiError::bad_request(error.to_string(), "WORKFLOW_RUN_INVALID")
            }
            WorkflowCancelError::NotFound => {
                ApiError::not_found("Workflow run not found", "WORKFLOW_RUN_NOT_FOUND")
            }
            WorkflowCancelError::Store(_) | WorkflowCancelError::Internal(_) => {
                ApiError::internal("workflow run storage failure")
            }
        }
    }
}
