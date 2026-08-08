//! The single access-policy funnel every cross-agent operation clears.
//!
//! Today it encodes exactly two rules: sessions are visible runtime-wide (there
//! is no per-workspace or per-owner scoping to apply), and a closed session
//! stays readable but takes no more input. Ownership and promotion rights land
//! here too once `session_links` carries them.

use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::SessionStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentAccessIntent {
    /// Reading a target: still allowed after it closes — transcripts outlive
    /// the agent.
    Read,
    /// Reaching a target's actor or prompt queue.
    Send,
}

#[derive(Debug, Clone)]
pub struct AgentAccess {
    pub caller: SessionRecord,
    pub target: SessionRecord,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentAccessError {
    #[error("caller session not found: {0}")]
    CallerNotFound(String),
    #[error("target session not found: {0}")]
    TargetNotFound(String),
    #[error("caller session is closed")]
    CallerClosed,
    #[error("target session is closed")]
    TargetClosed,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub fn authorize(
    session_store: &SessionStore,
    caller_session_id: &str,
    target_session_id: &str,
    intent: AgentAccessIntent,
) -> Result<AgentAccess, AgentAccessError> {
    let caller = session_store
        .find_by_id(caller_session_id)?
        .ok_or_else(|| AgentAccessError::CallerNotFound(caller_session_id.to_string()))?;
    if is_closed(&caller) {
        return Err(AgentAccessError::CallerClosed);
    }
    let target = session_store
        .find_by_id(target_session_id)?
        .ok_or_else(|| AgentAccessError::TargetNotFound(target_session_id.to_string()))?;
    if intent == AgentAccessIntent::Send && is_closed(&target) {
        return Err(AgentAccessError::TargetClosed);
    }
    Ok(AgentAccess { caller, target })
}

fn is_closed(session: &SessionRecord) -> bool {
    session.closed_at.is_some() || session.status == "closed"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::persistence::Db;

    fn session_record(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
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
            status: "idle".to_string(),
            created_at: "2026-08-07T00:00:00Z".to_string(),
            updated_at: "2026-08-07T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn store_fixture() -> SessionStore {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-2",
            "local",
            "/tmp/workspace-2",
        );
        SessionStore::new(db)
    }

    #[test]
    fn visibility_is_runtime_wide_across_workspaces() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");
        store
            .insert(&session_record("target", "workspace-2"))
            .expect("insert target");

        let access = authorize(&store, "caller", "target", AgentAccessIntent::Send)
            .expect("authorize across workspaces");

        assert_eq!(access.caller.id, "caller");
        assert_eq!(access.target.id, "target");
    }

    #[test]
    fn closed_target_rejects_sends_but_stays_readable() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");
        let mut target = session_record("target", "workspace-1");
        target.closed_at = Some("2026-08-07T01:00:00Z".to_string());
        target.status = "closed".to_string();
        store.insert(&target).expect("insert target");

        let error = authorize(&store, "caller", "target", AgentAccessIntent::Send)
            .err()
            .expect("closed target rejects sends");
        assert!(matches!(error, AgentAccessError::TargetClosed));

        authorize(&store, "caller", "target", AgentAccessIntent::Read)
            .expect("closed target stays readable");
    }

    #[test]
    fn closed_caller_is_rejected_for_every_intent() {
        let store = store_fixture();
        let mut caller = session_record("caller", "workspace-1");
        caller.closed_at = Some("2026-08-07T01:00:00Z".to_string());
        store.insert(&caller).expect("insert caller");
        store
            .insert(&session_record("target", "workspace-1"))
            .expect("insert target");

        for intent in [AgentAccessIntent::Read, AgentAccessIntent::Send] {
            let error = authorize(&store, "caller", "target", intent)
                .err()
                .expect("closed caller is rejected");
            assert!(matches!(error, AgentAccessError::CallerClosed));
        }
    }

    #[test]
    fn missing_sessions_are_reported_by_side() {
        let store = store_fixture();
        store
            .insert(&session_record("caller", "workspace-1"))
            .expect("insert caller");

        let missing_target = authorize(&store, "caller", "ghost", AgentAccessIntent::Read)
            .err()
            .expect("missing target");
        assert!(matches!(missing_target, AgentAccessError::TargetNotFound(id) if id == "ghost"));

        let missing_caller = authorize(&store, "ghost", "caller", AgentAccessIntent::Read)
            .err()
            .expect("missing caller");
        assert!(matches!(missing_caller, AgentAccessError::CallerNotFound(id) if id == "ghost"));
    }
}
