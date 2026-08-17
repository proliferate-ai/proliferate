use super::*;

fn persist_delivery_with_outcome(
    db: &Db,
    turn_id: &str,
    event_seq: i64,
    completed_at: &str,
    outcome: SessionTurnOutcome,
) -> CompletionDeliveryRecord {
    SessionStore::new(db.clone())
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: format!("terminal-{turn_id}"),
            session_id: "child-1".into(),
            turn_id: turn_id.into(),
            outcome,
            assistant_text: Some(format!("{turn_id} output")),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: "child-1".into(),
                seq: event_seq,
                timestamp: completed_at.into(),
                turn_id: Some(turn_id.into()),
                item_id: None,
                event_type: "turn_ended".into(),
                payload_json: format!(
                    r#"{{"type":"turn_ended","stopReason":"{}"}}"#,
                    if outcome == SessionTurnOutcome::Cancelled {
                        "cancelled"
                    } else {
                        "end_turn"
                    }
                ),
            }],
            completed_at: completed_at.into(),
        })
        .expect("persist terminal turn through production capture");
    CompletionDeliveryStore::new(db.clone())
        .find(&format!("terminal-{turn_id}"))
        .expect("find captured delivery")
        .expect("delivery captured")
}

#[test]
fn older_actionable_wakes_remain_drainable_when_a_later_completion_is_enqueued() {
    for actionable_outcome in [SessionTurnOutcome::Failed, SessionTurnOutcome::Cancelled] {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        let delivery_store = CompletionDeliveryStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let actionable = persist_delivery_with_outcome(
            &db,
            "turn-actionable",
            1,
            "2026-08-11T00:02:00Z",
            actionable_outcome,
        );
        delivery_store
            .claim_next_due(
                "2026-08-11T00:02:00Z",
                "2026-08-11T00:02:30Z",
                "worker-actionable",
            )
            .expect("claim actionable delivery")
            .expect("actionable delivery due");
        let actionable_pending = match delivery_store
            .enqueue_claimed_canonical(
                &actionable.delivery_id,
                "worker-actionable",
                "2026-08-11T00:02:00Z",
                "2999-01-01T00:00:00Z",
            )
            .expect("enqueue actionable wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                pending,
                superseded_delivery_id,
                ..
            } => {
                assert!(superseded_delivery_id.is_none());
                pending
            }
            _ => panic!("expected actionable wake enqueue"),
        };

        let completed = persist_delivery_with_outcome(
            &db,
            "turn-completed",
            2,
            "2026-08-11T00:03:00Z",
            SessionTurnOutcome::Completed,
        );
        let claimed = delivery_store
            .claim_next_due(
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:35Z",
                "worker-completed",
            )
            .expect("claim later completion")
            .expect("later completion due");
        assert_eq!(claimed.delivery_id, completed.delivery_id);
        let completed_pending = match delivery_store
            .enqueue_claimed_canonical(
                &completed.delivery_id,
                "worker-completed",
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:07Z",
            )
            .expect("enqueue later completed wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                pending,
                inserted,
                superseded_delivery_id,
                ..
            } => {
                assert!(inserted);
                assert!(superseded_delivery_id.is_none());
                pending
            }
            _ => panic!("expected independent completed wake enqueue"),
        };

        // These are real SQLite queue rows produced by terminal capture,
        // outbox claim, and canonical enqueue. Admitting the actionable row
        // proves a later completion did not merely leave an orphaned prompt.
        assert_ne!(actionable_pending.seq, completed_pending.seq);
        assert_eq!(
            session_store
                .list_pending_prompts(&actionable.parent_session_id)
                .expect("durable queue"),
            vec![actionable_pending.clone(), completed_pending.clone()]
        );
        assert_eq!(
            session_store
                .persist_subagent_wake_turn_record(&staged_input(
                    &actionable,
                    &actionable_pending,
                    1,
                ))
                .expect("admit actionable wake"),
            DurableSubagentWakeTurnOutcome::Admitted
        );
        let delivered = delivery_store
            .find(&actionable.delivery_id)
            .expect("find actionable delivery")
            .expect("actionable delivery remains");
        assert_eq!(delivered.outcome, actionable_outcome);
        assert_eq!(delivered.parent_prompt_seq, Some(actionable_pending.seq));
        assert_eq!(
            delivered.parent_turn_id.as_deref(),
            Some("parent-turn-admitted")
        );
        assert_eq!(
            session_store
                .list_pending_prompts(&completed.parent_session_id)
                .expect("remaining queue"),
            vec![completed_pending]
        );
    }
}

#[test]
fn later_actionable_wakes_adopt_only_an_eligible_completed_sibling() {
    for actionable_outcome in [SessionTurnOutcome::Failed, SessionTurnOutcome::Cancelled] {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        let delivery_store = CompletionDeliveryStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let completed = persist_delivery_with_outcome(
            &db,
            "turn-completed",
            1,
            "2026-08-11T00:02:00Z",
            SessionTurnOutcome::Completed,
        );
        delivery_store
            .claim_next_due(
                "2026-08-11T00:02:00Z",
                "2026-08-11T00:02:30Z",
                "worker-completed",
            )
            .expect("claim completed delivery")
            .expect("completed delivery due");
        let completed_pending = match delivery_store
            .enqueue_claimed_canonical(
                &completed.delivery_id,
                "worker-completed",
                "2026-08-11T00:02:00Z",
                "2999-01-01T00:00:00Z",
            )
            .expect("enqueue completed wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued { pending, .. } => pending,
            _ => panic!("expected completed wake enqueue"),
        };

        let actionable = persist_delivery_with_outcome(
            &db,
            "turn-actionable",
            2,
            "2026-08-11T00:03:00Z",
            actionable_outcome,
        );
        delivery_store
            .claim_next_due(
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:35Z",
                "worker-actionable",
            )
            .expect("claim later actionable delivery")
            .expect("later actionable delivery due");
        let (enqueued, rewritten) = match delivery_store
            .enqueue_claimed_canonical(
                &actionable.delivery_id,
                "worker-actionable",
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:07Z",
            )
            .expect("enqueue later actionable wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                delivery,
                pending,
                inserted,
                superseded_delivery_id,
            } => {
                assert!(!inserted);
                assert_eq!(
                    superseded_delivery_id.as_deref(),
                    Some(completed.delivery_id.as_str())
                );
                (delivery, pending)
            }
            _ => panic!("expected actionable wake to adopt completed queue row"),
        };
        assert_eq!(rewritten.seq, completed_pending.seq);
        assert_eq!(enqueued.outcome, actionable_outcome);

        // The failed/cancelled result is the canonical durable payload that
        // admission accepts, so newest-wins never turns it into suppression.
        assert_eq!(
            session_store
                .persist_subagent_wake_turn_record(&staged_input(&enqueued, &rewritten, 1))
                .expect("admit later actionable wake"),
            DurableSubagentWakeTurnOutcome::Admitted
        );
        let delivered = delivery_store
            .find(&actionable.delivery_id)
            .expect("find actionable delivery")
            .expect("actionable delivery remains");
        assert_eq!(delivered.state, CompletionDeliveryState::Delivered);
        assert_eq!(delivered.outcome, actionable_outcome);
        assert_eq!(delivered.parent_prompt_seq, Some(rewritten.seq));
        assert_eq!(
            delivered.parent_turn_id.as_deref(),
            Some("parent-turn-admitted")
        );
    }
}
