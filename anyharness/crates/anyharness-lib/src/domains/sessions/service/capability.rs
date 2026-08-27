use super::SessionService;
use crate::domains::sessions::model::SessionRecord;

impl SessionService {
    /// Whether a session may keep exercising a capability minted at its
    /// launch: the row still exists, belongs to the workspace, and has not
    /// been closed.
    ///
    /// Product MCP capability tokens are delivered as a static header for the
    /// life of the session, so a session that outlives the token TTL would
    /// otherwise lose its product tools mid-flight. The token's expiry is
    /// defense-in-depth; this durable rule is the actual lifetime bound.
    /// Dismissal is hiding, not termination, so a dismissed session keeps its
    /// capability until it closes.
    pub fn session_open_for_capability(
        &self,
        session_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<bool> {
        Ok(self
            .session_store
            .find_by_id(session_id)?
            .is_some_and(|record| session_record_open_for_capability(&record, workspace_id)))
    }
}

fn session_record_open_for_capability(record: &SessionRecord, workspace_id: &str) -> bool {
    record.workspace_id == workspace_id && record.status != "closed" && record.closed_at.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::model::SessionMcpBindingPolicy;

    fn record(workspace_id: &str, status: &str, closed_at: Option<&str>) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: status.to_string(),
            created_at: "2026-08-16T00:00:00Z".to_string(),
            updated_at: "2026-08-16T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: closed_at.map(str::to_string),
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: None,
        }
    }

    #[test]
    fn open_statuses_keep_the_capability() {
        for status in ["starting", "idle", "running", "completed", "errored"] {
            assert!(
                session_record_open_for_capability(&record("workspace-1", status, None), "workspace-1"),
                "status {status:?} should keep the capability",
            );
        }
    }

    #[test]
    fn closed_sessions_lose_the_capability() {
        assert!(!session_record_open_for_capability(
            &record("workspace-1", "closed", None),
            "workspace-1"
        ));
        assert!(!session_record_open_for_capability(
            &record("workspace-1", "idle", Some("2026-08-16T01:00:00Z")),
            "workspace-1"
        ));
    }

    #[test]
    fn foreign_workspace_rows_do_not_grant_the_capability() {
        assert!(!session_record_open_for_capability(
            &record("workspace-2", "idle", None),
            "workspace-1"
        ));
    }

    #[test]
    fn dismissed_sessions_keep_the_capability_until_closed() {
        let mut dismissed = record("workspace-1", "idle", None);
        dismissed.dismissed_at = Some("2026-08-16T01:00:00Z".to_string());
        assert!(session_record_open_for_capability(&dismissed, "workspace-1"));
    }
}
