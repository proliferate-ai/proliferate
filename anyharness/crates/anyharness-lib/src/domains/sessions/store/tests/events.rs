use super::*;
use crate::domains::sessions::model::SessionEventRecord;

#[test]
fn detects_when_a_session_has_started_a_turn() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record();
    store.insert(&record).expect("insert session");

    assert!(!store
        .has_turn_started_event("session-1")
        .expect("check empty turn history"));

    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("append turn_started");

    assert!(store
        .has_turn_started_event("session-1")
        .expect("check populated turn history"));
}

#[test]
fn detects_a_durable_pending_prompt_added_identity() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");
    assert!(!store
        .has_pending_prompt_added_event("session-1", 17)
        .expect("check empty prompt history"));

    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "pending_prompt_added".to_string(),
            turn_id: None,
            item_id: None,
            payload_json: r#"{"type":"pending_prompt_added","seq":17}"#.to_string(),
        })
        .expect("append pending_prompt_added");

    assert!(store
        .has_pending_prompt_added_event("session-1", 17)
        .expect("find prompt identity"));
    assert!(!store
        .has_pending_prompt_added_event("session-1", 18)
        .expect("reject another prompt identity"));
}

#[test]
fn append_event_sanitizes_large_persisted_payloads() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    let oversized_text = "x".repeat(16 * 1024 + 128);
    let payload_json = serde_json::json!({
        "type": "item_delta",
        "delta": {
            "appendContentParts": [
                {
                    "type": "tool_result_text",
                    "text": oversized_text,
                }
            ]
        }
    })
    .to_string();

    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "item_delta".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: Some("item-1".to_string()),
            payload_json,
        })
        .expect("append event");

    let events = store.list_events("session-1").expect("list events");
    let persisted: serde_json::Value =
        serde_json::from_str(&events[0].payload_json).expect("parse event payload");
    let content_part = &persisted["delta"]["appendContentParts"][0];

    assert_eq!(content_part["textTruncated"], true);
    assert_eq!(content_part["textOriginalBytes"], 16 * 1024 + 128);
    assert!(content_part["text"].as_str().unwrap().len() <= 16 * 1024);
}

#[test]
fn limited_event_reads_return_newest_events_in_ascending_order() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    for seq in 1..=5 {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq,
                timestamp: format!("2026-03-25T00:01:0{seq}Z"),
                event_type: "turn_started".to_string(),
                turn_id: Some(format!("turn-{seq}")),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append event");
    }

    let tail = store
        .list_events_limited("session-1", 2)
        .expect("list limited events");
    assert_eq!(
        tail.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![4, 5]
    );

    let filtered_tail = store
        .list_events_after_limited("session-1", 2, 2)
        .expect("list limited events after seq");
    assert_eq!(
        filtered_tail
            .iter()
            .map(|event| event.seq)
            .collect::<Vec<_>>(),
        vec![4, 5],
    );

    let oldest_after = store
        .list_events_after_oldest_limited("session-1", 2, 2)
        .expect("list oldest events after seq");
    assert_eq!(
        oldest_after
            .iter()
            .map(|event| event.seq)
            .collect::<Vec<_>>(),
        vec![3, 4],
    );
}

#[test]
fn limited_event_reads_include_tail_turn_and_item_start_context() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:01Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("append turn start");

    for seq in 2..=4 {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq,
                timestamp: format!("2026-03-25T00:01:0{seq}Z"),
                event_type: if seq == 2 { "item_started" } else { "item_delta" }.to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: Some("item-1".to_string()),
                payload_json: if seq == 2 {
                    r#"{"type":"item_started","item":{"kind":"assistant_message","status":"in_progress","sourceAgentKind":"codex","contentParts":[]}}"#
                } else {
                    r#"{"type":"item_delta","delta":{"appendText":"old"}}"#
                }
                .to_string(),
            })
            .expect("append older item event");
    }

    for seq in 5..=7 {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq,
                timestamp: format!("2026-03-25T00:01:0{seq}Z"),
                event_type: if seq == 5 { "item_started" } else { "item_delta" }.to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: Some("item-2".to_string()),
                payload_json: if seq == 5 {
                    r#"{"type":"item_started","item":{"kind":"assistant_message","status":"in_progress","sourceAgentKind":"codex","contentParts":[]}}"#
                } else {
                    r#"{"type":"item_delta","delta":{"appendText":"new"}}"#
                }
                .to_string(),
            })
            .expect("append recent item event");
    }

    let tail = store
        .list_events_limited("session-1", 2)
        .expect("list limited events");

    assert_eq!(
        tail.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![1, 5, 6, 7],
    );
}

#[test]
fn latest_turn_reads_return_complete_recent_turns() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    for turn in 1..=3 {
        let start_seq = (turn - 1) * 2 + 1;
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: start_seq,
                timestamp: format!("2026-03-25T00:01:{start_seq:02}Z"),
                event_type: "turn_started".to_string(),
                turn_id: Some(format!("turn-{turn}")),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append turn_started");
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: start_seq + 1,
                timestamp: format!("2026-03-25T00:01:{:02}Z", start_seq + 1),
                event_type: "turn_ended".to_string(),
                turn_id: Some(format!("turn-{turn}")),
                item_id: None,
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.to_string(),
            })
            .expect("append turn_ended");
    }

    let tail = store
        .list_events_for_latest_turns("session-1", 2, 100)
        .expect("list latest turns");

    assert_eq!(
        tail.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![3, 4, 5, 6],
    );
}

#[test]
fn latest_turn_reads_reduce_window_to_event_budget() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    for turn in 1..=3 {
        let start_seq = (turn - 1) * 3 + 1;
        for offset in 0..3 {
            let seq = start_seq + offset;
            store
                .append_event(&SessionEventRecord {
                    id: 0,
                    session_id: "session-1".to_string(),
                    seq,
                    timestamp: format!("2026-03-25T00:01:{seq:02}Z"),
                    event_type: if offset == 0 {
                        "turn_started"
                    } else {
                        "item_completed"
                    }
                    .to_string(),
                    turn_id: Some(format!("turn-{turn}")),
                    item_id: Some(format!("item-{turn}-{offset}")),
                    payload_json: if offset == 0 {
                        r#"{"type":"turn_started"}"#
                    } else {
                        r#"{"type":"item_completed","item":{"kind":"assistant_message","status":"completed","sourceAgentKind":"codex","contentParts":[]}}"#
                    }
                    .to_string(),
                })
                .expect("append event");
        }
    }

    let tail = store
        .list_events_for_latest_turns("session-1", 3, 4)
        .expect("list budgeted latest turns");

    assert_eq!(
        tail.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![7, 8, 9],
    );
}

#[test]
fn older_turn_reads_return_complete_page_before_cutoff() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    for turn in 1..=5 {
        let start_seq = (turn - 1) * 2 + 1;
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: start_seq,
                timestamp: format!("2026-03-25T00:01:{start_seq:02}Z"),
                event_type: "turn_started".to_string(),
                turn_id: Some(format!("turn-{turn}")),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append turn_started");
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: start_seq + 1,
                timestamp: format!("2026-03-25T00:01:{:02}Z", start_seq + 1),
                event_type: "turn_ended".to_string(),
                turn_id: Some(format!("turn-{turn}")),
                item_id: None,
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.to_string(),
            })
            .expect("append turn_ended");
    }

    let older = store
        .list_events_before_for_latest_turns("session-1", 7, 2, 100)
        .expect("list older turns");

    assert_eq!(
        older.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![3, 4, 5, 6],
    );
}

#[test]
fn repair_unclosed_subagent_turns_captures_partial_text_and_engine_outcome() {
    use anyharness_contract::v1::{GoalStatus, GoalUpdatedPayload, SessionEvent};

    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());
    let mut parent = session_record();
    parent.id = "parent-1".to_string();
    parent.native_session_id = Some("native-parent".to_string());
    store.insert(&parent).expect("insert parent");
    let child = session_record();
    store
        .insert_session_with_link(
            &child,
            &SessionLinkRecord {
                id: "link-1".to_string(),
                public_id: Some("subagent-1".to_string()),
                relation: SessionLinkRelation::Subagent,
                parent_session_id: "parent-1".to_string(),
                child_session_id: "session-1".to_string(),
                workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
                label: Some("Researcher".to_string()),
                created_by_turn_id: None,
                created_by_tool_call_id: None,
                created_at: "2026-03-25T00:00:00Z".to_string(),
                subagent_closed_at: None,
                closed_at: None,
            },
        )
        .expect("insert child and link");

    let failed_goal = SessionEvent::GoalUpdated(GoalUpdatedPayload {
        goal: anyharness_contract::v1::Goal {
            objective: "research".to_string(),
            status: GoalStatus::Failed,
            native_status: None,
            token_budget: None,
            tokens_used: None,
            time_used_seconds: None,
            met_reason: None,
            iterations: None,
            native: true,
            revision: 1,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:01:00Z".to_string(),
        },
    });
    let met_goal = SessionEvent::GoalUpdated(GoalUpdatedPayload {
        goal: anyharness_contract::v1::Goal {
            objective: "prompt-side goal".to_string(),
            status: GoalStatus::Met,
            native_status: None,
            token_budget: None,
            tokens_used: None,
            time_used_seconds: None,
            met_reason: Some("observed during prompt".to_string()),
            iterations: None,
            native: true,
            revision: 1,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:01:00Z".to_string(),
        },
    });
    let events = [
        (1, "turn-1", None, r#"{"type":"turn_started"}"#.to_string()),
        (
            2,
            "turn-1",
            Some("assistant-1"),
            r#"{"type":"item_started","item":{"kind":"assistant_message","status":"in_progress","sourceAgentKind":"claude","messageId":"native-message-1","parentToolCallId":"tool-parent-1","contentParts":[{"type":"text","text":"Hel"}]}}"#.to_string(),
        ),
        (
            3,
            "turn-1",
            Some("assistant-1"),
            r#"{"type":"item_delta","delta":{"appendText":"lo"}}"#.to_string(),
        ),
        (4, "turn-2", None, r#"{"type":"turn_started"}"#.to_string()),
        (
            5,
            "turn-2",
            Some("assistant-2"),
            r#"{"type":"item_started","item":{"kind":"assistant_message","status":"in_progress","sourceAgentKind":"claude","contentParts":[{"type":"text","text":"engine output"}]}}"#.to_string(),
        ),
        (
            6,
            "turn-2",
            None,
            serde_json::to_string(&failed_goal).expect("serialize failed goal"),
        ),
        (7, "turn-3", None, r#"{"type":"turn_started"}"#.to_string()),
        (
            8,
            "turn-3",
            Some("prompt-3"),
            r#"{"type":"item_started","item":{"kind":"user_message","status":"completed","sourceAgentKind":"claude","contentParts":[{"type":"text","text":"run prompt"}]}}"#.to_string(),
        ),
        (
            9,
            "turn-3",
            None,
            serde_json::to_string(&met_goal).expect("serialize met goal"),
        ),
    ];
    for (seq, turn_id, item_id, payload_json) in events {
        let event_type = serde_json::from_str::<SessionEvent>(&payload_json)
            .expect("parse fixture event")
            .event_type()
            .to_string();
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq,
                timestamp: format!("2026-03-25T00:01:{seq:02}Z"),
                event_type,
                turn_id: Some(turn_id.to_string()),
                item_id: item_id.map(str::to_string),
                payload_json,
            })
            .expect("append open-turn event");
    }

    assert_eq!(
        store
            .repair_unclosed_turns("session-1")
            .expect("repair open turns"),
        3
    );
    assert_eq!(
        store
            .repair_unclosed_turns("session-1")
            .expect("idempotent repair"),
        0
    );
    let repaired_events = store
        .list_events("session-1")
        .expect("list repaired events");
    let repaired_assistant = repaired_events
        .iter()
        .filter(|event| event.turn_id.as_deref() == Some("turn-1"))
        .find_map(|record| {
            let event = serde_json::from_str::<SessionEvent>(&record.payload_json).ok()?;
            match event {
                SessionEvent::ItemCompleted(completed) => Some((record, completed.item)),
                _ => None,
            }
        })
        .expect("repaired assistant item completed");
    assert_eq!(repaired_assistant.0.item_id.as_deref(), Some("assistant-1"));
    assert_eq!(repaired_assistant.1.source_agent_kind, "claude");
    assert_eq!(
        repaired_assistant.1.message_id.as_deref(),
        Some("native-message-1")
    );
    assert_eq!(
        repaired_assistant.1.parent_tool_call_id.as_deref(),
        Some("tool-parent-1")
    );
    assert_eq!(
        repaired_assistant.1.content_parts,
        vec![anyharness_contract::v1::ContentPart::Text {
            text: "Hello".to_string()
        }]
    );
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT child_turn_id, outcome, assistant_text
             FROM session_link_completion_deliveries ORDER BY child_turn_id",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        assert_eq!(
            rows,
            vec![
                (
                    "turn-1".to_string(),
                    "cancelled".to_string(),
                    Some("Hello".to_string())
                ),
                (
                    "turn-2".to_string(),
                    "failed".to_string(),
                    Some("engine output".to_string())
                ),
                ("turn-3".to_string(), "cancelled".to_string(), None),
            ]
        );
        let terminal_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM session_events WHERE event_type = 'turn_ended'",
            [],
            |row| row.get(0),
        )?;
        let assistant_completion_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM session_events WHERE event_type = 'item_completed'",
            [],
            |row| row.get(0),
        )?;
        let projection_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })?;
        assert_eq!((terminal_count, projection_count), (3, 0));
        assert_eq!(assistant_completion_count, 2);
        Ok(())
    })
    .expect("verify repaired delivery snapshots");
}
