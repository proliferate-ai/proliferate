use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorkspaceRetireBlocker,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeInventoryState {
    Associated,
    OrphanCheckout,
    MissingCheckout,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeInventoryAction {
    PruneCheckout,
    DeleteWorkspaceHistory,
    RetryPurge,
    DeleteOrphanCheckout,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInventoryWorkspaceSummary {
    pub id: String,
    pub kind: WorkspaceKind,
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub session_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInventoryRow {
    pub id: String,
    pub state: WorktreeInventoryState,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_path: Option<String>,
    pub managed: bool,
    pub materialized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_root_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub associated_workspaces: Vec<WorktreeInventoryWorkspaceSummary>,
    pub total_session_count: usize,
    pub blockers: Vec<WorkspaceRetireBlocker>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_state: Option<WorkspaceCleanupState>,
    pub available_actions: Vec<WorktreeInventoryAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInventoryResponse {
    pub rows: Vec<WorktreeInventoryRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PruneOrphanWorktreeRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRetentionPolicy {
    pub max_materialized_worktrees_per_repo: u32,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorktreeRetentionPolicyRequest {
    pub max_materialized_worktrees_per_repo: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeRetentionRowOutcome {
    Retired,
    Blocked,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRetentionRunRow {
    pub workspace_id: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_root_id: Option<String>,
    pub outcome: WorktreeRetentionRowOutcome,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunWorktreeRetentionResponse {
    pub policy: WorktreeRetentionPolicy,
    pub already_running: bool,
    pub considered_count: usize,
    pub attempted_count: usize,
    pub retired_count: usize,
    pub blocked_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub more_eligible_remaining: bool,
    pub rows: Vec<WorktreeRetentionRunRow>,
}
