use super::*;
use crate::sessions::model::SessionEventRecord;

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
