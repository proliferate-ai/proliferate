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

#[test]
fn import_preserves_reused_legacy_deleted_prompt_identities() {
    let source_db = Db::open_in_memory().expect("open source db");
    seed_workspace(&source_db);
    let source_store = SessionStore::new(source_db.clone());
    source_store
        .insert(&session_record())
        .expect("insert legacy source session");

    let payload_json = serde_json::json!({
        "type": "pending_prompt_removed",
        "seq": 1,
        "promptId": null,
        "reason": "deleted",
    })
    .to_string();
    let events = [1, 2].map(|seq| SessionEventRecord {
        id: 0,
        session_id: "session-1".to_string(),
        seq,
        timestamp: format!("2026-03-25T00:0{seq}:00Z"),
        event_type: "pending_prompt_removed".to_string(),
        turn_id: None,
        item_id: None,
        payload_json: payload_json.clone(),
    });
    source_db
        .with_conn(|conn| {
            for event in &events {
                conn.execute(
                    "INSERT INTO session_events (
                        session_id, seq, timestamp, event_type, turn_id, item_id, payload_json
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        event.session_id,
                        event.seq,
                        event.timestamp,
                        event.event_type,
                        event.turn_id,
                        event.item_id,
                        event.payload_json,
                    ],
                )?;
            }
            Ok(())
        })
        .expect("seed migrated legacy history with null removal keys");
    let archived_events = source_store
        .list_events("session-1")
        .expect("export legacy event history");

    let destination_db = Db::open_in_memory().expect("open destination db");
    seed_workspace(&destination_db);
    let destination_store = SessionStore::new(destination_db.clone());

    destination_store
        .import_bundle(
            &session_record(),
            1,
            None,
            &[],
            &[],
            &[],
            &archived_events,
            &[],
        )
        .expect("import duplicate legacy prompt identities");

    destination_db
        .with_conn(|conn| {
            let (events, keys): (i64, i64) = conn.query_row(
                "SELECT COUNT(*), COUNT(completion_wake_removal_key)
             FROM session_events WHERE session_id = 'session-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!((events, keys), (2, 0));
            Ok(())
        })
        .expect("preserve both unkeyed ordinary removals");
}
