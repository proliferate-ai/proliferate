use std::path::PathBuf;
use std::sync::Arc;

use anyharness_contract::v1::{SessionEvent, StopReason, TranscriptItemKind};
use serde_json::json;
use tokio::sync::broadcast;

use super::super::{AcpChunkPayload, AcpToolPayload, SessionEventSink};
use super::support::{drain_events, seeded_store};

#[test]
fn provider_neutral_subagent_metadata_persists_nested_live_events_for_replay() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "codex".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    sink.begin_turn("delegate".to_string(), None, Vec::new(), None);
    sink.tool_call(AcpToolPayload {
        tool_call_id: "agent-1".to_string(),
        title: Some("Inspect the repository".to_string()),
        kind: Some("think".to_string()),
        status: Some("in_progress".to_string()),
        meta: Some(json!({
            "anyharness": {
                "nativeToolName": "Agent",
                "toolKind": "subagent"
            }
        })),
        ..Default::default()
    });
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("Inspecting README.md"),
        message_id: Some("child-message-1".to_string()),
        meta: Some(json!({
            "anyharness": { "parentToolCallId": "agent-1" }
        })),
    });
    sink.tool_call(AcpToolPayload {
        tool_call_id: "child-read-1".to_string(),
        title: Some("Read README.md".to_string()),
        kind: Some("read".to_string()),
        status: Some("completed".to_string()),
        meta: Some(json!({
            "anyharness": {
                "nativeToolName": "Read",
                "parentToolCallId": "agent-1"
            }
        })),
        ..Default::default()
    });
    sink.tool_call_update(AcpToolPayload {
        tool_call_id: "agent-1".to_string(),
        status: Some("completed".to_string()),
        raw_output: Some(json!({ "summary": "The first heading is Proliferate." })),
        ..Default::default()
    });
    sink.turn_ended(StopReason::EndTurn);

    let live = drain_events(&mut rx);
    let replay = store.list_events("session-1").expect("persisted replay");
    assert_eq!(
        replay.iter().map(|event| event.seq).collect::<Vec<_>>(),
        live.iter().map(|event| event.seq).collect::<Vec<_>>()
    );

    let nested = live
        .iter()
        .filter_map(|envelope| match &envelope.event {
            SessionEvent::ItemStarted(event) => Some(&event.item),
            SessionEvent::ItemCompleted(event) => Some(&event.item),
            _ => None,
        })
        .filter(|item| item.parent_tool_call_id.as_deref() == Some("agent-1"))
        .collect::<Vec<_>>();
    assert!(nested.iter().any(|item| {
        matches!(item.kind, TranscriptItemKind::AssistantMessage)
            && item.message_id.as_deref() == Some("child-message-1")
    }));
    assert!(nested.iter().any(|item| {
        matches!(item.kind, TranscriptItemKind::ToolInvocation)
            && item.tool_call_id.as_deref() == Some("child-read-1")
    }));

    let replay_events = replay
        .iter()
        .map(|record| {
            serde_json::from_str::<SessionEvent>(&record.payload_json)
                .expect("deserialize persisted event")
        })
        .collect::<Vec<_>>();
    let replay_nested = replay_events
        .iter()
        .filter_map(|event| match event {
            SessionEvent::ItemStarted(event) => Some(&event.item),
            SessionEvent::ItemCompleted(event) => Some(&event.item),
            _ => None,
        })
        .filter(|item| item.parent_tool_call_id.as_deref() == Some("agent-1"))
        .collect::<Vec<_>>();
    assert!(replay_nested.iter().any(|item| {
        matches!(item.kind, TranscriptItemKind::AssistantMessage)
            && item.message_id.as_deref() == Some("child-message-1")
    }));
    assert!(replay_nested.iter().any(|item| {
        matches!(item.kind, TranscriptItemKind::ToolInvocation)
            && item.tool_call_id.as_deref() == Some("child-read-1")
    }));
}
