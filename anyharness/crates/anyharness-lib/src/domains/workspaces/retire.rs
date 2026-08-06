//! The workspace retire / cleanup-retry use case.
//!
//! Grid PR 9 (structure violation #5). The retire state machine used to be
//! written inline in `api/http/workspaces_lifecycle.rs`; the pipeline now lives
//! here and the handler is auth → parse → one facade call → map error.
//!
//! **Why a service and not `runtime/retire.rs`.** The pipeline's authoritative
//! safety check is [`RetirePreflightChecker`], which holds
//! `Arc<WorkspaceRuntime>` (wired at `app/mod.rs`, runtime first, checker
//! second). A use case on the runtime would need the checker, closing a
//! construction cycle the one-`::new()`-per-layer rule forbids. `anyharness-
//! structure.md`'s violation table names the target for #5 as "lifecycle
//! service in `domains/workspaces`", and the sibling destructive use case —
//! purge, same checker, same gates, same admission — already lives at
//! `domains/workspaces/purge.rs` as `WorkspacePurgeService`. Retire is purge's
//! twin, so it takes purge's shape.
//!
//! Every state-transition decision is delegated to `retire_policy.rs`; nothing
//! in this file decides, it only resolves facts, asks the policy, and executes.

use std::collections::BTreeSet;
use std::sync::Arc;

use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::service::SessionService;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceRecord,
};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::retire_policy::{
    decide_cleanup_outcome, decide_retire_admission, decide_retry_admission, retire_preflight_mode,
    RetireAdmission, RetireOutcome, RetireStateFacts, RetryAdmission,
    PURGE_CLEANUP_RETIRE_MESSAGE, RETRY_PREFLIGHT_BLOCKED_MESSAGE, RETRY_UNAVAILABLE_MESSAGE,
};
use crate::domains::workspaces::retire_preflight::{
    active_path_owner_retire_blocker, RetirePreflightChecker, RetirePreflightMode,
    RetirePreflightResult,
};
use crate::domains::workspaces::runtime::WorkspaceRuntime;

/// A safety preflight plus the mode it was evaluated under, with `can_retire`
/// already narrowed. The api mapper reads these fields straight through: the
/// `can_retire && mode == ActiveRetire` narrowing the handler used to apply is
/// resolved here so the mapper stays decisionless.
#[derive(Debug, Clone)]
pub struct RetirePreflightView {
    pub result: RetirePreflightResult,
    pub mode: RetirePreflightMode,
    pub can_retire: bool,
}

impl RetirePreflightView {
    fn new(result: RetirePreflightResult, mode: RetirePreflightMode) -> Self {
        let can_retire = result.can_retire && mode == RetirePreflightMode::ActiveRetire;
        Self {
            result,
            mode,
            can_retire,
        }
    }
}

/// One retire-family outcome, in domain vocabulary.
#[derive(Debug, Clone)]
pub struct WorkspaceRetireResult {
    pub workspace: WorkspaceRecord,
    pub outcome: RetireOutcome,
    pub preflight: RetirePreflightView,
    pub cleanup_attempted: bool,
    pub cleanup_succeeded: bool,
    pub cleanup_message: Option<String>,
}

/// The failures the retire family can report. One `From` impl at the api edge
/// turns these into `ApiError`s; the HTTP status/code choices live there.
#[derive(Debug)]
pub enum WorkspaceRetireError {
    WorkspaceNotFound,
    /// PR1227-WORKSPACE-FENCE-02: a session id enumerated under the exclusive
    /// lease was absent from the up-front admitted set.
    SessionAppearedAfterAdmission { session_id: String },
    /// PR1227-WORKSPACE-FENCE-01: a nonterminal workflow controls a workspace
    /// session the up-front admission could not have seen.
    ControlledByWorkflow,
    /// The workspace session list could not be read during the fence re-check.
    SessionListUnavailable,
    /// The workflow-control lookup itself failed during the fence re-check.
    SessionAdmissionUnavailable,
    /// A `spawn_blocking` cleanup task did not join.
    CleanupTaskFailed { label: &'static str, detail: String },
    Unexpected(anyhow::Error),
}

impl From<anyhow::Error> for WorkspaceRetireError {
    fn from(error: anyhow::Error) -> Self {
        Self::Unexpected(error)
    }
}

#[derive(Clone)]
pub struct WorkspaceRetireService {
    workspace_runtime: Arc<WorkspaceRuntime>,
    workspace_access_gate: Arc<WorkspaceAccessGate>,
    operation_gate: Arc<WorkspaceOperationGate>,
    preflight_checker: Arc<RetirePreflightChecker>,
    session_service: Arc<SessionService>,
    admission: Arc<SessionMutationAdmission>,
}

impl WorkspaceRetireService {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        workspace_access_gate: Arc<WorkspaceAccessGate>,
        operation_gate: Arc<WorkspaceOperationGate>,
        preflight_checker: Arc<RetirePreflightChecker>,
        session_service: Arc<SessionService>,
        admission: Arc<SessionMutationAdmission>,
    ) -> Self {
        Self {
            workspace_runtime,
            workspace_access_gate,
            operation_gate,
            preflight_checker,
            session_service,
            admission,
        }
    }

    /// `GET /v1/workspaces/{id}/retire/preflight`.
    pub async fn preflight(
        &self,
        workspace_id: &str,
    ) -> Result<RetirePreflightView, WorkspaceRetireError> {
        self.build_preflight(workspace_id).await
    }

    /// `POST /v1/workspaces/{id}/retire`.
    ///
    /// `admitted_session_ids` is the set the handler's up-front
    /// `admit_all_workspace_sessions` snapshotted and holds permits for; it is
    /// carried in for the FENCE-02 under-lease membership re-check.
    pub async fn retire(
        &self,
        workspace_id: &str,
        admitted_session_ids: BTreeSet<String>,
    ) -> Result<WorkspaceRetireResult, WorkspaceRetireError> {
        let current = self.require_workspace(workspace_id)?;
        // Copies A and B of the retired-state machine were byte-identical
        // modulo the binding name; one rule, evaluated once here on the
        // pre-lease read and once below on the under-lease re-read.
        if let Some(result) = self.retired_state_result(workspace_id, &current).await? {
            return Ok(result);
        }
        if let Some(result) = self.blocked_if_preflight_refuses(workspace_id).await? {
            return Ok(result);
        }

        // PR1227-WORKSPACE-FENCE-01 proof seam (test-only, no-op in
        // production): park between the advisory preflight and the exclusive
        // lease so a proof can bind a workflow-controlled session in exactly
        // the gap the fence guards. Keyed by workspace id; absent keys change
        // nothing.
        #[cfg(test)]
        retire_barriers::at_pre_exclusive(workspace_id).await;

        let _exclusive = self.operation_gate.acquire_exclusive(workspace_id).await;
        // PR1227-WORKSPACE-FENCE-01/02: the up-front admission snapshot cannot
        // see a session the workflow executor creates+binds inside the window
        // before this exclusive lease is held (it only holds the shared
        // SessionStart lease then). Now that the exclusive lease excludes
        // further workflow session creation, re-enumerate and fail closed.
        self.reject_if_workflow_controlled(workspace_id, &admitted_session_ids)
            .await?;

        let workspace = self.require_workspace(workspace_id)?;
        if let Some(result) = self.retired_state_result(workspace_id, &workspace).await? {
            return Ok(result);
        }
        // Provably unobservable, and kept anyway. The preflight below folds this
        // exact gate check into a blocker under ActiveRetire mode and returns a
        // byte-identical body, and nothing can make the two disagree: the
        // retired-state branch above already returned for every Retired record,
        // so this record is necessarily Active; both reads happen under the same
        // exclusive lease with no await between them. So this branch cannot
        // change any response.
        //
        // It survives because grid PR 9 is a refactor: the pre-refactor handler
        // had this standalone gate check, and preserving its structure keeps the
        // diff honestly behaviour-preserving rather than mixing a dead-branch
        // deletion into a move. Delete it in a follow-up that owns that call.
        if self
            .workspace_access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .is_err()
        {
            return Ok(self.blocked_with_fresh_record(workspace_id, None).await?);
        }
        let preflight = self.build_preflight(workspace_id).await?;
        if !preflight.can_retire {
            // Reuses this preflight (does not rebuild) but re-reads the record —
            // exactly as the pre-refactor handler did.
            return Ok(self.blocked_result(workspace_id, preflight, None).await?);
        }
        // Race-window re-check: the preflight already folds an active
        // path-owner into a blocker, but another workspace can claim this
        // checkout path between that read and this one (the exclusive lease is
        // per workspace id, so it does not exclude the other workspace's
        // creation). Reported with its own message.
        if let Some(active) = self
            .workspace_runtime
            .find_active_worktree_by_path_excluding_id(&workspace.path, &workspace.id)?
        {
            let mut preflight = preflight;
            preflight.can_retire = false;
            preflight
                .result
                .blockers
                .push(active_path_owner_retire_blocker(&active));
            return Ok(WorkspaceRetireResult {
                workspace,
                outcome: RetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(format!(
                    "cleanup blocked because active workspace {} also owns path {}",
                    active.id, active.path
                )),
            });
        }

        let attempted_at = chrono::Utc::now().to_rfc3339();
        let pending = self.mark_cleanup_pending(workspace_id, &attempted_at)?;
        let cleanup_succeeded = self
            .run_worktree_cleanup("retire worktree cleanup", &pending)
            .await?;
        self.finish_cleanup(workspace_id, &attempted_at, cleanup_succeeded, preflight)
            .await
    }

    /// `POST /v1/workspaces/{id}/retire/cleanup-retry`.
    pub async fn retry_cleanup(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceRetireResult, WorkspaceRetireError> {
        let workspace = self.require_workspace(workspace_id)?;
        // Copy C: a different question from copies A/B — "may this retired
        // workspace's cleanup be resumed?" — so it stays its own policy branch.
        if decide_retry_admission(&RetireStateFacts::of(&workspace)) == RetryAdmission::Unavailable {
            let preflight = self.build_preflight(workspace_id).await?;
            return Ok(WorkspaceRetireResult {
                workspace,
                outcome: RetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(RETRY_UNAVAILABLE_MESSAGE.to_string()),
            });
        }

        let _exclusive = self.operation_gate.acquire_exclusive(workspace_id).await;
        let preflight = self.build_preflight(workspace_id).await?;
        // Retry inspects `blockers` directly, NOT `can_retire`: this record is
        // evaluated under RetiredCleanupRetry mode, whose narrowed `can_retire`
        // is false by construction.
        if !preflight.result.blockers.is_empty() {
            return Ok(WorkspaceRetireResult {
                workspace,
                outcome: RetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(RETRY_PREFLIGHT_BLOCKED_MESSAGE.to_string()),
            });
        }
        // Same race-window re-check as the retire path, with retry's own
        // message. Note it rebuilds the preflight rather than reusing the one
        // above — preserved from the pre-refactor handler.
        if let Some(active) = self
            .workspace_runtime
            .find_active_worktree_by_path_excluding_id(&workspace.path, &workspace.id)?
        {
            let mut preflight = self.build_preflight(workspace_id).await?;
            preflight
                .result
                .blockers
                .push(active_path_owner_retire_blocker(&active));
            return Ok(WorkspaceRetireResult {
                workspace,
                outcome: RetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(format!(
                    "cleanup retry blocked because active workspace {} now owns path {}",
                    active.id, active.path
                )),
            });
        }

        let attempted_at = chrono::Utc::now().to_rfc3339();
        // Retry tolerates a vanished record here (the pre-refactor handler
        // discarded this result); the final write below is the one that 404s.
        let _ = self.workspace_runtime.set_lifecycle_cleanup_state(
            workspace_id,
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Pending,
            Some(WorkspaceCleanupOperation::Retire),
            None,
            None,
            Some(&attempted_at),
        )?;
        // Retry re-runs cleanup against the record read BEFORE the pending
        // write, not the refreshed one — preserved from the pre-refactor
        // handler.
        let cleanup = self
            .run_worktree_cleanup("retire cleanup retry", &workspace)
            .await?;
        let mut result = self
            .finish_cleanup(workspace_id, &attempted_at, cleanup, preflight)
            .await?;
        // Retry reports the preflight rebuilt AFTER the final write; retire
        // reports the one it decided on. Preserved divergence.
        result.preflight = self.build_preflight(workspace_id).await?;
        Ok(result)
    }

    /// Copies A and B, as one call site each.
    async fn retired_state_result(
        &self,
        workspace_id: &str,
        workspace: &WorkspaceRecord,
    ) -> Result<Option<WorkspaceRetireResult>, WorkspaceRetireError> {
        let facts = RetireStateFacts::of(workspace);
        let admission = decide_retire_admission(&facts);
        if admission == RetireAdmission::Proceed {
            return Ok(None);
        }
        let preflight = self.build_preflight(workspace_id).await?;
        let (outcome, cleanup_succeeded, cleanup_message) = match admission {
            RetireAdmission::Proceed => unreachable!("filtered above"),
            RetireAdmission::PurgeCleanupInProgress => (
                RetireOutcome::Blocked,
                false,
                Some(PURGE_CLEANUP_RETIRE_MESSAGE.to_string()),
            ),
            RetireAdmission::AlreadyRetired {
                cleanup_succeeded,
                cleanup_message,
            } => (
                RetireOutcome::AlreadyRetired,
                cleanup_succeeded,
                cleanup_message,
            ),
        };
        Ok(Some(WorkspaceRetireResult {
            workspace: workspace.clone(),
            outcome,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded,
            cleanup_message,
        }))
    }

    /// The pre-lease advisory refusal: blocked with a freshly re-read record.
    async fn blocked_if_preflight_refuses(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceRetireResult>, WorkspaceRetireError> {
        let preflight = self.build_preflight(workspace_id).await?;
        if preflight.can_retire {
            return Ok(None);
        }
        Ok(Some(
            self.blocked_result(workspace_id, preflight, None).await?,
        ))
    }

    async fn blocked_with_fresh_record(
        &self,
        workspace_id: &str,
        cleanup_message: Option<String>,
    ) -> Result<WorkspaceRetireResult, WorkspaceRetireError> {
        let preflight = self.build_preflight(workspace_id).await?;
        self.blocked_result(workspace_id, preflight, cleanup_message)
            .await
    }

    /// Blocked, carrying the record as re-read now (not the one in hand) —
    /// preserving which record version these responses serialized.
    async fn blocked_result(
        &self,
        workspace_id: &str,
        preflight: RetirePreflightView,
        cleanup_message: Option<String>,
    ) -> Result<WorkspaceRetireResult, WorkspaceRetireError> {
        Ok(WorkspaceRetireResult {
            workspace: self.require_workspace(workspace_id)?,
            outcome: RetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message,
        })
    }

    async fn build_preflight(
        &self,
        workspace_id: &str,
    ) -> Result<RetirePreflightView, WorkspaceRetireError> {
        let current = self.require_workspace(workspace_id)?;
        let mode = retire_preflight_mode(&RetireStateFacts::of(&current));
        let result = self.preflight_checker.check_workspace(current, mode).await?;
        Ok(RetirePreflightView::new(result, mode))
    }

    fn require_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceRecord, WorkspaceRetireError> {
        self.workspace_runtime
            .get_workspace(workspace_id)?
            .ok_or(WorkspaceRetireError::WorkspaceNotFound)
    }

    fn mark_cleanup_pending(
        &self,
        workspace_id: &str,
        attempted_at: &str,
    ) -> Result<WorkspaceRecord, WorkspaceRetireError> {
        self.workspace_runtime
            .set_lifecycle_cleanup_state(
                workspace_id,
                WorkspaceLifecycleState::Retired,
                WorkspaceCleanupState::Pending,
                Some(WorkspaceCleanupOperation::Retire),
                None,
                None,
                Some(attempted_at),
            )?
            .ok_or(WorkspaceRetireError::WorkspaceNotFound)
    }

    /// Runs the worktree removal off-thread. Returns whether it succeeded plus
    /// the failure message to report.
    async fn run_worktree_cleanup(
        &self,
        label: &'static str,
        workspace: &WorkspaceRecord,
    ) -> Result<(bool, Option<String>), WorkspaceRetireError> {
        let runtime = self.workspace_runtime.clone();
        let workspace = workspace.clone();
        let joined = tokio::task::spawn_blocking(move || {
            runtime.retire_worktree_materialization(&workspace)
        })
        .await
        .map_err(|error| WorkspaceRetireError::CleanupTaskFailed {
            label,
            detail: error.to_string(),
        })?;
        Ok(match joined {
            Ok(()) => (true, None),
            Err(error) => (false, Some(error.to_string())),
        })
    }

    async fn finish_cleanup(
        &self,
        workspace_id: &str,
        attempted_at: &str,
        cleanup: (bool, Option<String>),
        preflight: RetirePreflightView,
    ) -> Result<WorkspaceRetireResult, WorkspaceRetireError> {
        let decision = decide_cleanup_outcome(cleanup.0);
        let final_record =
            self.write_final_cleanup_state(workspace_id, attempted_at, cleanup.clone(), decision)?;
        Ok(WorkspaceRetireResult {
            workspace: final_record,
            outcome: decision.outcome,
            preflight,
            cleanup_attempted: true,
            cleanup_succeeded: decision.cleanup_succeeded,
            cleanup_message: cleanup.1,
        })
    }

    fn write_final_cleanup_state(
        &self,
        workspace_id: &str,
        attempted_at: &str,
        cleanup: (bool, Option<String>),
        decision: crate::domains::workspaces::retire_policy::CleanupDecision,
    ) -> Result<WorkspaceRecord, WorkspaceRetireError> {
        let error_at = if decision.records_failure_timestamp {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            None
        };
        self.workspace_runtime
            .set_lifecycle_cleanup_state(
                workspace_id,
                WorkspaceLifecycleState::Retired,
                decision.cleanup_state,
                Some(WorkspaceCleanupOperation::Retire),
                cleanup.1.as_deref(),
                error_at.as_deref(),
                Some(attempted_at),
            )?
            .ok_or(WorkspaceRetireError::WorkspaceNotFound)
    }

    /// PR1227-WORKSPACE-FENCE-01/02: called under the already-held exclusive
    /// workspace lease. Re-enumerate the workspace session set and fail closed
    /// if either (02) an enumerated session id is absent from
    /// `admitted_session_ids` — the ids the up-front admission snapshotted and
    /// holds permits for — even if its controlling workflow already
    /// terminalized (the bind->terminalize race), OR (01) a NONTERMINAL
    /// workflow controls a session the up-front admission could not have seen
    /// (created+bound inside the admission -> exclusive-lease window). FENCE-02
    /// is checked first: it is a pure in-memory set comparison over ids
    /// enumerated under the held lease (no permit, no lease). FENCE-01 remains
    /// to catch control acquired post-snapshot on an EXISTING admitted session.
    /// Neither introduces an ABBA edge.
    async fn reject_if_workflow_controlled(
        &self,
        workspace_id: &str,
        admitted_session_ids: &BTreeSet<String>,
    ) -> Result<(), WorkspaceRetireError> {
        let session_ids = self
            .session_service
            .list_sessions(Some(workspace_id), true)
            .map_err(|error| {
                tracing::error!(workspace_id = %workspace_id, error = %error, "retire re-check session list failed");
                WorkspaceRetireError::SessionListUnavailable
            })?
            .into_iter()
            .map(|session| session.id)
            .collect::<Vec<_>>();
        // PR1227-WORKSPACE-FENCE-02: any id enumerated under the exclusive
        // lease that was NOT in the up-front admitted set was bound after the
        // snapshot and never admitted; fail closed regardless of its
        // controller's terminality.
        if let Some(unadmitted) = session_ids
            .iter()
            .find(|id| !admitted_session_ids.contains(*id))
        {
            tracing::info!(
                workspace_id = %workspace_id,
                session_id = %unadmitted,
                "workspace retire rejected under exclusive lease: a session appeared after the destruction admission snapshot"
            );
            return Err(WorkspaceRetireError::SessionAppearedAfterAdmission {
                session_id: unadmitted.clone(),
            });
        }
        match self
            .admission
            .find_workflow_controlled_session(session_ids)
            .await
        {
            Ok(None) => Ok(()),
            Ok(Some((session_id, run_id))) => {
                tracing::info!(
                    workspace_id = %workspace_id,
                    session_id = %session_id,
                    controlling_run_id = %run_id,
                    "workspace retire rejected under exclusive lease: a workflow controls a session created after admission"
                );
                Err(WorkspaceRetireError::ControlledByWorkflow)
            }
            Err(error) => {
                tracing::error!(workspace_id = %workspace_id, error = %error, "retire controlled-session re-check failed");
                Err(WorkspaceRetireError::SessionAdmissionUnavailable)
            }
        }
    }
}

/// PR1227-WORKSPACE-FENCE-01 proof seam, in its own file so `retire.rs` stays
/// under the repo line ceiling without a pin.
#[cfg(test)]
#[path = "retire_barriers.rs"]
pub(crate) mod retire_barriers;
