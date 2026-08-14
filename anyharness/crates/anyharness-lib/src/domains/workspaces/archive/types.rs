//! The archive subdomain's vocabulary: request options, response envelopes,
//! notices, and the typed failures.
//!
//! Domain types, not wire types: `DOMAIN_CONTRACT_IMPORT` bars domain code from
//! naming `anyharness_contract`, so every shape here has a twin minted in
//! `api/http/workspaces_lifecycle_contract.rs`. That is not duplication for its
//! own sake — it is what lets the flows below be reasoned about without a wire
//! format in scope, and what keeps a casing decision from reaching into the
//! orchestrator.

use crate::adapters::git::types::{SnapshotError, SnapshotNotice};
use crate::domains::workspaces::model::WorkspaceRecord;

/// The archive request's knobs. Both are resolved CLIENT-side at click time
/// (the host's branch-delete preference and the repo environment's archive
/// script) and travel in the request body, because the runtime deliberately
/// stores neither: a knob the runtime remembered would silently re-run on every
/// convergence re-POST, and the sweep — which has no request to read them from
/// — would have to either guess or grow a second policy.
#[derive(Debug, Clone, Default)]
pub struct ArchiveOptions {
    pub delete_branch: bool,
    pub archive_script: Option<String>,
}

/// The unarchive request's knobs. `branch_strategy` and `overwrite` are answers
/// to a previous scenario 409; a first attempt carries neither.
#[derive(Debug, Clone, Default)]
pub struct UnarchiveOptions {
    pub rerun_setup: bool,
    pub setup_script: Option<String>,
    pub overwrite: bool,
    pub branch_strategy: Option<BranchStrategy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchStrategy {
    RecreateAtSha,
    RestoreDetached,
    RestoreBranchTip,
}

#[derive(Debug, Clone)]
pub struct ArchiveOutcome {
    pub record: WorkspaceRecord,
    pub notices: Vec<SnapshotNotice>,
}

#[derive(Debug, Clone)]
pub struct UnarchiveOutcome {
    pub record: WorkspaceRecord,
    pub notices: Vec<UnarchiveNotice>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnarchiveNotice {
    /// The row never had a snapshot: restored at the recorded branch tip.
    NoSnapshot,
    /// Session rows reference JSONL that is no longer on disk (a crashed purge
    /// deleted it). Derived at unarchive time, never stored.
    HistoryIncomplete,
    /// The post-restore HEAD verify failed. The workspace IS active and its
    /// files ARE restored; the snapshot is deliberately retained as evidence
    /// and to arm the retry.
    HeadMismatch,
    PartialCaptureUntracked {
        paths: Vec<String>,
    },
    PartialCaptureTracked {
        paths: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnarchiveScenario {
    BranchDiverged,
    CheckedOutElsewhere,
    SnapshotLost,
    PathOccupied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnarchiveStrategy {
    RecreateAtSha,
    RestoreDetached,
    RestoreBranchTip,
    Overwrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OccupantLifecycle {
    Active,
    Archived,
}

/// The typed 409 body for every ambiguous unarchive. `strategies` is the
/// server's answer to "what may this user choose here", never the client's to
/// infer: a live path claim, for instance, offers nothing at all, because
/// force-removing an occupying row that may hold unsnapshotted work — with no
/// quiesce and no snapshot of IT — would reintroduce retire's loss profile
/// through a dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnarchiveScenarioPayload {
    pub scenario: UnarchiveScenario,
    pub occupant_name: Option<String>,
    pub occupant_lifecycle: Option<OccupantLifecycle>,
    pub strategies: Vec<UnarchiveStrategy>,
}

/// Every way archiving can refuse or fail. All of them are PHASE 1: once the
/// row flips, the request has already answered 200 and phase 2's failures are
/// leftover facts the sweep converges, never request errors.
#[derive(Debug, thiserror::Error)]
pub enum ArchiveError {
    #[error("workspace not found: {0}")]
    NotFound(String),
    /// The bounded gate wait expired against a still-active row. Rare and
    /// honest; a timeout against a row that flipped meanwhile answers 200
    /// instead (see the re-read in `archive.rs`).
    #[error("another operation holds this workspace")]
    OperationInFlight,
    #[error("a git {operation} is in progress")]
    GitOperationInProgress { operation: String },
    #[error("the branch has no commits yet")]
    UnbornHead,
    #[error("the workspace directory is not the root of its own git repository")]
    HollowCheckout { path: String },
    #[error("git is locked by {file}")]
    GitLocked { file: String },
    /// Mechanical failure or a quiesce deadline trip. Retryable: the workspace
    /// is left fully active and untouched.
    #[error("archiving failed: {0}")]
    Failed(String),
}

impl From<SnapshotError> for ArchiveError {
    fn from(error: SnapshotError) -> Self {
        match error {
            SnapshotError::HollowCheckout { path } => Self::HollowCheckout { path },
            SnapshotError::GitOperationInProgress { operation } => {
                Self::GitOperationInProgress { operation }
            }
            SnapshotError::UnbornHead => Self::UnbornHead,
            SnapshotError::GitLocked { file } => Self::GitLocked { file },
            SnapshotError::Internal(error) => Self::Failed(error.to_string()),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum UnarchiveError {
    #[error("workspace not found: {0}")]
    NotFound(String),
    #[error("another operation holds this workspace")]
    OperationInFlight,
    /// An ambiguity only the user can resolve. A clean 409 with a payload, not
    /// a failure.
    #[error("this workspace cannot be unarchived without a decision")]
    Scenario(UnarchiveScenarioPayload),
    /// Mechanical restore failure. Retryable: the own-crashed-restore re-entry
    /// converges on the next attempt.
    #[error("unarchiving failed: {0}")]
    Failed(String),
}

impl From<anyhow::Error> for UnarchiveError {
    fn from(error: anyhow::Error) -> Self {
        Self::Failed(error.to_string())
    }
}

impl From<SnapshotError> for UnarchiveError {
    fn from(error: SnapshotError) -> Self {
        Self::Failed(error.to_string())
    }
}

impl From<anyhow::Error> for ArchiveError {
    fn from(error: anyhow::Error) -> Self {
        Self::Failed(error.to_string())
    }
}

/// Fold the row's persisted skipped-path list back into notices, so an
/// unarchive re-states exactly what the archive could not capture. Stored as
/// JSON rather than as a notice list because the row has to answer the question
/// long after the request that produced it is gone.
pub fn partial_capture_notices(partial_capture_json: Option<&str>) -> Vec<UnarchiveNotice> {
    let Some(raw) = partial_capture_json else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let read = |key: &str| -> Vec<String> {
        value
            .get(key)
            .and_then(|entry| entry.as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut notices = Vec::new();
    let tracked = read("tracked");
    if !tracked.is_empty() {
        notices.push(UnarchiveNotice::PartialCaptureTracked { paths: tracked });
    }
    let untracked = read("untracked");
    if !untracked.is_empty() {
        notices.push(UnarchiveNotice::PartialCaptureUntracked { paths: untracked });
    }
    notices
}
