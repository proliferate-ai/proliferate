use anyharness_contract::v1::{
    BranchPullRequestStatus as ContractBranchPullRequestStatus,
    BranchPullRequestSummary as ContractBranchPullRequestSummary, CreatePullRequestRequest,
    CreatePullRequestResponse, CurrentPullRequestResponse,
    PullRequestChecksState as ContractPullRequestChecksState,
    PullRequestReviewDecision as ContractPullRequestReviewDecision,
    PullRequestState as ContractPullRequestState, PullRequestSummary as ContractPullRequestSummary,
    RepoPullRequestStatusesResponse,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};

use super::access::{assert_workspace_mutable, assert_workspace_not_retired};
use super::blocking::run_blocking;
use super::error::ApiError;
use crate::adapters::hosting::types::{
    BranchPullRequestStatus as InternalBranchPullRequestStatus, CreatePullRequestResult,
    CurrentPullRequestResult, HostingServiceError,
    PullRequestChecksState as InternalPullRequestChecksState,
    PullRequestReviewDecision as InternalPullRequestReviewDecision,
    PullRequestState as InternalPullRequestState, PullRequestSummary as InternalPullRequestSummary,
    RepoPullRequestStatusesResult,
};
use crate::adapters::hosting::HostingService;
use crate::app::AppState;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::domains::workspaces::store::WorkspaceStore;

fn resolve_workspace_path(
    workspace_runtime: &crate::domains::workspaces::runtime::WorkspaceRuntime,
    workspace_id: &str,
) -> Result<std::path::PathBuf, ApiError> {
    let workspace = workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("Workspace not found", "WORKSPACE_NOT_FOUND"))?;

    Ok(std::path::PathBuf::from(workspace.path))
}

#[derive(Clone, Copy)]
enum HostingTaskAccess {
    Read,
    Write,
}

async fn run_hosting_task<T, F>(
    state: &AppState,
    workspace_id: String,
    access: HostingTaskAccess,
    task_label: &'static str,
    task: F,
) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(std::path::PathBuf) -> Result<T, ApiError> + Send + 'static,
{
    // Acquire exactly one operation lease per request. Nested read leases can
    // deadlock behind a queued exclusive retire lease.
    let operation_kind = match access {
        HostingTaskAccess::Read => WorkspaceOperationKind::MaterializationRead,
        HostingTaskAccess::Write => WorkspaceOperationKind::HostingWrite,
    };
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, operation_kind)
        .await;
    match access {
        HostingTaskAccess::Read => assert_workspace_not_retired(state, &workspace_id)?,
        HostingTaskAccess::Write => assert_workspace_mutable(state, &workspace_id)?,
    }
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
        HostingTaskAccess::Read,
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
    let title = req.title;
    let body = req.body;
    let base_branch = req.base_branch;
    let draft = req.draft;
    let pr_status_cache = state.pr_status_cache.clone();
    let response = run_hosting_task(
        &state,
        workspace_id,
        HostingTaskAccess::Write,
        "create pull request",
        move |workspace_path| {
            HostingService::create_pull_request(
                &workspace_path,
                &title,
                body.as_deref(),
                &base_branch,
                draft,
                &pr_status_cache,
            )
            .map(create_pull_request_to_contract)
            .map_err(map_hosting_error)
        },
    )
    .await?;

    Ok(Json(response))
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct RepoPullRequestStatusesQuery {
    /// "1" requests a refresh (honored with a 10s floor); anything else uses
    /// the default 60s throttle window.
    #[serde(default)]
    pub refresh: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/repo-roots/{repo_root_id}/hosting/pull-requests",
    params(
        ("repo_root_id" = String, Path, description = "Repo root ID"),
        ("refresh" = Option<String>, Query, description = "Set to 1 to request a refresh (10s floor); default 0 serves the 60s throttle window"),
    ),
    responses(
        (status = 200, description = "Branch-scoped pull request statuses for the repo root's active workspace branches", body = RepoPullRequestStatusesResponse),
        (status = 404, description = "Repo root not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Hosting error", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "hosting"
)]
pub async fn get_repo_pull_request_statuses(
    State(state): State<AppState>,
    Path(repo_root_id): Path<String>,
    Query(query): Query<RepoPullRequestStatusesQuery>,
) -> Result<Json<RepoPullRequestStatusesResponse>, ApiError> {
    let refresh = matches!(query.refresh.as_deref(), Some("1") | Some("true"));

    // Repo-root-not-found is a coded ProblemDetails 404 so clients can tell
    // it apart from a bare axum 404 on older daemons missing this route.
    let repo_root_service = state.repo_root_service.clone();
    let lookup_id = repo_root_id.clone();
    let repo_root = run_blocking("get repo root", move || {
        repo_root_service.get_repo_root(&lookup_id)
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?
    .ok_or_else(|| ApiError::not_found("Repo root not found", "REPO_ROOT_NOT_FOUND"))?;

    // The daemon derives the branch set itself: distinct current branches
    // over the repo root's non-retired workspaces (clients send nothing).
    let workspace_store = WorkspaceStore::new(state.db.clone());
    let workspaces = run_blocking("list active repo root workspaces", move || {
        workspace_store.list_active_by_repo_root_id(&repo_root_id)
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?;
    let active_branches: Vec<String> = workspaces
        .into_iter()
        .filter_map(|workspace| workspace.current_branch)
        .filter(|branch| !branch.is_empty())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();

    // Reads the repo root only — never a worktree — so no workspace
    // operation lease is taken (cannot race retire/purge).
    let result = HostingService::list_repo_pull_requests(
        &repo_root.path,
        active_branches,
        refresh,
        &state.pr_status_cache,
    )
    .await
    .map_err(map_hosting_error)?;

    Ok(Json(repo_pull_request_statuses_to_contract(result)))
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
        HostingServiceError::RemoteUnsupported(message) => {
            ApiError::bad_request(message, "HOSTING_REMOTE_UNSUPPORTED")
        }
        HostingServiceError::PullRequestViewFailed(message) => {
            ApiError::bad_request(message, "HOSTING_PR_VIEW_FAILED")
        }
        HostingServiceError::PullRequestCreateFailed(message) => {
            ApiError::bad_request(message, "HOSTING_PR_CREATE_FAILED")
        }
    }
}

fn repo_pull_request_statuses_to_contract(
    result: RepoPullRequestStatusesResult,
) -> RepoPullRequestStatusesResponse {
    RepoPullRequestStatusesResponse {
        entries: result
            .entries
            .into_iter()
            .map(branch_status_to_contract)
            .collect(),
        fetched_at: result.fetched_at,
    }
}

fn branch_status_to_contract(
    status: InternalBranchPullRequestStatus,
) -> ContractBranchPullRequestStatus {
    ContractBranchPullRequestStatus {
        head_branch: status.head_branch,
        pull_request: status
            .pull_request
            .map(branch_pull_request_summary_to_contract),
    }
}

fn branch_pull_request_summary_to_contract(
    summary: InternalPullRequestSummary,
) -> ContractBranchPullRequestSummary {
    ContractBranchPullRequestSummary {
        number: summary.number,
        title: summary.title,
        url: summary.url,
        state: pull_request_state_to_contract(summary.state),
        draft: summary.draft,
        head_branch: summary.head_branch,
        base_branch: summary.base_branch,
        checks: summary.checks.map(checks_state_to_contract),
        review_decision: summary.review_decision.map(review_decision_to_contract),
    }
}

fn checks_state_to_contract(
    state: InternalPullRequestChecksState,
) -> ContractPullRequestChecksState {
    match state {
        InternalPullRequestChecksState::None => ContractPullRequestChecksState::None,
        InternalPullRequestChecksState::Pending => ContractPullRequestChecksState::Pending,
        InternalPullRequestChecksState::Passing => ContractPullRequestChecksState::Passing,
        InternalPullRequestChecksState::Failing => ContractPullRequestChecksState::Failing,
    }
}

fn review_decision_to_contract(
    decision: InternalPullRequestReviewDecision,
) -> ContractPullRequestReviewDecision {
    match decision {
        InternalPullRequestReviewDecision::None => ContractPullRequestReviewDecision::None,
        InternalPullRequestReviewDecision::Approved => ContractPullRequestReviewDecision::Approved,
        InternalPullRequestReviewDecision::ChangesRequested => {
            ContractPullRequestReviewDecision::ChangesRequested
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
