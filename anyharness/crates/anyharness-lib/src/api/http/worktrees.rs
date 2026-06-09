use anyharness_contract::v1::{
    PruneOrphanWorktreeRequest, RunWorktreeRetentionResponse, UpdateWorktreeRetentionPolicyRequest,
    WorkspaceCleanupOperation as ContractWorkspaceCleanupOperation,
    WorkspaceCleanupState as ContractWorkspaceCleanupState, WorkspaceKind as ContractWorkspaceKind,
    WorkspaceLifecycleState as ContractWorkspaceLifecycleState, WorkspaceRetireBlocker,
    WorktreeInventoryAction as ContractWorktreeInventoryAction, WorktreeInventoryResponse,
    WorktreeInventoryRow as ContractWorktreeInventoryRow,
    WorktreeInventoryState as ContractWorktreeInventoryState,
    WorktreeInventoryWorkspaceSummary as ContractWorktreeInventoryWorkspaceSummary,
    WorktreeRetentionPolicy, WorktreeRetentionRunRow,
};
use axum::{extract::State, Json};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::workspaces::inventory::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorktreeInventory, WorktreeInventoryAction, WorktreeInventoryRow, WorktreeInventoryState,
    WorktreeInventoryWorkspaceSummary,
};

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
        .map(worktree_inventory_to_contract)
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
        .map(worktree_inventory_to_contract)
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
    policy: crate::domains::workspaces::retention_policy::WorktreeRetentionPolicyRecord,
) -> WorktreeRetentionPolicy {
    WorktreeRetentionPolicy {
        max_materialized_worktrees_per_repo: policy.max_materialized_worktrees_per_repo,
        updated_at: policy.updated_at,
    }
}

fn run_result_to_contract(
    result: crate::domains::workspaces::retention::WorktreeRetentionRunResult,
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
                repo_root_id: Some(row.repo_root_id),
                outcome: row.outcome,
                message: row.message,
            })
            .collect(),
    }
}

fn worktree_inventory_to_contract(inventory: WorktreeInventory) -> WorktreeInventoryResponse {
    WorktreeInventoryResponse {
        rows: inventory
            .rows
            .into_iter()
            .map(worktree_inventory_row_to_contract)
            .collect(),
    }
}

fn worktree_inventory_row_to_contract(row: WorktreeInventoryRow) -> ContractWorktreeInventoryRow {
    ContractWorktreeInventoryRow {
        id: row.id,
        state: worktree_inventory_state_to_contract(row.state),
        path: row.path,
        canonical_path: row.canonical_path,
        managed: row.managed,
        materialized: row.materialized,
        repo_root_id: row.repo_root_id,
        repo_root_name: row.repo_root_name,
        branch: row.branch,
        associated_workspaces: row
            .associated_workspaces
            .into_iter()
            .map(worktree_inventory_workspace_to_contract)
            .collect(),
        total_session_count: row.total_session_count,
        blockers: Vec::<WorkspaceRetireBlocker>::new(),
        cleanup_operation: row
            .cleanup_operation
            .map(workspace_cleanup_operation_to_contract),
        cleanup_state: row.cleanup_state.map(workspace_cleanup_state_to_contract),
        available_actions: row
            .available_actions
            .into_iter()
            .map(worktree_inventory_action_to_contract)
            .collect(),
    }
}

fn worktree_inventory_workspace_to_contract(
    workspace: WorktreeInventoryWorkspaceSummary,
) -> ContractWorktreeInventoryWorkspaceSummary {
    ContractWorktreeInventoryWorkspaceSummary {
        id: workspace.id,
        kind: workspace_kind_to_contract(workspace.kind),
        lifecycle_state: workspace_lifecycle_state_to_contract(workspace.lifecycle_state),
        cleanup_state: workspace_cleanup_state_to_contract(workspace.cleanup_state),
        cleanup_operation: workspace
            .cleanup_operation
            .map(workspace_cleanup_operation_to_contract),
        display_name: workspace.display_name,
        branch: workspace.branch,
        session_count: workspace.session_count,
    }
}

fn worktree_inventory_state_to_contract(
    state: WorktreeInventoryState,
) -> ContractWorktreeInventoryState {
    match state {
        WorktreeInventoryState::Associated => ContractWorktreeInventoryState::Associated,
        WorktreeInventoryState::OrphanCheckout => ContractWorktreeInventoryState::OrphanCheckout,
        WorktreeInventoryState::MissingCheckout => ContractWorktreeInventoryState::MissingCheckout,
        WorktreeInventoryState::Conflict => ContractWorktreeInventoryState::Conflict,
    }
}

fn worktree_inventory_action_to_contract(
    action: WorktreeInventoryAction,
) -> ContractWorktreeInventoryAction {
    match action {
        WorktreeInventoryAction::PruneCheckout => ContractWorktreeInventoryAction::PruneCheckout,
        WorktreeInventoryAction::DeleteWorkspaceHistory => {
            ContractWorktreeInventoryAction::DeleteWorkspaceHistory
        }
        WorktreeInventoryAction::RetryPurge => ContractWorktreeInventoryAction::RetryPurge,
        WorktreeInventoryAction::DeleteOrphanCheckout => {
            ContractWorktreeInventoryAction::DeleteOrphanCheckout
        }
    }
}

fn workspace_kind_to_contract(kind: WorkspaceKind) -> ContractWorkspaceKind {
    match kind {
        WorkspaceKind::Worktree => ContractWorkspaceKind::Worktree,
        WorkspaceKind::Local => ContractWorkspaceKind::Local,
    }
}

fn workspace_lifecycle_state_to_contract(
    state: WorkspaceLifecycleState,
) -> ContractWorkspaceLifecycleState {
    match state {
        WorkspaceLifecycleState::Active => ContractWorkspaceLifecycleState::Active,
        WorkspaceLifecycleState::Retired => ContractWorkspaceLifecycleState::Retired,
    }
}

fn workspace_cleanup_state_to_contract(
    state: WorkspaceCleanupState,
) -> ContractWorkspaceCleanupState {
    match state {
        WorkspaceCleanupState::None => ContractWorkspaceCleanupState::None,
        WorkspaceCleanupState::Pending => ContractWorkspaceCleanupState::Pending,
        WorkspaceCleanupState::Complete => ContractWorkspaceCleanupState::Complete,
        WorkspaceCleanupState::Failed => ContractWorkspaceCleanupState::Failed,
    }
}

fn workspace_cleanup_operation_to_contract(
    operation: WorkspaceCleanupOperation,
) -> ContractWorkspaceCleanupOperation {
    match operation {
        WorkspaceCleanupOperation::Retire => ContractWorkspaceCleanupOperation::Retire,
        WorkspaceCleanupOperation::Purge => ContractWorkspaceCleanupOperation::Purge,
    }
}
