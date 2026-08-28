use std::path::PathBuf;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeBaseFetch {
    Fetched,
    NoRemote,
    Failed { message: String },
    TimedOut,
}

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
    BaseWorktree,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRevertPatchOperation {
    Create,
    Edit,
    Delete,
    Move,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitStatusSummaryState {
    Clean,
    Dirty,
    Conflicted,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitWorktreeRestoreOutcome {
    Restored,
    AlreadyPresent,
}

#[derive(Debug, thiserror::Error)]
pub enum GitWorktreeRestoreError {
    #[error("repository checkout is missing at {path}")]
    RepositoryMissing { path: String },
    #[error("repository checkout at {path} is not a usable Git repository")]
    RepositoryInvalid { path: String },
    #[error("recorded branch '{branch}' no longer exists in the repository")]
    BranchMissing { branch: String },
    #[error("the parent directory for the recorded worktree path is unavailable: {path}")]
    DestinationParentUnavailable { path: String },
    #[error("the recorded worktree path is occupied and will not be overwritten: {path}")]
    DestinationOccupied { path: String },
    #[error("Git has a conflicting worktree registration at {path}: {detail}")]
    RegistrationConflict { path: String, detail: String },
    #[error("branch '{branch}' is already checked out in another worktree at {path}")]
    BranchCheckedOutElsewhere { branch: String, path: String },
    #[error("Git worktree state is ambiguous: {detail}")]
    AmbiguousState { detail: String },
    #[error("Git could not restore the worktree: {detail}")]
    OperationFailed { detail: String },
}

#[derive(Debug, Clone)]
pub struct GitStatusSummarySnapshot {
    pub state: GitStatusSummaryState,
    pub clean: bool,
    pub conflicted: bool,
    pub changed_file_count: u32,
    pub untracked_file_count: u32,
    pub ahead: u32,
    pub behind: u32,
    pub branch: Option<String>,
    pub upstream_branch: Option<String>,
    pub error_message: Option<String>,
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

#[derive(Debug, Clone)]
pub struct GitRevertPatchEntry {
    pub path: String,
    pub old_path: Option<String>,
    pub operation: GitRevertPatchOperation,
    pub patch: String,
    pub patch_truncated: bool,
}

#[derive(Debug, Clone)]
pub struct GitRevertPatchesResult {
    pub reverted_paths: Vec<String>,
    pub head_oid_before: String,
    pub head_oid_after: String,
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

/// A plain projection of a `git worktree list --porcelain` registration,
/// public so callers outside the git adapter (R4's in-use check) can read
/// registrations through the adapter instead of re-parsing porcelain output
/// themselves. Mirrors the shape the adapter already parses internally in
/// `operations/worktree_restore_registry.rs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRegistration {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub prunable: bool,
    pub locked: bool,
}

/// Outcome of a forced worktree removal (`operations/worktrees.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeRemoveOutcome {
    Removed,
    /// Git reported exit 128 "is not a working tree" and nothing exists at
    /// the path: the registration was already gone and there is nothing to
    /// remove. Distinguished from a real failure by a post-call stat.
    AlreadyGone,
}

/// Typed failure of a forced worktree removal.
#[derive(Debug, thiserror::Error)]
pub enum WorktreeRemoveError {
    #[error("git worktree remove failed for {path}: {detail}")]
    Failed { path: String, detail: String },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// The evidence the three archive planes (sessions, terminals, agent
/// processes) actually killed before an archive capture runs. Lives in the
/// git adapter, not `domains/workspaces/archive/quiesce.rs` (which the ADR
/// names), because `scripts/check_anyharness_boundaries.py`'s
/// `ADAPTERS_PRODUCT_DOMAIN_IMPORT` gate bars `adapters/**` from importing
/// `crate::domains::**`, and `repair_kill_debris` (an adapter function) must
/// consume this type. R4's `quiesce.rs` constructs and re-exports it.
#[derive(Debug, Clone, Copy)]
pub struct QuiesceReport {
    /// Total processes the three planes actually killed.
    pub killed: usize,
    /// Of those, git processes specifically (matched by the kill's own pid
    /// check). The ownership proof for kill-debris repair: a nonzero count
    /// proves a post-quiesce conflict sentinel can be our own kill's debris.
    pub killed_git: usize,
    /// When every plane confirmed dead. Bounds which lock files can still
    /// have a living owner.
    pub completed_at: SystemTime,
}

/// A single notice threaded through the archive capture's response and
/// persisted (the partial-capture variants) on the row as
/// `partial_capture_json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotNotice {
    DirtySubmodule {
        paths: Vec<String>,
    },
    EmbeddedRepo {
        paths: Vec<String>,
    },
    PartialCaptureUntracked {
        paths: Vec<String>,
    },
    PartialCaptureTracked {
        paths: Vec<String>,
    },
    /// Raised by `repair_kill_debris`, never by the capture itself.
    AbortedGitOperation {
        operation: String,
    },
}

/// The typed refusals and failures `snapshot_workspace`, `probe_refusals`,
/// `repair_kill_debris`, `restore_snapshot`, and `restore_trees` can produce.
/// R4 maps each variant onto a distinct wire code; `Internal` carries every
/// mechanical git failure, matching the house style of `CommitError` /
/// `PushError` / `GitDiffError` above.
#[derive(Debug, thiserror::Error)]
pub enum SnapshotError {
    #[error("the workspace directory is not the root of its own git repository")]
    HollowCheckout { path: String },
    #[error("a git {operation} is in progress")]
    GitOperationInProgress { operation: String },
    #[error("the branch has no commits yet")]
    UnbornHead,
    #[error("git is locked by {file}")]
    GitLocked { file: String },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum GitRevertPatchesError {
    #[error("nothing to undo")]
    NothingToRevert,
    #[error("cannot undo because a patch is missing for {path}")]
    MissingPatch { path: String },
    #[error("cannot undo because a patch was truncated for {path}")]
    TruncatedPatch { path: String },
    #[error("cannot undo unsafe path {path}")]
    UnsafePath { path: String },
    #[error("cannot undo because {path} has partially staged changes")]
    PartialStaging { path: String },
    #[error("cannot undo because {path} has staged changes")]
    StagedChanges { path: String },
    #[error("cannot undo while git is resolving an operation")]
    ConflictedOperation,
    #[error("cannot undo patch for {path}: {message}")]
    PatchRejected { path: String, message: String },
    #[error("git undo failed: {message}")]
    GitFailed { message: String },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
