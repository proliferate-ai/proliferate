use rusqlite::params;

use super::{seed_workspace, session_record, SessionStore};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::support_windows::{
    SupportEvidenceWindowFilter, SupportSessionWindowFilter, SupportWindowCandidate,
    SUPPORT_WINDOW_ITEM_BYTES,
};
use crate::persistence::Db;

fn insert_session(store: &SessionStore, id: &str, updated_at: &str) {
    let mut record: SessionRecord = session_record();
    record.id = id.to_owned();
    record.updated_at = updated_at.to_owned();
    store.insert(&record).expect("insert session");
}

#[test]
fn recent_support_sessions_use_julianday_order_and_hard_cap_plus_one() {
    let db = Db::open_in_memory().expect("open database");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    insert_session(&store, "session-c", "2026-03-25T00:02:00+00:00");
    insert_session(&store, "session-a", "2026-03-25T00:02:00Z");
    insert_session(&store, "session-b", "2026-03-25T00:01:00Z");

    let (cancellation, guard) = store.begin_support_window_query();
    let rows = store
        .list_support_session_window(
            "workspace-1",
            &SupportSessionWindowFilter::Recent {
                updated_at_from: "2026-03-25T00:00:00Z".to_owned(),
                updated_at_to: "2026-03-25T00:02:00Z".to_owned(),
            },
            2,
            &cancellation,
        )
        .expect("list bounded sessions");
    guard.disarm();

    assert!(rows.has_more);
    let ids = rows
        .candidates
        .into_iter()
        .map(|candidate| match candidate {
            SupportWindowCandidate::Item(record) => record.id,
            SupportWindowCandidate::Oversized => panic!("unexpected oversized session"),
        })
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["session-a", "session-c", "session-b"]);
}

#[test]
fn oversized_session_keeps_the_valid_hard_cap_plus_one_candidate_available() {
    let db = Db::open_in_memory().expect("open database");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    let mut oversized: SessionRecord = session_record();
    oversized.id = "session-newest".to_owned();
    oversized.updated_at = "2026-03-25T00:02:00Z".to_owned();
    oversized.title = Some("x".repeat(SUPPORT_WINDOW_ITEM_BYTES + 1));
    store.insert(&oversized).expect("insert oversized session");
    insert_session(&store, "session-valid", "2026-03-25T00:01:00Z");

    let (cancellation, guard) = store.begin_support_window_query();
    let rows = store
        .list_support_session_window(
            "workspace-1",
            &SupportSessionWindowFilter::Recent {
                updated_at_from: "2026-03-25T00:00:00Z".to_owned(),
                updated_at_to: "2026-03-25T00:02:00Z".to_owned(),
            },
            1,
            &cancellation,
        )
        .expect("list bounded sessions");
    guard.disarm();

    assert!(rows.has_more);
    assert!(matches!(
        rows.candidates.as_slice(),
        [
            SupportWindowCandidate::Oversized,
            SupportWindowCandidate::Item(record)
        ] if record.id == "session-valid"
    ));
}

#[test]
fn event_support_metadata_omits_oversized_payload_before_loading_it() {
    let db = Db::open_in_memory().expect("open database");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());
    insert_session(&store, "session-1", "2026-03-25T00:00:00Z");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_events
             (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
             VALUES (?1, 1, ?2, 'error', NULL, NULL, '{}')",
            params!["session-1", "2026-03-25T00:00:00Z"],
        )?;
        conn.execute(
            "INSERT INTO session_events
             (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
             VALUES (?1, 2, ?2, 'error', NULL, NULL, ?3)",
            params![
                "session-1",
                "2026-03-25T00:01:00+00:00",
                "x".repeat(SUPPORT_WINDOW_ITEM_BYTES + 1)
            ],
        )?;
        Ok(())
    })
    .expect("insert event rows");

    let (cancellation, guard) = store.begin_support_window_query();
    let rows = store
        .list_support_event_window(
            "session-1",
            &SupportEvidenceWindowFilter {
                timestamp_from: "2026-03-25T00:00:00Z".to_owned(),
                timestamp_to: "2026-03-25T00:01:00Z".to_owned(),
            },
            2,
            &cancellation,
        )
        .expect("list bounded events")
        .expect("session exists");
    guard.disarm();

    assert!(!rows.has_more);
    assert!(matches!(
        rows.candidates.as_slice(),
        [
            SupportWindowCandidate::Oversized,
            SupportWindowCandidate::Item(_)
        ]
    ));
}

#[test]
fn event_support_metadata_keeps_valid_candidate_after_oversized_newest_at_limit_one() {
    let db = Db::open_in_memory().expect("open database");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());
    insert_session(&store, "session-1", "2026-03-25T00:00:00Z");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_events
             (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
             VALUES (?1, 1, ?2, 'valid', NULL, NULL, '{}')",
            params!["session-1", "2026-03-25T00:00:00Z"],
        )?;
        conn.execute(
            "INSERT INTO session_events
             (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
             VALUES (?1, 2, ?2, 'oversized', NULL, NULL, ?3)",
            params![
                "session-1",
                "2026-03-25T00:01:00Z",
                "x".repeat(SUPPORT_WINDOW_ITEM_BYTES + 1)
            ],
        )?;
        Ok(())
    })
    .expect("insert event rows");

    let (cancellation, guard) = store.begin_support_window_query();
    let rows = store
        .list_support_event_window(
            "session-1",
            &SupportEvidenceWindowFilter {
                timestamp_from: "2026-03-25T00:00:00Z".to_owned(),
                timestamp_to: "2026-03-25T00:01:00Z".to_owned(),
            },
            1,
            &cancellation,
        )
        .expect("list bounded events")
        .expect("session exists");
    guard.disarm();

    assert!(rows.has_more);
    assert!(matches!(
        rows.candidates.as_slice(),
        [
            SupportWindowCandidate::Oversized,
            SupportWindowCandidate::Item(record)
        ] if record.seq == 1
    ));
}

#[test]
fn raw_support_metadata_keeps_valid_candidate_after_oversized_newest() {
    let db = Db::open_in_memory().expect("open database");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());
    insert_session(&store, "session-1", "2026-03-25T00:00:00Z");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_raw_notifications
             (session_id, seq, timestamp, notification_kind, payload_json)
             VALUES (?1, 1, ?2, 'valid', '{}')",
            params!["session-1", "2026-03-25T00:00:00Z"],
        )?;
        conn.execute(
            "INSERT INTO session_raw_notifications
             (session_id, seq, timestamp, notification_kind, payload_json)
             VALUES (?1, 2, ?2, 'oversized', ?3)",
            params![
                "session-1",
                "2026-03-25T00:01:00Z",
                "x".repeat(SUPPORT_WINDOW_ITEM_BYTES + 1)
            ],
        )?;
        Ok(())
    })
    .expect("insert raw rows");

    let (cancellation, guard) = store.begin_support_window_query();
    let rows = store
        .list_support_raw_notification_window(
            "session-1",
            &SupportEvidenceWindowFilter {
                timestamp_from: "2026-03-25T00:00:00Z".to_owned(),
                timestamp_to: "2026-03-25T00:01:00Z".to_owned(),
            },
            1,
            &cancellation,
        )
        .expect("list bounded raw rows")
        .expect("session exists");
    guard.disarm();

    assert!(rows.has_more);
    assert!(matches!(
        rows.candidates.as_slice(),
        [
            SupportWindowCandidate::Oversized,
            SupportWindowCandidate::Item(record)
        ] if record.seq == 1
    ));
}

#[test]
fn exact_support_session_requires_workspace_ownership_and_only_an_upper_bound() {
    let db = Db::open_in_memory().expect("open database");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    insert_session(&store, "session-old", "2020-01-01T00:00:00Z");
    let (cancellation, guard) = store.begin_support_window_query();
    let owned = store
        .list_support_session_window(
            "workspace-1",
            &SupportSessionWindowFilter::Exact {
                session_id: "session-old".to_owned(),
                updated_at_to: "2026-03-25T00:00:00Z".to_owned(),
            },
            1,
            &cancellation,
        )
        .expect("read exact session");
    guard.disarm();
    assert_eq!(owned.candidates.len(), 1);

    let (cancellation, guard) = store.begin_support_window_query();
    let foreign = store
        .list_support_session_window(
            "another-workspace",
            &SupportSessionWindowFilter::Exact {
                session_id: "session-old".to_owned(),
                updated_at_to: "2026-03-25T00:00:00Z".to_owned(),
            },
            1,
            &cancellation,
        )
        .expect("read foreign exact session");
    guard.disarm();
    assert!(foreign.candidates.is_empty());
}

#[test]
fn support_session_projection_never_loads_persisted_secret_or_launch_fields() {
    let db = Db::open_in_memory().expect("open database");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    let mut record = session_record();
    record.agent_auth_contexts = Some(r#"[{"secret":"auth"}]"#.to_owned());
    record.mcp_bindings_ciphertext = Some("ciphertext-canary".to_owned());
    record.system_prompt_append = Some("private launch instruction".to_owned());
    record.thinking_level_id = Some("private-level".to_owned());
    record.thinking_budget_tokens = Some(42);
    store.insert(&record).expect("insert sensitive session");

    let (cancellation, guard) = store.begin_support_window_query();
    let rows = store
        .list_support_session_window(
            "workspace-1",
            &SupportSessionWindowFilter::Exact {
                session_id: record.id,
                updated_at_to: "2026-12-31T00:00:00Z".to_owned(),
            },
            1,
            &cancellation,
        )
        .expect("read durable support projection");
    guard.disarm();

    let SupportWindowCandidate::Item(projected) = &rows.candidates[0] else {
        panic!("expected projected session");
    };
    assert!(projected.agent_auth_contexts.is_none());
    assert!(projected.mcp_bindings_ciphertext.is_none());
    assert!(projected.system_prompt_append.is_none());
    assert!(projected.thinking_level_id.is_none());
    assert!(projected.thinking_budget_tokens.is_none());
}
