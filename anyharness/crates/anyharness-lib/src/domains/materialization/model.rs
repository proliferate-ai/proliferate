//! Domain model for local repository / workspace materialization.

/// The kind of operation a ledger row records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterializationKind {
    RepoRoot,
    Workspace,
}

impl MaterializationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            MaterializationKind::RepoRoot => "repo_root",
            MaterializationKind::Workspace => "workspace",
        }
    }
}

/// Recovery state of a ledger row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterializationState {
    Running,
    Completed,
    Failed,
}

impl MaterializationState {
    pub fn as_str(&self) -> &'static str {
        match self {
            MaterializationState::Running => "running",
            MaterializationState::Completed => "completed",
            MaterializationState::Failed => "failed",
        }
    }

    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "running" => Some(MaterializationState::Running),
            "completed" => Some(MaterializationState::Completed),
            "failed" => Some(MaterializationState::Failed),
            _ => None,
        }
    }
}

/// A persisted materialization operation row.
#[derive(Debug, Clone)]
pub struct MaterializationOperationRecord {
    pub operation_id: String,
    pub kind: MaterializationKind,
    pub request_hash: String,
    pub state: MaterializationState,
    /// The repo-root kind (`managed`/`external`) this operation intends to
    /// register, recorded when the clone path is chosen so crash-after-clone
    /// recovery re-registers as `managed` instead of downgrading to `external`.
    pub intended_kind: Option<String>,
    pub repo_root_id: Option<String>,
    pub workspace_id: Option<String>,
    pub destination_path: Option<String>,
    pub observed_head_sha: Option<String>,
    pub failure_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// How a repository was acquired.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcquireOutcome {
    Cloned,
    Adopted,
    Reused,
}

/// Result of a repo-root acquisition.
#[derive(Debug, Clone)]
pub struct AcquireRepoRootResult {
    pub repo_root: crate::domains::repo_roots::model::RepoRootRecord,
    pub outcome: AcquireOutcome,
}

/// Result of an exact-ref workspace materialization.
#[derive(Debug, Clone)]
pub struct MaterializeWorkspaceResult {
    pub workspace: crate::domains::workspaces::model::WorkspaceRecord,
    pub observed_head_sha: String,
    pub outcome: crate::domains::workspaces::runtime::ExactRefOutcome,
}

/// Typed materialization failures. Mapped to RFC7807 problem codes at the API
/// boundary (400/409). Diagnostic detail must never contain credentials.
#[derive(Debug, thiserror::Error)]
pub enum MaterializationError {
    #[error("repository authentication required: {0}")]
    RepositoryAuthRequired(String),
    #[error("repository remote identity does not match the requested repository: {0}")]
    RepositoryRemoteMismatch(String),
    #[error("destination is not empty: {0}")]
    DestinationNotEmpty(String),
    #[error("destination is outside the allowed root: {0}")]
    DestinationOutsideAllowedRoot(String),
    #[error("destination conflict: {0}")]
    DestinationConflict(String),
    #[error("repo root worktree is not supported: {0}")]
    RepoRootWorktreeUnsupported(String),
    #[error("requested ref not found: {0}")]
    RequestedRefNotFound(String),
    #[error("workspace branch mismatch: {0}")]
    WorkspaceBranchMismatch(String),
    #[error("workspace head mismatch: {0}")]
    WorkspaceHeadMismatch(String),
    #[error("workspace has uncommitted changes: {0}")]
    WorkspaceDirty(String),
    #[error("workspace is busy: {0}")]
    WorkspaceBusy(String),
    #[error("materialization operation conflict: {0}")]
    OperationConflict(String),
    #[error("materialization failed: {0}")]
    Failed(String),
}

impl MaterializationError {
    /// The stable RFC7807 problem `code` for this error.
    pub fn code(&self) -> &'static str {
        match self {
            MaterializationError::RepositoryAuthRequired(_) => "REPOSITORY_AUTH_REQUIRED",
            MaterializationError::RepositoryRemoteMismatch(_) => "REPOSITORY_REMOTE_MISMATCH",
            MaterializationError::DestinationNotEmpty(_) => "DESTINATION_NOT_EMPTY",
            MaterializationError::DestinationOutsideAllowedRoot(_) => {
                "DESTINATION_OUTSIDE_ALLOWED_ROOT"
            }
            MaterializationError::DestinationConflict(_) => "DESTINATION_CONFLICT",
            MaterializationError::RepoRootWorktreeUnsupported(_) => {
                "REPO_ROOT_WORKTREE_UNSUPPORTED"
            }
            MaterializationError::RequestedRefNotFound(_) => "REQUESTED_REF_NOT_FOUND",
            MaterializationError::WorkspaceBranchMismatch(_) => "WORKSPACE_BRANCH_MISMATCH",
            MaterializationError::WorkspaceHeadMismatch(_) => "WORKSPACE_HEAD_MISMATCH",
            MaterializationError::WorkspaceDirty(_) => "WORKSPACE_DIRTY",
            MaterializationError::WorkspaceBusy(_) => "WORKSPACE_BUSY",
            MaterializationError::OperationConflict(_) => "MATERIALIZATION_OPERATION_CONFLICT",
            MaterializationError::Failed(_) => "MATERIALIZATION_FAILED",
        }
    }

    /// Whether the mapped HTTP status is 409 (conflict) rather than 400.
    pub fn is_conflict(&self) -> bool {
        matches!(
            self,
            MaterializationError::DestinationNotEmpty(_)
                | MaterializationError::DestinationConflict(_)
                | MaterializationError::WorkspaceBranchMismatch(_)
                | MaterializationError::WorkspaceHeadMismatch(_)
                | MaterializationError::WorkspaceDirty(_)
                | MaterializationError::WorkspaceBusy(_)
                | MaterializationError::OperationConflict(_)
        )
    }

    /// The failure_code persisted on a failed ledger row (None for
    /// OperationConflict, which is not a durable failure of the underlying op).
    pub fn ledger_failure_code(&self) -> Option<&'static str> {
        match self {
            MaterializationError::OperationConflict(_) => None,
            other => Some(other.code()),
        }
    }
}
