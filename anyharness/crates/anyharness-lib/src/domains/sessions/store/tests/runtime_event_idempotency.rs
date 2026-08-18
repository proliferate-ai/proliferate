use super::*;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::prompt::SUBAGENT_COMPLETION_PROMPT_ID_PREFIX;
use anyharness_contract::v1::{
    PendingPromptRemovalReason, PendingPromptRemovedPayload, SessionEvent,
};

#[test]
fn deleted_prompt_removal_identity_is_durably_unique() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());
    store.insert(&session_record()).expect("insert session");
    let prompt_id = format!("{SUBAGENT_COMPLETION_PROMPT_ID_PREFIX}delivery-17");
    let payload = serde_json::json!({
        "type": "pending_prompt_removed",
        "seq": 17,
        "promptId": prompt_id,
        "reason": "deleted",
    })
    .to_string();

    let event = |seq| SessionEventRecord {
        id: 0,
        session_id: "session-1".into(),
        seq,
        timestamp: format!("2026-03-25T00:01:0{seq}Z"),
        event_type: "pending_prompt_removed".into(),
        turn_id: None,
        item_id: None,
        payload_json: payload.clone(),
    };
    store
        .append_event(&event(1))
        .expect("persist first removal");
    assert!(store.append_event(&event(2)).is_err());
    assert!(store
        .append_event_with_next_seq(
            "session-1",
            SessionEvent::PendingPromptRemoved(PendingPromptRemovedPayload {
                seq: 17,
                prompt_id: Some(prompt_id),
                reason: PendingPromptRemovalReason::Deleted,
            }),
            false,
        )
        .is_err());

    db.with_conn(|conn| {
        let (events, keys): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), COUNT(completion_wake_removal_key)
             FROM session_events WHERE session_id = 'session-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!((events, keys), (1, 1));
        Ok(())
    })
    .expect("verify unique durable event key");
}
