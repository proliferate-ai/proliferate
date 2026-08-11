use super::*;

#[tokio::test]
async fn active_unload_is_bounded_when_the_acp_peer_ignores_cancel() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let harness = spawn_harness().await;
            let store = harness._store.clone();
            let (handle, _turn_id, held_responder, mut cancel_rx, actor_task) =
                start_turn(harness).await;

            handle.unload_nonterminal().await.expect("unload accepted");
            let cancel = tokio::time::timeout(Duration::from_secs(1), cancel_rx.recv())
                .await
                .expect("cancel notification delivered")
                .expect("cancel notification present");
            assert_eq!(&*cancel.session_id.0, NATIVE_SESSION_ID);
            let disposition = tokio::time::timeout(Duration::from_secs(1), actor_task)
                .await
                .expect("bounded unload finished")
                .expect("actor turn task joined");
            assert!(matches!(
                disposition,
                Some(crate::live::sessions::actor::shutdown::types::ActorExitDisposition::Unload)
            ));
            drop(held_responder);

            let events = store.list_events(SESSION_ID).expect("list events");
            let event_types = events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<_>>();
            assert!(event_types.contains(&"turn_ended"));
            assert!(!event_types.contains(&"error"));
            assert!(!event_types.contains(&"session_ended"));
            let record = store
                .find_by_id(SESSION_ID)
                .expect("read session")
                .expect("session remains durable");
            assert_eq!(record.status, "idle");
            assert_eq!(record.native_session_id.as_deref(), Some(NATIVE_SESSION_ID));
            assert!(record.closed_at.is_none());
        })
        .await;
}

#[tokio::test]
async fn unload_records_cancelled_when_agent_returns_end_turn_during_grace() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let harness = spawn_harness().await;
            let store = harness._store.clone();
            let (handle, _turn_id, responder, mut cancel_rx, actor_task) =
                start_turn(harness).await;

            handle.unload_nonterminal().await.expect("unload accepted");
            tokio::time::timeout(Duration::from_secs(1), cancel_rx.recv())
                .await
                .expect("cancel delivered")
                .expect("cancel present");
            responder
                .respond(acp::schema::PromptResponse::new(
                    acp::schema::StopReason::EndTurn,
                ))
                .expect("late normal response");

            let disposition = tokio::time::timeout(Duration::from_secs(1), actor_task)
                .await
                .expect("bounded unload")
                .expect("actor task joined");
            assert!(matches!(
                disposition,
                Some(crate::live::sessions::actor::shutdown::types::ActorExitDisposition::Unload)
            ));
            let ended = store
                .list_events(SESSION_ID)
                .expect("events")
                .into_iter()
                .filter_map(|record| {
                    serde_json::from_str::<SessionEvent>(&record.payload_json).ok()
                })
                .find_map(|event| match event {
                    SessionEvent::TurnEnded(ended) => Some(ended),
                    _ => None,
                })
                .expect("turn ended");
            assert!(matches!(
                ended.stop_reason,
                anyharness_contract::v1::StopReason::Cancelled
            ));
        })
        .await;
}

#[tokio::test(flavor = "current_thread")]
async fn runtime_close_preserves_partial_output_and_records_cancelled_completion() {
    const PARENT_ID: &str = "parent-session-1";
    const PARTIAL_TEXT: &str = "partial answer before reversible close";

    let _lock = crate::app::test_support::ENV_MUTEX
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = crate::app::test_support::set_bearer_token_env(None);
    let _data_key_guard = crate::app::test_support::set_data_key_env(None);
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let runtime_home = std::env::temp_dir()
                .join(format!("subagent-runtime-close-{}", uuid::Uuid::new_v4()));
            let workspace_path = runtime_home.join("workspace");
            std::fs::create_dir_all(&workspace_path).unwrap();
            let state = AppState::new(
                runtime_home,
                "http://127.0.0.1:8457".into(),
                Db::open_in_memory().unwrap(),
                false,
                AgentSeedStore::not_configured_dev(),
            )
            .unwrap();
            seed_workspace_with_repo_root(
                &state.db,
                WORKSPACE_ID,
                "local",
                &workspace_path.to_string_lossy(),
            );

            let store = SessionStore::new(state.db.clone());
            store.insert(&test_session_record()).unwrap();
            let mut parent = test_session_record();
            parent.id = PARENT_ID.to_string();
            parent.native_session_id = Some("native-parent-1".to_string());
            store.insert(&parent).unwrap();
            let link = state
                .subagent_service
                .link_child(PARENT_ID, SESSION_ID, Some("worker".into()), None, None)
                .unwrap();

            let workspace = state
                .workspace_runtime
                .get_workspace(WORKSPACE_ID)
                .unwrap()
                .unwrap();
            let extension = state.subagent_session_hooks.clone();
            let hooks = SessionHooks {
                on_turn_finish: Some(Arc::new(move |result| {
                    extension.on_turn_finished(SessionTurnFinishedContext {
                        workspace: workspace.clone(),
                        session_id: result.session_id,
                        turn_id: result.turn_id,
                        prompt_id: result.prompt_id,
                        outcome: result.outcome,
                        stop_reason: result.stop_reason,
                        last_event_seq: result.last_event_seq,
                        error_details: result.error_details,
                    });
                })),
                on_exit: None,
            };
            let harness = spawn_harness_with_store(store.clone(), hooks).await;
            state
                .acp_manager
                .register_handle_for_test(harness.handle.clone())
                .await;

            let Harness {
                actor,
                command_rx,
                notification_rx,
                background_work_rx,
                handle,
                mut prompt_responder_rx,
                mut cancel_rx,
                agent_notification_tx,
                _store,
            } = harness;
            let manager = state.acp_manager.clone();
            let actor_task = tokio::task::spawn_local(async move {
                let _store = _store;
                let result = actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await;
                manager.remove_session(SESSION_ID).await;
                result
            });

            let accepted = handle
                .send_prompt(PromptPayload::text("do work".to_string()), None)
                .await
                .expect("prompt accepted");
            let turn_id = match accepted {
                PromptAcceptance::Started { turn_id } => turn_id,
                other => panic!("expected started prompt, got {other:?}"),
            };
            let held_responder =
                tokio::time::timeout(Duration::from_secs(2), prompt_responder_rx.recv())
                    .await
                    .expect("prompt reached fake agent")
                    .expect("prompt responder present");
            agent_notification_tx
                .send(acp::schema::SessionNotification::new(
                    NATIVE_SESSION_ID,
                    acp::schema::SessionUpdate::AgentMessageChunk(acp::schema::ContentChunk::new(
                        PARTIAL_TEXT.into(),
                    )),
                ))
                .unwrap();
            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    if store
                        .list_events(SESSION_ID)
                        .unwrap()
                        .iter()
                        .any(|event| event.payload_json.contains(PARTIAL_TEXT))
                    {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("partial assistant text persisted before close");

            let closed = state
                .session_runtime
                .close_subagent(PARENT_ID, SESSION_ID)
                .await
                .expect("runtime reversible close");
            let cancel = tokio::time::timeout(Duration::from_secs(1), cancel_rx.recv())
                .await
                .expect("ACP cancel delivered")
                .expect("cancel notification present");
            assert_eq!(&*cancel.session_id.0, NATIVE_SESSION_ID);
            actor_task.await.unwrap().unwrap();
            drop(held_responder);

            let completion_store = SubagentStore::new(state.db.clone());
            let completions = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let records = completion_store
                        .list_completions_for_links(std::slice::from_ref(&link.id))
                        .unwrap();
                    if !records.is_empty() {
                        break records;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("cancelled completion persisted");
            assert_eq!(completions.len(), 1);

            let child_events = store.list_events(SESSION_ID).unwrap();
            let last_child_seq = child_events.last().unwrap().seq;
            let ended = child_events
                .iter()
                .filter_map(|record| {
                    serde_json::from_str::<SessionEvent>(&record.payload_json).ok()
                })
                .find_map(|event| match event {
                    SessionEvent::TurnEnded(ended) => Some(ended),
                    _ => None,
                })
                .expect("turn ended event");
            assert!(matches!(
                ended.stop_reason,
                anyharness_contract::v1::StopReason::Cancelled
            ));
            assert!(!child_events
                .iter()
                .any(|event| event.event_type == "session_ended"));

            let completion = &completions[0];
            assert_eq!(completion.child_turn_id, turn_id);
            assert_eq!(
                completion.outcome,
                crate::domains::sessions::extensions::SessionTurnOutcome::Cancelled
            );
            assert_eq!(completion.child_last_event_seq, last_child_seq);
            assert!(completion.parent_event_seq.is_none());
            assert!(completion.parent_prompt_seq.is_some());
            let task_output = state
                .session_service
                .get_task_output(SESSION_ID, None, 10)
                .unwrap();
            assert!(task_output
                .messages
                .iter()
                .any(|message| message.text.contains(PARTIAL_TEXT)));
            let deliveries = CompletionDeliveryStore::new(state.db.clone())
                .list_all_for_test()
                .unwrap();
            assert_eq!(deliveries.len(), 1);
            assert_eq!(deliveries[0].state, CompletionDeliveryState::Enqueued);
            assert_eq!(deliveries[0].outcome, SessionTurnOutcome::Cancelled);
            assert!(deliveries[0]
                .assistant_text
                .as_deref()
                .is_some_and(|text| text.contains(PARTIAL_TEXT)));
            let pending = store.list_pending_prompts(PARENT_ID).unwrap();
            assert_eq!(pending.len(), 1);
            let delivery_prompt_id = deliveries[0].prompt_id();
            assert_eq!(
                pending[0].prompt_id.as_deref(),
                Some(delivery_prompt_id.as_str())
            );
            assert!(pending[0].text.contains(PARTIAL_TEXT));
            assert!(!store
                .list_events(PARENT_ID)
                .unwrap()
                .iter()
                .any(|event| event.event_type == "subagent_turn_completed"));
            assert!(!state.session_runtime.has_live_session(SESSION_ID).await);
            assert_eq!(closed.native_session_id.as_deref(), Some(NATIVE_SESSION_ID));
            assert!(closed.closed_at.is_none());
            assert!(closed.dismissed_at.is_none());
            assert!(state
                .subagent_service
                .resolve_target_including_closed(PARENT_ID, None, Some(SESSION_ID))
                .unwrap()
                .subagent_closed_at
                .is_some());
        })
        .await;
}
