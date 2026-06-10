use std::time::Instant;

use anyharness_contract::v1::{
    CreateWorktreeWorkspaceRequest, CreateWorktreeWorkspaceResponse,
    WorktreeCheckoutMode as ContractWorktreeCheckoutMode,
    WorktreeNameConflictPolicy as ContractWorktreeNameConflictPolicy,
};
use axum::{extract::State, http::HeaderMap, Json};

use super::access::map_access_error;
use super::error::ApiError;
use super::workspaces_contract::{request_origin_or_api_default, workspace_to_contract};
use super::workspaces_setup::map_workspace_setup_error;
use crate::app::AppState;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::worktree_checkout::WorktreeCheckoutMode;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
use crate::domains::workspaces::worktree_runtime::{
    CreateWorktreeWorkflowError, CreateWorktreeWorkflowInput,
};
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

#[utoipa::path(
    post,
    path = "/v1/workspaces/worktrees",
    request_body = CreateWorktreeWorkspaceRequest,
    responses(
        (status = 200, description = "Created worktree workspace", body = CreateWorktreeWorkspaceResponse),
        (status = 400, description = "Invalid request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Source workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn create_worktree(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateWorktreeWorkspaceRequest>,
) -> Result<Json<CreateWorktreeWorkspaceResponse>, ApiError> {
    let span = FlowHeaders::from_headers(&headers).span();
    async move {
        let started = Instant::now();
        let repo_root_id = req.repo_root_id;
        let target_path = req.target_path;
        let new_branch_name = req.new_branch_name;
        let checkout_mode = req
            .checkout_mode
            .map(worktree_checkout_mode_from_contract)
            .unwrap_or_default();
        let name_conflict_policy = req
            .name_conflict_policy
            .map(worktree_name_conflict_policy_from_contract)
            .unwrap_or_default();
        let base_branch = req.base_branch.clone();
        let setup_script = req.setup_script;
        let origin = request_origin_or_api_default(req.origin, "create_worktree");
        let creator_context = req
            .creator_context
            .map(WorkspaceCreatorContext::from_contract);
        let has_setup_script = setup_script
            .as_deref()
            .map(str::trim)
            .map(|script| !script.is_empty())
            .unwrap_or(false);
        tracing::info!(
            repo_root_id = %repo_root_id,
            has_setup_script,
            "[workspace-latency] workspace.http.worktree.request_received"
        );

        state
            .workspace_access_gate
            .assert_can_mutate_for_repo_root(&repo_root_id)
            .map_err(map_access_error)?;

        let result = state
            .workspace_worktree_runtime
            .create_worktree(CreateWorktreeWorkflowInput {
                repo_root_id: repo_root_id.clone(),
                target_path,
                new_branch_name,
                base_branch: base_branch.clone(),
                checkout_mode,
                setup_script,
                surface: "standard".to_string(),
                name_conflict_policy,
                origin,
                creator_context,
            })
            .await
            .map_err(map_create_worktree_error)?;

        tracing::info!(
            workspace_id = %result.worktree.workspace.id,
            repo_root_id = %repo_root_id,
            has_setup_script,
            setup_started = result.setup_started,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.http.worktree.completed"
        );

        Ok(Json(CreateWorktreeWorkspaceResponse {
            workspace: workspace_to_contract(&state, result.worktree.workspace).await?,
            setup_script: None,
        }))
    }
    .instrument(span)
    .await
}

fn worktree_checkout_mode_from_contract(
    value: ContractWorktreeCheckoutMode,
) -> WorktreeCheckoutMode {
    match value {
        ContractWorktreeCheckoutMode::NewBranch => WorktreeCheckoutMode::NewBranch,
        ContractWorktreeCheckoutMode::DetachedRef => WorktreeCheckoutMode::DetachedRef,
    }
}

fn worktree_name_conflict_policy_from_contract(
    value: ContractWorktreeNameConflictPolicy,
) -> WorktreeNameConflictPolicy {
    match value {
        ContractWorktreeNameConflictPolicy::Fail => WorktreeNameConflictPolicy::Fail,
        ContractWorktreeNameConflictPolicy::SuffixPath => WorktreeNameConflictPolicy::SuffixPath,
        ContractWorktreeNameConflictPolicy::SuffixPathAndBranch => {
            WorktreeNameConflictPolicy::SuffixPathAndBranch
        }
    }
}

fn map_create_worktree_error(error: CreateWorktreeWorkflowError) -> ApiError {
    match error {
        CreateWorktreeWorkflowError::CreateTaskFailed(error) => {
            ApiError::internal(format!("worktree task failed: {error}"))
        }
        CreateWorktreeWorkflowError::Create(error) => {
            ApiError::bad_request(error.to_string(), "WORKTREE_CREATE_FAILED")
        }
        CreateWorktreeWorkflowError::Setup(error) => map_workspace_setup_error(error),
    }
}
