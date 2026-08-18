use super::*;
use crate::app::test_support;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::store::SessionStore;

#[path = "tests/wake_removal_intents.rs"]
mod wake_removal_intents;

pub(super) fn seed_link(db: &Db, relationship_closed: bool) {
    test_support::seed_workspace_with_repo_root(
        db,
        "workspace-1",
        "local",
        "/tmp/completion-delivery",
    );
    db.with_conn(|conn| {
        for id in ["parent-1", "child-1"] {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at,
                    subagents_enabled
                 ) VALUES (?1, 'workspace-1', 'claude', 'idle', ?2, ?2, 1)",
                params![id, "2026-08-11T00:00:00Z"],
            )?;
        }
        conn.execute(
            "INSERT INTO session_links (
                id, public_id, relation, parent_session_id, child_session_id,
                workspace_relation, label, created_at, subagent_closed_at
             ) VALUES (
                'link-1', 'subagent-1', 'subagent', 'parent-1', 'child-1',
                'same_workspace', 'Researcher', ?1, ?2
             )",
            params![
                "2026-08-11T00:00:00Z",
                relationship_closed.then_some("2026-08-11T00:01:00Z")
            ],
        )?;
        Ok(())
    })
    .expect("seed subagent relationship");
}

pub(super) fn terminal_input(turn_id: &str) -> DurableTerminalTurn {
    DurableTerminalTurn {
        terminal_id: format!("terminal-{turn_id}"),
        session_id: "child-1".to_string(),
        turn_id: turn_id.to_string(),
        outcome: SessionTurnOutcome::Completed,
        assistant_text: Some("Useful answer".to_string()),
        events: vec![SessionEventRecord {
            id: 0,
            session_id: "child-1".to_string(),
            seq: 1,
            timestamp: "2026-08-11T00:02:00Z".to_string(),
            turn_id: Some(turn_id.to_string()),
            item_id: None,
            event_type: "turn_ended".to_string(),
            payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.to_string(),
        }],
        completed_at: "2026-08-11T00:02:00Z".to_string(),
    }
}

pub(super) fn persist_delivery(db: &Db, turn_id: &str) -> CompletionDeliveryRecord {
    SessionStore::new(db.clone())
        .persist_terminal_turn_record(&terminal_input(turn_id))
        .expect("persist terminal turn");
    CompletionDeliveryStore::new(db.clone())
        .find(&format!("terminal-{turn_id}"))
        .expect("find delivery")
        .expect("delivery captured")
}

#[test]
fn terminal_capture_is_atomic_stable_and_accepts_relationship_closed() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, true);
    let store = CompletionDeliveryStore::new(db.clone());
    let first = persist_delivery(&db, "turn-1");
    SessionStore::new(db.clone())
        .persist_terminal_turn_record(&terminal_input("turn-1"))
        .expect("idempotent terminal retry");
    let second = store
        .find(&first.delivery_id)
        .expect("find retry")
        .expect("delivery exists");
    assert_eq!(first.delivery_id, second.delivery_id);
    assert_eq!(first.completion_id, second.completion_id);
    assert_eq!(first.state, CompletionDeliveryState::Pending);
    assert_eq!(
        first.notification_text,
        "Subagent update\nAgent: Researcher (child-1)\nOutcome: completed\n\nFinal output:\nUseful answer"
    );
    db.with_conn(|conn| {
        let completions: i64 =
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })?;
        let deliveries: i64 = conn.query_row(
            "SELECT COUNT(*) FROM session_link_completion_deliveries",
            [],
            |row| row.get(0),
        )?;
        assert_eq!((completions, deliveries), (0, 1));
        Ok(())
    })
    .expect("count rows");
}

#[test]
fn terminal_retry_rejects_conflicting_frozen_input() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    persist_delivery(&db, "turn-1");
    let session_store = SessionStore::new(db.clone());

    let mut changed_identity = terminal_input("turn-1");
    changed_identity.terminal_id = "different-terminal-id".to_string();
    assert!(session_store
        .persist_terminal_turn_record(&changed_identity)
        .is_err());

    let mut changed_output = terminal_input("turn-1");
    changed_output.assistant_text = Some("Different answer".to_string());
    assert!(session_store
        .persist_terminal_turn_record(&changed_output)
        .is_err());

    let mut changed_outcome = terminal_input("turn-1");
    changed_outcome.outcome = SessionTurnOutcome::Failed;
    assert!(session_store
        .persist_terminal_turn_record(&changed_outcome)
        .is_err());

    let delivery = CompletionDeliveryStore::new(db)
        .find("terminal-turn-1")
        .expect("find original")
        .expect("original remains");
    assert_eq!(delivery.outcome, SessionTurnOutcome::Completed);
    assert_eq!(delivery.assistant_text.as_deref(), Some("Useful answer"));
}

#[test]
fn terminal_port_rejects_malformed_batches_without_writes() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let session_store = SessionStore::new(db.clone());

    let mut cross_session = terminal_input("turn-1");
    cross_session.events[0].session_id = "parent-1".to_string();
    assert!(session_store
        .persist_terminal_turn_record(&cross_session)
        .is_err());

    let mut wrong_start = terminal_input("turn-1");
    wrong_start.events[0].seq = 2;
    assert!(session_store
        .persist_terminal_turn_record(&wrong_start)
        .is_err());

    let mut gapped = terminal_input("turn-1");
    gapped.outcome = SessionTurnOutcome::Failed;
    gapped.events[0].event_type = "error".to_string();
    gapped.events[0].payload_json = r#"{"type":"error","message":"provider failed"}"#.to_string();
    let mut gapped_end = gapped.events[0].clone();
    gapped_end.seq = 3;
    gapped_end.event_type = "turn_ended".to_string();
    gapped_end.payload_json = r#"{"type":"turn_ended","stopReason":"end_turn"}"#.to_string();
    gapped.events.push(gapped_end);
    assert!(session_store.persist_terminal_turn_record(&gapped).is_err());

    let mut wrong_outcome = terminal_input("turn-1");
    wrong_outcome.events[0].payload_json =
        r#"{"type":"turn_ended","stopReason":"cancelled"}"#.to_string();
    assert!(session_store
        .persist_terminal_turn_record(&wrong_outcome)
        .is_err());

    db.with_conn(|conn| {
        let events: i64 =
            conn.query_row("SELECT COUNT(*) FROM session_events", [], |row| row.get(0))?;
        let deliveries: i64 = conn.query_row(
            "SELECT COUNT(*) FROM session_link_completion_deliveries",
            [],
            |row| row.get(0),
        )?;
        assert_eq!((events, deliveries), (0, 0));
        Ok(())
    })
    .expect("verify malformed batches were atomic no-ops");
}

#[test]
fn promotion_orders_against_capture_and_snapshot_survives_cascade() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let store = CompletionDeliveryStore::new(db.clone());
    let delivery = persist_delivery(&db, "turn-1");
    db.with_conn(|conn| {
        conn.execute("DELETE FROM session_links WHERE id = 'link-1'", [])?;
        Ok(())
    })
    .expect("promote child");
    assert!(store
        .find(&delivery.delivery_id)
        .expect("find delivery")
        .is_some());
    let mut post_promotion_terminal = terminal_input("turn-2");
    post_promotion_terminal.events[0].seq = 2;
    SessionStore::new(db.clone())
        .persist_terminal_turn_record(&post_promotion_terminal)
        .expect("terminal after promotion");
    assert!(store
        .find("terminal-turn-2")
        .expect("find absent delivery")
        .is_none());
    SessionStore::new(db.clone())
        .persist_terminal_turn_record(&terminal_input("turn-1"))
        .expect("retry captured terminal after promotion");
}

#[test]
fn failed_outbox_insert_rolls_back_terminal_event() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TRIGGER fail_delivery_insert
             BEFORE INSERT ON session_link_completion_deliveries
             BEGIN SELECT RAISE(ABORT, 'failpoint'); END;",
        )?;
        Ok(())
    })
    .expect("install failpoint");
    let session_store = SessionStore::new(db.clone());
    assert!(session_store
        .persist_terminal_turn_record(&terminal_input("turn-1"))
        .is_err());
    db.with_conn(|conn| {
        let events: i64 =
            conn.query_row("SELECT COUNT(*) FROM session_events", [], |row| row.get(0))?;
        let deliveries: i64 = conn.query_row(
            "SELECT COUNT(*) FROM session_link_completion_deliveries",
            [],
            |row| row.get(0),
        )?;
        assert_eq!((events, deliveries), (0, 0));
        conn.execute_batch("DROP TRIGGER fail_delivery_insert")?;
        Ok(())
    })
    .expect("verify rollback");
    session_store
        .persist_terminal_turn_record(&terminal_input("turn-1"))
        .expect("retry after removing failpoint");
    assert!(CompletionDeliveryStore::new(db)
        .find("terminal-turn-1")
        .expect("find delivery")
        .is_some());
}

#[test]
fn terminal_capture_adopts_existing_completion_projection_identity() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_link_completions (
                completion_id, session_link_id, child_turn_id, child_last_event_seq,
                outcome, created_at, updated_at
             ) VALUES ('legacy-completion', 'link-1', 'turn-1', 1, 'completed', ?1, ?1)",
            ["2026-08-11T00:01:00Z"],
        )?;
        Ok(())
    })
    .expect("seed legacy completion");

    let delivery = persist_delivery(&db, "turn-1");
    assert_eq!(delivery.delivery_id, "terminal-turn-1");
    assert_eq!(delivery.completion_id, "legacy-completion");
    let store = CompletionDeliveryStore::new(db.clone());
    store
        .claim_next_due("2026-08-11T00:02:00Z", "2026-08-11T00:03:00Z", "worker-1")
        .expect("claim")
        .expect("delivery claimed");
    let expected_parent_prompt_seq = match store
        .enqueue_claimed_canonical(
            &delivery.delivery_id,
            "worker-1",
            "2026-08-11T00:02:01Z",
            "2026-08-11T00:02:02Z",
        )
        .expect("enqueue canonical")
    {
        super::enqueue::ClaimedDeliveryEnqueueOutcome::Enqueued { pending, .. } => pending.seq,
        _ => panic!("expected enqueue"),
    };
    db.with_conn(|conn| {
        let projected_parent_prompt_seq: Option<i64> = conn.query_row(
            "SELECT parent_prompt_seq FROM session_link_completions
             WHERE completion_id = 'legacy-completion'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(
            projected_parent_prompt_seq,
            Some(expected_parent_prompt_seq)
        );
        Ok(())
    })
    .expect("verify actual projection updated");
}

#[test]
fn projection_failure_after_terminal_commit_reuses_exact_ids_on_retry() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TRIGGER fail_completion_projection
             BEFORE INSERT ON session_link_completions
             BEGIN SELECT RAISE(ABORT, 'projection-failpoint'); END;",
        )?;
        Ok(())
    })
    .expect("install projection failpoint");
    let store = CompletionDeliveryStore::new(db.clone());
    assert!(store.ensure_completion_projection(&delivery).is_err());
    assert!(store
        .find(&delivery.delivery_id)
        .expect("find durable intent")
        .is_some());
    db.with_conn(|conn| {
        conn.execute_batch("DROP TRIGGER fail_completion_projection")?;
        Ok(())
    })
    .expect("remove projection failpoint");
    assert!(store
        .ensure_completion_projection(&delivery)
        .expect("retry projection"));
    db.with_conn(|conn| {
        let projection: (String, i64) = conn.query_row(
            "SELECT completion_id, child_last_event_seq
             FROM session_link_completions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(projection, (delivery.completion_id.clone(), 1));
        Ok(())
    })
    .expect("verify one exact projection");
}

#[test]
fn projection_rejects_completion_identity_collision_on_another_link() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at,
                subagents_enabled
             ) VALUES ('child-2', 'workspace-1', 'claude', 'idle', ?1, ?1, 1)",
            ["2026-08-11T00:00:00Z"],
        )?;
        conn.execute(
            "INSERT INTO session_links (
                id, public_id, relation, parent_session_id, child_session_id,
                workspace_relation, label, created_at
             ) VALUES (
                'link-2', 'subagent-2', 'subagent', 'parent-1', 'child-2',
                'same_workspace', 'Other', ?1
             )",
            ["2026-08-11T00:00:00Z"],
        )?;
        conn.execute(
            "INSERT INTO session_link_completions (
                completion_id, session_link_id, child_turn_id, child_last_event_seq,
                outcome, created_at, updated_at
             ) VALUES (?1, 'link-2', 'other-turn', 7, 'completed', ?2, ?2)",
            params![delivery.completion_id, "2026-08-11T00:01:00Z"],
        )?;
        Ok(())
    })
    .expect("seed unrelated completion identity collision");

    let store = CompletionDeliveryStore::new(db.clone());
    assert!(store.ensure_completion_projection(&delivery).is_err());
    db.with_conn(|conn| {
        let target_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM session_link_completions
             WHERE session_link_id = 'link-1' AND child_turn_id = 'turn-1'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(target_count, 0);
        Ok(())
    })
    .expect("verify target projection was not fabricated");
}

#[test]
fn expiring_claim_allows_only_one_worker_then_recovers() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let store = CompletionDeliveryStore::new(db.clone());
    persist_delivery(&db, "turn-1");

    let first = store
        .claim_next_due("2026-08-11T00:02:00Z", "2026-08-11T00:03:00Z", "worker-1")
        .expect("first claim")
        .expect("delivery claimed");
    assert_eq!(first.attempt_count, 1);
    assert!(store
        .claim_next_due("2026-08-11T00:02:30Z", "2026-08-11T00:03:30Z", "worker-2",)
        .expect("parallel claim")
        .is_none());

    let recovered = store
        .claim_next_due("2026-08-11T00:03:00Z", "2026-08-11T00:04:00Z", "worker-2")
        .expect("expired claim recovery")
        .expect("delivery reclaimed");
    assert_eq!(recovered.delivery_id, first.delivery_id);
    assert_eq!(recovered.attempt_count, 2);
}

#[test]
fn mobility_round_trip_recreates_missing_canonical_row_beside_same_seq_id_collision() {
    let source = Db::open_in_memory().expect("open source db");
    seed_link(&source, false);
    let source_store = CompletionDeliveryStore::new(source.clone());
    let delivery = persist_delivery(&source, "turn-1");
    source_store
        .claim_next_due("2026-08-11T00:02:00Z", "2026-08-11T00:03:00Z", "worker-1")
        .expect("claim delivery")
        .expect("delivery claimed");
    assert!(matches!(
        source_store
            .enqueue_claimed_canonical(
                &delivery.delivery_id,
                "worker-1",
                "2026-08-11T00:02:01Z",
                "2026-08-11T00:02:02Z",
            )
            .expect("enqueue canonical"),
        super::enqueue::ClaimedDeliveryEnqueueOutcome::Enqueued { .. }
    ));
    source
        .with_conn(|conn| {
            conn.execute("DELETE FROM session_links WHERE id = 'link-1'", [])?;
            Ok(())
        })
        .expect("promote child");

    let exported = source_store
        .list_for_parent_sessions(&["parent-1".to_string()])
        .expect("export deliveries");
    assert_eq!(exported.len(), 1);
    assert_eq!(exported[0].state, CompletionDeliveryState::Enqueued);

    let destination = Db::open_in_memory().expect("open destination db");
    test_support::seed_workspace_with_repo_root(
        &destination,
        "workspace-1",
        "local",
        "/tmp/completion-delivery-destination",
    );
    destination
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at,
                    subagents_enabled
                 ) VALUES ('parent-1', 'workspace-1', 'claude', 'idle', ?1, ?1, 1)",
                ["2026-08-11T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed destination parent");
    let destination_store = CompletionDeliveryStore::new(destination.clone());
    destination_store
        .import(&exported[0])
        .expect("import delivery without link or child");
    let imported = destination_store
        .find(&delivery.delivery_id)
        .expect("find imported delivery")
        .expect("delivery imported");
    assert_eq!(imported, exported[0]);

    // Queue rows are not part of the mobility delivery export. Reuse the
    // imported sequence with an ordinary same-id row to prove the worker does
    // not treat either raw identity as authority when it recreates the wake.
    let destination_sessions = SessionStore::new(destination.clone());
    let ordinary = destination_sessions
        .insert_pending_prompt(
            &delivery.parent_session_id,
            "ordinary destination collision",
            Some(&delivery.prompt_id()),
        )
        .expect("insert ordinary collision");
    assert_eq!(Some(ordinary.seq), imported.parent_prompt_seq);
    destination_store
        .claim_next_due("2026-08-11T00:02:02Z", "2026-08-11T00:03:02Z", "worker-2")
        .expect("claim imported delivery")
        .expect("imported delivery due");
    let (reenqueued, canonical) = match destination_store
        .enqueue_claimed_canonical(
            &delivery.delivery_id,
            "worker-2",
            "2026-08-11T00:02:02Z",
            "2026-08-11T00:02:04Z",
        )
        .expect("recreate imported wake")
    {
        super::enqueue::ClaimedDeliveryEnqueueOutcome::Enqueued {
            delivery,
            pending,
            inserted: true,
            ..
        } => (delivery, pending),
        outcome => panic!("expected inserted enqueue, got {outcome:?}"),
    };
    assert_ne!(canonical.seq, ordinary.seq);
    assert!(super::canonical::pending_prompt_matches_delivery(
        &canonical,
        &reenqueued
    ));
    let queue = destination_sessions
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("destination queue");
    assert_eq!(queue.len(), 2);
    assert!(queue.iter().any(|row| row == &ordinary));
    assert!(queue.iter().any(|row| row == &canonical));
    destination
        .with_conn(|conn| {
            let links: i64 =
                conn.query_row("SELECT COUNT(*) FROM session_links", [], |row| row.get(0))?;
            let completions: i64 =
                conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                    row.get(0)
                })?;
            assert_eq!((links, completions), (0, 0));
            Ok(())
        })
        .expect("verify independent delivery import");
}
