use crate::domains::sessions::links::model::{SubagentLinkCloseOutcome, SubagentLinkOpenOutcome};
use crate::domains::sessions::model::SessionRecord;

use super::{SessionRuntime, SubagentLifecycleError};

impl SessionRuntime {
    /// Close only the parent/child relationship's operability. Durable
    /// session lifecycle and visibility remain untouched. The store owns the
    /// single transaction that closes the gate and purges queued work; actor
    /// cancellation/finalization happens only after that transaction returns.
    pub async fn close_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        let link = self
            .session_link_service
            .find_subagent_link(parent_session_id, child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .ok_or(SubagentLifecycleError::RelationshipNotFound)?;
        let now = chrono::Utc::now().to_rfc3339();
        match self
            .session_link_service
            .close_subagent_operability(&link.id, &now)
            .map_err(SubagentLifecycleError::Internal)?
        {
            SubagentLinkCloseOutcome::NotFound => {
                return Err(SubagentLifecycleError::RelationshipNotFound)
            }
            SubagentLinkCloseOutcome::Closed(_) => {}
        }

        // Deliberately outside the close/purge transaction: the actor may
        // wait for provider cancellation or its bounded forced-cancel grace.
        self.unload_live_session_nonterminal(child_session_id)
            .await
            .map_err(|error| match error {
                super::SessionLifecycleError::SessionNotFound(_) => {
                    SubagentLifecycleError::RelationshipNotFound
                }
                super::SessionLifecycleError::Internal(error) => {
                    SubagentLifecycleError::Internal(error)
                }
            })?;
        // A bounded actor-side terminal write may have exhausted while the
        // provider was being cancelled. The exact handle is retired now, so
        // startup cannot race this durable repair and Close cannot report
        // success while the child still has an open turn.
        let repair = self
            .acp_manager
            .run_if_session_absent(child_session_id, || {
                self.session_service
                    .store()
                    .repair_unclosed_turns(child_session_id)
            })
            .await
            .ok_or_else(|| {
                SubagentLifecycleError::Internal(anyhow::anyhow!(
                    "subagent actor restarted before Close repair"
                ))
            })?;
        repair.map_err(SubagentLifecycleError::Internal)?;
        self.current_subagent_session(child_session_id)
    }

    /// Crash-safe backstop for a current subagent whose actor retired before
    /// its terminal transaction committed. Open and reversibly Closed links
    /// are eligible; promoted/no-link sessions are not. The live manager
    /// serializes each repair against actor installation.
    pub(crate) async fn repair_retired_subagent_turns(&self, limit: usize) -> anyhow::Result<u32> {
        if limit == 0 {
            return Ok(0);
        }
        let page_size = limit.max(64);
        let mut after_link_id = None;
        let mut repair_attempts = 0usize;
        let mut repaired = 0u32;

        loop {
            let candidates = self
                .session_link_service
                .list_current_subagent_children_with_unclosed_turns_page(
                    after_link_id.as_deref(),
                    page_size,
                )?;
            if candidates.is_empty() {
                break;
            }
            let page_len = candidates.len();
            for (link_id, session_id) in candidates {
                after_link_id = Some(link_id);
                if let Some(result) = self
                    .acp_manager
                    .run_if_session_absent(&session_id, || {
                        self.session_service
                            .store()
                            .repair_unclosed_turns(&session_id)
                    })
                    .await
                {
                    repair_attempts += 1;
                    repaired = repaired.saturating_add(result?);
                    if repair_attempts == limit {
                        return Ok(repaired);
                    }
                }
            }
            if page_len < page_size {
                break;
            }
        }
        Ok(repaired)
    }

    /// Re-open the same durable/native conversation. Startup completes while
    /// the relationship gate is still Closed, so a failed restart never
    /// exposes a falsely-Open target.
    pub async fn open_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        let link = self
            .session_link_service
            .find_subagent_link(parent_session_id, child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .ok_or(SubagentLifecycleError::RelationshipNotFound)?;

        let resumed = self
            .ensure_live_session(child_session_id, None)
            .await
            .map_err(SubagentLifecycleError::Resume)?;
        match self
            .session_link_service
            .open_subagent_operability(&link.id)
            .map_err(SubagentLifecycleError::Internal)?
        {
            SubagentLinkOpenOutcome::NotFound => {
                return Err(SubagentLifecycleError::RelationshipNotFound)
            }
            SubagentLinkOpenOutcome::Opened(_) => {}
        }

        Ok(self
            .session_service
            .get_session(child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .unwrap_or(resumed))
    }

    /// Remove the ownership relationship and nothing else. An active turn,
    /// live actor, native conversation, transcript, and configuration remain
    /// intact; dynamic role/capabilities change because the relationship is
    /// physically absent from subsequent reads.
    pub async fn promote_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        let link = self
            .session_link_service
            .find_subagent_link(parent_session_id, child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .ok_or(SubagentLifecycleError::RelationshipNotFound)?;
        if link.subagent_closed_at.is_some() {
            return Err(SubagentLifecycleError::OpenRequired);
        }
        if !self
            .session_link_service
            .delete_link(&link.id)
            .map_err(SubagentLifecycleError::Internal)?
        {
            return Err(SubagentLifecycleError::RelationshipNotFound);
        }
        self.current_subagent_session(child_session_id)
    }

    fn current_subagent_session(
        &self,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        self.session_service
            .get_session(child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .ok_or(SubagentLifecycleError::RelationshipNotFound)
    }
}
