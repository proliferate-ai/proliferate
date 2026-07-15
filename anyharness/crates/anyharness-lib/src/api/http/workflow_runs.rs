//! `PUT`/`GET /v1/workflow-runs/{runId}` handlers. They assert workspace auth,
//! map wire/domain shapes, make one runtime call, and let typed errors ride
//! `?`. No product validation, SQL, spawning, session calls, or orchestration.

use anyharness_contract::v1::VersionedWorkflowRunResponse;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};

use super::access::assert_workspace_auth_scope;
use super::error::ApiError;
use super::workflow_runs_contract::{
    decode_put_workflow_run, input_workspace_id, view_to_response, view_workspace_id,
};
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::workflows::runtime::WorkflowPutSuccess;

#[utoipa::path(
    put,
    path = "/v1/workflow-runs/{run_id}",
    params(("run_id" = String, Path, description = "Canonical UUID for the workflow run")),
    request_body = anyharness_contract::v1::VersionedPutWorkflowRunRequest,
    responses(
        (status = 201, description = "New durable acceptance", body = VersionedWorkflowRunResponse),
        (status = 200, description = "Exact replay of an identical invocation", body = VersionedWorkflowRunResponse),
        (status = 400, description = "Invalid ID, definition, arguments, or rendered prompt", body = anyharness_contract::v1::ProblemDetails),
        (status = 403, description = "Direct-attach token is outside its workspace scope", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Same ID with different invocation, workspace mutation blocked, or a schema-v2 workflow-workspace binding conflict (workflow_workspace_not_ready when this run's materialization is not ready; workflow_workspace_mismatch when the ready materialization's workspace differs from the request)", body = anyharness_contract::v1::ProblemDetails),
        (status = 422, description = "Portable target cannot be resolved", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Acceptance storage failure; no committed run or step", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflow-runs"
)]
pub async fn put_workflow_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Response, ApiError> {
    let input = decode_put_workflow_run(body)?;
    assert_workspace_auth_scope(&auth, input_workspace_id(&input))?;
    let outcome = state.workflow_run_runtime.put(run_id, input).await?;
    Ok(match outcome {
        WorkflowPutSuccess::Created(view) => {
            (StatusCode::CREATED, Json(view_to_response(view)?)).into_response()
        }
        WorkflowPutSuccess::Replay(view) => {
            (StatusCode::OK, Json(view_to_response(view)?)).into_response()
        }
    })
}

#[utoipa::path(
    get,
    path = "/v1/workflow-runs/{run_id}",
    params(("run_id" = String, Path, description = "Canonical UUID for the workflow run")),
    responses(
        (status = 200, description = "Durable run and step status", body = VersionedWorkflowRunResponse),
        (status = 400, description = "Non-canonical run ID", body = anyharness_contract::v1::ProblemDetails),
        (status = 403, description = "Direct-attach token is outside its workspace scope", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Unknown workflow run", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflow-runs"
)]
pub async fn get_workflow_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<Json<VersionedWorkflowRunResponse>, ApiError> {
    let view = state
        .workflow_run_runtime
        .get(run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Workflow run not found", "WORKFLOW_RUN_NOT_FOUND"))?;
    assert_workspace_auth_scope(&auth, view_workspace_id(&view))?;
    Ok(Json(view_to_response(view)?))
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/cancel",
    params(("run_id" = String, Path, description = "Canonical UUID for the workflow run")),
    responses(
        (status = 200, description = "Durable cancellation intent acknowledged; current truthful versioned snapshot", body = VersionedWorkflowRunResponse),
        (status = 400, description = "Non-canonical run ID", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Unknown workflow run", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Cancel-intent storage failure; nothing changed, or a post-commit snapshot read failed with intent preserved", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflow-runs"
)]
pub async fn cancel_workflow_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<Json<VersionedWorkflowRunResponse>, ApiError> {
    let view = state.workflow_run_runtime.cancel(run_id).await?;
    assert_workspace_auth_scope(&auth, view_workspace_id(&view))?;
    Ok(Json(view_to_response(view)?))
}
