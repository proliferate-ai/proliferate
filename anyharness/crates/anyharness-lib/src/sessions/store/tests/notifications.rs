use super::*;

#[test]
fn raw_notifications_are_persisted_in_seq_order() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record();
    store.insert(&record).expect("insert session");

    store
        .append_raw_notification(
            "session-1",
            "agent_message_chunk",
            "2026-03-25T00:00:01Z",
            r#"{"update":{"sessionUpdate":"agent_message_chunk"}}"#,
        )
        .expect("append first raw notification");
    store
        .append_raw_notification(
            "session-1",
            "tool_call",
            "2026-03-25T00:00:02Z",
            r#"{"update":{"sessionUpdate":"tool_call"}}"#,
        )
        .expect("append second raw notification");

    let all = store
        .list_raw_notifications("session-1")
        .expect("list raw notifications");
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].seq, 1);
    assert_eq!(all[0].notification_kind, "agent_message_chunk");
    assert_eq!(all[1].seq, 2);
    assert_eq!(all[1].notification_kind, "tool_call");

    let tail = store
        .list_raw_notifications_after("session-1", 1)
        .expect("list raw notifications after");
    assert_eq!(tail.len(), 1);
    assert_eq!(tail[0].seq, 2);
}
