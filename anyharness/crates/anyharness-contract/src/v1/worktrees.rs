use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRetireBlocker};

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
    DeleteOrphanCheckout,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInventoryWorkspaceSummary {
    pub id: String,
    pub kind: WorkspaceKind,
    pub lifecycle_state: WorkspaceLifecycleState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub session_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeGitStatusState {
    Clean,
    Dirty,
    Conflicted,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeGitStatusSummary {
    pub state: WorktreeGitStatusState,
    pub clean: bool,
    pub conflicted: bool,
    pub changed_file_count: u32,
    pub untracked_file_count: u32,
    pub ahead: u32,
    pub behind: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStorageEstimate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sqlite_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_status: Option<WorktreeGitStatusSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<WorktreeStorageEstimate>,
    pub blockers: Vec<WorkspaceRetireBlocker>,
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
