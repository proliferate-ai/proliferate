use std::time::Duration;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionExecutionPhase;
use tokio::sync::{mpsc, oneshot};

use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::actor::command::{
    ConditionalCancelOutcome, ConditionalUnloadOutcome, ForkSessionCommandError, PromptAcceptError,
    PromptAcceptance, Resolution, SessionCommand, UnloadRetainedReason,
};
use crate::live::sessions::actor::fork::handle::reject_busy_close_native_child_session;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::actor::turn::diagnostics::{age_ms, PromptDiagnostics};
use crate::live::sessions::actor::turn::start::{BeginPromptTurnOutcome, StartedPromptTurn};
use crate::live::sessions::background_work::BackgroundWorkUpdate;

#[cfg(not(test))]
const UNLOAD_CANCEL_GRACE: Duration = Duration::from_secs(5);
#[cfg(test)]
const UNLOAD_CANCEL_GRACE: Duration = Duration::from_millis(100);

/// How long an active-turn `Stop` waits for the agent to unwind its turn in
/// response to the ACP cancel before abandoning the turn outright and letting
/// `run()`'s exit sequence kill the agent's process group.
///
/// The cancel is cooperative and nothing obliges an agent to honor it, so
/// without this bound `stop_and_await` (and with it `stop_all_for_workspace`
/// and R4's whole quiesce) would block for as long as the turn lasts. Racing
/// the cancel against a short bound and then escalating regardless is safe:
/// the escalation reaps the child either way, and the worst case (bound + the
/// kill path's 5s grace) still fits R4's 8s `QUIESCE_DEADLINE`.
const ACTIVE_TURN_STOP_BOUND: Duration = Duration::from_secs(2);

pub(in crate::live::sessions::actor) struct ActivePromptRequest {
    pub payload: PromptPayload,
    pub prompt_id: Option<String>,
    pub from_queue_seq: Option<i64>,
    pub respond_to: oneshot::Sender<Result<PromptAcceptance, PromptAcceptError>>,
}

impl SessionActor {
    /// Runs one prompt turn: the busy window between `set_busy(true)` and
    /// `set_busy(false)`. Further durable prompts are selected by the idle
    /// loop, where mailbox commands have priority over automatic queue drain.
    pub(in crate::live::sessions::actor) async fn run_turn(
        &mut self,
        request: ActivePromptRequest,
        command_rx: &mut mpsc::Receiver<SessionCommand>,
        notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        background_work_rx: &mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    ) -> Option<ActorExitDisposition> {
        // Invariant 2: the actor is the sole writer of `busy`.
        self.handle.set_busy(true);

        let current_payload = request.payload;
        let current_prompt_id = request.prompt_id;
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
            let draining_queued_prompt = current_queue_seq.is_some();
            let start = match self
                .begin_prompt_turn(
                    &current_payload,
                    current_prompt_id.clone(),
                    current_queue_seq.take(),
                )
                .await
            {
                Ok(started) => started,
                Err(error) => {
                    if draining_queued_prompt {
                        if let PromptAcceptError::ProductContextUnavailable {
                            incident_id, ..
                        } = &error
                        {
                            let persisted = {
                                let mut sink = self.event_sink.lock().await;
                                sink.product_context_unavailable(incident_id.clone())
                            };
                            if persisted.is_err() {
                                tracing::error!(
                                    session_id = %self.session_id,
                                    incident_id,
                                    failure_code = "agent_product_context_receipt_persist_failed",
                                    "queued product-context failure receipt was not persisted"
                                );
                            }
                            // Retain the durable queue head and retire this
                            // actor. Only a later explicit activation may
                            // re-resolve context and retry it.
                            tracing::warn!(
                                target: "anyharness.session.queue_drain_halted",
                                session_id = %self.session_id,
                                incident_id,
                                action = "unload_pending_retry",
                                "queued prompt drain halted; session unloaded pending retry"
                            );
                            exit_after_prompt = Some(ActorExitDisposition::Unload);
                        }
                    }
                    if let Some(respond_to) = current_respond_to.take() {
                        let _ = respond_to.send(Err(error));
                    }
                    break 'drain;
                }
            };
            let StartedPromptTurn {
                acp_blocks,
                turn_id,
            } = match start {
                BeginPromptTurnOutcome::Started(started) => started,
                BeginPromptTurnOutcome::Skipped(outcome) => {
                    tracing::info!(
                        session_id = %self.session_id,
                        outcome = subagent_wake_skip_class(&outcome),
                        "completion wake stopped before ACP dispatch"
                    );
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
            let unload_deadline = tokio::time::sleep(UNLOAD_CANCEL_GRACE);
            tokio::pin!(unload_deadline);
            let mut unload_requested = false;
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

            // Armed only by `SessionCommand::Stop`; see
            // `ACTIVE_TURN_STOP_BOUND`. Same shape as `run.rs`'s
            // `queue_drain_not_before` arm: an absolute instant plus an `if`
            // precondition, so the disabled arm costs nothing.
            let mut stop_bound_at: Option<tokio::time::Instant> = None;
            let mut abandoned_for_stop = false;

            while prompt_result.is_none() && !abandoned_for_stop {
                let stop_bound_armed = stop_bound_at.is_some();
                let stop_bound_deadline = stop_bound_at.unwrap_or_else(tokio::time::Instant::now);
                tokio::select! {
                    _ = tokio::time::sleep_until(stop_bound_deadline), if stop_bound_armed => {
                        tracing::warn!(
                            session_id = %self.session_id,
                            prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                            bound_ms = ACTIVE_TURN_STOP_BOUND.as_millis() as u64,
                            "session.actor.stop.turn_unwind_bound_exceeded"
                        );
                        abandoned_for_stop = true;
                    }
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
                    _ = &mut unload_deadline, if unload_requested => {
                        break;
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
                            Some(SessionCommand::CancelTurnIfActive { expected_turn_id, respond_to }) => {
                                // Serial exact-turn comparison: forward ACP
                                // cancellation only for the current active
                                // turn; a stale stored id never cancels newer
                                // foreign work.
                                if expected_turn_id == turn_id {
                                    self.resolve_pending_interactions(Resolution::Cancelled).await;
                                    let _ = self.conn
                                        .send_notification(acp::schema::CancelNotification::new(self.native_session_id.clone()));
                                    let _ = respond_to.send(ConditionalCancelOutcome::Requested);
                                } else {
                                    let _ = respond_to.send(ConditionalCancelOutcome::NotActive);
                                }
                            }
                            Some(SessionCommand::Dismiss { respond_to }) => {
                                self.resolve_pending_interactions(Resolution::Dismissed).await;
                                let _ = self.conn
                                    .send_notification(acp::schema::CancelNotification::new(self.native_session_id.clone()));
                                let _ = respond_to.send(Ok(()));
                                exit_after_prompt = Some(ActorExitDisposition::Dismiss);
                            }
                            Some(SessionCommand::Unload { respond_to }) => {
                                self.resolve_pending_interactions(Resolution::Cancelled).await;
                                let _ = self.conn
                                    .send_notification(acp::schema::CancelNotification::new(self.native_session_id.clone()));
                                let _ = respond_to.send(Ok(()));
                                unload_requested = true;
                                unload_deadline.as_mut().reset(tokio::time::Instant::now() + UNLOAD_CANCEL_GRACE);
                                exit_after_prompt = Some(ActorExitDisposition::Unload);
                            }
                            Some(SessionCommand::UnloadIfIdle { respond_to }) => {
                                // A turn is running, so the reaper's
                                // observation is stale by definition. Refuse:
                                // the unconditional `Unload` above would
                                // cancel this turn and discard its work, and
                                // the price of a reap is a cold start, never
                                // a turn.
                                let _ = respond_to.send(ConditionalUnloadOutcome::Retained(
                                    UnloadRetainedReason::ActiveTurn,
                                ));
                            }
                            Some(SessionCommand::Stop { respond_to }) => {
                                self.resolve_pending_interactions(Resolution::Dismissed).await;
                                let _ = self.conn
                                    .send_notification(acp::schema::CancelNotification::new(self.native_session_id.clone()));
                                // Stored, not sent: `run()`'s exit sequence
                                // fires this only after the process-group
                                // kill escalation confirms death.
                                self.pending_stop_response = Some(respond_to);
                                exit_after_prompt = Some(ActorExitDisposition::Dismiss);
                                // Race the cooperative cancel against a short
                                // bound; an agent that ignores it must not be
                                // able to hold the stop open for the length
                                // of its turn.
                                stop_bound_at = Some(
                                    tokio::time::Instant::now() + ACTIVE_TURN_STOP_BOUND,
                                );
                            }
                            Some(SessionCommand::ResolveInteraction { request_id, resolution, respond_to }) => {
                                let result = self.resolve_interaction(request_id, resolution).await;
                                let _ = respond_to.send(result);
                            }
                            Some(SessionCommand::RunDomainOp { op, respond_to }) => {
                                if let Some(result) = self.run_domain_op_cmd(op).await {
                                    let _ = respond_to.send(result);
                                } else {
                                    unload_requested = true;
                                    unload_deadline.as_mut().reset(
                                        tokio::time::Instant::now() + UNLOAD_CANCEL_GRACE,
                                    );
                                    exit_after_prompt = Some(ActorExitDisposition::Unload);
                                }
                            }
                            Some(SessionCommand::CallAgentExtMethod { method, params, respond_to }) => {
                                // Dispatched off the actor loop (see
                                // `spawn_agent_ext_method`): awaiting a sidecar
                                // confirmation inline here would freeze the
                                // streaming turn, notifications, Cancel, and the
                                // ResolveInteraction that must answer a pending
                                // permission before the goal write can land.
                                self.spawn_agent_ext_method(method, params, respond_to);
                            }
                            Some(SessionCommand::VerifyForkReady { respond_to, .. }) => {
                                let _ = respond_to.send(Err(ForkSessionCommandError::Busy));
                            }
                            Some(SessionCommand::Fork { respond_to, .. }) => {
                                let _ = respond_to.send(Err(ForkSessionCommandError::Busy));
                            }
                            Some(SessionCommand::SidedoorTargetedFork { respond_to, .. }) => {
                                let _ = respond_to.send(Err(crate::live::sessions::SidedoorForkCommandError::Busy));
                            }
                            Some(SessionCommand::CloseNativeSession { respond_to, .. }) => {
                                reject_busy_close_native_child_session(respond_to);
                            }
                            Some(SessionCommand::InjectRuntimeEvent { event, respond_to }) => {
                                let result = self.inject_runtime_event(event).await;
                                let _ = respond_to.send(result);
                            }
                            Some(SessionCommand::SetConfigOption {
                                config_id,
                                value,
                                live_snapshot_authorized_model,
                                respond_to,
                            }) => {
                                let result = self
                                    .handle_busy_config_command(
                                        &config_id,
                                        &value,
                                        live_snapshot_authorized_model,
                                    )
                                    .await;
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
                            Some(SessionCommand::ReorderPendingPrompts {
                                expected_seqs,
                                desired_seqs,
                                respond_to,
                            }) => {
                                let _ = respond_to.send(
                                    self.handle_reorder_pending_prompts(expected_seqs, desired_seqs).await,
                                );
                            }
                            Some(SessionCommand::SteerPendingPrompt { seq, respond_to }) => {
                                let _ = respond_to.send(
                                    self.handle_steer_pending_prompt(seq, true).await,
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

            if abandoned_for_stop {
                // The agent never unwound within the bound. Close the turn in
                // the transcript so it does not hang open forever, then fall
                // straight through to `run()`'s exit sequence, whose group
                // escalation reaps the agent process regardless of whether
                // the cancel was ever honored. `finish_prompt_result` is
                // deliberately skipped: there is no prompt result, and the
                // agent it would have reported on is about to be killed.
                {
                    let mut sink = self.event_sink.lock().await;
                    sink.turn_ended(anyharness_contract::v1::StopReason::Cancelled);
                }
                self.resume_replay_filter.disable();
                break 'drain;
            }

            let broken_session = if unload_requested {
                self.finish_forced_unload_cancel(
                    &mut prompt_diagnostics,
                    notification_rx,
                    background_work_rx,
                )
                .await;
                false
            } else {
                let result = prompt_result.expect("prompt_result must be set");
                self.finish_prompt_result(
                    result,
                    &mut prompt_diagnostics,
                    notification_rx,
                    background_work_rx,
                )
                .await
            };

            self.resume_replay_filter.disable();

            if broken_session && exit_after_prompt.is_none() {
                // Terminal persistence exhausted its bounded retry while the
                // exact frozen batch remains in the sink. Retire this actor
                // before it can re-enter idle and accept any event-producing
                // work; the no-live-handle subagent recovery pass owns the
                // durable open turn from here.
                exit_after_prompt = Some(ActorExitDisposition::Unload);
            }
            if exit_after_prompt.is_some() || broken_session {
                break 'drain;
            }

            // Return through the idle loop even when more durable prompts are
            // queued. Its biased select gives accepted reorder/steer commands
            // precedence before choosing the next head.
            break 'drain;
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

fn subagent_wake_skip_class(
    outcome: &crate::live::sessions::sink::SubagentWakeTurnStartOutcome,
) -> &'static str {
    match outcome {
        crate::live::sessions::sink::SubagentWakeTurnStartOutcome::Admitted { .. } => "admitted",
        crate::live::sessions::sink::SubagentWakeTurnStartOutcome::AlreadyVisible => {
            "already_visible"
        }
        crate::live::sessions::sink::SubagentWakeTurnStartOutcome::Discarded => "discarded",
        crate::live::sessions::sink::SubagentWakeTurnStartOutcome::Stale => "stale",
    }
}
