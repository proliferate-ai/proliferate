use super::*;
use crate::sessions::model::{
    PendingConfigChangeRecord, SessionBackgroundWorkRecord, SessionBackgroundWorkState,
    SessionBackgroundWorkTrackerKind, SessionEventRecord, SessionLiveConfigSnapshotRecord,
};

#[test]
fn delete_session_removes_dependent_rows() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db.clone());
    let record = session_record();
    store.insert(&record).expect("insert session");
    let mut child = session_record();
    child.id = "session-child".to_string();
    store.insert(&child).expect("insert child session");

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
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_links (
                id, relation, parent_session_id, child_session_id, workspace_relation,
                created_at
             ) VALUES ('link-1', 'subagent', 'session-1', 'session-child', 'same_workspace', ?1)",
            ["2026-03-25T00:01:05Z"],
        )?;
        conn.execute(
            "INSERT INTO session_link_completions (
                completion_id, session_link_id, child_turn_id, child_last_event_seq,
                outcome, created_at, updated_at
             ) VALUES (
                'completion-1', 'link-1', 'turn-child-1', 42,
                'completed', ?1, ?1
             )",
            ["2026-03-25T00:01:06Z"],
        )?;
        conn.execute(
            "INSERT INTO session_link_wake_schedules (session_link_id)
             VALUES ('link-1')",
            [],
        )?;
        Ok(())
    })
    .expect("insert subagent link and completion");

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
    assert_eq!(count_all_rows(&db, "session_links"), 1);
    assert_eq!(count_all_rows(&db, "session_link_completions"), 1);
    assert_eq!(count_all_rows(&db, "session_link_wake_schedules"), 1);

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
    assert_eq!(count_all_rows(&db, "session_links"), 0);
    assert_eq!(count_all_rows(&db, "session_link_completions"), 0);
    assert_eq!(count_all_rows(&db, "session_link_wake_schedules"), 0);
}
