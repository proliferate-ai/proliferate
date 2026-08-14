use super::completion_wake::completion_wake_fixture;
use super::*;

use crate::domains::sessions::prompt::StoredPromptBlock;
use crate::live::sessions::sink::AcpChunkPayload;
use anyharness_contract::v1::StopReason as TranscriptStopReason;
use serde_json::json;

#[tokio::test]
async fn forged_text_or_missing_attachment_wake_is_discarded_before_acp() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            for forge_attachment in [false, true] {
                let (db, store, delivery, pending) = completion_wake_fixture();
                let blocks_json = serde_json::to_string(&vec![
                    StoredPromptBlock::Text {
                        text: delivery.notification_text.clone(),
                    },
                    StoredPromptBlock::Image {
                        attachment_id: "missing-attachment".into(),
                        mime_type: "image/png".into(),
                        name: None,
                        uri: None,
                        size: 1,
                        source: None,
                    },
                ])
                .expect("forged blocks json");
                db.with_conn(|conn| {
                    if forge_attachment {
                        conn.execute(
                            "UPDATE session_pending_prompts SET blocks_json = ?3
                             WHERE session_id = ?1 AND seq = ?2",
                            rusqlite::params![SESSION_ID, pending.seq, blocks_json],
                        )?;
                    } else {
                        conn.execute(
                            "UPDATE session_pending_prompts SET text = 'forged'
                             WHERE session_id = ?1 AND seq = ?2",
                            rusqlite::params![SESSION_ID, pending.seq],
                        )?;
                    }
                    Ok(())
                })
                .expect("forge internal row");
                let forged = store
                    .find_pending_prompt(SESSION_ID, pending.seq)
                    .expect("pending")
                    .expect("row");
                let mut harness =
                    spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
                let (respond_to, response_rx) = oneshot::channel();
                assert!(harness
                    .actor
                    .run_turn(
                        ActivePromptRequest {
                            payload: forged.prompt_payload(),
                            prompt_id: forged.prompt_id.clone(),
                            from_queue_seq: Some(forged.seq),
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
                assert!(store.list_events(SESSION_ID).expect("events").is_empty());
                assert!(store
                    .find_pending_prompt(SESSION_ID, pending.seq)
                    .expect("pending")
                    .is_none());
                assert_eq!(
                    CompletionDeliveryStore::new(db)
                        .find(&delivery.delivery_id)
                        .expect("delivery")
                        .expect("row")
                        .state,
                    CompletionDeliveryState::Enqueued
                );
            }
        })
        .await;
}

#[tokio::test]
async fn active_delivery_lease_is_stale_and_never_reaches_acp() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (db, store, delivery, pending) = completion_wake_fixture();
            CompletionDeliveryStore::new(db.clone())
                .claim_next_due("2026-08-11T00:02:02Z", "2026-08-11T00:02:32Z", "worker-2")
                .expect("claim enqueued delivery")
                .expect("delivery due");
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
            assert!(store.list_events(SESSION_ID).expect("events").is_empty());
            assert!(store
                .find_pending_prompt(SESSION_ID, pending.seq)
                .expect("pending")
                .is_some());
            let stale = CompletionDeliveryStore::new(db)
                .find(&delivery.delivery_id)
                .expect("delivery")
                .expect("row");
            assert_eq!(stale.state, CompletionDeliveryState::Enqueued);
            assert_eq!(stale.lease_token.as_deref(), Some("worker-2"));
        })
        .await;
}

#[tokio::test]
async fn stale_snapshot_after_committed_admission_never_dispatches_twice() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (db, store, delivery, pending) = completion_wake_fixture();
            let mut first = spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
            {
                let (accepted_tx, accepted_rx) = oneshot::channel();
                let Harness {
                    actor,
                    command_rx,
                    notification_rx,
                    background_work_rx,
                    prompt_responder_rx,
                    ..
                } = &mut first;
                let first_run = actor.run_turn(
                    ActivePromptRequest {
                        payload: pending.prompt_payload(),
                        prompt_id: pending.prompt_id.clone(),
                        from_queue_seq: Some(pending.seq),
                        respond_to: accepted_tx,
                    },
                    command_rx,
                    notification_rx,
                    background_work_rx,
                );
                tokio::pin!(first_run);
                let responder = tokio::time::timeout(Duration::from_secs(5), async {
                    tokio::select! {
                        responder = prompt_responder_rx.recv() => responder.expect("first prompt"),
                        disposition = &mut first_run => panic!(
                            "first turn ended before ACP dispatch: {disposition:?}"
                        ),
                    }
                })
                .await
                .expect("first ACP prompt");
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
                    .expect("finish first prompt");
                assert!(tokio::time::timeout(Duration::from_secs(5), &mut first_run)
                    .await
                    .expect("first turn completed")
                    .is_none());
            }
            drop(first);

            let event_count = store.list_events(SESSION_ID).expect("events").len();
            assert!(store
                .find_pending_prompt(SESSION_ID, pending.seq)
                .expect("pending")
                .is_none());
            let mut stale = spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
            let (respond_to, response_rx) = oneshot::channel();
            assert!(stale
                .actor
                .run_turn(
                    ActivePromptRequest {
                        payload: pending.prompt_payload(),
                        prompt_id: pending.prompt_id.clone(),
                        from_queue_seq: Some(pending.seq),
                        respond_to,
                    },
                    &mut stale.command_rx,
                    &mut stale.notification_rx,
                    &mut stale.background_work_rx,
                )
                .await
                .is_none());
            assert!(response_rx.await.is_err());
            assert!(matches!(
                stale.prompt_responder_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ));
            assert_eq!(
                store.list_events(SESSION_ID).expect("events").len(),
                event_count
            );
            assert_eq!(
                CompletionDeliveryStore::new(db)
                    .find(&delivery.delivery_id)
                    .expect("delivery")
                    .expect("row")
                    .state,
                CompletionDeliveryState::Delivered
            );
        })
        .await;
}

#[tokio::test]
async fn completion_wake_sweeps_dangling_engine_turn_before_one_acp_dispatch() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (db, store, delivery, pending) = completion_wake_fixture();
            let mut harness =
                spawn_harness_with_store(store.clone(), SessionHooks::default()).await;
            {
                let mut sink = harness.actor.event_sink.lock().await;
                sink.begin_turn("earlier prompt".into(), None, Vec::new(), None)
                    .expect("begin earlier prompt");
                sink.turn_ended(TranscriptStopReason::EndTurn);
                sink.agent_message_chunk(AcpChunkPayload {
                    content: json!("engine continuation"),
                    ..Default::default()
                });
                assert!(sink.current_turn_id().is_some());
            }

            let (accepted_tx, accepted_rx) = oneshot::channel();
            let Harness {
                actor,
                command_rx,
                notification_rx,
                background_work_rx,
                prompt_responder_rx,
                ..
            } = &mut harness;
            let run = actor.run_turn(
                ActivePromptRequest {
                    payload: pending.prompt_payload(),
                    prompt_id: pending.prompt_id.clone(),
                    from_queue_seq: Some(pending.seq),
                    respond_to: accepted_tx,
                },
                command_rx,
                notification_rx,
                background_work_rx,
            );
            tokio::pin!(run);
            let responder = tokio::time::timeout(Duration::from_secs(5), async {
                tokio::select! {
                    responder = prompt_responder_rx.recv() => responder.expect("prompt responder"),
                    disposition = &mut run => panic!(
                        "completion wake ended before ACP dispatch: {disposition:?}"
                    ),
                }
            })
            .await
            .expect("one ACP prompt");
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
            assert!(tokio::time::timeout(Duration::from_secs(5), &mut run)
                .await
                .expect("turn completed")
                .is_none());
            assert!(matches!(
                prompt_responder_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ));
            assert_eq!(
                CompletionDeliveryStore::new(db)
                    .find(&delivery.delivery_id)
                    .expect("delivery")
                    .expect("row")
                    .state,
                CompletionDeliveryState::Delivered
            );
        })
        .await;
}
