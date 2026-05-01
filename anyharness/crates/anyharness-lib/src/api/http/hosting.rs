use anyharness_contract::v1::{
    CreatePullRequestRequest, CreatePullRequestResponse, CurrentPullRequestResponse,
    PullRequestState as ContractPullRequestState, PullRequestSummary as ContractPullRequestSummary,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::access::{assert_workspace_mutable, assert_workspace_not_retired};
use super::error::ApiError;
use crate::app::AppState;
use crate::hosting::types::{
    CreatePullRequestResult, CurrentPullRequestResult, HostingServiceError,
    PullRequestState as InternalPullRequestState, PullRequestSummary as InternalPullRequestSummary,
};
use crate::hosting::HostingService;
use crate::workspaces::operation_gate::WorkspaceOperationKind;

fn resolve_workspace_path(
    workspace_runtime: &crate::workspaces::runtime::WorkspaceRuntime,
    workspace_id: &str,
) -> Result<std::path::PathBuf, ApiError> {
    let workspace = workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("Workspace not found", "WORKSPACE_NOT_FOUND"))?;

    Ok(std::path::PathBuf::from(workspace.path))
}

async fn run_hosting_task<T, F>(
    state: &AppState,
    workspace_id: String,
    task_label: &'static str,
    task: F,
) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(std::path::PathBuf) -> Result<T, ApiError> + Send + 'static,
{
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(state, &workspace_id)?;
    let workspace_runtime = state.workspace_runtime.clone();
    tokio::task::spawn_blocking(move || {
        let workspace_path = resolve_workspace_path(&workspace_runtime, &workspace_id)?;
        task(workspace_path)
    })
    .await
    .map_err(|e| ApiError::internal(format!("{task_label} task failed: {e}")))?
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/hosting/pull-requests/current",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Current pull request for the active branch", body = CurrentPullRequestResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Hosting error", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "hosting"
)]
pub async fn get_current_pull_request(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<CurrentPullRequestResponse>, ApiError> {
    let response = run_hosting_task(
        &state,
        workspace_id,
        "get current pull request",
        move |workspace_path| {
            HostingService::get_current_pull_request(&workspace_path)
                .map(current_pull_request_to_contract)
                .map_err(map_hosting_error)
        },
    )
    .await?;

    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/hosting/pull-requests",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = CreatePullRequestRequest,
    responses(
        (status = 200, description = "Pull request created", body = CreatePullRequestResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Hosting error", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "hosting"
)]
pub async fn create_pull_request(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<CreatePullRequestRequest>,
) -> Result<Json<CreatePullRequestResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::HostingWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let title = req.title;
    let body = req.body;
    let base_branch = req.base_branch;
    let draft = req.draft;
    let response = run_hosting_task(
        &state,
        workspace_id,
        "create pull request",
        move |workspace_path| {
            HostingService::create_pull_request(
                &workspace_path,
                &title,
                body.as_deref(),
                &base_branch,
                draft,
            )
            .map(create_pull_request_to_contract)
            .map_err(map_hosting_error)
        },
    )
    .await?;

    Ok(Json(response))
}

fn map_hosting_error(error: HostingServiceError) -> ApiError {
    match error {
        HostingServiceError::GhNotInstalled => ApiError::bad_request(
            "GitHub CLI (gh) is not installed",
            "HOSTING_GH_NOT_INSTALLED",
        ),
        HostingServiceError::GhAuthRequired(message) => {
            ApiError::bad_request(message, "HOSTING_GH_AUTH_REQUIRED")
        }
        HostingServiceError::PullRequestViewFailed(message) => {
            ApiError::bad_request(message, "HOSTING_PR_VIEW_FAILED")
        }
        HostingServiceError::PullRequestCreateFailed(message) => {
            ApiError::bad_request(message, "HOSTING_PR_CREATE_FAILED")
        }
    }
}

fn current_pull_request_to_contract(
    result: CurrentPullRequestResult,
) -> CurrentPullRequestResponse {
    CurrentPullRequestResponse {
        pull_request: result.pull_request.map(pull_request_summary_to_contract),
    }
}

fn create_pull_request_to_contract(result: CreatePullRequestResult) -> CreatePullRequestResponse {
    CreatePullRequestResponse {
        pull_request: pull_request_summary_to_contract(result.pull_request),
        manual_url: result.manual_url,
    }
}

fn pull_request_summary_to_contract(
    summary: InternalPullRequestSummary,
) -> ContractPullRequestSummary {
    ContractPullRequestSummary {
        number: summary.number,
        title: summary.title,
        url: summary.url,
        state: pull_request_state_to_contract(summary.state),
        draft: summary.draft,
        head_branch: summary.head_branch,
        base_branch: summary.base_branch,
    }
}

fn pull_request_state_to_contract(state: InternalPullRequestState) -> ContractPullRequestState {
    match state {
        InternalPullRequestState::Open => ContractPullRequestState::Open,
        InternalPullRequestState::Closed => ContractPullRequestState::Closed,
        InternalPullRequestState::Merged => ContractPullRequestState::Merged,
    }
}
