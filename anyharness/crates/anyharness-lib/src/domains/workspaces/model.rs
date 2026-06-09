use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::origin::OriginContext;

#[derive(Debug, Clone)]
pub struct WorkspaceRecord {
    pub id: String,
    pub kind: WorkspaceKind,
    pub repo_root_id: String,
    pub path: String,
    pub surface: WorkspaceSurface,
    pub original_branch: Option<String>,
    pub current_branch: Option<String>,
    pub display_name: Option<String>,
    pub origin: Option<OriginContext>,
    pub creator_context: Option<WorkspaceCreatorContext>,
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    pub cleanup_error_message: Option<String>,
    pub cleanup_failed_at: Option<String>,
    pub cleanup_attempted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceKind {
    Local,
    Worktree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceSurface {
    Standard,
    Cowork,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceLifecycleState {
    Active,
    Retired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceCleanupState {
    None,
    Pending,
    Complete,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceCleanupOperation {
    Retire,
    Purge,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown workspace {field}: {value}")]
pub struct WorkspaceModelError {
    field: &'static str,
    value: String,
}

impl WorkspaceModelError {
    fn unknown(field: &'static str, value: &str) -> Self {
        Self {
            field,
            value: value.to_string(),
        }
    }
}

impl WorkspaceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Worktree => "worktree",
        }
    }
}

impl WorkspaceSurface {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Cowork => "cowork",
        }
    }
}

impl WorkspaceLifecycleState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Retired => "retired",
        }
    }
}

impl WorkspaceCleanupState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Pending => "pending",
            Self::Complete => "complete",
            Self::Failed => "failed",
        }
    }
}

impl WorkspaceCleanupOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Retire => "retire",
            Self::Purge => "purge",
        }
    }
}

impl TryFrom<&str> for WorkspaceKind {
    type Error = WorkspaceModelError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "local" => Ok(Self::Local),
            "worktree" => Ok(Self::Worktree),
            _ => Err(WorkspaceModelError::unknown("kind", value)),
        }
    }
}

impl TryFrom<&str> for WorkspaceSurface {
    type Error = WorkspaceModelError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "standard" => Ok(Self::Standard),
            "cowork" => Ok(Self::Cowork),
            _ => Err(WorkspaceModelError::unknown("surface", value)),
        }
    }
}

impl TryFrom<&str> for WorkspaceLifecycleState {
    type Error = WorkspaceModelError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "active" => Ok(Self::Active),
            "retired" => Ok(Self::Retired),
            _ => Err(WorkspaceModelError::unknown("lifecycle_state", value)),
        }
    }
}

impl TryFrom<&str> for WorkspaceCleanupState {
    type Error = WorkspaceModelError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "none" => Ok(Self::None),
            "pending" => Ok(Self::Pending),
            "complete" => Ok(Self::Complete),
            "failed" => Ok(Self::Failed),
            _ => Err(WorkspaceModelError::unknown("cleanup_state", value)),
        }
    }
}

impl TryFrom<&str> for WorkspaceCleanupOperation {
    type Error = WorkspaceModelError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "retire" => Ok(Self::Retire),
            "purge" => Ok(Self::Purge),
            _ => Err(WorkspaceModelError::unknown("cleanup_operation", value)),
        }
    }
}

macro_rules! impl_workspace_display {
    ($ty:ty) => {
        impl std::fmt::Display for $ty {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

impl_workspace_display!(WorkspaceKind);
impl_workspace_display!(WorkspaceSurface);
impl_workspace_display!(WorkspaceLifecycleState);
impl_workspace_display!(WorkspaceCleanupState);
impl_workspace_display!(WorkspaceCleanupOperation);

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
