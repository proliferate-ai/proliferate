#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum GitOperation {
    #[default]
    None,
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitIncludedState {
    Included,
    Excluded,
    Partial,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitDiffScope {
    WorkingTree,
    Unstaged,
    Staged,
    Branch,
}

#[derive(Debug, Clone)]
pub struct GitChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: GitFileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub included_state: GitIncludedState,
}

#[derive(Debug, Clone)]
pub struct GitStatusSummary {
    pub changed_files: u32,
    pub additions: u32,
    pub deletions: u32,
    pub included_files: u32,
    pub conflicted_files: u32,
}

#[derive(Debug, Clone)]
pub struct GitActionAvailability {
    pub can_commit: bool,
    pub can_push: bool,
    pub push_label: String,
    pub can_create_pull_request: bool,
    pub can_create_draft_pull_request: bool,
    pub can_create_branch_workspace: bool,
    pub reason_if_blocked: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GitStatusSnapshot {
    pub workspace_id: String,
    pub workspace_path: String,
    pub repo_root_path: String,
    pub current_branch: Option<String>,
    pub head_oid: String,
    pub detached: bool,
    pub upstream_branch: Option<String>,
    pub suggested_base_branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub operation: GitOperation,
    pub conflicted: bool,
    pub clean: bool,
    pub summary: GitStatusSummary,
    pub actions: GitActionAvailability,
    pub files: Vec<GitChangedFile>,
}

#[derive(Debug, Clone)]
pub struct GitDiffResult {
    pub path: String,
    pub scope: GitDiffScope,
    pub binary: bool,
    pub truncated: bool,
    pub additions: u32,
    pub deletions: u32,
    pub base_ref: Option<String>,
    pub resolved_base_oid: Option<String>,
    pub merge_base_oid: Option<String>,
    pub head_oid: Option<String>,
    pub patch: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GitDiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: GitFileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
}

#[derive(Debug, Clone)]
pub struct GitBranchDiffFilesResult {
    pub base_ref: String,
    pub resolved_base_oid: String,
    pub merge_base_oid: String,
    pub head_oid: String,
    pub files: Vec<GitDiffFile>,
}

#[derive(Debug, Clone)]
pub struct GitBranch {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub is_default: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CommitError {
    #[error("nothing staged to commit")]
    NothingStaged,
    #[error("git commit failed: {message}")]
    Failed { message: String },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum PushError {
    #[error("cannot push a detached HEAD")]
    DetachedHead,
    #[error("push rejected by remote: {message}")]
    Rejected { message: String },
    #[error("git push failed: {message}")]
    Failed { message: String },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum GitDiffError {
    #[error("invalid git diff base ref")]
    InvalidBaseRef,
    #[error("git diff base ref not found")]
    BaseRefNotFound,
    #[error("git diff merge base not found")]
    MergeBaseNotFound,
    #[error("git diff failed: {message}")]
    GitFailed { message: String },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
