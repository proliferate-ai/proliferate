use super::*;

use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::store::completion_deliveries::{
    CompletionDeliveryRecord, DurableTerminalTurn,
};

fn append_legacy_visible_turn(
    store: &SessionStore,
    delivery: &CompletionDeliveryRecord,
    pending: &crate::domains::sessions::model::PendingPromptRecord,
) {
    let payload = pending.prompt_payload();
    let item = anyharness_contract::v1::TranscriptItemPayload {
        kind: anyharness_contract::v1::TranscriptItemKind::UserMessage,
        status: anyharness_contract::v1::TranscriptItemStatus::Completed,
        source_agent_kind: "claude".into(),
        is_transient: false,
        message_id: None,
        prompt_id: Some(delivery.prompt_id()),
        title: None,
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: None,
        raw_input: None,
        raw_output: None,
        content_parts: payload.content_parts(),
        prompt_provenance: payload.public_provenance(),
    };
    for (seq, event, item_id) in [
        (
            1,
            SessionEvent::TurnStarted(anyharness_contract::v1::TurnStartedEvent::default()),
            None,
        ),
        (
            2,
            SessionEvent::ItemStarted(anyharness_contract::v1::ItemStartedEvent {
                item: item.clone(),
            }),
            Some("legacy-item"),
        ),
        (
            3,
            SessionEvent::ItemCompleted(anyharness_contract::v1::ItemCompletedEvent { item }),
            Some("legacy-item"),
        ),
    ] {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: SESSION_ID.into(),
                seq,
                timestamp: format!("2026-08-11T00:03:0{seq}Z"),
                event_type: event.event_type().into(),
                turn_id: Some("legacy-parent-turn".into()),
                item_id: item_id.map(str::to_string),
                payload_json: serde_json::to_string(&event).expect("event json"),
            })
            .expect("append legacy turn");
    }
}

pub(super) fn completion_wake_fixture() -> (
    Db,
    SessionStore,
    CompletionDeliveryRecord,
    crate::domains::sessions::model::PendingPromptRecord,
) {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace_with_repo_root(&db, WORKSPACE_ID, "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store
        .insert(&test_session_record())
        .expect("parent session");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at,
                subagents_enabled
             ) VALUES (
                'child-1', ?1, 'claude', 'idle', '2026-08-11T00:00:00Z',
                '2026-08-11T00:00:00Z', 1
             )",
            [WORKSPACE_ID],
        )?;
        conn.execute(
            "INSERT INTO session_links (
                id, public_id, relation, parent_session_id, child_session_id,
                workspace_relation, label, created_at
             ) VALUES (
                'link-1', 'subagent-1', 'subagent', ?1, 'child-1',
                'same_workspace', 'Researcher', '2026-08-11T00:00:00Z'
             )",
            [SESSION_ID],
        )?;
        Ok(())
    })
    .expect("subagent link");
    store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: "delivery-1".into(),
            session_id: "child-1".into(),
            turn_id: "child-turn-1".into(),
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("Useful answer".into()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: "child-1".into(),
                seq: 1,
                timestamp: "2026-08-11T00:01:00Z".into(),
                event_type: "turn_ended".into(),
                turn_id: Some("child-turn-1".into()),
                item_id: None,
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.into(),
            }],
            completed_at: "2026-08-11T00:01:00Z".into(),
        })
        .expect("capture delivery");
    let delivery_store = CompletionDeliveryStore::new(db.clone());
    delivery_store
        .claim_next_due("2026-08-11T00:02:00Z", "2026-08-11T00:02:30Z", "worker-1")
        .expect("claim")
        .expect("claimed");
    let (delivery, pending) = match delivery_store
        .enqueue_claimed_canonical(
            "delivery-1",
            "worker-1",
            "2026-08-11T00:02:00Z",
            "2026-08-11T00:02:02Z",
        )
        .expect("enqueue")
    {
        crate::domains::sessions::store::completion_deliveries::enqueue::ClaimedDeliveryEnqueueOutcome::Enqueued {
            delivery,
            pending,
            ..
        } => (delivery, pending),
        _ => panic!("expected enqueued delivery"),
    };
    (db, store, delivery, pending)
}

async fn assert_failpoint_has_no_acp_then_retries_once(trigger_name: &str, trigger_sql: &str) {
    let (db, store, delivery, pending) = completion_wake_fixture();
    db.with_conn(|conn| conn.execute_batch(trigger_sql))
        .expect("install admission failpoint");
    let mut harness = spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
    let payload = pending.prompt_payload();

    let (failed_tx, failed_rx) = oneshot::channel();
    let disposition = harness
        .actor
        .run_turn(
            ActivePromptRequest {
                payload: payload.clone(),
                prompt_id: pending.prompt_id.clone(),
                from_queue_seq: Some(pending.seq),
                respond_to: failed_tx,
            },
            &mut harness.command_rx,
            &mut harness.notification_rx,
            &mut harness.background_work_rx,
        )
        .await;
    assert!(disposition.is_none());
    assert!(failed_rx.await.expect("failed response").is_err());
    assert!(matches!(
        harness.prompt_responder_rx.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
    assert!(store.list_events(SESSION_ID).expect("events").is_empty());
    assert!(store
        .find_pending_prompt(SESSION_ID, pending.seq)
        .expect("pending")
        .is_some());
    assert_eq!(
        CompletionDeliveryStore::new(db.clone())
            .find(&delivery.delivery_id)
            .expect("delivery")
            .expect("row")
            .state,
        CompletionDeliveryState::Enqueued
    );

    db.with_conn(|conn| conn.execute_batch(&format!("DROP TRIGGER {trigger_name}")))
        .expect("drop failpoint");
    drop(harness);
    let mut harness = spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
    let (accepted_tx, accepted_rx) = oneshot::channel();
    let Harness {
        actor,
        command_rx,
        notification_rx,
        background_work_rx,
        prompt_responder_rx,
        ..
    } = &mut harness;
    let retry = actor.run_turn(
        ActivePromptRequest {
            payload,
            prompt_id: pending.prompt_id.clone(),
            from_queue_seq: Some(pending.seq),
            respond_to: accepted_tx,
        },
        command_rx,
        notification_rx,
        background_work_rx,
    );
    tokio::pin!(retry);
    let responder = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::select! {
            responder = prompt_responder_rx.recv() => responder.expect("prompt responder"),
            disposition = &mut retry => panic!(
                "retry turn ended before ACP dispatch: {disposition:?}"
            ),
        }
    })
    .await
    .expect("one ACP prompt after retry");
    assert!(matches!(
        accepted_rx
            .await
            .expect("accepted response")
            .expect("started"),
        PromptAcceptance::Started { .. }
    ));
    responder
        .respond(acp::schema::PromptResponse::new(
            acp::schema::StopReason::EndTurn,
        ))
        .expect("finish ACP prompt");
    assert!(tokio::time::timeout(Duration::from_secs(5), &mut retry)
        .await
        .expect("retry turn completed")
        .is_none());
    assert!(matches!(
        prompt_responder_rx.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
    let events = store.list_events(SESSION_ID).expect("events");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.event_type == "item_completed")
            .count(),
        1
    );
    assert_eq!(
        CompletionDeliveryStore::new(db)
            .find(&delivery.delivery_id)
            .expect("delivery")
            .expect("row")
            .state,
        CompletionDeliveryState::Delivered
    );
}

#[tokio::test]
async fn completion_wake_admission_failpoints_never_reach_acp_and_retry_once() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            for (trigger_name, trigger_sql) in [
                (
                    "fail_actor_queue_delete",
                    "CREATE TRIGGER fail_actor_queue_delete
                     BEFORE DELETE ON session_pending_prompts
                     BEGIN SELECT RAISE(ABORT, 'queue delete failpoint'); END;",
                ),
                (
                    "fail_actor_outbox_update",
                    "CREATE TRIGGER fail_actor_outbox_update
                     BEFORE UPDATE OF state ON session_link_completion_deliveries
                     WHEN NEW.state = 'delivered'
                     BEGIN SELECT RAISE(ABORT, 'outbox update failpoint'); END;",
                ),
            ] {
                assert_failpoint_has_no_acp_then_retries_once(trigger_name, trigger_sql).await;
            }
        })
        .await;
}

#[tokio::test]
async fn exact_legacy_visible_turn_cleans_stale_queue_without_acp() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (db, store, delivery, pending) = completion_wake_fixture();
            append_legacy_visible_turn(&store, &delivery, &pending);
            let mut harness =
                spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
            let (respond_to, response_rx) = oneshot::channel();
            assert!(harness
                .actor
                .run_turn(
                    ActivePromptRequest {
                        payload: pending.prompt_payload(),
                        prompt_id: pending.prompt_id.clone(),
                        from_queue_seq: Some(pending.seq),
                        respond_to,
                    },
                    &mut harness.command_rx,
                    &mut harness.notification_rx,
                    &mut harness.background_work_rx,
                )
                .await
                .is_none());
            assert!(response_rx.await.is_err());
            assert!(matches!(
                harness.prompt_responder_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ));
            assert!(store
                .find_pending_prompt(SESSION_ID, pending.seq)
                .expect("pending")
                .is_none());
            assert_eq!(store.list_events(SESSION_ID).expect("events").len(), 3);
            let delivered = CompletionDeliveryStore::new(db)
                .find(&delivery.delivery_id)
                .expect("delivery")
                .expect("row");
            assert_eq!(delivered.state, CompletionDeliveryState::Delivered);
            assert_eq!(
                delivered.parent_turn_id.as_deref(),
                Some("legacy-parent-turn")
            );
        })
        .await;
}

#[tokio::test]
async fn canonical_edit_delete_are_protected_while_ordinary_collision_reorder_and_steer_work() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (db, store, delivery, canonical) = completion_wake_fixture();
            let ordinary = store
                .insert_pending_prompt(
                    SESSION_ID,
                    "ordinary collision",
                    Some(&delivery.prompt_id()),
                )
                .expect("ordinary same-prefix row");
            let harness = spawn_harness_with_store(store.clone(), SessionHooks::default()).await;

            assert!(matches!(
                harness
                    .actor
                    .handle_edit_pending_prompt(
                        canonical.seq,
                        PromptPayload::text("forged edit".into()),
                    )
                    .await,
                Err(crate::live::sessions::actor::command::QueueMutationError::Protected)
            ));
            assert!(matches!(
                harness
                    .actor
                    .handle_delete_pending_prompt(canonical.seq)
                    .await,
                Err(crate::live::sessions::actor::command::QueueMutationError::Protected)
            ));
            assert!(store
                .find_pending_prompt(SESSION_ID, canonical.seq)
                .expect("canonical")
                .is_some());
            assert_eq!(
                CompletionDeliveryStore::new(db.clone())
                    .find(&delivery.delivery_id)
                    .expect("delivery")
                    .expect("row")
                    .state,
                CompletionDeliveryState::Enqueued
            );

            harness
                .actor
                .handle_edit_pending_prompt(
                    ordinary.seq,
                    PromptPayload::text("edited ordinary".into()),
                )
                .await
                .expect("ordinary edit");
            harness
                .actor
                .handle_reorder_pending_prompts(
                    vec![canonical.seq, ordinary.seq],
                    vec![ordinary.seq, canonical.seq],
                )
                .await
                .expect("reorder canonical row");
            harness
                .actor
                .handle_steer_pending_prompt(canonical.seq, false)
                .await
                .expect("steer canonical row");
            assert_eq!(
                store
                    .list_pending_prompts(SESSION_ID)
                    .expect("ordered queue")
                    .iter()
                    .map(|record| record.seq)
                    .collect::<Vec<_>>(),
                vec![canonical.seq, ordinary.seq]
            );
            harness
                .actor
                .handle_delete_pending_prompt(ordinary.seq)
                .await
                .expect("ordinary delete");
            assert_eq!(
                store
                    .list_pending_prompts(SESSION_ID)
                    .expect("queue")
                    .iter()
                    .map(|record| record.seq)
                    .collect::<Vec<_>>(),
                vec![canonical.seq]
            );
        })
        .await;
}
