use anyharness_contract::v1::{
    PruneOrphanWorktreeRequest, RunWorktreeRetentionResponse, UpdateWorktreeRetentionPolicyRequest,
    WorktreeInventoryResponse, WorktreeRetentionPolicy, WorktreeRetentionRunRow,
};
use axum::{extract::State, Json};

use super::error::ApiError;
use crate::app::AppState;

#[utoipa::path(
    get,
    path = "/v1/worktrees/inventory",
    responses((status = 200, description = "Worktree inventory", body = WorktreeInventoryResponse)),
    tag = "worktrees"
)]
pub async fn get_worktree_inventory(
    State(state): State<AppState>,
) -> Result<Json<WorktreeInventoryResponse>, ApiError> {
    state
        .worktree_inventory_service
        .inventory()
        .map(Json)
        .map_err(|error| ApiError::internal(error.to_string()))
}

#[utoipa::path(
    post,
    path = "/v1/worktrees/orphans/prune",
    request_body = PruneOrphanWorktreeRequest,
    responses((status = 200, description = "Updated worktree inventory", body = WorktreeInventoryResponse)),
    tag = "worktrees"
)]
pub async fn prune_orphan_worktree(
    State(state): State<AppState>,
    Json(request): Json<PruneOrphanWorktreeRequest>,
) -> Result<Json<WorktreeInventoryResponse>, ApiError> {
    let service = state.worktree_inventory_service.clone();
    tokio::task::spawn_blocking(move || service.prune_orphan(&request.path))
        .await
        .map_err(|error| ApiError::internal(format!("worktree prune task failed: {error}")))?
        .map(Json)
        .map_err(|error| ApiError::bad_request(error.to_string(), "WORKTREE_PRUNE_FAILED"))
}

#[utoipa::path(
    get,
    path = "/v1/worktrees/retention-policy",
    responses((status = 200, description = "Worktree retention policy", body = WorktreeRetentionPolicy)),
    tag = "worktrees"
)]
pub async fn get_worktree_retention_policy(
    State(state): State<AppState>,
) -> Result<Json<WorktreeRetentionPolicy>, ApiError> {
    state
        .workspace_retention_service
        .get_policy()
        .map(policy_to_contract)
        .map(Json)
        .map_err(|error| ApiError::internal(error.to_string()))
}

#[utoipa::path(
    put,
    path = "/v1/worktrees/retention-policy",
    request_body = UpdateWorktreeRetentionPolicyRequest,
    responses(
        (status = 200, description = "Updated worktree retention policy", body = WorktreeRetentionPolicy),
        (status = 400, description = "Invalid retention policy", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "worktrees"
)]
pub async fn update_worktree_retention_policy(
    State(state): State<AppState>,
    Json(request): Json<UpdateWorktreeRetentionPolicyRequest>,
) -> Result<Json<WorktreeRetentionPolicy>, ApiError> {
    state
        .workspace_retention_service
        .update_policy(request.max_materialized_worktrees_per_repo)
        .map(policy_to_contract)
        .map(Json)
        .map_err(|error| {
            ApiError::bad_request(error.to_string(), "WORKTREE_RETENTION_POLICY_INVALID")
        })
}

#[utoipa::path(
    post,
    path = "/v1/worktrees/retention/run",
    responses((status = 200, description = "Worktree retention run result", body = RunWorktreeRetentionResponse)),
    tag = "worktrees"
)]
pub async fn run_worktree_retention(
    State(state): State<AppState>,
) -> Result<Json<RunWorktreeRetentionResponse>, ApiError> {
    state
        .workspace_retention_service
        .run_pass(None)
        .await
        .map(run_result_to_contract)
        .map(Json)
        .map_err(|error| ApiError::internal(error.to_string()))
}

fn policy_to_contract(
    policy: crate::workspaces::retention_policy::WorktreeRetentionPolicyRecord,
) -> WorktreeRetentionPolicy {
    WorktreeRetentionPolicy {
        max_materialized_worktrees_per_repo: policy.max_materialized_worktrees_per_repo,
        updated_at: policy.updated_at,
    }
}

fn run_result_to_contract(
    result: crate::workspaces::retention::WorktreeRetentionRunResult,
) -> RunWorktreeRetentionResponse {
    RunWorktreeRetentionResponse {
        policy: policy_to_contract(result.policy),
        already_running: result.already_running,
        considered_count: result.considered_count,
        attempted_count: result.attempted_count,
        retired_count: result.retired_count,
        blocked_count: result.blocked_count,
        skipped_count: result.skipped_count,
        failed_count: result.failed_count,
        more_eligible_remaining: result.more_eligible_remaining,
        rows: result
            .rows
            .into_iter()
            .map(|row| WorktreeRetentionRunRow {
                workspace_id: row.workspace_id,
                path: row.path,
                repo_root_id: row.repo_root_id,
                outcome: row.outcome,
                message: row.message,
            })
            .collect(),
    }
}
