//! Wire types for the archive/unarchive lifecycle transitions.
//!
//! A sibling of `workspaces.rs` rather than more lines inside it: the request,
//! response, notice, and scenario families together are larger than that
//! file's remaining headroom under `scripts/check_max_lines.py`, and a net-new
//! allowlist row would be a net-new Constitution exception. The split mirrors
//! `api/http/workspaces_lifecycle*.rs`, which owns the mapping onto these
//! types.
//!
//! Casing: struct fields serialize camelCase (repo-wide, and every workspace
//! contract struct already does), while enum VALUES stay snake_case (repo-wide
//! for enums, and these values are stable identifiers a client branches on).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::workspaces::Workspace;

/// `POST /v1/workspaces/{id}/archive` body. Both knobs are resolved by the
/// client at click time — the branch-delete host preference and the repo
/// environment's archive script — because the runtime stores neither. A
/// re-POST that converges an interrupted archive carries the same resolved
/// values; it never re-runs the script or the branch delete.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveWorkspaceRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_branch: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_script: Option<String>,
}

/// `POST /v1/workspaces/{id}/unarchive` body. `branch_strategy` and
/// `overwrite` are the answers to a previous `WORKSPACE_UNARCHIVE_SCENARIO`
/// 409; a first attempt sends neither.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnarchiveWorkspaceRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerun_setup: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_strategy: Option<WorkspaceUnarchiveBranchStrategy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceUnarchiveBranchStrategy {
    /// Create a uniquified NEW branch at the archived SHA. Never a force-move
    /// of the diverged branch, which keeps its commits.
    RecreateAtSha,
    RestoreDetached,
    /// Abandon a lost snapshot and restore the branch tip instead. Terminal:
    /// the row's archive columns are released after it.
    RestoreBranchTip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceArchiveNoticeKind {
    DirtySubmodule,
    EmbeddedRepo,
    PartialCaptureUntracked,
    PartialCaptureTracked,
    AbortedGitOperation,
}

/// One archive notice. Every field beyond `kind` is additive-optional so a
/// client that predates a notice kind can render the kinds it knows and ignore
/// the rest instead of failing to parse the envelope.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArchiveNotice {
    pub kind: WorkspaceArchiveNoticeKind,
    /// The skipped-path list for the `partial_capture_*` kinds and the
    /// affected paths for the submodule/embedded-repo kinds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    /// The git operation that was aborted, for `aborted_git_operation`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceUnarchiveNoticeKind {
    /// The row never had a snapshot (an absorbed pre-archiving row): restored
    /// at the recorded branch tip.
    NoSnapshot,
    /// Session rows reference JSONL a crashed purge already deleted.
    HistoryIncomplete,
    /// The post-restore HEAD verify failed. The workspace IS active and its
    /// files ARE restored; the snapshot is deliberately retained.
    HeadMismatch,
    PartialCaptureUntracked,
    PartialCaptureTracked,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUnarchiveNotice {
    pub kind: WorkspaceUnarchiveNoticeKind,
    /// The persisted skipped-path list, re-emitted for the
    /// `partial_capture_*` kinds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveWorkspaceResponse {
    pub record: Workspace,
    pub notices: Vec<WorkspaceArchiveNotice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnarchiveWorkspaceResponse {
    pub record: Workspace,
    pub notices: Vec<WorkspaceUnarchiveNotice>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceUnarchiveScenario {
    BranchDiverged,
    CheckedOutElsewhere,
    SnapshotLost,
    PathOccupied,
}

/// The `extra` payload of a `WORKSPACE_UNARCHIVE_SCENARIO` 409. The dialog
/// renders its choices from `strategies`, never from client-side inference:
/// only the server knows which of the four answers this row can actually take
/// (a live path claim, for instance, refuses `overwrite` whatever the client
/// sends).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUnarchiveScenarioBody {
    pub scenario: WorkspaceUnarchiveScenario,
    /// Display name of the workspace row occupying the path, for
    /// `path_occupied`. Absent when no row claims it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occupant_name: Option<String>,
    /// The occupant's lifecycle, so the dialog can name an exit that is
    /// actually available ("archive it first" vs "unarchive or delete it").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occupant_lifecycle: Option<String>,
    pub strategies: Vec<WorkspaceUnarchiveStrategy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceUnarchiveStrategy {
    RecreateAtSha,
    RestoreDetached,
    RestoreBranchTip,
    Overwrite,
}

/// The `extra` payload of a `WORKSPACE_GIT_LOCKED` 409: the lock file archive
/// could not reap, so the toast can name it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitLockedBody {
    pub file: String,
}

/// `GET /v1/workspaces?lifecycle=` filter. The default is `active`: the
/// sidebar's universe is active workspaces, and the archived list asks for its
/// own page explicitly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceLifecycleFilter {
    #[default]
    Active,
    Archived,
    All,
}
