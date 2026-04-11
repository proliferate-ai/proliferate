use super::model::WorkspaceRecord;

#[derive(Debug, thiserror::Error)]
pub enum ResolveRepoRootError {
    #[error("Selected folder is not a Git repository.")]
    NotGitRepo,
    #[error("Select the main repository root, not a worktree.")]
    WorktreeNotAllowed,
    #[error(transparent)]
    Unexpected(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum RegisterRepoWorkspaceError {
    #[error("Selected folder is not a Git repository.")]
    NotGitRepo,
    #[error("Select the main repository root, not a worktree.")]
    WorktreeNotAllowed,
    #[error(transparent)]
    Unexpected(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum SetWorkspaceDisplayNameError {
    #[error("Workspace not found: {0}")]
    NotFound(String),
    #[error("Workspace display name cannot exceed {0} characters")]
    TooLong(usize),
    #[error(transparent)]
    Unexpected(#[from] anyhow::Error),
}

// ---------------------------------------------------------------------------
// Project setup detection (internal types — converted to wire types in handler)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetectedHintCategory {
    BuildTool,
    SecretSync,
}

#[derive(Debug, Clone)]
pub struct DetectedSetupHint {
    pub id: String,
    pub label: String,
    pub suggested_command: String,
    pub detected_file: String,
    pub category: DetectedHintCategory,
}

#[derive(Debug, Clone)]
pub struct ProjectSetupDetectionResult {
    pub hints: Vec<DetectedSetupHint>,
}

// ---------------------------------------------------------------------------
// Setup script execution
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupScriptExecutionStatus {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone)]
pub struct SetupScriptExecutionResult {
    pub command: String,
    pub status: SetupScriptExecutionStatus,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct CreateWorktreeResult {
    pub workspace: WorkspaceRecord,
    pub setup_script: Option<SetupScriptExecutionResult>,
}
