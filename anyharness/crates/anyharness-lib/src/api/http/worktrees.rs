use anyharness_contract::v1::{
    PruneOrphanWorktreeRequest, WorkspaceKind as ContractWorkspaceKind,
    WorkspaceLifecycleState as ContractWorkspaceLifecycleState, WorkspaceRetireBlocker,
    WorktreeGitStatusState as ContractWorktreeGitStatusState,
    WorktreeGitStatusSummary as ContractWorktreeGitStatusSummary,
    WorktreeInventoryAction as ContractWorktreeInventoryAction, WorktreeInventoryResponse,
    WorktreeInventoryRow as ContractWorktreeInventoryRow,
    WorktreeInventoryState as ContractWorktreeInventoryState,
    WorktreeInventoryWorkspaceSummary as ContractWorktreeInventoryWorkspaceSummary,
    WorktreeStorageEstimate as ContractWorktreeStorageEstimate,
};
use axum::{extract::State, Json};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::workspaces::inventory::{
    WorkspaceKind, WorkspaceLifecycleState, WorktreeGitStatusState, WorktreeGitStatusSummary,
    WorktreeInventory, WorktreeInventoryAction, WorktreeInventoryRow, WorktreeInventoryState,
    WorktreeInventoryWorkspaceSummary, WorktreeStorageEstimate,
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
    let service = state.worktree_inventory_service.clone();
    tokio::task::spawn_blocking(move || service.inventory())
        .await
        .map_err(|error| ApiError::internal(format!("worktree inventory task failed: {error}")))?
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
        git_status: row.git_status.map(worktree_git_status_to_contract),
        storage: worktree_storage_to_contract(row.storage),
        blockers: Vec::<WorkspaceRetireBlocker>::new(),
        available_actions: row
            .available_actions
            .into_iter()
            .map(worktree_inventory_action_to_contract)
            .collect(),
    }
}

fn worktree_git_status_to_contract(
    status: WorktreeGitStatusSummary,
) -> ContractWorktreeGitStatusSummary {
    ContractWorktreeGitStatusSummary {
        state: match status.state {
            WorktreeGitStatusState::Clean => ContractWorktreeGitStatusState::Clean,
            WorktreeGitStatusState::Dirty => ContractWorktreeGitStatusState::Dirty,
            WorktreeGitStatusState::Conflicted => ContractWorktreeGitStatusState::Conflicted,
            WorktreeGitStatusState::Unknown => ContractWorktreeGitStatusState::Unknown,
        },
        clean: status.clean,
        conflicted: status.conflicted,
        changed_file_count: status.changed_file_count,
        untracked_file_count: status.untracked_file_count,
        ahead: status.ahead,
        behind: status.behind,
        branch: status.branch,
        upstream_branch: status.upstream_branch,
        error_message: status.error_message,
    }
}

fn worktree_storage_to_contract(
    storage: WorktreeStorageEstimate,
) -> Option<ContractWorktreeStorageEstimate> {
    if storage.worktree_bytes.is_none()
        && storage.sqlite_bytes.is_none()
        && storage.total_bytes.is_none()
    {
        return None;
    }
    Some(ContractWorktreeStorageEstimate {
        worktree_bytes: storage.worktree_bytes,
        sqlite_bytes: storage.sqlite_bytes,
        total_bytes: storage.total_bytes,
    })
}

fn worktree_inventory_workspace_to_contract(
    workspace: WorktreeInventoryWorkspaceSummary,
) -> ContractWorktreeInventoryWorkspaceSummary {
    ContractWorktreeInventoryWorkspaceSummary {
        id: workspace.id,
        kind: workspace_kind_to_contract(workspace.kind),
        lifecycle_state: workspace_lifecycle_state_to_contract(workspace.lifecycle_state),
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
        WorkspaceLifecycleState::Archived => ContractWorkspaceLifecycleState::Archived,
    }
}

