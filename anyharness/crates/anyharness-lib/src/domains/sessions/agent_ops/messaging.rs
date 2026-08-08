//! Everything `send_agent_message` decides before the prompt queue takes over.
//!
//! Split out from the dispatch call so the whole decision — who may be
//! reached, what the target receives, and what is stored beside it — is
//! testable without a live actor. What follows this is the ordinary
//! pending-prompt path: a busy target queues, an idle open target boots.

use crate::domains::sessions::authorize::{authorize, AgentAccessError, AgentAccessIntent};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::prompt::envelope::{agent_message, AgentMessageSender};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::store::SessionStore;

#[derive(Debug, thiserror::Error)]
pub(super) enum AgentMessageError {
    #[error("message is required")]
    EmptyMessage,
    #[error(transparent)]
    Access(#[from] AgentAccessError),
}

#[derive(Debug, Clone)]
pub(super) struct PreparedAgentMessage {
    pub target: SessionRecord,
    pub sender_label: String,
    pub text: String,
    pub provenance: PromptProvenance,
}

/// Gate the send, then build the envelope. Any agent may message any agent:
/// reach is runtime-wide and unlinked, so the only refusals here are an empty
/// body, a session that does not exist, and a closed target — a closed session
/// takes no more input and its actor is never spun up again.
pub(super) fn prepare_agent_message(
    session_store: &SessionStore,
    caller_session_id: &str,
    target_session_id: &str,
    message: &str,
) -> Result<PreparedAgentMessage, AgentMessageError> {
    if message.trim().is_empty() {
        return Err(AgentMessageError::EmptyMessage);
    }
    let access = authorize(
        session_store,
        caller_session_id,
        target_session_id,
        AgentAccessIntent::Send,
    )?;
    let sender = AgentMessageSender::from_session(&access.caller);
    let (text, provenance) = agent_message(&sender, message).into_parts();
    Ok(PreparedAgentMessage {
        target: access.target,
        sender_label: sender.label,
        text,
        provenance,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::domains::sessions::prompt::PromptPayload;
    use crate::persistence::Db;

    fn session_record(id: &str, workspace_id: &str, title: Option<&str>) -> SessionRecord {
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
            title: title.map(ToString::to_string),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
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
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        test_support::seed_workspace_with_repo_root(&db, "workspace-2", "local", "/tmp/workspace-2");
        let store = SessionStore::new(db);
        store
            .insert(&session_record(
                "ses_caller",
                "workspace-1",
                Some("Deploy Checker"),
            ))
            .expect("insert caller");
        store
            .insert(&session_record("ses_target", "workspace-2", Some("Schema audit")))
            .expect("insert target");
        store
    }

    #[test]
    fn an_open_target_in_another_workspace_is_reachable() {
        let store = store_fixture();

        let prepared = prepare_agent_message(&store, "ses_caller", "ses_target", "Ship it?")
            .expect("prepare message");

        assert_eq!(prepared.target.id, "ses_target");
        assert_eq!(prepared.target.workspace_id, "workspace-2");
        assert_eq!(prepared.sender_label, "Deploy Checker");
    }

    #[test]
    fn a_closed_target_is_rejected_before_any_prompt_is_built() {
        let store = store_fixture();
        let mut closed = session_record("ses_closed", "workspace-1", Some("Retired"));
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        store.insert(&closed).expect("insert closed target");

        let error = prepare_agent_message(&store, "ses_caller", "ses_closed", "Ship it?")
            .err()
            .expect("closed target is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::TargetClosed)
        ));
        assert_eq!(error.to_string(), "target session is closed");
    }

    #[test]
    fn an_unknown_target_is_named_in_the_error() {
        let store = store_fixture();

        let error = prepare_agent_message(&store, "ses_caller", "ses_ghost", "Ship it?")
            .err()
            .expect("unknown target is rejected");

        assert!(matches!(
            error,
            AgentMessageError::Access(AgentAccessError::TargetNotFound(ref id)) if id == "ses_ghost"
        ));
    }

    #[test]
    fn a_blank_message_is_rejected() {
        let store = store_fixture();

        let error = prepare_agent_message(&store, "ses_caller", "ses_target", "  \n ")
            .err()
            .expect("blank message is rejected");

        assert!(matches!(error, AgentMessageError::EmptyMessage));
    }

    #[test]
    fn the_target_receives_the_envelope_and_the_row_stores_exactly_that_text() {
        let store = store_fixture();

        let prepared = prepare_agent_message(&store, "ses_caller", "ses_target", "Ship it?")
            .expect("prepare message");

        assert_eq!(
            prepared.text,
            "Message from agent \"Deploy Checker\" (session ses_caller):\n\nShip it?\n\nTo reply, use send_agent_message with sessionId \"ses_caller\"."
        );
        assert_eq!(
            prepared.provenance,
            PromptProvenance::AgentSession {
                source_session_id: "ses_caller".to_string(),
                session_link_id: None,
                label: Some("Deploy Checker".to_string()),
            }
        );

        // The dispatch call builds exactly this payload from the two halves.
        let payload =
            PromptPayload::text(prepared.text.clone()).with_provenance(prepared.provenance.clone());
        assert_eq!(payload.text_summary, prepared.text);
        assert!(payload.public_provenance().is_some());
    }
}
