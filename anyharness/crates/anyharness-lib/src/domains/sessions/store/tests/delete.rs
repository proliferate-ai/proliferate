use super::*;
use crate::domains::sessions::model::{
    PendingConfigChangeRecord, SessionBackgroundWorkRecord, SessionBackgroundWorkState,
    SessionBackgroundWorkTrackerKind, SessionEventRecord, SessionLiveConfigSnapshotRecord,
};

#[test]
fn delete_session_removes_session_owned_rows() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db.clone());
    let record = session_record();
    store.insert(&record).expect("insert session");
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
        .expect("append event");
    store
        .append_raw_notification(
            "session-1",
            "agent_message_chunk",
            "2026-03-25T00:01:01Z",
            r#"{"kind":"agent_message_chunk"}"#,
        )
        .expect("append raw notification");
    store
        .upsert_live_config_snapshot(&SessionLiveConfigSnapshotRecord {
            session_id: "session-1".to_string(),
            source_seq: 1,
            raw_config_options_json: "{}".to_string(),
            normalized_controls_json: "{}".to_string(),
            prompt_capabilities_json: None,
            updated_at: "2026-03-25T00:01:02Z".to_string(),
        })
        .expect("upsert snapshot");
    store
        .upsert_pending_config_change(&PendingConfigChangeRecord {
            session_id: "session-1".to_string(),
            config_id: "model".to_string(),
            value: "\"opus\"".to_string(),
            queued_at: "2026-03-25T00:01:03Z".to_string(),
        })
        .expect("insert pending config change");
    store
        .insert_pending_prompt("session-1", "finish cleanup", Some("prompt-1"))
        .expect("insert pending prompt");
    store
        .upsert_or_refresh_pending_background_work(&SessionBackgroundWorkRecord {
            session_id: "session-1".to_string(),
            tool_call_id: "tool-1".to_string(),
            turn_id: "turn-1".to_string(),
            tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
            source_agent_kind: "claude".to_string(),
            agent_id: Some("agent-1".to_string()),
            output_file: "/tmp/agent.output".to_string(),
            state: SessionBackgroundWorkState::Pending,
            created_at: "2026-03-25T00:01:04Z".to_string(),
            updated_at: "2026-03-25T00:01:04Z".to_string(),
            launched_at: "2026-03-25T00:01:04Z".to_string(),
            last_activity_at: "2026-03-25T00:01:04Z".to_string(),
            completed_at: None,
        })
        .expect("insert background work");
    assert_eq!(count_rows(&db, "session_events", "session-1"), 1);
    assert_eq!(count_rows(&db, "session_raw_notifications", "session-1"), 1);
    assert_eq!(
        count_rows(&db, "session_live_config_snapshots", "session-1"),
        1
    );
    assert_eq!(
        count_rows(&db, "session_pending_config_changes", "session-1"),
        1
    );
    assert_eq!(count_rows(&db, "session_pending_prompts", "session-1"), 1);
    assert_eq!(count_rows(&db, "session_background_work", "session-1"), 1);

    store
        .delete_session("session-1")
        .expect("delete session with dependents");

    assert!(store
        .find_by_id("session-1")
        .expect("load deleted session")
        .is_none());
    assert_eq!(count_rows(&db, "session_events", "session-1"), 0);
    assert_eq!(count_rows(&db, "session_raw_notifications", "session-1"), 0);
    assert_eq!(
        count_rows(&db, "session_live_config_snapshots", "session-1"),
        0
    );
    assert_eq!(
        count_rows(&db, "session_pending_config_changes", "session-1"),
        0
    );
    assert_eq!(count_rows(&db, "session_pending_prompts", "session-1"), 0);
    assert_eq!(count_rows(&db, "session_background_work", "session-1"), 0);
}
