use crate::origin::OriginContext;
use crate::workspaces::creator_context::WorkspaceCreatorContext;

#[derive(Debug, Clone)]
pub struct WorkspaceRecord {
    pub id: String,
    pub kind: String,
    pub repo_root_id: Option<String>,
    pub path: String,
    pub surface: String,
    pub source_repo_root_path: String,
    pub source_workspace_id: Option<String>,
    pub git_provider: Option<String>,
    pub git_owner: Option<String>,
    pub git_repo_name: Option<String>,
    pub original_branch: Option<String>,
    pub current_branch: Option<String>,
    pub display_name: Option<String>,
    pub origin: Option<OriginContext>,
    pub creator_context: Option<WorkspaceCreatorContext>,
    pub lifecycle_state: String,
    pub cleanup_state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ResolvedGitContext {
    pub repo_root: String,
    pub is_worktree: bool,
    pub main_worktree_path: Option<String>,
    pub current_branch: Option<String>,
    pub remote_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedRemote {
    pub provider: String,
    pub owner: String,
    pub repo: String,
}
