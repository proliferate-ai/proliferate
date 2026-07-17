//! `PUT`/`GET /v1/workflow-run-workspaces/{runId}` handlers (spec
//! `workflow-workspace-placement`). They map wire/domain shapes, make one
//! runtime call, and let typed errors ride `?`. No product validation, SQL,
//! spawning, workspace calls, or orchestration lives here. Contract types stop
//! at this boundary.

use anyharness_contract::v1::WorkflowRunWorkspaceResponse;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use super::error::ApiError;
use super::workflow_workspaces_contract::{
    decode_put_workflow_run_workspace, record_to_response, WorkflowWorkspaceDecodeError,
};
use crate::app::AppState;
use crate::domains::workflows::workspace_materialization::{
    WorkspaceGetError, WorkspacePutError, WorkspacePutSuccess,
};

#[utoipa::path(
    put,
    path = "/v1/workflow-run-workspaces/{run_id}",
    params(("run_id" = String, Path, description = "Canonical UUID for the workflow run")),
    request_body = anyharness_contract::v1::PutWorkflowRunWorkspaceRequest,
    responses(
        (status = 201, description = "New durable materialization (status ready or failed)", body = WorkflowRunWorkspaceResponse),
        (status = 200, description = "Exact replay of an identical placement request", body = WorkflowRunWorkspaceResponse),
        (status = 400, description = "Invalid ID or placement request", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Same ID with a different placement request, or the workflow run already claimed this ID before placement acceptance", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Materialization storage failure", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflow-run-workspaces"
)]
pub async fn put_workflow_run_workspace(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Response, ApiError> {
    let placement = decode_put_workflow_run_workspace(&run_id, body)?;
    let outcome = state
        .workflow_workspace_runtime
        .put(run_id, placement)
        .await?;
    Ok(match outcome {
        WorkspacePutSuccess::Created(record) => {
            let response = record_to_response(&record)
                .map_err(|_| ApiError::internal("workflow workspace response mapping failure"))?;
            (StatusCode::CREATED, Json(response)).into_response()
        }
        WorkspacePutSuccess::Replay(record) => {
            let response = record_to_response(&record)
                .map_err(|_| ApiError::internal("workflow workspace response mapping failure"))?;
            (StatusCode::OK, Json(response)).into_response()
        }
    })
}

#[utoipa::path(
    get,
    path = "/v1/workflow-run-workspaces/{run_id}",
    params(("run_id" = String, Path, description = "Canonical UUID for the workflow run")),
    responses(
        (status = 200, description = "Durable materialization record", body = WorkflowRunWorkspaceResponse),
        (status = 400, description = "Non-canonical run ID", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Unknown workflow run workspace", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflow-run-workspaces"
)]
pub async fn get_workflow_run_workspace(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<WorkflowRunWorkspaceResponse>, ApiError> {
    let record = state
        .workflow_workspace_runtime
        .get(run_id)
        .await?
        .ok_or_else(|| {
            ApiError::not_found(
                "Workflow run workspace not found",
                "WORKFLOW_WORKSPACE_NOT_FOUND",
            )
        })?;
    let response = record_to_response(&record)
        .map_err(|_| ApiError::internal("workflow workspace response mapping failure"))?;
    Ok(Json(response))
}

impl From<WorkflowWorkspaceDecodeError> for ApiError {
    fn from(_: WorkflowWorkspaceDecodeError) -> Self {
        ApiError::bad_request(
            "Invalid workflow run workspace placement request.",
            "WORKFLOW_WORKSPACE_INVALID",
        )
    }
}

impl From<WorkspacePutError> for ApiError {
    fn from(error: WorkspacePutError) -> Self {
        match error {
            WorkspacePutError::Invalid(error) => {
                ApiError::bad_request(error.to_string(), "WORKFLOW_WORKSPACE_INVALID")
            }
            WorkspacePutError::Conflict => ApiError::conflict(
                "A workflow run workspace with this ID already exists with a different placement.",
                "WORKFLOW_WORKSPACE_CONFLICT",
            ),
            WorkspacePutError::RunAlreadyAccepted => ApiError::conflict(
                "The workflow run already claimed this ID before workspace placement.",
                "workflow_run_already_accepted",
            ),
            WorkspacePutError::Internal(_) => {
                ApiError::internal("workflow workspace materialization failure")
            }
        }
    }
}

impl From<WorkspaceGetError> for ApiError {
    fn from(error: WorkspaceGetError) -> Self {
        match error {
            WorkspaceGetError::Invalid(error) => {
                ApiError::bad_request(error.to_string(), "WORKFLOW_WORKSPACE_INVALID")
            }
            WorkspaceGetError::Internal(_) => {
                ApiError::internal("workflow workspace storage failure")
            }
        }
    }
}
