//! Pure retire / cleanup-retry state-transition decisions.
//!
//! Grid PR 9 (structure violation #5): the retire state machine used to be
//! written inline in `api/http/workspaces_lifecycle.rs` in three copies — twice
//! in `retire_workspace` (once before the exclusive workspace lease, once
//! after) and once, inverted, in `retry_retire_cleanup`. Every decision the
//! machine makes now lives here as a data-in/data-out rule over
//! [`RetireStateFacts`]: no store, no clock, no uuid, no `&self`.
//!
//! The three copies were not three different rules. Copies A and B were
//! byte-identical modulo the binding name and collapse into
//! [`decide_retire_admission`], called twice by the use case because the
//! pre-lease early-out and the under-lease re-read are two *evaluations* of one
//! rule, not two rules. Copy C is genuinely a different question — "may this
//! retired workspace's cleanup be retried?" — and stays its own branch,
//! [`decide_retry_admission`].
//!
//! [`decide_retry_admission`] doubles as the preflight-mode selector: the
//! handler's mode choice in `build_retire_preflight` evaluated exactly the same
//! three-term predicate as copy C's gate, so [`retire_preflight_mode`] is
//! defined in terms of it rather than restating it.

use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceRecord,
};
use crate::domains::workspaces::retire_preflight::RetirePreflightMode;

/// Blocked-response text for a retire attempt against a workspace already
/// carrying a PURGE tombstone.
pub const PURGE_CLEANUP_RETIRE_MESSAGE: &str =
    "workspace is in purge cleanup state; use purge retry instead";
/// Blocked-response text for a cleanup-retry attempt against a workspace whose
/// state does not admit a retry.
pub const RETRY_UNAVAILABLE_MESSAGE: &str =
    "cleanup retry is only available for retired workspaces with pending or failed cleanup";
/// Blocked-response text when the cleanup-retry safety preflight reports any
/// blocker.
pub const RETRY_PREFLIGHT_BLOCKED_MESSAGE: &str =
    "cleanup retry blocked because workspace safety preflight failed";

/// The record facts the retire state machine reads — the whole world of every
/// decision in this module. Hand-built in the policy tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetireStateFacts {
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    pub cleanup_error_message: Option<String>,
}

impl RetireStateFacts {
    pub fn of(workspace: &WorkspaceRecord) -> Self {
        Self {
            lifecycle_state: workspace.lifecycle_state,
            cleanup_state: workspace.cleanup_state,
            cleanup_operation: workspace.cleanup_operation,
            cleanup_error_message: workspace.cleanup_error_message.clone(),
        }
    }
}

/// The wire outcome vocabulary, as a domain twin. Mapped to
/// `anyharness_contract::v1::WorkspaceRetireOutcome` at the api edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetireOutcome {
    Retired,
    AlreadyRetired,
    Blocked,
    CleanupFailed,
}

/// What the retire pipeline may do with a record it just read (copies A and B).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetireAdmission {
    /// Not retired: the retire pipeline continues.
    Proceed,
    /// Retired under a PURGE tombstone. Retire refuses and points the caller at
    /// purge retry — a retire retry would fight the purge tombstone.
    PurgeCleanupInProgress,
    /// Retired under a retire tombstone (or none at all): retire is idempotent
    /// and reports the recorded cleanup standing without attempting anything.
    AlreadyRetired {
        cleanup_succeeded: bool,
        cleanup_message: Option<String>,
    },
}

/// Whether a cleanup retry is available for a record (copy C).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryAdmission {
    Proceed,
    Unavailable,
}

/// The durable standing to record after a cleanup attempt, and the outcome to
/// report for it. The failure timestamp itself is a clock read, so the caller
/// stamps it when `records_failure_timestamp` is set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CleanupDecision {
    pub outcome: RetireOutcome,
    pub cleanup_state: WorkspaceCleanupState,
    pub cleanup_succeeded: bool,
    pub records_failure_timestamp: bool,
}

/// Copies A and B of the retired-state machine, as one rule.
pub fn decide_retire_admission(facts: &RetireStateFacts) -> RetireAdmission {
    if facts.lifecycle_state != WorkspaceLifecycleState::Retired {
        return RetireAdmission::Proceed;
    }
    if facts.cleanup_operation == Some(WorkspaceCleanupOperation::Purge) {
        return RetireAdmission::PurgeCleanupInProgress;
    }
    RetireAdmission::AlreadyRetired {
        cleanup_succeeded: facts.cleanup_state == WorkspaceCleanupState::Complete,
        cleanup_message: retired_cleanup_message(facts),
    }
}

/// Copy C: a cleanup retry needs a RETIRED workspace whose cleanup is still
/// resumable (pending or failed) and which is not a purge tombstone.
///
/// Deliberately NOT the negation of [`decide_retire_admission`]: a retired
/// workspace with `cleanup_state == Complete` is `AlreadyRetired` for retire but
/// `Unavailable` for retry, and a retired workspace with `cleanup_state == None`
/// is reported as "cleanup is not complete" by retire while retry refuses to
/// resume it. Both asymmetries are the pre-refactor behaviour, preserved here
/// verbatim; the second is flagged in the PR body for a ruling.
pub fn decide_retry_admission(facts: &RetireStateFacts) -> RetryAdmission {
    let retired = facts.lifecycle_state == WorkspaceLifecycleState::Retired;
    let resumable_cleanup = matches!(
        facts.cleanup_state,
        WorkspaceCleanupState::Pending | WorkspaceCleanupState::Failed
    );
    let purge_tombstone = facts.cleanup_operation == Some(WorkspaceCleanupOperation::Purge);
    if retired && resumable_cleanup && !purge_tombstone {
        RetryAdmission::Proceed
    } else {
        RetryAdmission::Unavailable
    }
}

/// Which mode the retire family evaluates a record's safety preflight under.
///
/// The pre-refactor handler restated copy C's three-term predicate here; it is
/// the same question ("is this record a resumable retire cleanup?"), so this is
/// defined in terms of [`decide_retry_admission`] rather than duplicated.
pub fn retire_preflight_mode(facts: &RetireStateFacts) -> RetirePreflightMode {
    match decide_retry_admission(facts) {
        RetryAdmission::Proceed => RetirePreflightMode::RetiredCleanupRetry,
        RetryAdmission::Unavailable => RetirePreflightMode::ActiveRetire,
    }
}

/// The cleanup standing reported for an already-retired workspace.
pub fn retired_cleanup_message(facts: &RetireStateFacts) -> Option<String> {
    match facts.cleanup_state {
        WorkspaceCleanupState::Complete => None,
        WorkspaceCleanupState::Failed => facts
            .cleanup_error_message
            .clone()
            .or_else(|| Some("retired workspace cleanup failed".to_string())),
        WorkspaceCleanupState::Pending => {
            Some("retired workspace cleanup is still pending".to_string())
        }
        WorkspaceCleanupState::None => Some(format!(
            "retired workspace cleanup is not complete: {}",
            facts.cleanup_state
        )),
    }
}

/// The fourth copy the recon did not name: `retire_workspace` and
/// `retry_retire_cleanup` each carried a byte-identical `match cleanup_result`
/// block turning the materialization result into
/// `(outcome, succeeded, message, cleanup_state, error_at)`.
pub fn decide_cleanup_outcome(cleanup_succeeded: bool) -> CleanupDecision {
    if cleanup_succeeded {
        CleanupDecision {
            outcome: RetireOutcome::Retired,
            cleanup_state: WorkspaceCleanupState::Complete,
            cleanup_succeeded: true,
            records_failure_timestamp: false,
        }
    } else {
        CleanupDecision {
            outcome: RetireOutcome::CleanupFailed,
            cleanup_state: WorkspaceCleanupState::Failed,
            cleanup_succeeded: false,
            records_failure_timestamp: true,
        }
    }
}

#[cfg(test)]
#[path = "retire_policy_tests.rs"]
mod tests;
