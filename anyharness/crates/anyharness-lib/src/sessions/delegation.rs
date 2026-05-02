use anyharness_contract::v1::SessionEvent;
use serde_json::json;

use super::links::model::{SessionLinkRecord, SessionLinkRelation};
use super::links::service::SessionLinkService;
use super::prompt::PromptProvenance;
use super::store::SessionStore;

pub const READ_EVENTS_DEFAULT_LIMIT: usize = 50;
pub const READ_EVENTS_MAX_LIMIT: usize = 100;
pub const READ_EVENTS_MAX_BYTES: usize = 256 * 1024;

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
    authorize_child(link_service, relation, parent_session_id, child_session_id)?;
    let limit = limit
        .unwrap_or(READ_EVENTS_DEFAULT_LIMIT)
        .min(READ_EVENTS_MAX_LIMIT);
    let after_seq = since_seq.unwrap_or(0);
    let mut records = session_store.list_events_after(child_session_id, after_seq)?;
    records.truncate(limit);

    let mut total_bytes = 0usize;
    let mut truncated = false;
    let mut events = Vec::with_capacity(records.len());
    let mut next_since_seq = None;
    for record in records {
        let seq = record.seq;
        let oversized_placeholder = oversized_event_placeholder(&record);
        let event = sanitize_event_record(record)?;
        let event_bytes = serde_json::to_vec(&event)?.len();
        if total_bytes.saturating_add(event_bytes) > READ_EVENTS_MAX_BYTES {
            truncated = true;
            if events.is_empty() {
                events.push(oversized_placeholder);
                next_since_seq = Some(seq);
            }
            break;
        }
        total_bytes += event_bytes;
        next_since_seq = Some(seq);
        events.push(event);
    }

    Ok(DelegatedEventSlice {
        child_session_id: child_session_id.to_string(),
        events,
        next_since_seq,
        truncated,
    })
}

fn sanitize_event_record(
    record: super::model::SessionEventRecord,
) -> anyhow::Result<serde_json::Value> {
    let event: SessionEvent = serde_json::from_str(&record.payload_json)?;
    if matches!(event, SessionEvent::ItemDelta(_)) {
        return Ok(json!({
            "seq": record.seq,
            "timestamp": record.timestamp,
            "turnId": record.turn_id,
            "itemId": record.item_id,
            "type": "item_delta_redacted",
        }));
    }
    let mut event_value = serde_json::to_value(event)?;
    redact_tool_io(&mut event_value);
    Ok(json!({
        "seq": record.seq,
        "timestamp": record.timestamp,
        "turnId": record.turn_id,
        "itemId": record.item_id,
        "event": event_value,
    }))
}

fn redact_tool_io(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.remove("rawInput");
            map.remove("rawOutput");
            for value in map.values_mut() {
                redact_tool_io(value);
            }
        }
        serde_json::Value::Array(items) => {
            for value in items {
                redact_tool_io(value);
            }
        }
        _ => {}
    }
}

fn oversized_event_placeholder(record: &super::model::SessionEventRecord) -> serde_json::Value {
    json!({
        "seq": record.seq,
        "timestamp": record.timestamp.clone(),
        "turnId": record.turn_id.clone(),
        "itemId": record.item_id.clone(),
        "eventType": record.event_type.clone(),
        "type": "event_oversized_redacted",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;
    use crate::sessions::links::service::{CreateSessionLinkInput, SessionLinkService};
    use crate::sessions::links::store::SessionLinkStore;
    use crate::sessions::model::SessionEventRecord;
    use crate::sessions::model::SessionRecord;
    use crate::sessions::store::SessionStore;
    use rusqlite::params;

    fn seed_workspace(db: &Db) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");
    }

    fn session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
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
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
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
    fn read_event_sanitizer_redacts_streaming_deltas() {
        let sanitized = sanitize_event_record(event_record(
            7,
            "item_delta",
            r#"{"type":"item_delta","delta":{"appendText":"secret"}}"#,
        ))
        .expect("sanitize event");

        assert_eq!(sanitized["type"], "item_delta_redacted");
        assert!(sanitized.get("event").is_none());
    }

    #[test]
    fn read_event_sanitizer_removes_raw_tool_io() {
        let sanitized = sanitize_event_record(event_record(
            7,
            "item_completed",
            r#"{
                "type": "item_completed",
                "item": {
                    "kind": "tool_invocation",
                    "status": "completed",
                    "sourceAgentKind": "claude",
                    "rawInput": { "token": "secret" },
                    "rawOutput": { "result": "secret" },
                    "contentParts": []
                }
            }"#,
        ))
        .expect("sanitize event");

        let item = &sanitized["event"]["item"];
        assert!(item.get("rawInput").is_none());
        assert!(item.get("rawOutput").is_none());
        assert_eq!(item["kind"], "tool_invocation");
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
                    crate::sessions::links::model::SessionLinkWorkspaceRelation::SameWorkspace,
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
