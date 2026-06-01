use super::*;
use crate::domains::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
};

#[test]
fn background_work_round_trips_and_marks_terminal() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    let pending = SessionBackgroundWorkRecord {
        session_id: "session-1".to_string(),
        tool_call_id: "tool-1".to_string(),
        turn_id: "turn-1".to_string(),
        tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
        source_agent_kind: "claude".to_string(),
        agent_id: Some("agent-1".to_string()),
        output_file: "/tmp/agent.output".to_string(),
        state: SessionBackgroundWorkState::Pending,
        created_at: "2026-03-25T01:00:00Z".to_string(),
        updated_at: "2026-03-25T01:00:00Z".to_string(),
        launched_at: "2026-03-25T01:00:00Z".to_string(),
        last_activity_at: "2026-03-25T01:00:00Z".to_string(),
        completed_at: None,
    };

    assert!(store
        .upsert_or_refresh_pending_background_work(&pending)
        .expect("upsert pending background work"));
    store
        .touch_background_work_activity("session-1", "tool-1", "2026-03-25T01:05:00Z")
        .expect("touch background work activity");

    let pending_rows = store
        .list_pending_background_work("session-1")
        .expect("list pending background work");
    assert_eq!(pending_rows.len(), 1);
    assert_eq!(pending_rows[0].last_activity_at, "2026-03-25T01:05:00Z");
    assert_eq!(pending_rows[0].updated_at, "2026-03-25T01:05:00Z");

    assert!(store
        .mark_background_work_terminal(
            "session-1",
            "tool-1",
            SessionBackgroundWorkState::Completed,
            "2026-03-25T01:06:00Z",
        )
        .expect("mark background work terminal"));

    assert!(store
        .list_pending_background_work("session-1")
        .expect("list pending background work")
        .is_empty());
}
