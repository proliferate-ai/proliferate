use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::time::Instant;

use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};
use crate::sessions::extensions::SessionClosingContext;
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
            self.session_link_service
                .close_link(&link.id, &now)
                .map_err(SessionLifecycleError::Internal)?;
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
            self.session_link_service
                .close_link(&link.id, &now)
                .map_err(SessionLifecycleError::Internal)?;
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
