use std::path::Path;
use std::time::Duration;

use anyharness_contract::v1::{
    ContentPart, PromptProvenance, SessionEvent, TranscriptItemKind, TranscriptItemPayload,
    TranscriptItemStatus,
};

use crate::app::AppState;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{prompt_texts, ScriptedAgent};
use crate::domains::sessions::store::completion_deliveries::{
    CompletionDeliveryRecord, DurableTerminalTurn,
};
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::subagents::delivery::{
    CompletionDeliveryState, CompletionDeliveryStore,
};
use crate::persistence::Db;

pub(super) const PARENT_ID: &str = "target";
pub(super) const CHILD_ID: &str = "completion-child";
pub(super) const LABEL: &str = "Crash verifier";

pub(super) fn capture_delivery(state: &AppState, terminal_id: &str) -> CompletionDeliveryRecord {
    let store = SessionStore::new(state.db.clone());
    let mut child = state
        .session_service
        .get_session(PARENT_ID)
        .expect("load parent fixture")
        .expect("parent fixture");
    child.id = CHILD_ID.into();
    child.native_session_id = None;
    child.title = Some("Completion child".into());
    child.last_prompt_at = None;
    store.insert(&child).expect("insert completion child");
    let link = state
        .subagent_service
        .link_child(
            PARENT_ID,
            CHILD_ID,
            Some(LABEL.into()),
            Some("parent-turn".into()),
            Some("parent-tool".into()),
        )
        .expect("link completion child");
    assert_eq!(link.parent_session_id, PARENT_ID);
    store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: terminal_id.into(),
            session_id: CHILD_ID.into(),
            turn_id: "child-turn".into(),
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("durable child result".into()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: CHILD_ID.into(),
                seq: 1,
                timestamp: "2026-08-11T00:01:00Z".into(),
                event_type: "turn_ended".into(),
                turn_id: Some("child-turn".into()),
                item_id: None,
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.into(),
            }],
            completed_at: "2026-08-11T00:01:00Z".into(),
        })
        .expect("commit terminal capture and delivery intent");
    let deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("captured deliveries");
    assert_eq!(deliveries.len(), 1);
    let delivery = deliveries.into_iter().next().expect("delivery");
    assert_eq!(delivery.delivery_id, terminal_id);
    assert_eq!(delivery.session_link_id, link.id);
    assert_eq!(delivery.state, CompletionDeliveryState::Pending);
    delivery
}

pub(super) fn install_trigger(db: &Db, name: &str, timing: &str, body: &str) {
    db.with_conn(|conn| {
        conn.execute_batch(&format!(
            "CREATE TRIGGER {name} {timing} BEGIN {body}; END;"
        ))
    })
    .expect("install scoped SQLite trigger");
}

pub(super) fn drop_trigger_and_force_due(runtime_home: &Path, name: &str, delivery_id: &str) {
    let db = Db::open(runtime_home).expect("reopen file-backed db");
    db.with_conn(|conn| {
        conn.execute_batch(&format!("DROP TRIGGER {name};"))?;
        let changed = conn.execute(
            "UPDATE session_link_completion_deliveries
             SET next_attempt_at = '1970-01-01T00:00:00Z',
                 lease_token = NULL, lease_expires_at = NULL
             WHERE delivery_id = ?1",
            [delivery_id],
        )?;
        assert_eq!(changed, 1);
        Ok(())
    })
    .expect("remove trigger and force delivery due");
}

pub(super) async fn wait_for_failed_attempt(state: &AppState, delivery_id: &str) {
    wait_for("failed delivery attempt", || {
        CompletionDeliveryStore::new(state.db.clone())
            .find(delivery_id)
            .is_ok_and(|record| {
                record.is_some_and(|record| {
                    record.attempt_count >= 1
                        && record.last_error_code.as_deref() == Some("delivery_attempt_failed")
                        && record.lease_token.is_none()
                })
            })
    })
    .await;
}

pub(super) async fn wait_for_enqueued(state: &AppState, delivery_id: &str) {
    wait_for("enqueued completion wake", || {
        CompletionDeliveryStore::new(state.db.clone())
            .find(delivery_id)
            .is_ok_and(|record| {
                record.is_some_and(|record| {
                    record.state == CompletionDeliveryState::Enqueued
                        && record.parent_prompt_seq.is_some()
                        && record.lease_token.is_none()
                })
            })
            && state
                .session_service
                .store()
                .list_pending_prompts(PARENT_ID)
                .is_ok_and(|rows| rows.len() == 1)
    })
    .await;
}

pub(super) async fn wait_for_delivered(
    state: &AppState,
    script: &ScriptedAgent,
    delivery: &CompletionDeliveryRecord,
) {
    wait_for("one durable and provider-visible completion", || {
        let delivered = CompletionDeliveryStore::new(state.db.clone())
            .find(&delivery.delivery_id)
            .is_ok_and(|record| {
                record.is_some_and(|record| {
                    record.state == CompletionDeliveryState::Delivered
                        && record.parent_turn_id.is_some()
                })
            });
        delivered
            && prompt_texts(&script.request_log)
                .iter()
                .filter(|text| *text == &delivery.notification_text)
                .count()
                == 1
    })
    .await;
}

pub(super) async fn wait_for(description: &str, mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if condition() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {description}"));
}

pub(super) fn assert_enqueue_rolled_back(state: &AppState, delivery_id: &str) {
    let delivery = CompletionDeliveryStore::new(state.db.clone())
        .find(delivery_id)
        .expect("failed delivery")
        .expect("delivery remains retryable");
    assert_eq!(delivery.state, CompletionDeliveryState::Pending);
    assert_eq!(delivery.parent_prompt_seq, None);
    assert!(state
        .session_service
        .store()
        .list_pending_prompts(PARENT_ID)
        .expect("parent queue")
        .is_empty());
    let projection_count: i64 = state
        .db
        .with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })
        })
        .expect("completion projection count");
    assert_eq!(projection_count, 0);
}

pub(super) fn assert_admission_rolled_back(state: &AppState, delivery_id: &str) {
    let delivery = CompletionDeliveryStore::new(state.db.clone())
        .find(delivery_id)
        .expect("failed admission delivery")
        .expect("delivery remains retryable");
    assert_eq!(delivery.state, CompletionDeliveryState::Enqueued);
    let queue_seq = delivery.parent_prompt_seq.expect("canonical queue seq");
    assert!(state
        .session_service
        .store()
        .find_pending_prompt(PARENT_ID, queue_seq)
        .expect("canonical queue row after rollback")
        .is_some());
    let transcript_event_count = state
        .session_service
        .store()
        .list_events(PARENT_ID)
        .expect("parent events after rollback")
        .iter()
        .filter(|event| {
            matches!(
                event.event_type.as_str(),
                "turn_started" | "item_started" | "item_completed" | "pending_prompt_removed"
            )
        })
        .count();
    assert_eq!(transcript_event_count, 0);
}

pub(super) fn assert_final_delivery(
    state: &AppState,
    script: &ScriptedAgent,
    expected: &CompletionDeliveryRecord,
) {
    assert_final_delivery_with_ledger_count(state, script, expected, 1);
}

pub(super) fn assert_final_delivery_after_link_loss(
    state: &AppState,
    script: &ScriptedAgent,
    expected: &CompletionDeliveryRecord,
) {
    assert_final_delivery_with_ledger_count(state, script, expected, 0);
}

fn assert_final_delivery_with_ledger_count(
    state: &AppState,
    script: &ScriptedAgent,
    expected: &CompletionDeliveryRecord,
    expected_ledger_count: i64,
) {
    let deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("final deliveries");
    assert_eq!(deliveries.len(), 1);
    let delivery = &deliveries[0];
    assert_eq!(delivery.delivery_id, expected.delivery_id);
    assert_eq!(delivery.prompt_id(), expected.prompt_id());
    assert_eq!(delivery.state, CompletionDeliveryState::Delivered);
    let parent_turn_id = delivery
        .parent_turn_id
        .as_deref()
        .expect("delivered parent turn id");
    assert!(delivery.parent_prompt_seq.is_some());
    assert_eq!(
        prompt_texts(&script.request_log)
            .iter()
            .filter(|text| *text == &delivery.notification_text)
            .count(),
        1
    );

    let pending = state
        .session_service
        .store()
        .list_pending_prompts(PARENT_ID)
        .expect("final parent queue");
    assert_eq!(
        pending
            .iter()
            .filter(|row| row.prompt_id.as_deref() == Some(delivery.prompt_id().as_str()))
            .count(),
        0
    );
    let projection_count: i64 = state
        .db
        .with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })
        })
        .expect("completion projection count");
    assert_eq!(projection_count, expected_ledger_count);

    let events = state
        .session_service
        .store()
        .list_events(PARENT_ID)
        .expect("parent events");
    let completed = events
        .iter()
        .filter_map(|record| {
            completion_item_value(record, delivery, false).map(|item| (record, item))
        })
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 1);
    let (completed_record, completed_value) = &completed[0];
    assert_eq!(completed_record.turn_id.as_deref(), Some(parent_turn_id));
    let item_id = completed_record
        .item_id
        .as_deref()
        .expect("completion item id");
    let started = events
        .iter()
        .filter_map(|record| {
            if record.turn_id.as_deref() != Some(parent_turn_id)
                || record.item_id.as_deref() != Some(item_id)
            {
                return None;
            }
            completion_item_value(record, delivery, true).map(|item| (record, item))
        })
        .collect::<Vec<_>>();
    assert_eq!(started.len(), 1);
    assert_eq!(&started[0].1, completed_value);
    assert_eq!(started[0].0.seq + 1, completed_record.seq);
    let turn_starts = events
        .iter()
        .filter(|record| {
            record.event_type == SessionEvent::TurnStarted(Default::default()).event_type()
                && serde_json::from_str::<SessionEvent>(&record.payload_json)
                    .is_ok_and(|event| matches!(event, SessionEvent::TurnStarted(_)))
                && record.turn_id.as_deref() == Some(parent_turn_id)
                && record.item_id.is_none()
                && record.seq + 1 == started[0].0.seq
        })
        .count();
    assert_eq!(turn_starts, 1);
}

fn completion_item_value(
    record: &SessionEventRecord,
    delivery: &CompletionDeliveryRecord,
    started: bool,
) -> Option<serde_json::Value> {
    let event = serde_json::from_str::<SessionEvent>(&record.payload_json).ok()?;
    let item = match (started, event) {
        (true, SessionEvent::ItemStarted(event)) if record.event_type == "item_started" => {
            event.item
        }
        (false, SessionEvent::ItemCompleted(event)) if record.event_type == "item_completed" => {
            event.item
        }
        _ => return None,
    };
    completion_item_matches(&item, delivery).then(|| {
        serde_json::to_value(item).expect("serialize exact completion wake transcript item")
    })
}

fn completion_item_matches(
    item: &TranscriptItemPayload,
    delivery: &CompletionDeliveryRecord,
) -> bool {
    matches!(item.kind, TranscriptItemKind::UserMessage)
        && matches!(item.status, TranscriptItemStatus::Completed)
        && !item.is_transient
        && item.message_id.is_none()
        && item.prompt_id.as_deref() == Some(delivery.prompt_id().as_str())
        && item.title.is_none()
        && item.tool_call_id.is_none()
        && item.native_tool_name.is_none()
        && item.parent_tool_call_id.is_none()
        && item.raw_input.is_none()
        && item.raw_output.is_none()
        && matches!(
            item.content_parts.as_slice(),
            [ContentPart::Text { text }] if text == &delivery.notification_text
        )
        && matches!(
            item.prompt_provenance.as_ref(),
            Some(PromptProvenance::SubagentWake {
                session_link_id,
                completion_id,
                label,
            }) if session_link_id == &delivery.session_link_id
                && completion_id == &delivery.delivery_id
                && label == &delivery.label
        )
}

pub(super) fn assert_one_outbox_and_ledger(state: &AppState, delivery_id: &str) {
    assert_eq!(
        CompletionDeliveryStore::new(state.db.clone())
            .list_all_for_test()
            .expect("outbox rows")
            .iter()
            .filter(|row| row.delivery_id == delivery_id)
            .count(),
        1
    );
    let ledger_count: i64 = state
        .db
        .with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })
        })
        .expect("ledger rows");
    assert!(ledger_count <= 1);
}
