use super::*;

const DUE_AT: &str = "2026-08-11T00:02:00Z";

fn seed_removal_intent(db: &Db, suffix: &str, prompt_seq: i64, updated_at: &str) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_link_completion_deliveries (
                delivery_id, completion_id, session_link_id, parent_session_id,
                child_session_id, child_turn_id, child_last_event_seq, outcome,
                notification_text, state, next_attempt_at, created_at, updated_at,
                delivered_at, retired_prompt_seq, retired_prompt_id
             ) VALUES (
                ?1, ?2, 'link-1', 'parent-1', 'child-1', ?3, ?4, 'completed',
                'done', 'delivered', ?5, ?6, ?6, ?6, ?7, ?8
             )",
            params![
                format!("delivery-{suffix}"),
                format!("completion-{suffix}"),
                format!("turn-{suffix}"),
                prompt_seq,
                DUE_AT,
                updated_at,
                prompt_seq,
                format!("wake-{suffix}"),
            ],
        )?;
        Ok(())
    })
    .expect("seed removal intent");
}

#[test]
fn removal_claim_is_exclusive_and_acknowledges_exact_identity() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    seed_removal_intent(&db, "a", 41, "2026-08-11T00:00:00Z");
    let store = CompletionDeliveryStore::new(db);

    let intent = store
        .claim_next_pending_wake_removal(DUE_AT, "2026-08-11T00:03:00Z", "worker-a")
        .expect("claim removal")
        .expect("removal due");
    assert!(store
        .claim_next_pending_wake_removal(DUE_AT, "2026-08-11T00:03:00Z", "worker-b",)
        .expect("competing claim")
        .is_none());
    assert!(!store
        .acknowledge_wake_removal(&intent, "worker-b", "2026-08-11T00:02:01Z")
        .expect("reject foreign acknowledgement"));
    assert!(store
        .acknowledge_wake_removal(&intent, "worker-a", "2026-08-11T00:02:01Z")
        .expect("acknowledge claimed identity"));
    assert!(store
        .list_pending_wake_removals(10)
        .expect("pending removals")
        .is_empty());
}

#[test]
fn deferred_failed_removal_cannot_starve_the_next_due_intent() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    seed_removal_intent(&db, "a", 41, "2026-08-11T00:00:00Z");
    seed_removal_intent(&db, "b", 42, "2026-08-11T00:00:01Z");
    let store = CompletionDeliveryStore::new(db);

    let first = store
        .claim_next_pending_wake_removal(DUE_AT, "2026-08-11T00:03:00Z", "worker-a")
        .expect("claim first")
        .expect("first intent due");
    assert_eq!(first.delivery_id, "delivery-a");
    assert!(store
        .release_wake_removal_claim(
            &first,
            "worker-a",
            "2026-08-11T00:02:01Z",
            "2026-08-11T00:03:01Z",
        )
        .expect("defer failed intent"));

    let next = store
        .claim_next_pending_wake_removal("2026-08-11T00:02:01Z", "2026-08-11T00:03:01Z", "worker-b")
        .expect("claim next")
        .expect("later intent remains reachable");
    assert_eq!(next.delivery_id, "delivery-b");
}

#[test]
fn mobility_round_trip_preserves_unacknowledged_removal_without_lease() {
    let source = Db::open_in_memory().expect("open source db");
    seed_link(&source, false);
    seed_removal_intent(&source, "mobile", 73, "2026-08-11T00:00:00Z");
    let source_store = CompletionDeliveryStore::new(source.clone());
    source_store
        .claim_next_pending_wake_removal(DUE_AT, "2099-01-01T00:00:00Z", "source-worker")
        .expect("claim source intent")
        .expect("source intent due");

    let snapshot = SessionStore::new(source)
        .snapshot_workspace_for_mobility("workspace-1", false)
        .expect("snapshot source sessions");
    assert_eq!(snapshot.session_link_completion_deliveries.len(), 1);
    let archived = &snapshot.session_link_completion_deliveries[0];
    assert_eq!(archived.state, CompletionDeliveryState::Delivered);
    assert_eq!(archived.retired_prompt_seq, Some(73));
    assert_eq!(archived.retired_prompt_id.as_deref(), Some("wake-mobile"));

    let destination = Db::open_in_memory().expect("open destination db");
    let destination_store = CompletionDeliveryStore::new(destination);
    destination_store
        .import(archived)
        .expect("import unacknowledged removal");
    let imported = destination_store
        .find(&archived.delivery_id)
        .expect("find imported row")
        .expect("imported row exists");
    assert!(imported.lease_token.is_none());
    assert!(imported.lease_expires_at.is_none());
    let retry = destination_store
        .claim_next_pending_wake_removal(DUE_AT, "2026-08-11T00:03:00Z", "destination-worker")
        .expect("claim imported removal")
        .expect("imported removal remains retryable");
    assert_eq!(retry.parent_prompt_seq, 73);
    assert_eq!(retry.prompt_id.as_deref(), Some("wake-mobile"));
}
