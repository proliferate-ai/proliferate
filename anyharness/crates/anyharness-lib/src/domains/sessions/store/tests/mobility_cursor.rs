use super::*;
use crate::domains::sessions::model::SessionEventRecord;

#[test]
fn import_applies_legacy_prompt_cursor_floor_before_allocation() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let events = vec![
        SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "pending_prompt_added".to_string(),
            turn_id: None,
            item_id: None,
            payload_json: serde_json::json!({
                "type": "pending_prompt_added",
                "seq": 1,
                "text": "already drained",
                "queuedAt": "2026-03-25T00:01:00Z"
            })
            .to_string(),
        },
        SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 2,
            timestamp: "2026-03-25T00:02:00Z".to_string(),
            event_type: "pending_prompt_removed".to_string(),
            turn_id: None,
            item_id: None,
            payload_json: serde_json::json!({
                "type": "pending_prompt_removed",
                "seq": 1,
                "reason": "executed"
            })
            .to_string(),
        },
    ];
    store
        .import_bundle(&session_record(), 1, None, &[], &[], &[], &events, &[])
        .expect("import queue-empty mobility bundle");

    let next = store
        .insert_pending_prompt("session-1", "new after mobility", None)
        .expect("insert after mobility");
    assert_eq!(next.seq, 2);
    assert!(!store
        .has_pending_prompt_added_event(&next)
        .expect("new row must not match historical visibility"));
}

#[test]
fn import_restores_authoritative_prompt_cursor_without_queue_history() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store
        .import_bundle(&session_record(), 7, None, &[], &[], &[], &[], &[])
        .expect("import queue-empty mobility bundle");

    let next = store
        .insert_pending_prompt("session-1", "new after mobility", None)
        .expect("insert after mobility");
    assert_eq!(next.seq, 8);
}
