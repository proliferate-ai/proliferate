use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::time::Instant;

use crate::domains::sessions::extensions::SessionClosingContext;
use crate::domains::sessions::links::model::SessionLinkRelation;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};

use super::{SessionLifecycleError, SessionRuntime};

use crate::live::sessions::ConditionalCancelOutcome;
use crate::process_kill::PlaneKills;

impl SessionRuntime {
    /// Retire the in-memory actor while leaving the durable session fully
    /// resumable. This is intentionally separate from terminal Close and
    /// user-facing Dismiss semantics.
    pub async fn unload_live_session_nonterminal(
        &self,
        session_id: &str,
    ) -> Result<(), SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
        let _record = self.get_session_or_not_found(session_id)?;
        self.acp_manager
            .unload_session_nonterminal(session_id)
            .await
            .map_err(SessionLifecycleError::Internal)
    }

    pub async fn cancel_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
        let record = self.get_session_or_not_found(session_id)?;

        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let _ = handle.cancel().await;
        }

        Ok(self
            .session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .unwrap_or(record))
    }

    pub async fn close_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
        let _record = self.get_session_or_not_found(session_id)?;
        let mut visited = HashSet::new();
        self.close_session_tree(session_id, &mut visited).await?;

        self.session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .ok_or_else(|| SessionLifecycleError::SessionNotFound(session_id.to_string()))
    }

    /// Stop every live session in `workspace_id`: awaits each agent
    /// process's confirmed death (group TERM → 5s grace → KILL) and moves
    /// the session row to its stopped (`idle`) state, never `closed` or
    /// `dismissed` — the whole point of archiving is that unarchive resumes.
    /// Generalized from `force_retire_workspace_live_sessions_for_purge`,
    /// which only dismissed handles and never awaited process death or wrote
    /// a session row; purge inherits both new behaviors by calling this.
    /// Infallible from the caller's point of view: a per-session error is
    /// logged and folded into a zero contribution, matching the `_for_purge`
    /// precedent.
    ///
    /// The per-session stops are driven CONCURRENTLY. Each `stop_and_await`
    /// carries its own TERM → grace → KILL escalation, so a sequential walk
    /// would stack one 5s grace window per live session and a workspace with
    /// two of them could never fit R4's 8s `QUIESCE_DEADLINE`. One grace
    /// window must cover the whole plane.
    pub async fn stop_all_for_workspace(&self, workspace_id: &str) -> anyhow::Result<PlaneKills> {
        let sessions = self
            .session_service
            .store()
            .list_by_workspace(workspace_id)?;

        let stops = sessions.into_iter().map(|session| async move {
            let mut kills = PlaneKills::default();

            // A session with no live handle contributes no kills, but it
            // still owns a row. Falling through to the row write rather than
            // returning early is what makes an INTERRUPTED stop converge: the
            // attempt that was dropped mid-flight may already have detached
            // the actor without ever reaching the row, and skipping the write
            // here would leave that row reading "running" for a session that
            // is gone for good.
            if let Some(handle) = self.acp_manager.get_handle(&session.id).await {
                match handle.stop_and_await().await {
                    Ok((total, git)) => {
                        kills.total += total;
                        kills.git += git;
                    }
                    Err(error) => {
                        // Includes the actor that is already on its way out:
                        // its mailbox closes the moment it decides to exit, so
                        // the command is refused rather than answered. "Already
                        // stopped" is exactly the outcome this primitive wants,
                        // and a zero contribution states it honestly.
                        tracing::warn!(
                            session_id = %session.id,
                            workspace_id = %workspace_id,
                            error = %error,
                            "failed to stop live session during workspace stop"
                        );
                    }
                }
            }
            self.acp_manager.remove_session(&session.id).await;

            // Only a live row moves to its stopped state - never rewrite a
            // row that already reads "closed"/"completed"/"errored", which
            // `update_status` guards against for `closed_at` but not against
            // for the status value itself.
            if matches!(session.status.as_str(), "starting" | "running") {
                let now = chrono::Utc::now().to_rfc3339();
                if let Err(error) =
                    self.session_service
                        .store()
                        .update_status(&session.id, "idle", &now)
                {
                    tracing::warn!(
                        session_id = %session.id,
                        workspace_id = %workspace_id,
                        error = %error,
                        "failed to move session to its stopped state during workspace stop"
                    );
                }
            }
            kills
        });

        let mut kills = PlaneKills::default();
        for session_kills in futures::future::join_all(stops).await {
            kills.total += session_kills.total;
            kills.git += session_kills.git;
        }

        Ok(kills)
    }

    async fn close_session_actor_and_mark_closed(
        &self,
        session_id: &str,
    ) -> Result<(), SessionLifecycleError> {
        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let _ = handle.close().await;
        }
        self.acp_manager.remove_session(session_id).await;

        let now = chrono::Utc::now().to_rfc3339();
        self.session_service
            .store()
            .mark_closed(session_id, &now)
            .map_err(SessionLifecycleError::Internal)
    }

    fn close_session_tree<'a>(
        &'a self,
        session_id: &'a str,
        visited: &'a mut HashSet<String>,
    ) -> Pin<Box<dyn Future<Output = Result<(), SessionLifecycleError>> + Send + 'a>> {
        Box::pin(async move {
            if !visited.insert(session_id.to_string()) {
                return Ok(());
            }
            if self
                .session_service
                .store()
                .find_by_id(session_id)
                .map_err(SessionLifecycleError::Internal)?
                .is_none()
            {
                return Ok(());
            }
            self.close_delegated_children(session_id, visited).await?;
            self.close_session_actor_and_mark_closed(session_id).await?;
            self.close_inbound_delegated_links(session_id)?;
            Ok(())
        })
    }

    async fn close_delegated_children(
        &self,
        parent_session_id: &str,
        visited: &mut HashSet<String>,
    ) -> Result<(), SessionLifecycleError> {
        let now = chrono::Utc::now().to_rfc3339();
        let extension_close_session_ids =
            self.run_session_closing_extensions(parent_session_id, &now)?;
        let links = self
            .session_link_service
            .list_by_parent(parent_session_id)
            .map_err(SessionLifecycleError::Internal)?;
        let mut closed_child_session_ids = std::collections::HashSet::new();
        for link in links {
            if !matches!(
                link.relation,
                SessionLinkRelation::Subagent
                    | SessionLinkRelation::CoworkCodingSession
                    | SessionLinkRelation::ReviewAgent
            ) {
                continue;
            }
            self.close_session_tree(&link.child_session_id, visited)
                .await?;
            // close_session_tree above already closed this link from the
            // child's side, so the record is the authority on who observed
            // the transition: only the caller whose write flipped it reports
            // the cause, and the link is logged exactly once.
            let newly_closed = self
                .session_link_service
                .close_link(&link.id, &now)
                .map_err(SessionLifecycleError::Internal)?;
            if newly_closed {
                tracing::info!(
                    target: "anyharness.subagent.link_closed",
                    parent_session_id = %link.parent_session_id,
                    child_session_id = %link.child_session_id,
                    relation = link.relation.as_str(),
                    cause = "parent_session_closed",
                    "subagent: link closed"
                );
            }
            closed_child_session_ids.insert(link.child_session_id);
        }
        for session_id in extension_close_session_ids {
            if closed_child_session_ids.insert(session_id.clone()) {
                self.close_session_tree(&session_id, visited).await?;
            }
        }
        Ok(())
    }

    fn run_session_closing_extensions(
        &self,
        session_id: &str,
        closed_at: &str,
    ) -> Result<Vec<String>, SessionLifecycleError> {
        let mut close_session_ids = Vec::new();
        for extension in &self.session_extensions {
            let actions = extension
                .on_session_closing(SessionClosingContext {
                    session_id: session_id.to_string(),
                    closed_at: closed_at.to_string(),
                })
                .map_err(SessionLifecycleError::Internal)?;
            close_session_ids.extend(actions.close_session_ids);
        }
        Ok(close_session_ids)
    }

    fn close_inbound_delegated_links(
        &self,
        child_session_id: &str,
    ) -> Result<(), SessionLifecycleError> {
        let links = self
            .session_link_service
            .list_by_child(child_session_id)
            .map_err(SessionLifecycleError::Internal)?;
        let now = chrono::Utc::now().to_rfc3339();
        for link in links {
            if !matches!(
                link.relation,
                SessionLinkRelation::Subagent
                    | SessionLinkRelation::CoworkCodingSession
                    | SessionLinkRelation::ReviewAgent
            ) {
                continue;
            }
            let newly_closed = self
                .session_link_service
                .close_link(&link.id, &now)
                .map_err(SessionLifecycleError::Internal)?;
            if newly_closed {
                tracing::info!(
                    target: "anyharness.subagent.link_closed",
                    parent_session_id = %link.parent_session_id,
                    child_session_id = %link.child_session_id,
                    relation = link.relation.as_str(),
                    cause = "child_session_closed",
                    "subagent: link closed"
                );
            }
        }
        Ok(())
    }

    pub async fn dismiss_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
        let record = self.get_session_or_not_found(session_id)?;

        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let _ = handle.dismiss().await;
        }
        self.acp_manager.remove_session(session_id).await;

        if record.dismissed_at.is_none() {
            let now = chrono::Utc::now().to_rfc3339();
            self.session_service
                .store()
                .mark_dismissed(session_id, &now)
                .map_err(SessionLifecycleError::Internal)?;
        }

        self.session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .ok_or_else(|| SessionLifecycleError::SessionNotFound(session_id.to_string()))
    }

    #[tracing::instrument(skip_all, fields(workspace_id = %workspace_id))]
    pub async fn restore_dismissed_session(
        &self,
        workspace_id: &str,
        expected_session_id: &str,
    ) -> Result<Option<SessionRecord>, SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
        let started = Instant::now();
        tracing::info!(
            workspace_id = %workspace_id,
            "[workspace-latency] session.runtime.restore.start"
        );
        let now = chrono::Utc::now().to_rfc3339();
        let Some(restored) = self
            .session_service
            .store()
            .pop_last_dismissed_in_workspace(workspace_id, Some(expected_session_id), &now)
            .map_err(SessionLifecycleError::Internal)?
        else {
            tracing::info!(
                workspace_id = %workspace_id,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] session.runtime.restore.empty"
            );
            return Ok(None);
        };

        tracing::info!(
            session_id = %restored.id,
            workspace_id = %workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.restore.dismissed_cleared"
        );
        tracing::info!(
            session_id = %restored.id,
            workspace_id = %workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.restore.completed"
        );

        Ok(Some(restored))
    }

    pub(crate) async fn emit_runtime_event(
        &self,
        session_id: &str,
        event: RuntimeInjectedSessionEvent,
    ) -> RuntimeEventInjectionResult {
        self.acp_manager.emit_runtime_event(session_id, event).await
    }

    pub(super) fn get_session_or_not_found(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .ok_or_else(|| SessionLifecycleError::SessionNotFound(session_id.to_string()))
    }

    pub(super) fn persist_live_session_state(&self, session_id: &str, native_session_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let session_store = self.session_service.store();
        let _ = session_store.update_native_session_id(session_id, native_session_id, &now);
        let _ = session_store.update_status(session_id, "idle", &now);
    }

    pub(super) fn mark_session_errored(&self, session_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = self
            .session_service
            .store()
            .update_status(session_id, "errored", &now);
    }

    /// Narrow crate-private exact-active-turn cancel request (spec
    /// workflow-run-control §5.2). Targets the already-bound live session; it
    /// does NOT re-run caller/workspace mutation admission — the workflow
    /// route already established authority from its durable run — and changes
    /// no session row. `Requested` proves only that the matching-turn cancel
    /// command was accepted, never provider cancellation.
    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    pub(crate) async fn request_live_turn_cancel(
        &self,
        session_id: &str,
        expected_turn_id: &str,
    ) -> LiveTurnCancelOutcome {
        let Some(handle) = self.acp_manager.get_handle(session_id).await else {
            return LiveTurnCancelOutcome::NotLive;
        };
        match handle
            .cancel_turn_if_active(expected_turn_id.to_string())
            .await
        {
            Some(ConditionalCancelOutcome::Requested) => LiveTurnCancelOutcome::Requested,
            Some(ConditionalCancelOutcome::NotActive) => LiveTurnCancelOutcome::NotActive,
            None => LiveTurnCancelOutcome::ActorUnavailable,
        }
    }
}

/// Result of [`SessionRuntime::request_live_turn_cancel`]. No variant
/// terminalizes a workflow: only the exact correlated callback can.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
pub(crate) enum LiveTurnCancelOutcome {
    Requested,
    NotActive,
    NotLive,
    ActorUnavailable,
}
