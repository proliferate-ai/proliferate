use std::path::PathBuf;

use serde_json::json;
use tokio::sync::broadcast;

use super::{AcpChunkPayload, SessionEventSink};
use crate::persistence::Db;
use crate::sessions::model::{SessionBackgroundWorkState, SessionRecord};
use crate::sessions::runtime_event::{RuntimeEventInjectionError, RuntimeInjectedSessionEvent};
use crate::sessions::store::SessionStore;
use anyharness_contract::v1::{
    ContentPart, SessionEvent, SessionEventEnvelope, StopReason, TranscriptItemKind,
    TranscriptItemStatus,
};

#[test]
fn assistant_chunking_emits_one_item_lifecycle_with_monotonic_seq() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store.clone(),
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("Hel"),
        ..Default::default()
    });
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("lo"),
        ..Default::default()
    });
    sink.turn_ended(StopReason::EndTurn);

    let events = drain_events(&mut rx);
    let event_types = events
        .iter()
        .map(|event| event.event.event_type())
        .collect::<Vec<_>>();

    assert_eq!(
        event_types,
        vec![
            "turn_started",
            "item_started",
            "item_completed",
            "item_started",
            "item_delta",
            "item_completed",
            "turn_ended",
        ]
    );
    assert!(events
        .windows(2)
        .all(|window| window[0].seq < window[1].seq));
    assert_eq!(events[3].item_id, events[4].item_id);
    assert_eq!(events[4].item_id, events[5].item_id);
    assert_eq!(
        store
            .list_events("session-1")
            .expect("persisted events")
            .len(),
        events.len()
    );
}

#[test]
fn injected_runtime_event_persists_strictly_and_keeps_sequence() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::resume_from_seq(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        5,
        tx,
        store.clone(),
    );

    let envelope = sink
        .inject_runtime_event(RuntimeInjectedSessionEvent::SessionInfoUpdate {
            title: Some("Renamed".to_string()),
            updated_at: Some("2026-04-04T00:02:00Z".to_string()),
        })
        .expect("inject event");

    assert_eq!(envelope.seq, 6);
    assert_eq!(sink.next_seq(), 7);
    let persisted = store.list_events("session-1").expect("list events");
    assert_eq!(persisted.len(), 1);
    assert_eq!(persisted[0].seq, 6);
    assert_eq!(persisted[0].event_type, "session_info_update");
    assert_eq!(rx.try_recv().expect("broadcast event").seq, 6);
}

#[test]
fn injected_runtime_event_errors_when_persistence_fails() {
    let store = SessionStore::new(Db::open_in_memory().expect("open db"));
    let (tx, _rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "missing-session".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store,
    );

    let error = sink
        .inject_runtime_event(RuntimeInjectedSessionEvent::SessionInfoUpdate {
            title: Some("Renamed".to_string()),
            updated_at: None,
        })
        .expect_err("persistence should fail");

    assert!(matches!(
        error,
        RuntimeEventInjectionError::PersistenceFailed(_)
    ));
    assert_eq!(sink.next_seq(), 1);
}

#[test]
fn assistant_completion_marker_closes_matching_open_message() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "codex".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store.clone(),
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("Hel"),
        message_id: Some("2d313586-97aa-436b-932c-7e0c0b286f87".to_string()),
        ..Default::default()
    });
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("lo"),
        message_id: Some("2d313586-97aa-436b-932c-7e0c0b286f87".to_string()),
        ..Default::default()
    });
    sink.agent_message_chunk(assistant_completion_marker(
        "2d313586-97aa-436b-932c-7e0c0b286f87",
    ));

    let events = drain_events(&mut rx);
    let event_types = events
        .iter()
        .map(|event| event.event.event_type())
        .collect::<Vec<_>>();

    assert_eq!(
        event_types,
        vec![
            "turn_started",
            "item_started",
            "item_completed",
            "item_started",
            "item_delta",
            "item_completed",
        ]
    );
    assert_eq!(events[3].item_id, events[4].item_id);
    assert_eq!(events[4].item_id, events[5].item_id);

    let SessionEvent::ItemCompleted(completed) = &events[5].event else {
        panic!("expected item_completed");
    };
    assert!(matches!(
        &completed.item.kind,
        TranscriptItemKind::AssistantMessage
    ));
    assert!(matches!(
        &completed.item.status,
        TranscriptItemStatus::Completed
    ));
    assert_eq!(
        completed.item.message_id.as_deref(),
        Some("2d313586-97aa-436b-932c-7e0c0b286f87")
    );
    assert_eq!(
        completed.item.content_parts,
        vec![ContentPart::Text {
            text: "Hello".to_string(),
        }]
    );
}

#[test]
fn assistant_completion_marker_ignores_mismatched_message_id() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "codex".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store,
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("Hello"),
        message_id: Some("2d313586-97aa-436b-932c-7e0c0b286f87".to_string()),
        ..Default::default()
    });
    sink.agent_message_chunk(assistant_completion_marker(
        "f760973a-2eb1-4258-9de1-f643dce51c70",
    ));

    let events = drain_events(&mut rx);
    let event_types = events
        .iter()
        .map(|event| event.event.event_type())
        .collect::<Vec<_>>();

    assert_eq!(
        event_types,
        vec![
            "turn_started",
            "item_started",
            "item_completed",
            "item_started",
        ]
    );
}

#[test]
fn transient_status_marker_sets_transient_reasoning_and_replaces_text() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "codex".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store,
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.agent_thought_chunk(transient_status_chunk("Authenticating MCP server"));
    sink.agent_thought_chunk(transient_status_chunk("Waiting for browser auth"));
    sink.turn_ended(StopReason::EndTurn);

    let events = drain_events(&mut rx);
    let SessionEvent::ItemStarted(started) = &events[3].event else {
        panic!("expected transient item_started");
    };
    assert!(started.item.is_transient);
    assert_eq!(
        started.item.content_parts,
        vec![ContentPart::Reasoning {
            text: "Authenticating MCP server".to_string(),
            visibility: anyharness_contract::v1::ReasoningVisibility::Private,
        }]
    );

    let SessionEvent::ItemDelta(delta) = &events[4].event else {
        panic!("expected transient item_delta");
    };
    assert_eq!(delta.delta.is_transient, Some(true));
    assert_eq!(delta.delta.append_reasoning, None);
    assert_eq!(
        delta.delta.replace_content_parts,
        Some(vec![ContentPart::Reasoning {
            text: "Waiting for browser auth".to_string(),
            visibility: anyharness_contract::v1::ReasoningVisibility::Private,
        }])
    );

    let SessionEvent::ItemCompleted(completed) = &events[5].event else {
        panic!("expected transient item_completed");
    };
    assert!(completed.item.is_transient);
    assert_eq!(
        completed.item.content_parts,
        vec![ContentPart::Reasoning {
            text: "Waiting for browser auth".to_string(),
            visibility: anyharness_contract::v1::ReasoningVisibility::Private,
        }]
    );
}

#[test]
fn regular_thought_chunks_remain_non_transient_and_append() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "codex".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store,
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.agent_thought_chunk(AcpChunkPayload {
        content: json!("Thinking"),
        message_id: Some("reasoning-1".to_string()),
        ..Default::default()
    });
    sink.agent_thought_chunk(AcpChunkPayload {
        content: json!(" harder"),
        message_id: Some("reasoning-1".to_string()),
        ..Default::default()
    });

    let events = drain_events(&mut rx);
    let SessionEvent::ItemStarted(started) = &events[3].event else {
        panic!("expected reasoning item_started");
    };
    assert!(!started.item.is_transient);

    let SessionEvent::ItemDelta(delta) = &events[4].event else {
        panic!("expected reasoning item_delta");
    };
    assert_eq!(delta.delta.is_transient, Some(false));
    assert_eq!(delta.delta.append_reasoning.as_deref(), Some(" harder"));
    assert_eq!(delta.delta.replace_content_parts, None);
}

#[test]
fn plan_updates_reuse_the_same_plan_item_until_turn_end() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store.clone(),
    );

    sink.begin_turn("plan this".to_string(), None, Vec::new(), None);
    sink.plan(vec![json!({ "content": "Step 1", "status": "pending" })]);
    sink.plan(vec![json!({ "content": "Step 1", "status": "completed" })]);
    sink.turn_ended(StopReason::EndTurn);

    let events = drain_events(&mut rx);
    let event_types = events
        .iter()
        .map(|event| event.event.event_type())
        .collect::<Vec<_>>();

    assert_eq!(
        event_types,
        vec![
            "turn_started",
            "item_started",
            "item_completed",
            "item_started",
            "item_delta",
            "item_completed",
            "turn_ended",
        ]
    );
    assert_eq!(events[3].item_id, events[4].item_id);
    assert_eq!(events[4].item_id, events[5].item_id);
    assert_eq!(
        store
            .list_events("session-1")
            .expect("persisted events")
            .len(),
        events.len()
    );
}

#[test]
fn background_resolution_reuses_existing_tool_item_id() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store.clone(),
    );

    sink.begin_turn("delegate".to_string(), None, Vec::new(), None);
    sink.tool_call(super::AcpToolPayload {
        tool_call_id: "tool-1".to_string(),
        title: Some("Launch investigator".to_string()),
        kind: Some("other".to_string()),
        status: Some("in_progress".to_string()),
        raw_input: Some(json!({ "run_in_background": true })),
        meta: Some(json!({
            "claudeCode": {
                "toolName": "Agent",
                "toolResponse": {
                    "isAsync": true,
                    "agentId": "agent-1",
                    "outputFile": "/tmp/agent.output"
                }
            }
        })),
        ..Default::default()
    });
    sink.tool_call_update(super::AcpToolPayload {
        tool_call_id: "tool-1".to_string(),
        status: Some("completed".to_string()),
        content: Some(vec![json!({
            "type": "tool_result_text",
            "text": "Async agent launched successfully.\nThe agent is working in the background."
        })]),
        ..Default::default()
    });

    let turn_id = sink.current_turn_id().expect("turn id");
    sink.resolve_background_tool_call(
        turn_id,
        "tool-1".to_string(),
        SessionBackgroundWorkState::Completed,
        Some("agent-1".to_string()),
        "/tmp/agent.output".to_string(),
        "Final synthesized result.".to_string(),
    );

    let events = drain_events(&mut rx);
    let background_delta = events
        .iter()
        .rev()
        .find(|event| event.event.event_type() == "item_delta")
        .expect("background delta");
    let background_completed = events
        .iter()
        .rev()
        .find(|event| event.event.event_type() == "item_completed")
        .expect("background completion");

    assert_eq!(background_delta.item_id.as_deref(), Some("tool-1"));
    assert_eq!(background_completed.item_id.as_deref(), Some("tool-1"));
    let delta_payload = match &background_delta.event {
        SessionEvent::ItemDelta(event) => &event.delta,
        other => panic!("expected item_delta, got {}", other.event_type()),
    };
    let raw_output = delta_payload
        .raw_output
        .as_ref()
        .and_then(serde_json::Value::as_object)
        .expect("background raw_output");
    assert_eq!(
        raw_output
            .get("_anyharness")
            .and_then(serde_json::Value::as_object)
            .and_then(|value| value.get("backgroundWork"))
            .and_then(serde_json::Value::as_object)
            .and_then(|value| value.get("state"))
            .and_then(serde_json::Value::as_str),
        Some("completed")
    );
    assert_eq!(
        store
            .list_events("session-1")
            .expect("persisted events")
            .last()
            .expect("last event")
            .item_id
            .as_deref(),
        Some("tool-1")
    );
}

#[test]
fn async_launch_completion_preserves_background_metadata_on_completed_item() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        store,
    );

    sink.begin_turn("delegate".to_string(), None, Vec::new(), None);
    sink.tool_call(super::AcpToolPayload {
        tool_call_id: "tool-1".to_string(),
        title: Some("Task".to_string()),
        kind: Some("think".to_string()),
        status: Some("in_progress".to_string()),
        raw_input: Some(json!({})),
        meta: Some(json!({
            "claudeCode": {
                "toolName": "Agent"
            }
        })),
        ..Default::default()
    });
    sink.tool_call_update(super::AcpToolPayload {
        tool_call_id: "tool-1".to_string(),
        title: Some("Pick favorite file from desktop".to_string()),
        status: Some("in_progress".to_string()),
        raw_input: Some(json!({
            "description": "Pick favorite file from desktop",
            "run_in_background": true,
        })),
        meta: Some(json!({
            "claudeCode": {
                "toolName": "Agent"
            }
        })),
        ..Default::default()
    });
    sink.tool_call_update(super::AcpToolPayload {
        tool_call_id: "tool-1".to_string(),
        status: Some("in_progress".to_string()),
        meta: Some(json!({
            "claudeCode": {
                "toolName": "Agent",
                "toolResponse": {
                    "isAsync": true,
                    "agentId": "agent-1",
                    "outputFile": "/tmp/agent.output"
                }
            }
        })),
        ..Default::default()
    });
    sink.tool_call_update(super::AcpToolPayload {
        tool_call_id: "tool-1".to_string(),
        status: Some("completed".to_string()),
        raw_output: Some(json!([
            {
                "type": "text",
                "text": "Async agent launched successfully.\nThe agent is working in the background."
            }
        ])),
        content: Some(vec![json!({
            "type": "tool_result_text",
            "text": "Async agent launched successfully.\nThe agent is working in the background."
        })]),
        meta: Some(json!({
            "claudeCode": {
                "toolName": "Agent"
            }
        })),
        ..Default::default()
    });

    let events = drain_events(&mut rx);
    let completed = events
        .iter()
        .rev()
        .find_map(|event| match &event.event {
            SessionEvent::ItemCompleted(completed)
                if event.item_id.as_deref() == Some("tool-1") =>
            {
                Some(&completed.item)
            }
            _ => None,
        })
        .expect("completed tool item");

    let raw_output = completed
        .raw_output
        .as_ref()
        .and_then(serde_json::Value::as_object)
        .expect("completed raw_output");
    assert_eq!(
        raw_output
            .get("_anyharness")
            .and_then(serde_json::Value::as_object)
            .and_then(|value| value.get("backgroundWork"))
            .and_then(serde_json::Value::as_object)
            .and_then(|value| value.get("state"))
            .and_then(serde_json::Value::as_str),
        Some("pending")
    );
    assert_eq!(
        raw_output
            .get("outputFile")
            .and_then(serde_json::Value::as_str),
        Some("/tmp/agent.output")
    );
}

fn seeded_store() -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
             VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            rusqlite::params!["workspace-1", "2026-04-04T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");

    let store = SessionStore::new(db);
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
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
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        })
        .expect("seed session");
    store
}

fn drain_events(rx: &mut broadcast::Receiver<SessionEventEnvelope>) -> Vec<SessionEventEnvelope> {
    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        events.push(event);
    }
    events
}

fn assistant_completion_marker(message_id: &str) -> AcpChunkPayload {
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

fn transient_status_chunk(text: &str) -> AcpChunkPayload {
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
