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

    let prompt_turn = sink
        .begin_turn("hello".to_string(), None, Vec::new(), None)
        .expect("begin prompt turn");
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
        .find(|e| e.event.event_type() == "item_started" && e.seq > continuation_turn_started.seq)
        .expect("continuation item");
    assert_eq!(
        continuation_item.turn_id.as_deref(),
        Some(continuation_turn.as_str())
    );
}

/// A quiescent goal event (met/cleared/non-active update) published through
/// the observer path freezes the requested terminal outcome. The actor owns
/// the fallible atomic commit and only closes the turn after it succeeds.
#[test]
fn quiescent_goal_event_requests_engine_terminal_commit() {
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

    sink.begin_turn("hello".to_string(), None, Vec::new(), None)
        .expect("begin turn");
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

    assert!(
        sink.current_turn_id().is_some(),
        "turn stays open until commit"
    );
    assert_eq!(
        sink.requested_engine_terminal_outcome(),
        Some(crate::live::sessions::model::TerminalTurnOutcome::Completed)
    );
    let events = drain_events(&mut rx);
    assert_eq!(
        events
            .iter()
            .filter(|e| e.event.event_type() == "turn_ended")
            .count(),
        1,
        "only the already-committed prompt end is visible before actor commit"
    );
}

#[test]
fn goal_statuses_map_to_explicit_engine_terminal_outcomes() {
    use crate::live::sessions::model::TerminalTurnOutcome;
    use anyharness_contract::v1::{GoalStatus, GoalUpdatedPayload};

    let cases = [
        (GoalStatus::Met, Some(TerminalTurnOutcome::Completed)),
        (GoalStatus::Failed, Some(TerminalTurnOutcome::Failed)),
        (GoalStatus::Blocked, Some(TerminalTurnOutcome::Failed)),
        (GoalStatus::Cleared, Some(TerminalTurnOutcome::Cancelled)),
        (GoalStatus::Paused, Some(TerminalTurnOutcome::Cancelled)),
        (GoalStatus::Active, None),
    ];
    for (status, expected) in cases {
        let event = SessionEvent::GoalUpdated(GoalUpdatedPayload {
            goal: test_goal(status),
        });
        assert_eq!(super::super::goal_event_terminal_outcome(&event), expected);
    }
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

    let prompt_turn = sink
        .begin_turn("hello".to_string(), None, Vec::new(), None)
        .expect("begin prompt turn");
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

    sink.begin_turn("hello".to_string(), None, Vec::new(), None)
        .expect("begin turn");
    sink.turn_ended(StopReason::EndTurn);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("continuation"),
        ..Default::default()
    });
    sink.begin_turn("next prompt".to_string(), None, Vec::new(), None)
        .expect("begin turn");

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

/// A goal_updated tag opens the engine turn before the observer classifies
/// the update; when the observer drops it (stale echo) the post-dispatch
/// sweep must close the empty turn so it can't dangle as a phantom.
#[test]
fn sweep_closes_engine_turn_that_never_received_content() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(64);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None)
        .expect("begin turn");
    sink.turn_ended(StopReason::EndTurn);
    // Tag-opened engine turn (as ingest does for goal_updated), observer drops.
    sink.ensure_open_turn();
    sink.sweep_empty_engine_turn();
    assert_eq!(sink.current_turn_id(), None, "empty engine turn must close");

    let events = drain_events(&mut rx);
    let started = events
        .iter()
        .filter(|e| e.event.event_type() == "turn_started")
        .count();
    let ended = events
        .iter()
        .filter(|e| e.event.event_type() == "turn_ended")
        .count();
    assert_eq!(started, 2);
    assert_eq!(ended, 2, "the empty engine turn closes immediately");
}

/// The sweep must NOT close an engine turn that received content — the
/// continuation is still running and quiescence/next-prompt owns its close.
#[test]
fn sweep_keeps_engine_turn_with_content_open() {
    let store = seeded_store();
    let (tx, _rx) = broadcast::channel(64);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    sink.begin_turn("hello".to_string(), None, Vec::new(), None)
        .expect("begin turn");
    sink.turn_ended(StopReason::EndTurn);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("continuation"),
        ..Default::default()
    });
    sink.sweep_empty_engine_turn();
    assert!(
        sink.current_turn_id().is_some(),
        "engine turn with content stays open for its quiescence close"
    );
}

/// Time-to-first-output is stamped once per turn, at the first assistant
/// item, and re-armed by the next turn. The guard itself is inert here (no
/// producer installed), so the flag is the observable.
#[test]
fn first_assistant_output_is_stamped_once_per_turn() {
    let store = seeded_store();
    let (tx, _rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store),
    );

    assert!(sink.begin_turn("hello".into(), None, vec![], None).is_ok());
    assert!(
        !sink.turn_first_output_stamped,
        "nothing has been output yet"
    );
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("Hel"),
        ..Default::default()
    });
    assert!(
        sink.turn_first_output_stamped,
        "the first assistant item is the first output"
    );
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("lo"),
        ..Default::default()
    });
    assert!(sink.turn_first_output_stamped);
    sink.turn_ended(StopReason::EndTurn);

    assert!(sink.begin_turn("again".into(), None, vec![], None).is_ok());
    assert!(
        !sink.turn_first_output_stamped,
        "a new turn re-arms the stamp"
    );
}
