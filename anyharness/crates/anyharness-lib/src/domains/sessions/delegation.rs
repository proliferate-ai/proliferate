use super::links::model::{SessionLinkRecord, SessionLinkRelation};
use super::links::service::SessionLinkService;
use super::prompt::provenance::PromptProvenance;
use super::store::SessionStore;
use super::transcript_read::read_session_events;

// The budgets belong to the session-scoped reads; a delegated read is the same
// read with a link check in front of it.
pub(crate) use super::transcript_read::{
    READ_EVENTS_DEFAULT_LIMIT, READ_EVENTS_MAX_BYTES, READ_EVENTS_MAX_LIMIT,
};

#[derive(Debug, Clone)]
pub struct DelegatedEventSlice {
    pub child_session_id: String,
    pub events: Vec<serde_json::Value>,
    pub next_since_seq: Option<i64>,
    pub truncated: bool,
}

pub fn authorize_child(
    link_service: &SessionLinkService,
    relation: SessionLinkRelation,
    parent_session_id: &str,
    child_session_id: &str,
) -> anyhow::Result<SessionLinkRecord> {
    link_service
        .find_link_by_relation(relation, parent_session_id, child_session_id)?
        .ok_or_else(|| anyhow::anyhow!("child session is not owned by parent"))
}

pub(crate) fn parent_to_child_provenance(
    parent_session_id: &str,
    session_link_id: &str,
    label: Option<String>,
) -> PromptProvenance {
    PromptProvenance::AgentSession {
        source_session_id: parent_session_id.to_string(),
        session_link_id: Some(session_link_id.to_string()),
        label,
    }
}

pub fn read_child_events(
    session_store: &SessionStore,
    link_service: &SessionLinkService,
    relation: SessionLinkRelation,
    parent_session_id: &str,
    child_session_id: &str,
    since_seq: Option<i64>,
    limit: Option<usize>,
) -> anyhow::Result<DelegatedEventSlice> {
    link_service
        .find_link_by_relation_including_closed(relation, parent_session_id, child_session_id)?
        .ok_or_else(|| anyhow::anyhow!("child session is not owned by parent"))?;
    let slice = read_session_events(session_store, child_session_id, since_seq, limit)?;
    Ok(DelegatedEventSlice {
        child_session_id: slice.session_id,
        events: slice.events,
        next_since_seq: slice.next_since_seq,
        truncated: slice.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::links::service::{CreateSessionLinkInput, SessionLinkService};
    use crate::domains::sessions::links::store::SessionLinkStore;
    use crate::domains::sessions::model::SessionEventRecord;
    use crate::domains::sessions::model::SessionRecord;
    use crate::domains::sessions::store::SessionStore;
    use crate::persistence::Db;

    fn seed_workspace(db: &Db) {
        test_support::seed_workspace_with_repo_root(db, "workspace-1", "local", "/tmp/workspace");
    }

    fn session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
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
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn delegation_fixture() -> (SessionStore, SessionLinkService) {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);
        let session_store = SessionStore::new(db.clone());
        session_store
            .insert(&session_record("parent-1"))
            .expect("insert parent");
        session_store
            .insert(&session_record("child-1"))
            .expect("insert child");
        let link_service =
            SessionLinkService::new(SessionLinkStore::new(db.clone()), session_store.clone());
        (session_store, link_service)
    }

    fn event_record(seq: i64, event_type: &str, payload_json: &str) -> SessionEventRecord {
        SessionEventRecord {
            id: 0,
            session_id: "child-1".to_string(),
            seq,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: event_type.to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: Some("item-1".to_string()),
            payload_json: payload_json.to_string(),
        }
    }

    #[test]
    fn read_child_events_cursor_tracks_last_emitted_event_when_byte_truncated() {
        let (session_store, link_service) = delegation_fixture();

        link_service
            .create_link(CreateSessionLinkInput {
                relation: SessionLinkRelation::Subagent,
                parent_session_id: "parent-1".to_string(),
                child_session_id: "child-1".to_string(),
                workspace_relation:
                    crate::domains::sessions::links::model::SessionLinkWorkspaceRelation::SameWorkspace,
                label: None,
                created_by_turn_id: None,
                created_by_tool_call_id: None,
            })
            .expect("link");

        let oversized_text = "x".repeat(READ_EVENTS_MAX_BYTES);
        session_store
            .append_event(&event_record(
                1,
                "session_info_update",
                r#"{"type":"session_info_update","title":"first"}"#,
            ))
            .expect("first event");
        session_store
            .append_event(&event_record(
                2,
                "session_info_update",
                &serde_json::json!({
                    "type": "session_info_update",
                    "title": oversized_text,
                })
                .to_string(),
            ))
            .expect("oversized event");

        let slice = read_child_events(
            &session_store,
            &link_service,
            SessionLinkRelation::Subagent,
            "parent-1",
            "child-1",
            None,
            Some(100),
        )
        .expect("read events");

        assert!(slice.truncated);
        assert_eq!(slice.events.len(), 1);
        assert_eq!(slice.next_since_seq, Some(1));

        let slice = read_child_events(
            &session_store,
            &link_service,
            SessionLinkRelation::Subagent,
            "parent-1",
            "child-1",
            Some(1),
            Some(100),
        )
        .expect("read oversized event");

        assert!(slice.truncated);
        assert_eq!(slice.events.len(), 1);
        assert_eq!(slice.events[0]["type"], "event_oversized_redacted");
        assert_eq!(slice.next_since_seq, Some(2));
    }
}
