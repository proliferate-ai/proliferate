use super::*;
use crate::domains::sessions::model::SessionEventRecord;

#[test]
fn added_event_detection_uses_the_exact_prompt_allocation() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");
    let pending = store
        .insert_pending_prompt("session-1", "new prompt", None)
        .expect("insert prompt");
    assert!(!store
        .has_pending_prompt_added_event(&pending)
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
            payload_json: serde_json::json!({
                "type": "pending_prompt_added",
                "seq": pending.seq,
                "text": pending.text,
                "queuedAt": pending.queued_at,
            })
            .to_string(),
        })
        .expect("append pending_prompt_added");

    assert!(store
        .has_pending_prompt_added_event(&pending)
        .expect("find prompt identity"));
    let mut reused = pending.clone();
    reused.queued_at = "2026-03-25T00:02:00Z".to_string();
    assert!(!store
        .has_pending_prompt_added_event(&reused)
        .expect("reject a reused numeric sequence"));
}
