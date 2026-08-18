use super::*;

#[test]
fn older_retry_yields_to_every_newer_terminal_wake() {
    for newer_outcome in [
        SessionTurnOutcome::Completed,
        SessionTurnOutcome::Failed,
        SessionTurnOutcome::Cancelled,
    ] {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        let first = persist_delivery_for_started_turn(
            &db,
            "turn-1",
            1,
            "2026-08-11T00:01:10Z",
            "2026-08-11T00:02:00Z",
            SessionTurnOutcome::Completed,
        );
        let second = persist_delivery_for_started_turn(
            &db,
            "turn-2",
            3,
            "2026-08-11T00:02:05Z",
            "2026-08-11T00:02:10Z",
            newer_outcome,
        );
        let store = CompletionDeliveryStore::new(db.clone());

        let first_claim = store
            .claim_next_due("2026-08-11T00:02:15Z", "2026-08-11T00:02:45Z", "worker-1")
            .expect("claim first")
            .expect("first delivery due");
        assert_eq!(first_claim.delivery_id, first.delivery_id);
        let second_claim = store
            .claim_next_due("2026-08-11T00:02:15Z", "2026-08-11T00:02:45Z", "worker-2")
            .expect("claim second")
            .expect("second delivery due while first is leased");
        assert_eq!(second_claim.delivery_id, second.delivery_id);
        let second_pending = match store
            .enqueue_claimed_canonical(
                &second.delivery_id,
                "worker-2",
                "2026-08-11T00:02:15Z",
                "2026-08-11T00:02:17Z",
            )
            .expect("enqueue newer wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                delivery, pending, ..
            } => {
                assert_eq!(delivery.outcome, newer_outcome);
                pending
            }
            _ => panic!("expected newer enqueue"),
        };

        let reclaimed = store
            .claim_next_due("2026-08-11T00:02:46Z", "2026-08-11T00:03:16Z", "worker-3")
            .expect("reclaim first")
            .expect("older delivery due after lease expiry");
        assert_eq!(reclaimed.delivery_id, first.delivery_id);
        let outcome = store
            .enqueue_claimed_canonical(
                &first.delivery_id,
                "worker-3",
                "2026-08-11T00:02:46Z",
                "2026-08-11T00:02:48Z",
            )
            .expect("coalesce reverse-order retry");
        assert!(matches!(
            outcome,
            ClaimedDeliveryEnqueueOutcome::Suppressed {
                reason: CompletionWakeSuppressionReason::Coalesced,
                ..
            }
        ));

        let queue = SessionStore::new(db)
            .list_pending_prompts(&first.parent_session_id)
            .expect("queue");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].seq, second_pending.seq);
        let retired = store.find(&first.delivery_id).expect("first").expect("row");
        assert_eq!(retired.state, CompletionDeliveryState::Delivered);
        assert!(retired.parent_prompt_seq.is_none());
    }
}
