//! Engine-initiated turn boundaries: goal continuation/evaluation activity
//! arriving outside any prompt lifecycle opens its own synthetic turn, and
//! quiescent goal events close it (see `sink::turns::ensure_open_turn`).

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tokio::sync::broadcast;

use super::support::{drain_events, seeded_store};
use crate::live::sessions::sink::{AcpChunkPayload, SessionEventSink};
use anyharness_contract::v1::{SessionEvent, StopReason};

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
