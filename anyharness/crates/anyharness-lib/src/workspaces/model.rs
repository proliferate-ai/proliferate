#[derive(Debug, Clone)]
pub struct WorkspaceRecord {
    pub id: String,
    pub kind: String,
    pub surface_kind: String,
    pub is_internal: bool,
    pub path: String,
    pub source_repo_root_path: String,
    pub source_workspace_id: Option<String>,
    pub git_provider: Option<String>,
    pub git_owner: Option<String>,
    pub git_repo_name: Option<String>,
    pub original_branch: Option<String>,
    pub current_branch: Option<String>,
    pub display_name: Option<String>,
    pub default_session_id: Option<String>,
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
