use std::path::Path;

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

impl WorkspaceRecord {
    /// Whether this workspace is backed by a local checkout directory on this
    /// machine whose existence is meaningful. Both current kinds (`Local` and
    /// `Worktree`) are local checkouts; a future remote/cloud-style kind would
    /// return `false` here and always be treated as available.
    pub fn has_local_checkout(&self) -> bool {
        matches!(self.kind, WorkspaceKind::Local | WorkspaceKind::Worktree)
    }

    /// True when this workspace is a local checkout whose directory has been
    /// removed from disk. Shared existence predicate used by the workspace
    /// availability signal and the session-creation pre-flight gate. Uses the
    /// same `Path::exists` check as retire pre-flight and worktree inventory.
    pub fn checkout_directory_missing(&self) -> bool {
        self.has_local_checkout() && !Path::new(&self.path).exists()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn record(kind: WorkspaceKind, path: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind,
            repo_root_id: "repo-root-1".to_string(),
            path: path.to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: None,
            current_branch: None,
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn checkout_directory_missing_true_for_deleted_local_checkout() {
        let path = std::env::temp_dir().join(format!(
            "anyharness-workspace-model-missing-{}",
            uuid::Uuid::new_v4()
        ));
        let record = record(WorkspaceKind::Worktree, &path.to_string_lossy());
        assert!(record.checkout_directory_missing());
    }

    #[test]
    fn checkout_directory_missing_false_when_directory_exists() {
        let dir = std::env::temp_dir().join(format!(
            "anyharness-workspace-model-present-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let record = record(WorkspaceKind::Local, &dir.to_string_lossy());
        assert!(!record.checkout_directory_missing());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
