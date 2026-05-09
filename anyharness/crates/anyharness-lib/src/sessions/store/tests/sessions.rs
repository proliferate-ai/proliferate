use super::*;
use crate::origin::OriginContext;

#[test]
fn stores_and_loads_session_origin() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record();
    record.origin = Some(OriginContext::cowork());

    store.insert(&record).expect("insert session");
    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");

    assert_eq!(stored.origin, Some(OriginContext::cowork()));
}

#[test]
fn stores_and_loads_thinking_budget_tokens() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record();

    store.insert(&record).expect("insert session");
    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");

    assert_eq!(stored.thinking_budget_tokens, Some(16_000));
    assert_eq!(stored.title.as_deref(), Some("Fix auth refresh"));
}

#[test]
fn update_title_persists_session_title() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record();
    record.title = None;

    store.insert(&record).expect("insert session");
    store
        .update_title(
            "session-1",
            "Investigate flaky checkout",
            "2026-03-25T01:00:00Z",
        )
        .expect("update title");

    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");

    assert_eq!(stored.title.as_deref(), Some("Investigate flaky checkout"));
    assert_eq!(stored.updated_at, "2026-03-25T01:00:00Z");
}

#[test]
fn visible_session_lists_exclude_dismissed_and_closed_sessions() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);

    let visible = session_record();
    store.insert(&visible).expect("insert visible session");

    let mut dismissed = session_record();
    dismissed.id = "session-2".to_string();
    dismissed.dismissed_at = Some("2026-03-25T02:00:00Z".to_string());
    dismissed.updated_at = "2026-03-25T02:00:00Z".to_string();
    store.insert(&dismissed).expect("insert dismissed session");

    let mut closed = session_record();
    closed.id = "session-3".to_string();
    closed.status = "closed".to_string();
    closed.closed_at = Some("2026-03-25T03:00:00Z".to_string());
    closed.updated_at = "2026-03-25T03:00:00Z".to_string();
    store.insert(&closed).expect("insert closed session");

    let visible_by_workspace = store
        .list_visible_by_workspace("workspace-1")
        .expect("list visible sessions by workspace");
    assert_eq!(visible_by_workspace.len(), 1);
    assert_eq!(visible_by_workspace[0].id, "session-1");

    let with_dismissed = store
        .list_with_dismissed_by_workspace("workspace-1")
        .expect("list sessions with dismissed by workspace");
    assert_eq!(with_dismissed.len(), 2);
    assert_eq!(with_dismissed[0].id, "session-2");
    assert_eq!(with_dismissed[1].id, "session-1");
}

#[test]
fn mark_dismissed_is_idempotent_and_restore_uses_latest_timestamp() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);

    let first = session_record();
    store.insert(&first).expect("insert first session");

    let mut second = session_record();
    second.id = "session-2".to_string();
    store.insert(&second).expect("insert second session");

    store
        .mark_dismissed("session-1", "2026-03-25T01:00:00Z")
        .expect("dismiss first session");
    store
        .mark_dismissed("session-1", "2026-03-25T05:00:00Z")
        .expect("repeat dismiss first session");
    store
        .mark_dismissed("session-2", "2026-03-25T03:00:00Z")
        .expect("dismiss second session");

    let first_stored = store
        .find_by_id("session-1")
        .expect("find first session")
        .expect("first session exists");
    assert_eq!(
        first_stored.dismissed_at.as_deref(),
        Some("2026-03-25T01:00:00Z")
    );
    assert_eq!(first_stored.updated_at, "2026-03-25T01:00:00Z");

    let last_dismissed = store
        .find_last_dismissed_in_workspace("workspace-1")
        .expect("find last dismissed session")
        .expect("dismissed session exists");
    assert_eq!(last_dismissed.id, "session-2");

    store
        .clear_dismissed("session-2", "2026-03-25T04:00:00Z")
        .expect("restore second session");

    let restored = store
        .find_by_id("session-2")
        .expect("find restored session")
        .expect("restored session exists");
    assert_eq!(restored.dismissed_at, None);
    assert_eq!(restored.updated_at, "2026-03-25T04:00:00Z");

    let remaining = store
        .find_last_dismissed_in_workspace("workspace-1")
        .expect("find remaining dismissed session")
        .expect("remaining dismissed session exists");
    assert_eq!(remaining.id, "session-1");
}

#[test]
fn pop_last_dismissed_restores_latest_session_atomically() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);

    let mut first = session_record();
    first.id = "session-1".to_string();
    store.insert(&first).expect("insert first session");

    let mut second = session_record();
    second.id = "session-2".to_string();
    store.insert(&second).expect("insert second session");

    store
        .mark_dismissed("session-1", "2026-03-25T01:00:00Z")
        .expect("dismiss first session");
    store
        .mark_dismissed("session-2", "2026-03-25T03:00:00Z")
        .expect("dismiss second session");

    let restored = store
        .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T04:00:00Z")
        .expect("pop dismissed session")
        .expect("restored session exists");
    assert_eq!(restored.id, "session-2");
    assert_eq!(restored.dismissed_at, None);
    assert_eq!(restored.updated_at, "2026-03-25T04:00:00Z");

    let next = store
        .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T05:00:00Z")
        .expect("pop next dismissed session")
        .expect("next restored session exists");
    assert_eq!(next.id, "session-1");
    assert_eq!(next.dismissed_at, None);

    let none = store
        .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T06:00:00Z")
        .expect("pop empty dismissed stack");
    assert!(none.is_none());
}
