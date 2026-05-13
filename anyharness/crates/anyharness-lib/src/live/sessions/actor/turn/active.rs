use crate::live::sessions::actor::*;

pub(in crate::live::sessions::actor) struct ActivePromptRequest {
    pub payload: PromptPayload,
    pub prompt_id: Option<String>,
    pub latency: Option<LatencyRequestContext>,
    pub from_queue_seq: Option<i64>,
    pub respond_to: oneshot::Sender<Result<PromptAcceptance, PromptAcceptError>>,
}

pub(in crate::live::sessions::actor) struct ActivePromptContext<'a> {
    pub config: &'a SessionActorConfig,
    pub conn: &'a acp::ClientSideConnection,
    pub native_session_id: &'a str,
    pub command_rx: &'a mut mpsc::Receiver<SessionCommand>,
    pub notification_rx: &'a mut mpsc::UnboundedReceiver<acp::SessionNotification>,
    pub background_work_rx: &'a mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    pub background_work_registry: &'a mut BackgroundWorkRegistry,
    pub event_sink: &'a Arc<Mutex<SessionEventSink>>,
    pub persisted_config_state: &'a mut PersistedSessionConfigState,
    pub startup_state: &'a mut SessionStartupState,
    pub resume_replay_filter: &'a mut ResumeReplayFilter,
    pub handle: &'a Arc<LiveSessionHandle>,
    pub store: &'a SessionStore,
    pub attachment_storage: &'a PromptAttachmentStorage,
}

pub(in crate::live::sessions::actor) async fn handle_active_prompt(
    context: ActivePromptContext<'_>,
    request: ActivePromptRequest,
) -> Option<ActorExitDisposition> {
    let ActivePromptContext {
        config,
        conn,
        native_session_id,
        command_rx,
        notification_rx,
        background_work_rx,
        background_work_registry,
        event_sink,
        persisted_config_state,
        startup_state,
        resume_replay_filter,
        handle,
        store,
        attachment_storage,
    } = context;

    let session_id = config.session.id.as_str();
    let workspace_id = config.session.workspace_id.as_str();
    let source_agent_kind = config.session.agent_kind.as_str();

    // Invariant 2: the actor is the sole writer of `busy`.
    handle.busy.store(true, Ordering::Release);

    let mut current_payload = request.payload;
    let mut current_prompt_id = request.prompt_id;
    let mut current_latency = request.latency;
    let mut current_queue_seq = request.from_queue_seq;
    let mut current_respond_to = Some(request.respond_to);
    let mut exit_after_prompt: Option<ActorExitDisposition> = None;

    'drain: loop {
        let latency_fields = latency_trace_fields(current_latency.as_ref());
        tracing::info!(
            session_id = %session_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.actor.prompt.received"
        );
        let mut acp_blocks =
            match current_payload.to_acp_blocks(store, attachment_storage, session_id) {
                Ok(blocks) => blocks,
                Err(error) => {
                    let detail = error.detail.clone();
                    tracing::warn!(
                        session_id = %session_id,
                        code = error.code,
                        detail = %error.detail,
                        "failed to build ACP prompt blocks",
                    );
                    if let Some(respond_to) = current_respond_to.take() {
                        let _ = respond_to.send(Err(PromptAcceptError::EnqueueFailed(detail)));
                    }
                    break 'drain;
                }
            };
        match store.has_turn_started_event(session_id) {
            Ok(has_turn_started) => {
                if let Some(append) = first_prompt_system_prompt_append_for_codex_prompt(
                    source_agent_kind,
                    config.first_prompt_system_prompt_append.as_deref(),
                    has_turn_started,
                ) {
                    prepend_system_prompt_append_to_acp_blocks(&mut acp_blocks, append);
                }
            }
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    error = %error,
                    "failed to determine whether prompt should inline system prompt append"
                );
            }
        }
        let turn_id;
        {
            let mut sink = event_sink.lock().await;
            let content_parts = current_payload.content_parts();
            turn_id = sink.begin_turn(
                current_payload.text_summary.clone(),
                current_prompt_id.clone(),
                content_parts,
                current_payload.public_provenance(),
            );
            if let Err(error) = store.mark_prompt_attachments_state(
                session_id,
                &current_payload.attachment_ids(),
                PromptAttachmentState::Transcript,
            ) {
                tracing::warn!(
                    session_id = %session_id,
                    error = %error,
                    "failed to mark prompt attachments as transcript",
                );
            }
            // Invariant 3: delete the queue row and emit Removed AFTER
            // begin_turn has durably persisted the replacement turn events.
            // `current_queue_seq` is only set on drained iterations; initial
            // iterations get None.
            if let Some(seq) = current_queue_seq.take() {
                if let Err(error) = store.delete_pending_prompt(session_id, seq) {
                    tracing::warn!(
                        session_id = %session_id,
                        seq,
                        error = %error,
                        "failed to delete pending prompt after begin_turn",
                    );
                }
                sink.pending_prompt_removed(PendingPromptRemovedPayload {
                    seq,
                    prompt_id: current_prompt_id.clone(),
                    reason: PendingPromptRemovalReason::Executed,
                });
            }
        }
        if let Some(respond_to) = current_respond_to.take() {
            let _ = respond_to.send(Ok(PromptAcceptance::Started {
                turn_id: turn_id.clone(),
            }));
        }

        let now = chrono::Utc::now().to_rfc3339();
        handle
            .set_execution_phase(SessionExecutionPhase::Running)
            .await;
        let _ = store.update_status(session_id, "running", &now);
        let _ = store.update_last_prompt_at(session_id, &now);
        tracing::info!(
            session_id = %session_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.actor.prompt.accepted"
        );

        let req = acp::PromptRequest::new(native_session_id.to_owned(), acp_blocks);

        let mut prompt_result = None;
        let mut prompt_diagnostics = PromptDiagnostics::new(current_prompt_id.clone());
        tracing::info!(
            session_id = %session_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.actor.prompt.dispatch_started"
        );
        let prompt_fut = conn.prompt(req);
        tokio::pin!(prompt_fut);
        let mut prompt_pending_interval = tokio::time::interval(Duration::from_secs(15));
        prompt_pending_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        prompt_pending_interval.tick().await;

        while prompt_result.is_none() {
            tokio::select! {
                _ = prompt_pending_interval.tick() => {
                    let sink_snapshot = {
                        let sink = event_sink.lock().await;
                        sink.debug_snapshot()
                    };
                    let execution_snapshot = handle.execution_snapshot().await;
                    tracing::info!(
                        session_id = %session_id,
                        flow_id = latency_fields.flow_id,
                        flow_kind = latency_fields.flow_kind,
                        flow_source = latency_fields.flow_source,
                        prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                        turn_id = ?sink_snapshot.current_turn_id,
                        pending_for_ms = prompt_diagnostics.prompt_started_at.elapsed().as_millis() as u64,
                        execution_phase = ?execution_snapshot.phase,
                        last_raw_kind = ?prompt_diagnostics.last_raw_kind,
                        last_raw_age_ms = age_ms(prompt_diagnostics.last_raw_at),
                        last_agent_chunk_age_ms = age_ms(prompt_diagnostics.last_agent_chunk_at),
                        last_agent_preview = prompt_diagnostics.last_agent_preview.as_deref().unwrap_or(""),
                        last_tool_event_age_ms = age_ms(prompt_diagnostics.last_tool_event_at),
                        last_plan_age_ms = age_ms(prompt_diagnostics.last_plan_at),
                        last_usage_age_ms = age_ms(prompt_diagnostics.last_usage_at),
                        open_assistant_item_id = ?sink_snapshot.open_assistant_item_id,
                        open_assistant_chars = sink_snapshot.open_assistant_chars,
                        open_reasoning_item_id = ?sink_snapshot.open_reasoning_item_id,
                        open_reasoning_chars = sink_snapshot.open_reasoning_chars,
                        open_plan_item_id = ?sink_snapshot.open_plan_item_id,
                        open_tool_call_ids = ?sink_snapshot.open_tool_call_ids,
                        background_work_count = background_work_registry.tracker_count(),
                        next_event_seq = sink_snapshot.next_seq,
                        "session.actor.prompt.pending"
                    );
                }
                result = &mut prompt_fut => {
                    prompt_result = Some(result);
                }
                notification = notification_rx.recv() => {
                    if let Some(notif) = notification {
                        prompt_diagnostics.observe_notification(&notif);
                        handle_notification_with_resume_replay_filter(
                            &notif,
                            resume_replay_filter,
                            event_sink,
                            background_work_registry,
                            store,
                            session_id,
                            workspace_id,
                            source_agent_kind,
                            config.plan_service.clone(),
                            config.review_service.clone(),
                            persisted_config_state,
                            startup_state,
                        ).await;
                    }
                }
                background_update = background_work_rx.recv() => {
                    if let Some(update) = background_update {
                        handle_background_work_update(event_sink, store, session_id, update).await;
                    }
                }
                cmd = command_rx.recv() => {
                    match cmd {
                        Some(SessionCommand::Cancel) => {
                            resolve_pending_interactions(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                session_id,
                                InteractionResolution::Cancelled,
                            )
                            .await;
                            let _ = conn
                                .cancel(acp::CancelNotification::new(native_session_id.to_owned()))
                                .await;
                        }
                        Some(SessionCommand::Dismiss { respond_to }) => {
                            resolve_pending_interactions(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                session_id,
                                InteractionResolution::Dismissed,
                            )
                            .await;
                            let _ = conn
                                .cancel(acp::CancelNotification::new(native_session_id.to_owned()))
                                .await;
                            let _ = respond_to.send(Ok(()));
                            exit_after_prompt = Some(ActorExitDisposition::Dismiss);
                        }
                        Some(SessionCommand::ResolveInteraction { request_id, resolution, respond_to }) => {
                            let result = handle_resolve_interaction(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                session_id,
                                request_id,
                                resolution,
                            )
                            .await;
                            let _ = respond_to.send(result);
                        }
                        Some(SessionCommand::ApplyPlanDecision { plan_id, expected_version, decision, respond_to }) => {
                            let result = handle_apply_plan_decision(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                config.plan_service.as_ref(),
                                session_id,
                                &plan_id,
                                expected_version,
                                decision,
                            )
                            .await;
                            let _ = respond_to.send(result);
                        }
                        Some(SessionCommand::VerifyForkReady { respond_to }) => {
                            let _ = respond_to.send(Err(ForkSessionCommandError::Busy));
                        }
                        Some(SessionCommand::Fork { respond_to }) => {
                            let _ = respond_to.send(Err(ForkSessionCommandError::Busy));
                        }
                        Some(SessionCommand::CloseNativeSession { respond_to, .. }) => {
                            let _ = respond_to.send(Err(anyhow::anyhow!(
                                "cannot close native child session while parent session is busy"
                            )));
                        }
                        Some(SessionCommand::InjectRuntimeEvent { event, respond_to }) => {
                            let touch_session_activity = event.updates_session_activity_at();
                            let result = event_sink.lock().await.inject_runtime_event(event);
                            if touch_session_activity {
                                if let Ok(envelope) = &result {
                                    handle.mark_activity_at(envelope.timestamp.clone()).await;
                                }
                            }
                            let _ = respond_to.send(result);
                        }
                        Some(SessionCommand::SetConfigOption { config_id, value, respond_to }) => {
                            let option = find_select_option_for_request(
                                &startup_state.config_options,
                                &config_id,
                            );
                            let result = queue_pending_config_change(
                                store,
                                session_id,
                                startup_state,
                                &config_id,
                                &value,
                            );
                            let result = match result {
                                Ok(()) => {
                                    if let Err(error) = persist_requested_config_value_if_changed(
                                        store,
                                        event_sink,
                                        session_id,
                                        persisted_config_state,
                                        tracked_config_purpose(&config_id, option),
                                        &value,
                                        chrono::Utc::now().to_rfc3339(),
                                    )
                                    .await
                                    {
                                        let _ = store.delete_pending_config_change(session_id, &config_id);
                                        Err(SetConfigOptionCommandError::Rejected(error.to_string()))
                                    } else {
                                        Ok(ConfigApplyState::Queued)
                                    }
                                }
                                Err(error) => Err(error),
                            };
                            let _ = respond_to.send(result);
                        }
                        Some(SessionCommand::Close { respond_to }) => {
                            resolve_pending_interactions(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                session_id,
                                InteractionResolution::Cancelled,
                            )
                            .await;
                            let _ = respond_to.send(Ok(()));
                            exit_after_prompt = Some(ActorExitDisposition::Close);
                        }
                        Some(SessionCommand::Prompt { payload: queued_payload, prompt_id: queued_prompt_id, latency: _, from_queue_seq, respond_to }) => {
                            if let Some(seq) = from_queue_seq {
                                match store.find_pending_prompt(session_id, seq) {
                                    Ok(Some(record)) => {
                                        let mut sink = event_sink.lock().await;
                                        sink.pending_prompt_added(PendingPromptAddedPayload {
                                            seq: record.seq,
                                            prompt_id: record.prompt_id.clone(),
                                            text: record.text.clone(),
                                            content_parts: record.prompt_payload().content_parts(),
                                            queued_at: record.queued_at.clone(),
                                            prompt_provenance: record.prompt_payload().public_provenance(),
                                        });
                                    }
                                    Ok(None) => {}
                                    Err(error) => {
                                        tracing::warn!(
                                            session_id = %session_id,
                                            seq,
                                            error = %error,
                                            "failed to load prequeued prompt for pending prompt event",
                                        );
                                    }
                                }
                                let _ = respond_to.send(Ok(PromptAcceptance::Queued { seq }));
                                continue;
                            }
                            // Invariant 2/3: busy-path enqueue. Insert durably,
                            // emit PendingPromptAdded, respond Queued.
                            match store.insert_pending_prompt_payload(
                                session_id,
                                &queued_payload,
                                queued_prompt_id.as_deref(),
                            ) {
                                Ok(record) => {
                                    let mut sink = event_sink.lock().await;
                                    sink.pending_prompt_added(PendingPromptAddedPayload {
                                        seq: record.seq,
                                        prompt_id: record.prompt_id.clone(),
                                        text: record.text.clone(),
                                        content_parts: record.prompt_payload().content_parts(),
                                        queued_at: record.queued_at.clone(),
                                        prompt_provenance: record.prompt_payload().public_provenance(),
                                    });
                                    drop(sink);
                                    let _ = respond_to.send(Ok(PromptAcceptance::Queued {
                                        seq: record.seq,
                                    }));
                                }
                                Err(error) => {
                                    tracing::warn!(
                                        session_id = %session_id,
                                        error = %error,
                                        "failed to enqueue pending prompt",
                                    );
                                    let _ = respond_to.send(Err(PromptAcceptError::EnqueueFailed(
                                        error.to_string(),
                                    )));
                                }
                            }
                        }
                        Some(SessionCommand::EditPendingPrompt { seq, payload, respond_to }) => {
                            let _ = respond_to.send(
                                handle_edit_pending_prompt(
                                    store,
                                    attachment_storage,
                                    event_sink,
                                    session_id,
                                    seq,
                                    payload,
                                )
                                .await,
                            );
                        }
                        Some(SessionCommand::DeletePendingPrompt { seq, respond_to }) => {
                            let _ = respond_to.send(
                                handle_delete_pending_prompt(
                                    store,
                                    attachment_storage,
                                    event_sink,
                                    session_id,
                                    seq,
                                )
                                .await,
                            );
                        }
                        Some(SessionCommand::ReplayAdvance { respond_to }) => {
                            let _ = respond_to.send(Err(anyhow::anyhow!("session is not a replay session")));
                        }
                        None => {}
                    }
                }
            }
        }

        let result = prompt_result.expect("prompt_result must be set");
        let broken_session = finish_prompt_result(
            PromptFinishContext {
                config,
                conn,
                native_session_id,
                notification_rx,
                background_work_rx,
                background_work_registry,
                event_sink,
                persisted_config_state,
                startup_state,
                resume_replay_filter,
                handle,
                store,
                session_id,
                workspace_id,
                source_agent_kind,
            },
            result,
            current_latency.as_ref(),
            &mut prompt_diagnostics,
        )
        .await;

        resume_replay_filter.disable();

        // Suppress reference-unused warnings on latency locals so the drain body
        // behaves symmetrically across iterations.
        let _ = current_prompt_id.take();

        if exit_after_prompt.is_some() || broken_session {
            break 'drain;
        }

        // Invariant 2/3: peek the head of the queue BEFORE releasing `busy`.
        // If present, re-enter the prompt body with the new payload; begin_turn's
        // event emission is what durably hands off the queue row.
        match store.peek_head_pending_prompt(session_id) {
            Ok(Some(next)) => {
                current_payload = next.prompt_payload();
                current_prompt_id = next.prompt_id;
                current_latency = None;
                current_queue_seq = Some(next.seq);
                continue 'drain;
            }
            Ok(None) => break 'drain,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    error = %error,
                    "failed to peek pending prompt queue after turn end",
                );
                break 'drain;
            }
        }
    }

    handle.busy.store(false, Ordering::Release);
    exit_after_prompt
}
