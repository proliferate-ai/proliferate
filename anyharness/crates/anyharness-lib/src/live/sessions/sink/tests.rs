use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tokio::sync::broadcast;

mod support;

use super::{AcpChunkPayload, SessionEventSink};
use crate::domains::sessions::model::SessionBackgroundWorkState;
use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionError, RuntimeInjectedSessionEvent,
};
use anyharness_contract::v1::{
    ContentPart, SessionEvent, StopReason, TranscriptItemKind, TranscriptItemStatus,
};
use support::{
    assistant_completion_marker, drain_events, empty_store, seeded_store, transient_status_chunk,
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
        Arc::new(store.clone()),
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
    let persisted = store.list_events("session-1").expect("persisted events");
    assert_eq!(persisted.len(), events.len());
    assert_eq!(
        persisted.iter().map(|event| event.seq).collect::<Vec<_>>(),
        events.iter().map(|event| event.seq).collect::<Vec<_>>()
    );
    assert_eq!(sink.next_seq(), events.len() as i64 + 1);
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
        Arc::new(store.clone()),
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
    let store = empty_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "missing-session".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store),
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
    assert!(matches!(
        rx.try_recv(),
        Err(broadcast::error::TryRecvError::Empty)
    ));
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
        Arc::new(store.clone()),
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
        Arc::new(store),
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
        Arc::new(store),
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
        Arc::new(store),
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
        Arc::new(store.clone()),
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
        Arc::new(store.clone()),
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
        Arc::new(store),
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

// ── engine-initiated turns (goal continuation) ─────────────────────────────

fn test_goal(status: anyharness_contract::v1::GoalStatus) -> anyharness_contract::v1::Goal {
    anyharness_contract::v1::Goal {
        objective: "test objective".to_string(),
        status,
        native_status: None,
        token_budget: None,
        tokens_used: None,
        time_used_seconds: None,
        met_reason: None,
        iterations: None,
        native: true,
        revision: 1,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

fn goal_envelope(
    sink: &SessionEventSink,
    event: SessionEvent,
) -> anyharness_contract::v1::SessionEventEnvelope {
    anyharness_contract::v1::SessionEventEnvelope {
        session_id: "session-1".to_string(),
        seq: sink.next_seq(),
        timestamp: "2026-01-01T00:00:00Z".to_string(),
        turn_id: sink.current_turn_id(),
        item_id: None,
        event,
    }
}

/// Items arriving after turn_ended (goal continuation output) must open a
/// fresh engine-initiated turn instead of inheriting the ended turn's id —
/// otherwise the transcript fuses the continuation onto the previous group.
#[test]
fn post_turn_items_open_an_engine_initiated_turn() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(64);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    let prompt_turn = sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("hi"),
        ..Default::default()
    });
    sink.turn_ended(StopReason::EndTurn);
    assert_eq!(sink.current_turn_id(), None, "turn id must clear on end");

    // Engine-initiated continuation output, no prompt lifecycle.
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("continuation reply"),
        ..Default::default()
    });

    let events = drain_events(&mut rx);
    let continuation_turn_started = events
        .iter()
        .filter(|e| e.event.event_type() == "turn_started")
        .nth(1)
        .expect("engine-initiated turn_started");
    let continuation_turn = continuation_turn_started
        .turn_id
        .clone()
        .expect("engine turn id");
    assert_ne!(continuation_turn, prompt_turn);
    let continuation_item = events
        .iter()
        .find(|e| {
            e.event.event_type() == "item_started"
                && e.seq > continuation_turn_started.seq
        })
        .expect("continuation item");
    assert_eq!(continuation_item.turn_id.as_deref(), Some(continuation_turn.as_str()));
}

/// A quiescent goal event (met/cleared/non-active update) published through
/// the observer path closes the open engine-initiated turn.
#[test]
fn quiescent_goal_event_closes_engine_initiated_turn() {
    use anyharness_contract::v1::{GoalMetPayload, GoalStatus};
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(64);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.turn_ended(StopReason::EndTurn);
    // Continuation output opens the engine turn.
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("evaluating"),
        ..Default::default()
    });
    assert!(sink.current_turn_id().is_some());

    let met = goal_envelope(
        &sink,
        SessionEvent::GoalMet(GoalMetPayload {
            goal: test_goal(GoalStatus::Met),
        }),
    );
    sink.publish_persisted_events(vec![met]);

    assert_eq!(sink.current_turn_id(), None, "engine turn must close on met");
    let events = drain_events(&mut rx);
    assert_eq!(
        events
            .iter()
            .filter(|e| e.event.event_type() == "turn_ended")
            .count(),
        2,
        "prompt turn end + engine turn end"
    );
}

/// A quiescent goal event must NOT close a prompt-begun turn: a goal can be
/// met mid-turn while the prompt is still streaming.
#[test]
fn quiescent_goal_event_does_not_close_prompt_turn() {
    use anyharness_contract::v1::{GoalMetPayload, GoalStatus};
    let store = seeded_store();
    let (tx, _rx) = broadcast::channel(64);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    let prompt_turn = sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    let met = goal_envelope(
        &sink,
        SessionEvent::GoalMet(GoalMetPayload {
            goal: test_goal(GoalStatus::Met),
        }),
    );
    sink.publish_persisted_events(vec![met]);
    assert_eq!(
        sink.current_turn_id().as_deref(),
        Some(prompt_turn.as_str()),
        "prompt turn stays open"
    );
}

/// A dangling engine-initiated turn (goal never quiesced) is swept when the
/// next prompt turn begins.
#[test]
fn begin_turn_sweeps_dangling_engine_initiated_turn() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(64);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None);
    sink.turn_ended(StopReason::EndTurn);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("continuation"),
        ..Default::default()
    });
    sink.begin_turn("next prompt".to_string(), None, Vec::new(), None);

    let events = drain_events(&mut rx);
    let types = events
        .iter()
        .map(|e| e.event.event_type())
        .collect::<Vec<_>>();
    let ended = types.iter().filter(|t| **t == "turn_ended").count();
    let started = types.iter().filter(|t| **t == "turn_started").count();
    assert_eq!(started, 3, "prompt + engine + next prompt");
    assert_eq!(ended, 2, "first prompt end + swept engine turn end");
    // The swept engine turn must end BEFORE the next prompt's turn_started.
    let last_started_seq = events
        .iter()
        .filter(|e| e.event.event_type() == "turn_started")
        .map(|e| e.seq)
        .max()
        .unwrap();
    let last_ended_seq = events
        .iter()
        .filter(|e| e.event.event_type() == "turn_ended")
        .map(|e| e.seq)
        .max()
        .unwrap();
    assert!(last_ended_seq < last_started_seq);
}
