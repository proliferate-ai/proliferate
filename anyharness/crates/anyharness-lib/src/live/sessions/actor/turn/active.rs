use std::time::Duration;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionExecutionPhase;
use tokio::sync::{mpsc, oneshot};

use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::actor::command::{
    ForkSessionCommandError, Resolution, PromptAcceptError, PromptAcceptance,
    SessionCommand,
};
use crate::live::sessions::actor::fork::handle::reject_busy_close_native_child_session;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::actor::turn::diagnostics::{age_ms, PromptDiagnostics};
use crate::live::sessions::actor::turn::start::StartedPromptTurn;
use crate::live::sessions::background_work::BackgroundWorkUpdate;

pub(in crate::live::sessions::actor) struct ActivePromptRequest {
    pub payload: PromptPayload,
    pub prompt_id: Option<String>,
    pub from_queue_seq: Option<i64>,
    pub respond_to: oneshot::Sender<Result<PromptAcceptance, PromptAcceptError>>,
}

impl SessionActor {
    /// Runs one prompt turn (plus the queue-drain loop that follows it): the
    /// busy window between `set_busy(true)` and `set_busy(false)`.
    pub(in crate::live::sessions::actor) async fn run_turn(
        &mut self,
        request: ActivePromptRequest,
        command_rx: &mut mpsc::Receiver<SessionCommand>,
        notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        background_work_rx: &mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    ) -> Option<ActorExitDisposition> {
        // Invariant 2: the actor is the sole writer of `busy`.
        self.handle.set_busy(true);

        let mut current_payload = request.payload;
        let mut current_prompt_id = request.prompt_id;
        let mut current_queue_seq = request.from_queue_seq;
        let mut current_respond_to = Some(request.respond_to);
        let mut exit_after_prompt: Option<ActorExitDisposition> = None;

        'drain: loop {
            self.drain_replay_notifications_before_prompt(notification_rx)
                .await;
            self.resume_replay_filter.disable();

            tracing::info!(
                session_id = %self.session_id,
                prompt_id = current_prompt_id.as_deref(),
                "[workspace-latency] session.actor.prompt.received"
            );
            let StartedPromptTurn {
                acp_blocks,
                turn_id,
            } = match self
                .begin_prompt_turn(
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
            self.handle
                .set_execution_phase(SessionExecutionPhase::Running)
                .await;
            let _ = self
                .caps
                .state
                .update_status(&self.session_id, "running", &now);
            let _ = self
                .caps
                .state
                .update_last_prompt_at(&self.session_id, &now);
            tracing::info!(
                session_id = %self.session_id,
                prompt_id = current_prompt_id.as_deref(),
                "[workspace-latency] session.actor.prompt.accepted"
            );

            let req = acp::schema::PromptRequest::new(self.native_session_id.clone(), acp_blocks);

            let mut prompt_result = None;
            let mut prompt_diagnostics = PromptDiagnostics::new(current_prompt_id.clone());
            tracing::info!(
                session_id = %self.session_id,
                prompt_id = current_prompt_id.as_deref(),
                "[workspace-latency] session.actor.prompt.dispatch_started"
            );
            // ConnectionTo is a cheap handle; the clone keeps the pinned
            // prompt future from borrowing `self` across the `&mut self`
            // calls in the select arms below.
            let conn = self.conn.clone();
            let prompt_fut = conn.send_request(req).block_task();
            tokio::pin!(prompt_fut);
            let mut prompt_pending_interval = tokio::time::interval(Duration::from_secs(15));
            prompt_pending_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            prompt_pending_interval.tick().await;

            while prompt_result.is_none() {
                tokio::select! {
                    _ = prompt_pending_interval.tick() => {
                        let sink_snapshot = {
                            let sink = self.event_sink.lock().await;
                            sink.debug_snapshot()
                        };
                        let execution_snapshot = self.handle.execution_snapshot().await;
                        tracing::info!(
                            session_id = %self.session_id,
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
                            background_work_count = self.background_work_registry.tracker_count(),
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
                            self.handle_notification(&notif).await;
                        }
                    }
                    background_update = background_work_rx.recv() => {
                        if let Some(update) = background_update {
                            self.handle_background(update).await;
                        }
                    }
                    cmd = command_rx.recv() => {
                        match cmd {
                            Some(SessionCommand::Cancel) => {
                                self.resolve_pending_interactions(Resolution::Cancelled).await;
                                let _ = self.conn
                                    .send_notification(acp::schema::CancelNotification::new(self.native_session_id.clone()));
                            }
                            Some(SessionCommand::Dismiss { respond_to }) => {
                                self.resolve_pending_interactions(Resolution::Dismissed).await;
                                let _ = self.conn
                                    .send_notification(acp::schema::CancelNotification::new(self.native_session_id.clone()));
                                let _ = respond_to.send(Ok(()));
                                exit_after_prompt = Some(ActorExitDisposition::Dismiss);
                            }
                            Some(SessionCommand::ResolveInteraction { request_id, resolution, respond_to }) => {
                                let result = self.resolve_interaction(request_id, resolution).await;
                                let _ = respond_to.send(result);
                            }
                            Some(SessionCommand::RunDomainOp { op, respond_to }) => {
                                let result = self.run_domain_op_cmd(op).await;
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
                                let result = self.inject_runtime_event(event).await;
                                let _ = respond_to.send(result);
                            }
                            Some(SessionCommand::SetConfigOption { config_id, value, respond_to }) => {
                                let result = self.handle_busy_config_command(&config_id, &value).await;
                                let _ = respond_to.send(result);
                            }
                            Some(SessionCommand::Close { respond_to }) => {
                                self.resolve_pending_interactions(Resolution::Cancelled).await;
                                let _ = respond_to.send(Ok(()));
                                exit_after_prompt = Some(ActorExitDisposition::Close);
                            }
                            Some(SessionCommand::Prompt { payload: queued_payload, prompt_id: queued_prompt_id, from_queue_seq, respond_to }) => {
                                let result = self.handle_busy_prompt_queue(
                                    queued_payload,
                                    queued_prompt_id,
                                    from_queue_seq,
                                )
                                .await;
                                let _ = respond_to.send(result);
                            }
                            Some(SessionCommand::EditPendingPrompt { seq, payload, respond_to }) => {
                                let _ = respond_to.send(
                                    self.handle_edit_pending_prompt(seq, payload).await,
                                );
                            }
                            Some(SessionCommand::DeletePendingPrompt { seq, respond_to }) => {
                                let _ = respond_to.send(
                                    self.handle_delete_pending_prompt(seq).await,
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
            let broken_session = self
                .finish_prompt_result(
                    result,
                    &mut prompt_diagnostics,
                    notification_rx,
                    background_work_rx,
                )
                .await;

            self.resume_replay_filter.disable();

            if exit_after_prompt.is_some() || broken_session {
                break 'drain;
            }

            // Invariant 2/3: peek the head of the queue BEFORE releasing `busy`.
            // If present, re-enter the prompt body with the new payload; begin_turn's
            // event emission is what durably hands off the queue row.
            match self.next_pending_prompt_for_drain() {
                Some((next_payload, next_prompt_id, next_seq)) => {
                    current_payload = next_payload;
                    current_prompt_id = next_prompt_id;
                    current_queue_seq = Some(next_seq);
                    continue 'drain;
                }
                None => break 'drain,
            }
        }

        self.handle.set_busy(false);
        exit_after_prompt
    }

    async fn drain_replay_notifications_before_prompt(
        &mut self,
        notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
    ) {
        while let Ok(notif) = notification_rx.try_recv() {
            self.handle_notification(&notif).await;
        }
    }
}
