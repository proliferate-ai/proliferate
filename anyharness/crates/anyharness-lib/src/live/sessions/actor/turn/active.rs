use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionExecutionPhase;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::actor::background_work::handle_background_work_update;
use crate::live::sessions::actor::command::{
    ForkSessionCommandError, Resolution, PromptAcceptError, PromptAcceptance,
    SessionCommand,
};
use crate::live::sessions::actor::config::handle::handle_busy_config_command;
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::fork::handle::reject_busy_close_native_child_session;
use crate::live::sessions::actor::interactions::cleanup::resolve_pending_interactions;
use crate::live::sessions::actor::interactions::handle::{handle_resolve_interaction, run_domain_op};
use crate::live::sessions::actor::notifications::dispatch::inject_runtime_event;
use crate::live::sessions::actor::notifications::handle::handle_notification_with_resume_replay_filter;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::state::{SessionActorConfig, SessionStartupState};
use crate::live::sessions::actor::turn::diagnostics::{age_ms, PromptDiagnostics};
use crate::live::sessions::actor::turn::finish::{finish_prompt_result, PromptFinishContext};
use crate::live::sessions::actor::turn::queue::{
    handle_busy_prompt_queue, handle_delete_pending_prompt, handle_edit_pending_prompt,
    next_pending_prompt_for_drain,
};
use crate::live::sessions::actor::turn::start::{begin_prompt_turn, StartedPromptTurn};
use crate::live::sessions::background_work::{BackgroundWorkRegistry, BackgroundWorkUpdate};
use crate::live::sessions::sink::SessionEventSink;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};

pub(in crate::live::sessions::actor) struct ActivePromptRequest {
    pub payload: PromptPayload,
    pub prompt_id: Option<String>,
    pub latency: Option<LatencyRequestContext>,
    pub from_queue_seq: Option<i64>,
    pub respond_to: oneshot::Sender<Result<PromptAcceptance, PromptAcceptError>>,
}

pub(in crate::live::sessions::actor) struct ActivePromptContext<'a> {
    pub config: &'a SessionActorConfig,
    pub conn: &'a acp::ConnectionTo<acp::Agent>,
    pub native_session_id: &'a str,
    pub command_rx: &'a mut mpsc::Receiver<SessionCommand>,
    pub notification_rx: &'a mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
    pub background_work_rx: &'a mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    pub background_work_registry: &'a mut BackgroundWorkRegistry,
    pub event_sink: &'a Arc<Mutex<SessionEventSink>>,
    pub persisted_config_state: &'a mut PersistedSessionConfigState,
    pub startup_state: &'a mut SessionStartupState,
    pub resume_replay_filter: &'a mut ResumeReplayFilter,
    pub handle: &'a Arc<LiveSessionHandle>,
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
    } = context;

    let session_id = config.launch.session.id.as_str();
    let workspace_id = config.launch.session.workspace_id.as_str();
    let source_agent_kind = config.launch.session.agent_kind.as_str();

    // Invariant 2: the actor is the sole writer of `busy`.
    handle.set_busy(true);

    let mut current_payload = request.payload;
    let mut current_prompt_id = request.prompt_id;
    let mut current_latency = request.latency;
    let mut current_queue_seq = request.from_queue_seq;
    let mut current_respond_to = Some(request.respond_to);
    let mut exit_after_prompt: Option<ActorExitDisposition> = None;

    'drain: loop {
        drain_replay_notifications_before_prompt(
            notification_rx,
            resume_replay_filter,
            event_sink,
            background_work_registry,
            session_id,
            workspace_id,
            source_agent_kind,
            config,
            persisted_config_state,
            startup_state,
        )
        .await;
        resume_replay_filter.disable();

        let latency_fields = latency_trace_fields(current_latency.as_ref());
        tracing::info!(
            session_id = %session_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.actor.prompt.received"
        );
        let StartedPromptTurn {
            acp_blocks,
            turn_id,
        } = match begin_prompt_turn(
            config,
            event_sink,
            session_id,
            source_agent_kind,
            &current_payload,
            current_prompt_id.clone(),
            current_queue_seq.take(),
        )
        .await
        {
            Ok(started) => started,
            Err(error) => {
                if let Some(respond_to) = current_respond_to.take() {
                    let _ = respond_to.send(Err(error));
                }
                break 'drain;
            }
        };
        if let Some(respond_to) = current_respond_to.take() {
            let _ = respond_to.send(Ok(PromptAcceptance::Started {
                turn_id: turn_id.clone(),
            }));
        }

        let now = chrono::Utc::now().to_rfc3339();
        handle
            .set_execution_phase(SessionExecutionPhase::Running)
            .await;
        let _ = config.caps.state.update_status(session_id, "running", &now);
        let _ = config.caps.state.update_last_prompt_at(session_id, &now);
        tracing::info!(
            session_id = %session_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.actor.prompt.accepted"
        );

        let req = acp::schema::PromptRequest::new(native_session_id.to_owned(), acp_blocks);

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
        let prompt_fut = conn.send_request(req).block_task();
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
                        last_agent_thought_age_ms = age_ms(prompt_diagnostics.last_agent_thought_at),
                        last_transient_status_age_ms = age_ms(prompt_diagnostics.last_transient_status_at),
                        last_transient_status = prompt_diagnostics.last_transient_status.as_deref().unwrap_or(""),
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
                            &config.caps,
                            session_id,
                            workspace_id,
                            source_agent_kind,
                            persisted_config_state,
                            startup_state,
                        ).await;
                    }
                }
                background_update = background_work_rx.recv() => {
                    if let Some(update) = background_update {
                        handle_background_work_update(
                            event_sink,
                            config.caps.background.as_ref(),
                            session_id,
                            update,
                        )
                        .await;
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
                                Resolution::Cancelled,
                            )
                            .await;
                            let _ = conn
                                .send_notification(acp::schema::CancelNotification::new(native_session_id.to_owned()));
                        }
                        Some(SessionCommand::Dismiss { respond_to }) => {
                            resolve_pending_interactions(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                session_id,
                                Resolution::Dismissed,
                            )
                            .await;
                            let _ = conn
                                .send_notification(acp::schema::CancelNotification::new(native_session_id.to_owned()));
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
                        Some(SessionCommand::RunDomainOp { op, respond_to }) => {
                            let result = run_domain_op(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                session_id,
                                workspace_id,
                                source_agent_kind,
                                op,
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
                            reject_busy_close_native_child_session(respond_to);
                        }
                        Some(SessionCommand::InjectRuntimeEvent { event, respond_to }) => {
                            let result = inject_runtime_event(event_sink, handle, event).await;
                            let _ = respond_to.send(result);
                        }
                        Some(SessionCommand::SetConfigOption { config_id, value, respond_to }) => {
                            let result = handle_busy_config_command(
                                config.caps.state.as_ref(),
                                event_sink,
                                session_id,
                                persisted_config_state,
                                startup_state,
                                &config_id,
                                &value,
                            )
                            .await;
                            let _ = respond_to.send(result);
                        }
                        Some(SessionCommand::Close { respond_to }) => {
                            resolve_pending_interactions(
                                handle,
                                event_sink,
                                &config.interaction_broker,
                                session_id,
                                Resolution::Cancelled,
                            )
                            .await;
                            let _ = respond_to.send(Ok(()));
                            exit_after_prompt = Some(ActorExitDisposition::Close);
                        }
                        Some(SessionCommand::Prompt { payload: queued_payload, prompt_id: queued_prompt_id, latency: _, from_queue_seq, respond_to }) => {
                            let result = handle_busy_prompt_queue(
                                config.caps.queue.as_ref(),
                                event_sink,
                                session_id,
                                queued_payload,
                                queued_prompt_id,
                                from_queue_seq,
                            )
                            .await;
                            let _ = respond_to.send(result);
                        }
                        Some(SessionCommand::EditPendingPrompt { seq, payload, respond_to }) => {
                            let _ = respond_to.send(
                                handle_edit_pending_prompt(
                                    config.caps.queue.as_ref(),
                                    config.caps.attachments.as_ref(),
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
                                    config.caps.queue.as_ref(),
                                    config.caps.attachments.as_ref(),
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
        match next_pending_prompt_for_drain(config.caps.queue.as_ref(), session_id) {
            Some((next_payload, next_prompt_id, next_seq)) => {
                current_payload = next_payload;
                current_prompt_id = next_prompt_id;
                current_latency = None;
                current_queue_seq = Some(next_seq);
                continue 'drain;
            }
            None => break 'drain,
        }
    }

    handle.set_busy(false);
    exit_after_prompt
}

async fn drain_replay_notifications_before_prompt(
    notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
    resume_replay_filter: &mut ResumeReplayFilter,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    config: &SessionActorConfig,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    while let Ok(notif) = notification_rx.try_recv() {
        handle_notification_with_resume_replay_filter(
            &notif,
            resume_replay_filter,
            event_sink,
            background_work_registry,
            &config.caps,
            session_id,
            workspace_id,
            source_agent_kind,
            persisted_config_state,
            startup_state,
        )
        .await;
    }
}
