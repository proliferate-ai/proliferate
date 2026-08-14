use std::path::PathBuf;
use std::sync::Arc;

use anyharness_contract::v1::StopReason;
use serde_json::json;
use tokio::sync::broadcast;

use super::support::{drain_events, seeded_subagent_store};
use crate::domains::sessions::model::SessionBackgroundWorkState;
use crate::domains::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::live::sessions::model::TerminalTurnOutcome;
use crate::live::sessions::sink::{AcpChunkPayload, PromptTerminalEvent, SessionEventSink};

#[test]
fn terminal_commit_rolls_back_without_mutating_sink_then_retries_exact_output() {
    let (db, store) = seeded_subagent_store();
    let (tx, mut rx) = broadcast::channel(64);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    sink.begin_turn("research".to_string(), None, Vec::new(), None)
        .expect("begin turn");
    let first_message = "é".repeat(3_999);
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!(first_message),
        message_id: Some("message-1".to_string()),
        ..Default::default()
    });
    sink.agent_message_chunk(AcpChunkPayload {
        content: json!("tail"),
        message_id: Some("message-2".to_string()),
        ..Default::default()
    });
    let _ = drain_events(&mut rx);
    let before = sink.debug_snapshot();
    let durable_before = store
        .list_events("session-1")
        .expect("list events before terminal")
        .len();

    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TRIGGER fail_atomic_terminal_delivery
             BEFORE INSERT ON session_link_completion_deliveries
             BEGIN SELECT RAISE(ABORT, 'terminal-failpoint'); END;",
        )?;
        Ok(())
    })
    .expect("install terminal failpoint");
    sink.stage_prompt_terminal(
        TerminalTurnOutcome::Completed,
        PromptTerminalEvent::TurnEnded(StopReason::EndTurn),
    )
    .expect("stage terminal");
    assert_sink_snapshot_eq(&sink.debug_snapshot(), &before);
    assert!(sink.commit_staged_prompt_terminal().is_err());
    assert_sink_snapshot_eq(&sink.debug_snapshot(), &before);
    assert!(matches!(
        rx.try_recv(),
        Err(broadcast::error::TryRecvError::Empty)
    ));
    assert_eq!(
        store
            .list_events("session-1")
            .expect("list rolled-back events")
            .len(),
        durable_before
    );
    assert!(sink
        .inject_runtime_event(RuntimeInjectedSessionEvent::SessionInfoUpdate {
            title: Some("must not persist".to_string()),
            updated_at: None,
        })
        .is_err());
    sink.resolve_background_tool_call(
        before.current_turn_id.clone().expect("open turn"),
        "background-tool".to_string(),
        SessionBackgroundWorkState::Completed,
        None,
        "/tmp/output".to_string(),
        "must not persist".to_string(),
    );
    assert!(sink
        .begin_turn("must not start".to_string(), None, Vec::new(), None)
        .is_err());
    assert_sink_snapshot_eq(&sink.debug_snapshot(), &before);
    assert_eq!(
        store
            .list_events("session-1")
            .expect("list fenced events")
            .len(),
        durable_before
    );

    db.with_conn(|conn| {
        conn.execute_batch("DROP TRIGGER fail_atomic_terminal_delivery")?;
        Ok(())
    })
    .expect("remove terminal failpoint");
    let committed = sink
        .commit_staged_prompt_terminal()
        .expect("retry frozen terminal batch");
    assert_eq!(committed.last_event_seq, before.next_seq + 1);
    assert_eq!(drain_events(&mut rx).len(), 2);

    db.with_conn(|conn| {
        let row: (i64, String, i64) = conn.query_row(
            "SELECT COUNT(*), assistant_text, child_last_event_seq
             FROM session_link_completion_deliveries",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(row.0, 1);
        assert_eq!(row.1, format!("{}\n...", "é".repeat(3_999)));
        assert_eq!(row.2, committed.last_event_seq);
        Ok(())
    })
    .expect("verify exact captured output");
}

#[test]
fn prompt_terminal_shapes_capture_explicit_outcome_matrix() {
    enum Case {
        Completed,
        EmptyFailed,
        ProviderFailed,
        Cancelled,
    }

    for case in [
        Case::Completed,
        Case::EmptyFailed,
        Case::ProviderFailed,
        Case::Cancelled,
    ] {
        let (db, store) = seeded_subagent_store();
        let (tx, _rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            Arc::new(store.clone()),
        );
        sink.begin_turn("research".to_string(), None, Vec::new(), None)
            .expect("begin turn");
        let (outcome, terminal, expected_outcome, expected_types) = match case {
            Case::Completed => (
                TerminalTurnOutcome::Completed,
                PromptTerminalEvent::TurnEnded(StopReason::EndTurn),
                "completed",
                vec!["turn_ended"],
            ),
            Case::EmptyFailed => (
                TerminalTurnOutcome::Failed,
                PromptTerminalEvent::ErrorAndTurnEnded {
                    message: "empty turn".to_string(),
                    code: Some("empty_turn".to_string()),
                    details: None,
                    stop_reason: StopReason::EndTurn,
                },
                "failed",
                vec!["error", "turn_ended"],
            ),
            Case::ProviderFailed => (
                TerminalTurnOutcome::Failed,
                PromptTerminalEvent::Error {
                    message: "provider failure".to_string(),
                    code: None,
                    details: None,
                },
                "failed",
                vec!["error"],
            ),
            Case::Cancelled => (
                TerminalTurnOutcome::Cancelled,
                PromptTerminalEvent::TurnEnded(StopReason::Cancelled),
                "cancelled",
                vec!["turn_ended"],
            ),
        };
        sink.stage_prompt_terminal(outcome, terminal)
            .expect("stage terminal");
        sink.commit_staged_prompt_terminal()
            .expect("commit terminal");

        let terminal_types = store
            .list_events("session-1")
            .expect("list events")
            .into_iter()
            .skip(3)
            .map(|event| event.event_type)
            .collect::<Vec<_>>();
        assert_eq!(terminal_types, expected_types);
        db.with_conn(|conn| {
            let captured: String = conn.query_row(
                "SELECT outcome FROM session_link_completion_deliveries",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(captured, expected_outcome);
            Ok(())
        })
        .expect("verify captured outcome");
    }
}

fn assert_sink_snapshot_eq(
    actual: &crate::live::sessions::sink::SessionEventSinkDebugSnapshot,
    expected: &crate::live::sessions::sink::SessionEventSinkDebugSnapshot,
) {
    assert_eq!(actual.current_turn_id, expected.current_turn_id);
    assert_eq!(
        actual.open_assistant_item_id,
        expected.open_assistant_item_id
    );
    assert_eq!(actual.open_assistant_chars, expected.open_assistant_chars);
    assert_eq!(
        actual.open_reasoning_item_id,
        expected.open_reasoning_item_id
    );
    assert_eq!(actual.open_reasoning_chars, expected.open_reasoning_chars);
    assert_eq!(actual.open_plan_item_id, expected.open_plan_item_id);
    assert_eq!(actual.open_tool_call_ids, expected.open_tool_call_ids);
    assert_eq!(actual.next_seq, expected.next_seq);
}
