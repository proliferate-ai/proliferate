use super::*;
use crate::domains::sessions::model::SessionEventRecord;

#[test]
fn insert_session_with_link_rolls_back_child_when_link_insert_fails() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record();
    parent.id = "parent-session".to_string();
    store.insert(&parent).expect("insert parent session");

    let mut child = session_record();
    child.id = "child-session".to_string();
    child.native_session_id = Some("native-child".to_string());
    let first_link = fork_link_record("duplicate-link", "parent-session", "child-session");
    store
        .insert_session_with_link(&child, &first_link)
        .expect("insert first child and link");

    let mut second_child = session_record();
    second_child.id = "second-child".to_string();
    second_child.native_session_id = Some("native-second-child".to_string());
    let duplicate_link = fork_link_record("duplicate-link", "parent-session", "second-child");

    store
        .insert_session_with_link(&second_child, &duplicate_link)
        .expect_err("duplicate link id rejects transaction");

    assert!(store
        .find_by_id("second-child")
        .expect("find second child")
        .is_none());
}

// Regression evidence for the fork-resume dead-end (native session
// `Resource not found`): the fork snapshot copies `turn_started` events from
// the parent into the child, so `has_turn_started_event(child)` is `true` even
// though the child has never run its own turn. A never-prompted fork child also
// has `last_prompt_at == None`. Therefore the launch policy must key its
// "has this fork child run since the fork?" guard on `last_prompt_at`, NOT on
// `has_turn_started_event`, which is polluted by the snapshot.
#[test]
fn fork_snapshot_pollutes_turn_started_but_not_last_prompt_at() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut parent = session_record();
    parent.id = "parent-session".to_string();
    store.insert(&parent).expect("insert parent session");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "parent-session".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("append parent turn");

    let mut child = session_record();
    child.id = "child-session".to_string();
    child.native_session_id = Some("native-child".to_string());
    child.last_prompt_at = None; // mirrors fork.rs: forks start with no prompt
    let link = fork_link_record("fork-link", "parent-session", "child-session");
    store
        .insert_fork_session_with_link_and_event_snapshot(&child, &link)
        .expect("insert fork child with event snapshot");

    // POLLUTED signal: the parent's turn_started rode along in the snapshot.
    assert!(
        store
            .has_turn_started_event("child-session")
            .expect("has_turn_started_event"),
        "snapshot must copy the parent's turn_started into the child"
    );

    // CLEAN signal: a never-prompted fork child has no last_prompt_at, so the
    // launch policy can use it to detect "child has not run since the fork".
    let reloaded = store
        .find_by_id("child-session")
        .expect("find child")
        .expect("child exists");
    assert_eq!(
        reloaded.last_prompt_at, None,
        "a never-prompted fork child must have last_prompt_at == None"
    );
}

#[test]
fn insert_fork_session_with_link_snapshots_parent_events() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db.clone());
    let mut parent = session_record();
    parent.id = "parent-session".to_string();
    store.insert(&parent).expect("insert parent session");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "parent-session".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("append parent turn");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "parent-session".to_string(),
            seq: 2,
            timestamp: "2026-03-25T00:01:01Z".to_string(),
            event_type: "item_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: Some("item-1".to_string()),
            payload_json: r#"{"type":"item_started","item":{"kind":"user_message","status":"completed","contentParts":[{"type":"text","text":"hi"}]}}"#.to_string(),
        })
        .expect("append parent item");
    store
        .append_raw_notification(
            "parent-session",
            "agent_message_chunk",
            "2026-03-25T00:01:02Z",
            r#"{"chunk":"raw"}"#,
        )
        .expect("append parent raw notification");

    let mut child = session_record();
    child.id = "child-session".to_string();
    child.native_session_id = None;
    let link = fork_link_record("fork-link", "parent-session", "child-session");
    let copied = store
        .insert_fork_session_with_link_and_event_snapshot(&child, &link)
        .expect("insert fork child with event snapshot");

    assert_eq!(copied, 2);
    assert_eq!(store.next_event_seq("child-session").expect("next seq"), 3);
    let events = store
        .list_events("child-session")
        .expect("list child events");
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].seq, 1);
    assert_eq!(events[0].event_type, "turn_started");
    assert_eq!(events[0].turn_id.as_deref(), Some("turn-1"));
    assert_eq!(events[1].seq, 2);
    assert_eq!(events[1].item_id.as_deref(), Some("item-1"));
    assert_eq!(
        events[1].payload_json,
        r#"{"type":"item_started","item":{"kind":"user_message","status":"completed","contentParts":[{"type":"text","text":"hi"}]}}"#
    );
    assert!(
        store
            .list_raw_notifications("child-session")
            .expect("list child raw notifications")
            .is_empty(),
        "fork transcript snapshots must not copy raw ACP notifications"
    );
}
