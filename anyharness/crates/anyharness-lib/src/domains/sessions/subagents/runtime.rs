use std::sync::Arc;

use super::model::{CloseSubagentOutcome, SubagentActiveWorkCloseMode};
use super::service::{SubagentError, SubagentService};
use crate::domains::sessions::runtime::{SessionLifecycleError, SessionRuntime};

#[derive(Debug)]
pub enum CloseSubagentError {
    Subagent(SubagentError),
    SessionLifecycle(SessionLifecycleError),
    Internal(anyhow::Error),
}

impl From<SubagentError> for CloseSubagentError {
    fn from(error: SubagentError) -> Self {
        Self::Subagent(error)
    }
}

impl From<anyhow::Error> for CloseSubagentError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

#[derive(Clone)]
pub struct SubagentRuntime {
    service: Arc<SubagentService>,
    session_runtime: Arc<SessionRuntime>,
}

impl SubagentRuntime {
    pub fn new(service: Arc<SubagentService>, session_runtime: Arc<SessionRuntime>) -> Self {
        Self {
            service,
            session_runtime,
        }
    }

    /// Gracefully closes a parent-owned subagent relationship without deleting
    /// the child session or transcript. A live active turn is allowed to
    /// finish; close does not force-cancel the provider turn.
    #[tracing::instrument(
        skip_all,
        fields(parent_session_id = %parent_session_id, subagent_id = %subagent_id)
    )]
    pub async fn close_subagent(
        &self,
        parent_session_id: &str,
        subagent_id: &str,
    ) -> Result<CloseSubagentOutcome, CloseSubagentError> {
        let link = self.service.resolve_target_including_closed(
            parent_session_id,
            Some(subagent_id),
            None,
        )?;
        let already_closed = link.closed_at.is_some();
        if !already_closed {
            self.service
                .assert_parent_workspace_mutable(parent_session_id)?;
            self.service.delete_wake_schedule_for_link(&link.id)?;
        }

        if let Some(child) = self
            .service
            .session_store()
            .find_by_id(&link.child_session_id)?
        {
            if child.closed_at.is_none() && child.status != "closed" {
                self.session_runtime
                    .close_live_session(&link.child_session_id)
                    .await
                    .map_err(CloseSubagentError::SessionLifecycle)?;
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        if !already_closed {
            self.service.close_link(&link, &now)?;
        }

        let refreshed = self.service.resolve_target_including_closed(
            parent_session_id,
            Some(subagent_id),
            None,
        )?;
        let resolved_subagent_id = refreshed.public_id.clone().ok_or_else(|| {
            CloseSubagentError::Internal(anyhow::anyhow!(
                "resolved subagent relationship is missing its stable public id"
            ))
        })?;
        Ok(CloseSubagentOutcome {
            parent_session_id: parent_session_id.to_string(),
            subagent_id: resolved_subagent_id,
            session_link_id: refreshed.id,
            child_session_id: refreshed.child_session_id,
            label: refreshed.label,
            closed_at: refreshed.closed_at.unwrap_or(now),
            already_closed,
            active_work_close_mode: SubagentActiveWorkCloseMode::FinishCurrentTurn,
        })
    }
}
