use serde_json::json;
use tokio::sync::broadcast;

use crate::app::test_support;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::sink::AcpChunkPayload;
use crate::persistence::Db;
use anyharness_contract::v1::SessionEventEnvelope;

pub(super) fn empty_store() -> SessionStore {
    SessionStore::new(Db::open_in_memory().expect("open db"))
}

pub(super) fn seeded_store() -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");

    let store = SessionStore::new(db);
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-04-04T00:00:00Z".to_string(),
            updated_at: "2026-04-04T00:00:00Z".to_string(),
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
        })
        .expect("seed session");
    store
}

pub(super) fn drain_events(
    rx: &mut broadcast::Receiver<SessionEventEnvelope>,
) -> Vec<SessionEventEnvelope> {
    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        events.push(event);
    }
    events
}

pub(super) fn assistant_completion_marker(message_id: &str) -> AcpChunkPayload {
    AcpChunkPayload {
        content: json!(""),
        meta: Some(json!({
            "anyharness": {
                "transcriptEvent": "assistant_message_completed",
                "codexItemId": "item-1",
            },
        })),
        message_id: Some(message_id.to_string()),
    }
}

pub(super) fn transient_status_chunk(text: &str) -> AcpChunkPayload {
    AcpChunkPayload {
        content: json!(text),
        meta: Some(json!({
            "anyharness": {
                "transcriptEvent": "transient_status",
            },
        })),
        message_id: Some("status-stream".to_string()),
    }
}
