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

#[test]
fn append_raw_notification_sanitizes_large_persisted_payloads() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    let oversized_output = "x".repeat(16 * 1024 + 128);
    let payload_json = serde_json::json!({
        "_anyharness": {
            "aggregated_output": oversized_output.clone(),
        },
        "aggregated_output": oversized_output,
    })
    .to_string();

    store
        .append_raw_notification(
            "session-1",
            "tool_call",
            "2026-03-25T00:00:01Z",
            &payload_json,
        )
        .expect("append raw notification");

    let raw = store
        .list_raw_notifications("session-1")
        .expect("list raw notifications");
    let persisted: serde_json::Value =
        serde_json::from_str(&raw[0].payload_json).expect("parse raw payload");

    assert_eq!(
        persisted["_anyharness"]["aggregated_output"]
            .as_str()
            .unwrap()
            .len(),
        16 * 1024 + 128
    );
    assert_eq!(persisted["aggregated_output_truncated"], true);
    assert_eq!(
        persisted["aggregated_output_original_bytes"],
        16 * 1024 + 128
    );
    assert!(persisted["aggregated_output"].as_str().unwrap().len() <= 16 * 1024);
}
