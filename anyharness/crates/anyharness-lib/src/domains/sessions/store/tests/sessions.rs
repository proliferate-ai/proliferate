use super::*;
use crate::domains::agents::launch_options::{
    HarnessLaunchOptions, LaunchSelection, LaunchSelectionUnsupported,
};
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::origin::OriginContext;

fn seed_launch_options(db: &Db, basis: &str) {
    let options = serde_json::to_string(&HarnessLaunchOptions::default()).unwrap();
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO harness_launch_option_states (
                harness_kind, basis_revision, revision, options_json, observed_at,
                probe_state, probe_attempted_at, probe_failure_code
             ) VALUES ('claude', ?1, 1, ?2, '2026-08-19T00:00:00Z',
                       'succeeded', '2026-08-19T00:00:00Z', NULL)",
            rusqlite::params![basis, options],
        )?;
        Ok(())
    })
    .unwrap();
}

#[test]
fn insert_or_find_by_id_reuses_the_original_session_row() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    seed_launch_options(&db, "basis-1");

    let store = SessionStore::new(db.clone());
    let original = session_record();
    let selection = LaunchSelection::default();
    let intent = ResolvedLaunchIntent::default();
    let basis_revision = || "basis-1".to_string();
    assert!(matches!(
        store
            .insert_or_find_by_id(
                &original,
                &intent,
                "claude",
                &basis_revision,
                &selection,
            )
            .expect("insert original session"),
        (
            super::super::idempotent_create::InsertSessionByIdOutcome::Inserted,
            _
        )
    ));

    let mut replay = original.clone();
    replay.agent_kind = "codex".to_string();
    let existing = store
        .insert_or_find_by_id(
            &replay,
            &intent,
            "claude",
            &basis_revision,
            &selection,
        )
        .expect("find original session");
    let (
        super::super::idempotent_create::InsertSessionByIdOutcome::Existing {
            record: existing,
            intent: existing_intent,
        },
        _,
    ) = existing
    else {
        panic!("replay should return the original row");
    };
    assert_eq!(existing.agent_kind, "claude");
    assert_eq!(existing_intent, Some(intent));
    assert_eq!(
        store
            .list_by_workspace("workspace-1")
            .expect("list sessions")
            .len(),
        1
    );
}

#[test]
fn atomic_admission_rejects_changed_options_before_session_or_intent_insert() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    seed_launch_options(&db, "old-basis");
    let store = SessionStore::new(db.clone());
    let record = session_record();
    let intent = ResolvedLaunchIntent::default();
    let basis_revision = || "new-basis".to_string();

    let error = store
        .insert_with_launch_intent(
            &record,
            &intent,
            "claude",
            &basis_revision,
            &LaunchSelection::default(),
        )
        .expect_err("stale matching-basis row must not authorize a session");
    assert!(matches!(
        error,
        LaunchSelectionUnsupported::ObservationUnavailable { .. }
    ));
    assert!(store.find_by_id(&record.id).unwrap().is_none());
    assert!(store.find_launch_intent(&record.id).unwrap().is_none());
}

#[test]
fn concurrent_refresh_cannot_commit_between_validation_and_durable_insert() {
    use std::sync::mpsc;
    use std::time::Duration;

    use crate::domains::sessions::store::launch_intents::insert_launch_intent_row;
    use crate::domains::sessions::store::sessions::insert_session_row;
    use crate::domains::sessions::store::with_launch_admission_tx;

    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    seed_launch_options(&db, "basis-1");
    let record = session_record();
    let intent = ResolvedLaunchIntent::default();

    let (validated_tx, validated_rx) = mpsc::channel();
    let (refresh_started_tx, refresh_started_rx) = mpsc::channel();
    let refresh_db = db.clone();
    let refresh = std::thread::spawn(move || {
        validated_rx.recv().expect("admission validation signal");
        refresh_started_tx.send(()).expect("refresh start signal");
        refresh_db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE harness_launch_option_states
                     SET basis_revision = 'basis-2', revision = 2
                     WHERE harness_kind = 'claude'",
                    [],
                )?;
                Ok(())
            })
            .expect("commit concurrent refresh");
    });

    let basis_revision = || "basis-1".to_string();
    let ((), validated) = with_launch_admission_tx(
        &db,
        "claude",
        &basis_revision,
        &LaunchSelection::default(),
        |conn| {
            validated_tx.send(()).expect("validation complete signal");
            refresh_started_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("refresh attempted while admission transaction is open");
            insert_session_row(conn, &record)?;
            insert_launch_intent_row(conn, &record.id, &intent)?;
            Ok(())
        },
    )
    .expect("admit session against the transaction's current row");
    assert_eq!(validated.basis_revision, "basis-1");
    refresh.join().expect("refresh thread");

    let store = SessionStore::new(db.clone());
    assert!(store.find_by_id(&record.id).unwrap().is_some());
    assert!(store.find_launch_intent(&record.id).unwrap().is_some());
    let current_basis: String = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT basis_revision FROM harness_launch_option_states
                 WHERE harness_kind = 'claude'",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(current_basis, "basis-2");
}

#[test]
fn basis_change_during_admission_rolls_back_session_and_intent() {
    use std::cell::Cell;

    use crate::domains::sessions::store::launch_intents::insert_launch_intent_row;
    use crate::domains::sessions::store::sessions::insert_session_row;
    use crate::domains::sessions::store::with_launch_admission_tx;

    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    seed_launch_options(&db, "basis-1");
    let record = session_record();
    let intent = ResolvedLaunchIntent::default();
    let basis_reads = Cell::new(0_u8);
    let basis_revision = || {
        let read = basis_reads.get();
        basis_reads.set(read.saturating_add(1));
        if read == 0 {
            "basis-1".to_string()
        } else {
            "basis-2".to_string()
        }
    };

    let error = with_launch_admission_tx(
        &db,
        "claude",
        &basis_revision,
        &LaunchSelection::default(),
        |conn| {
            insert_session_row(conn, &record)?;
            insert_launch_intent_row(conn, &record.id, &intent)?;
            Ok(())
        },
    )
    .expect_err("basis change before commit must reject admission");
    assert!(matches!(
        error,
        super::super::LaunchAdmissionTxError::Selection(
            LaunchSelectionUnsupported::ObservationUnavailable { .. }
        )
    ));

    let store = SessionStore::new(db);
    assert!(store.find_by_id(&record.id).unwrap().is_none());
    assert!(store.find_launch_intent(&record.id).unwrap().is_none());
}

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
fn update_title_if_absent_never_replaces_an_assigned_title() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record();
    record.title = None;
    store.insert(&record).expect("insert session");

    assert!(store
        .update_title_if_absent("session-1", "Harness title", "2026-03-25T01:00:00Z")
        .expect("set title on untitled session"));
    assert!(!store
        .update_title_if_absent("session-1", "Later harness title", "2026-03-25T02:00:00Z")
        .expect("skip titled session"));

    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");
    assert_eq!(stored.title.as_deref(), Some("Harness title"));
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
fn live_state_updates_do_not_reopen_closed_sessions() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record();
    store.insert(&record).expect("insert session");
    store
        .mark_closed("session-1", "2026-03-25T03:00:00Z")
        .expect("close session");
    store
        .update_native_session_id("session-1", "native-2", "2026-03-25T04:00:00Z")
        .expect("ignore native update");
    store
        .update_status("session-1", "idle", "2026-03-25T04:00:00Z")
        .expect("ignore status update");
    store
        .mark_closed("session-1", "2026-03-25T05:00:00Z")
        .expect("repeat close");

    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");
    assert_eq!(stored.status, "closed");
    assert_eq!(stored.native_session_id.as_deref(), Some("native-1"));
    assert_eq!(stored.closed_at.as_deref(), Some("2026-03-25T03:00:00Z"));
    assert_eq!(stored.updated_at, "2026-03-25T03:00:00Z");
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
        .pop_last_dismissed_in_workspace("workspace-1", None, "2026-03-25T04:00:00Z")
        .expect("pop dismissed session")
        .expect("restored session exists");
    assert_eq!(restored.id, "session-2");
    assert_eq!(restored.dismissed_at, None);
    assert_eq!(restored.updated_at, "2026-03-25T04:00:00Z");

    let next = store
        .pop_last_dismissed_in_workspace("workspace-1", None, "2026-03-25T05:00:00Z")
        .expect("pop next dismissed session")
        .expect("next restored session exists");
    assert_eq!(next.id, "session-1");
    assert_eq!(next.dismissed_at, None);

    let none = store
        .pop_last_dismissed_in_workspace("workspace-1", None, "2026-03-25T06:00:00Z")
        .expect("pop empty dismissed stack");
    assert!(none.is_none());
}
