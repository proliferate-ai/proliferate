use anyharness_contract::v1::{
    CreateWorkflowRunRequest, ResolveWorkflowApprovalRequest, WorkflowRunListResponse,
    WorkflowRunSummaryView, WorkflowRunView, WorkflowStepRunView,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;

use super::access::assert_workspace_auth_scope;
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::workflows::model::{WorkflowRunRecord, WorkflowStepRunRecord};
use crate::domains::workflows::service::WorkflowServiceError;

#[derive(Debug, Deserialize)]
pub struct ListWorkflowRunsQuery {
    pub workspace_id: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/workflow-runs",
    params(("workspace_id" = Option<String>, Query, description = "Filter by workspace")),
    responses((status = 200, description = "List workflow runs", body = WorkflowRunListResponse)),
    tag = "workflows"
)]
pub async fn list_workflow_runs(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListWorkflowRunsQuery>,
) -> Result<Json<WorkflowRunListResponse>, ApiError> {
    // A direct-attach token is scoped to its own workspace; other tokens may
    // filter by the requested workspace (or list all).
    let workspace_id = match &auth {
        AuthContext::UserClaim(claim) => Some(claim.anyharness_workspace_id.clone()),
        _ => query.workspace_id.clone(),
    };
    let runs = state
        .workflow_manager
        .list_runs(workspace_id.as_deref())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let runs = runs.iter().map(run_summary).collect();
    Ok(Json(WorkflowRunListResponse { runs }))
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs",
    request_body = CreateWorkflowRunRequest,
    responses(
        (status = 202, description = "Run delivered (idempotent on run_id)", body = WorkflowRunView),
        (status = 400, description = "Invalid plan", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflows"
)]
pub async fn create_workflow_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(request): Json<CreateWorkflowRunRequest>,
) -> Result<(StatusCode, Json<WorkflowRunView>), ApiError> {
    assert_workspace_auth_scope(&auth, &request.workspace_id)?;
    let plan_json =
        serde_json::to_string(&request.plan).map_err(|error| ApiError::internal(error.to_string()))?;
    let record = state
        .workflow_manager
        .deliver(&plan_json, &request.workspace_id)
        .map_err(map_error)?;
    // The step runs exist from creation; echo the full view (delivery is
    // idempotent, so a re-POST returns the current state).
    let steps = load_steps(&state, &record.run_id)?;
    Ok((StatusCode::ACCEPTED, Json(run_view(&record, &steps))))
}

#[utoipa::path(
    get,
    path = "/v1/workflow-runs/{run_id}",
    params(("run_id" = String, Path, description = "Run ID")),
    responses(
        (status = 200, description = "Workflow run detail", body = WorkflowRunView),
        (status = 404, description = "Run not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflows"
)]
pub async fn get_workflow_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<Json<WorkflowRunView>, ApiError> {
    let (record, steps) = load_run(&state, &run_id)?;
    assert_workspace_auth_scope(&auth, &record.workspace_id)?;
    Ok(Json(run_view(&record, &steps)))
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/cancel",
    params(("run_id" = String, Path, description = "Run ID")),
    responses(
        (status = 200, description = "Run cancelled", body = WorkflowRunView),
        (status = 404, description = "Run not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflows"
)]
pub async fn cancel_workflow_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<Json<WorkflowRunView>, ApiError> {
    let (record, _) = load_run(&state, &run_id)?;
    assert_workspace_auth_scope(&auth, &record.workspace_id)?;
    let record = state
        .workflow_manager
        .cancel(&run_id)
        .await
        .map_err(map_error)?;
    let steps = load_steps(&state, &run_id)?;
    Ok(Json(run_view(&record, &steps)))
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/approval",
    params(("run_id" = String, Path, description = "Run ID")),
    request_body = ResolveWorkflowApprovalRequest,
    responses(
        (status = 200, description = "Approval resolved", body = WorkflowRunView),
        (status = 404, description = "Run not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "No pending approval", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workflows"
)]
pub async fn resolve_workflow_approval(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
    Json(request): Json<ResolveWorkflowApprovalRequest>,
) -> Result<Json<WorkflowRunView>, ApiError> {
    let (record, _) = load_run(&state, &run_id)?;
    assert_workspace_auth_scope(&auth, &record.workspace_id)?;
    let record = state
        .workflow_manager
        .resolve_approval(&run_id, request.approve)
        .map_err(map_error)?;
    let steps = load_steps(&state, &run_id)?;
    Ok(Json(run_view(&record, &steps)))
}

fn load_run(
    state: &AppState,
    run_id: &str,
) -> Result<(WorkflowRunRecord, Vec<WorkflowStepRunRecord>), ApiError> {
    state
        .workflow_manager
        .get_run(run_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("Workflow run not found", "NOT_FOUND"))
}

fn load_steps(
    state: &AppState,
    run_id: &str,
) -> Result<Vec<WorkflowStepRunRecord>, ApiError> {
    Ok(load_run(state, run_id)?.1)
}

fn run_view(record: &WorkflowRunRecord, steps: &[WorkflowStepRunRecord]) -> WorkflowRunView {
    WorkflowRunView {
        run_id: record.run_id.clone(),
        workflow_id: record.workflow_id.clone(),
        workflow_version_id: record.workflow_version_id.clone(),
        version_n: record.version_n,
        trigger_kind: record.trigger_kind.clone(),
        target_mode: record.target_mode.clone(),
        workspace_id: record.workspace_id.clone(),
        status: record.status,
        step_cursor: record.step_cursor,
        session_ids: record.session_ids.clone(),
        error_code: record.error_code.clone(),
        error_message: record.error_message.clone(),
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        steps: steps.iter().map(step_view).collect(),
    }
}

fn step_view(step: &WorkflowStepRunRecord) -> WorkflowStepRunView {
    WorkflowStepRunView {
        step_index: step.step_index,
        kind: step.kind.clone(),
        status: step.status,
        attempt: step.attempt,
        output: step.output_value(),
        error_code: step.error_code.clone(),
        error_message: step.error_message.clone(),
        started_at: step.started_at.clone(),
        ended_at: step.ended_at.clone(),
    }
}

fn run_summary(record: &WorkflowRunRecord) -> WorkflowRunSummaryView {
    WorkflowRunSummaryView {
        run_id: record.run_id.clone(),
        workflow_id: record.workflow_id.clone(),
        trigger_kind: record.trigger_kind.clone(),
        workspace_id: record.workspace_id.clone(),
        status: record.status,
        step_cursor: record.step_cursor,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
    }
}

fn map_error(error: WorkflowServiceError) -> ApiError {
    match error {
        WorkflowServiceError::RunNotFound => {
            ApiError::not_found("Workflow run not found", "NOT_FOUND")
        }
        WorkflowServiceError::WorkspaceNotFound => {
            ApiError::not_found("Workspace not found", "WORKSPACE_NOT_FOUND")
        }
        WorkflowServiceError::InvalidPlan(detail) => {
            ApiError::bad_request(format!("Invalid workflow plan: {detail}"), "WORKFLOW_PLAN_INVALID")
        }
        WorkflowServiceError::DeliveryIdentityConflict { field } => ApiError::conflict(
            format!(
                "Delivery identity conflicts with the stored run ({field}); the \
                 (run_id, plan_hash, binding_hash, execution_generation) identity is immutable."
            ),
            "WORKFLOW_DELIVERY_IDENTITY_CONFLICT",
        ),
        WorkflowServiceError::NoPendingApproval => ApiError::conflict(
            "This run has no pending approval to resolve.",
            "WORKFLOW_NO_PENDING_APPROVAL",
        ),
        WorkflowServiceError::UnexpectedApprovalStep => ApiError::conflict(
            "The run's current step cannot resolve an approval.",
            "WORKFLOW_UNEXPECTED_APPROVAL_STEP",
        ),
        WorkflowServiceError::Store(error) => ApiError::internal(error.to_string()),
    }
}
