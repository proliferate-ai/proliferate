use std::time::Instant;

use crate::live::sessions::actor::command::SessionCommand;
use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};
use crate::sessions::links::model::SessionLinkRelation;
use crate::sessions::model::SessionRecord;
use crate::sessions::runtime_event::{RuntimeEventInjectionResult, RuntimeInjectedSessionEvent};

use super::{SessionLifecycleError, SessionRuntime};

impl SessionRuntime {
    pub async fn cancel_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
        let record = self.get_session_or_not_found(session_id)?;

        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let _ = handle.command_tx.send(SessionCommand::Cancel).await;
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
        self.close_delegated_children(session_id).await?;
        self.close_session_actor_and_mark_closed(session_id).await?;

        self.session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .ok_or_else(|| SessionLifecycleError::SessionNotFound(session_id.to_string()))
    }

    async fn close_session_actor_and_mark_closed(
        &self,
        session_id: &str,
    ) -> Result<(), SessionLifecycleError> {
        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let (tx, rx) = tokio::sync::oneshot::channel();
            let _ = handle
                .command_tx
                .send(SessionCommand::Close { respond_to: tx })
                .await;
            let _ = rx.await;
        }
        self.acp_manager.remove_session(session_id).await;

        let now = chrono::Utc::now().to_rfc3339();
        self.session_service
            .store()
            .mark_closed(session_id, &now)
            .map_err(SessionLifecycleError::Internal)
    }

    async fn close_delegated_children(
        &self,
        parent_session_id: &str,
    ) -> Result<(), SessionLifecycleError> {
        let links = self
            .session_link_service
            .list_by_parent(parent_session_id)
            .map_err(SessionLifecycleError::Internal)?;
        let now = chrono::Utc::now().to_rfc3339();
        self.session_service
            .store()
            .mark_cowork_managed_workspaces_closed_by_parent(parent_session_id, &now)
            .map_err(SessionLifecycleError::Internal)?;
        for link in links {
            if !matches!(
                link.relation,
                SessionLinkRelation::Subagent
                    | SessionLinkRelation::CoworkCodingSession
                    | SessionLinkRelation::ReviewAgent
            ) {
                continue;
            }
            self.session_link_service
                .close_link(&link.id, &now)
                .map_err(SessionLifecycleError::Internal)?;
            if let Some(child) = self
                .session_service
                .store()
                .find_by_id(&link.child_session_id)
                .map_err(SessionLifecycleError::Internal)?
            {
                if child.closed_at.is_none() {
                    self.close_session_actor_and_mark_closed(&link.child_session_id)
                        .await?;
                }
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
            let (tx, rx) = tokio::sync::oneshot::channel();
            let _ = handle
                .command_tx
                .send(SessionCommand::Dismiss { respond_to: tx })
                .await;
            let _ = rx.await;
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

    pub async fn restore_dismissed_session(
        &self,
        workspace_id: &str,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<Option<SessionRecord>, SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        tracing::info!(
            workspace_id = %workspace_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.restore.start"
        );
        let now = chrono::Utc::now().to_rfc3339();
        let Some(restored) = self
            .session_service
            .store()
            .pop_last_dismissed_in_workspace(workspace_id, &now)
            .map_err(SessionLifecycleError::Internal)?
        else {
            tracing::info!(
                workspace_id = %workspace_id,
                elapsed_ms = started.elapsed().as_millis(),
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = latency_fields.prompt_id,
                "[workspace-latency] session.runtime.restore.empty"
            );
            return Ok(None);
        };

        tracing::info!(
            session_id = %restored.id,
            workspace_id = %workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.restore.dismissed_cleared"
        );
        tracing::info!(
            session_id = %restored.id,
            workspace_id = %workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.restore.completed"
        );

        Ok(Some(restored))
    }

    pub(crate) async fn emit_runtime_event(
        &self,
        session_id: &str,
        event: RuntimeInjectedSessionEvent,
    ) -> RuntimeEventInjectionResult {
        self.acp_manager
            .emit_runtime_event(session_id, self.session_service.store().clone(), event)
            .await
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
}
