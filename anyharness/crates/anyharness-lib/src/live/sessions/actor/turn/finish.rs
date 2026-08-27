use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionExecutionPhase, StopReason};
use tokio::sync::mpsc;

use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::integrations::acp::provider_errors::{
    classify_network_connection_error, classify_provider_model_error,
    classify_provider_rate_limit_error, classify_seat_usage_limit_error, NETWORK_CONNECTION_CODE,
    PROVIDER_RATE_LIMIT_CODE, SEAT_USAGE_LIMIT_CODE,
};
use crate::live::sessions::actor::config::queue::apply_pending_config_changes_if_idle;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::actor::turn::diagnostics::{age_ms, PromptDiagnostics};
use crate::live::sessions::actor::turn::types::SessionTurnFinishResult;
use crate::live::sessions::background_work::BackgroundWorkUpdate;
use crate::live::sessions::model::TerminalTurnOutcome;
use crate::live::sessions::sink::{
    PromptTerminalEvent, SessionEventSinkDebugSnapshot, TerminalTurnCommit,
};

const TERMINAL_PERSIST_ATTEMPTS: u32 = 4;
const TERMINAL_PERSIST_BASE_DELAY_MS: u64 = 25;
const TERMINAL_PERSIST_MAX_DELAY_MS: u64 = 200;

pub(in crate::live::sessions::actor) const EMPTY_TURN_ERROR_CODE: &str = "empty_turn";
pub(in crate::live::sessions::actor) const EMPTY_TURN_ERROR_MESSAGE: &str = "The agent ended the turn without producing a response. The selected model or provider may need additional configuration or credentials.";

pub(in crate::live::sessions::actor) fn should_emit_empty_turn_error(
    stop: &StopReason,
    diagnostics: &PromptDiagnostics,
    sink_snapshot: &SessionEventSinkDebugSnapshot,
) -> bool {
    matches!(stop, StopReason::EndTurn)
        && diagnostics.last_agent_chunk_at.is_none()
        && diagnostics.last_agent_thought_at.is_none()
        && diagnostics.last_tool_event_at.is_none()
        && diagnostics.last_plan_at.is_none()
        && sink_snapshot.open_assistant_item_id.is_none()
        && sink_snapshot.open_assistant_chars == 0
        && sink_snapshot.open_reasoning_item_id.is_none()
        && sink_snapshot.open_reasoning_chars == 0
        && sink_snapshot.open_plan_item_id.is_none()
        && sink_snapshot.open_tool_call_ids.is_empty()
}

pub(in crate::live::sessions::actor) fn map_stop_reason(
    stop_reason: &acp::schema::StopReason,
) -> StopReason {
    match stop_reason {
        acp::schema::StopReason::EndTurn => StopReason::EndTurn,
        acp::schema::StopReason::MaxTokens => StopReason::MaxTokens,
        acp::schema::StopReason::MaxTurnRequests => StopReason::MaxTurnRequests,
        acp::schema::StopReason::Refusal => StopReason::Refusal,
        acp::schema::StopReason::Cancelled => StopReason::Cancelled,
        #[allow(unreachable_patterns)]
        _ => StopReason::Cancelled,
    }
}

impl SessionActor {
    async fn persist_prompt_terminal(
        &self,
        outcome: SessionTurnOutcome,
        terminal: PromptTerminalEvent,
    ) -> anyhow::Result<TerminalTurnCommit> {
        {
            let mut sink = self.event_sink.lock().await;
            sink.stage_prompt_terminal(map_terminal_outcome(outcome), terminal)?;
        }
        commit_staged_terminal_with_retry(&self.event_sink, &self.session_id).await
    }

    /// Finalize a turn when a non-terminal actor unload has waited its bounded
    /// cancellation grace period and the ACP peer still has not resolved the
    /// prompt request. Notifications already received remain durable; this
    /// closes their open sink items as a cancelled turn without fabricating a
    /// provider error or terminal session state.
    pub(in crate::live::sessions::actor) async fn finish_forced_unload_cancel(
        &mut self,
        prompt_diagnostics: &mut PromptDiagnostics,
        notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        background_work_rx: &mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    ) {
        while let Ok(notif) = notification_rx.try_recv() {
            prompt_diagnostics.observe_notification(&notif);
            self.handle_notification(&notif).await;
        }
        while let Ok(update) = background_work_rx.try_recv() {
            self.handle_background(update).await;
        }

        let committed = match self
            .persist_prompt_terminal(
                SessionTurnOutcome::Cancelled,
                PromptTerminalEvent::TurnEnded(StopReason::Cancelled),
            )
            .await
        {
            Ok(committed) => committed,
            Err(error) => {
                tracing::error!(
                    session_id = %self.session_id,
                    failure_code = "terminal_persist_exhausted",
                    error_class = terminal_persist_error_class(&error),
                    "forced unload left a durable open turn for startup repair"
                );
                return;
            }
        };
        let now = chrono::Utc::now().to_rfc3339();
        self.handle
            .set_execution_phase(SessionExecutionPhase::Idle)
            .await;
        let _ = self
            .caps
            .state
            .update_status(&self.session_id, "idle", &now);

        if let Some(callback) = self.hooks.on_turn_finish.as_ref() {
            callback(SessionTurnFinishResult {
                session_id: self.session_id.clone(),
                turn_id: committed.turn_id,
                prompt_id: prompt_diagnostics.prompt_id.clone(),
                outcome: SessionTurnOutcome::Cancelled,
                // Hook-only marker: the durable row above keeps the plain
                // Cancelled stop, but extensions must be able to tell a
                // platform unload from a user cancel (the workflow engine
                // parks these as app_shutdown, not user_cancel).
                stop_reason: Some("forced_unload".to_string()),
                last_event_seq: committed.last_event_seq,
                error_details: None,
            });
        }
    }

    /// Settles a resolved prompt request: drains straggler notifications and
    /// background updates, emits turn end (or the error), writes the durable
    /// status row, and fires the turn-finish hook. Returns `true` when the
    /// session is broken and the drain loop must stop.
    pub(in crate::live::sessions::actor) async fn finish_prompt_result(
        &mut self,
        result: acp::Result<acp::schema::PromptResponse>,
        prompt_diagnostics: &mut PromptDiagnostics,
        notification_rx: &mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
        background_work_rx: &mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    ) -> bool {
        match result {
            Ok(resp) => {
                while let Ok(notif) = notification_rx.try_recv() {
                    prompt_diagnostics.observe_notification(&notif);
                    self.handle_notification(&notif).await;
                }
                while let Ok(update) = background_work_rx.try_recv() {
                    self.handle_background(update).await;
                }
                let sink_snapshot_before_turn_end = {
                    let sink = self.event_sink.lock().await;
                    sink.debug_snapshot()
                };
                tracing::info!(
                    target: "anyharness.turn.finished",
                    session_id = %self.session_id,
                    prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                    turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                    stop_reason = ?resp.stop_reason,
                    conn = "resolved",
                    prompt_elapsed_ms = prompt_diagnostics.prompt_started_at.elapsed().as_millis() as u64,
                    last_raw_kind = ?prompt_diagnostics.last_raw_kind,
                    last_raw_age_ms = age_ms(prompt_diagnostics.last_raw_at),
                    last_agent_chunk_age_ms = age_ms(prompt_diagnostics.last_agent_chunk_at),
                    last_agent_preview = prompt_diagnostics.last_agent_preview.as_deref().unwrap_or(""),
                    last_agent_thought_age_ms = age_ms(prompt_diagnostics.last_agent_thought_at),
                    last_transient_status_age_ms = age_ms(prompt_diagnostics.last_transient_status_at),
                    last_transient_status = prompt_diagnostics.last_transient_status.as_deref().unwrap_or(""),
                    open_assistant_item_id = ?sink_snapshot_before_turn_end.open_assistant_item_id,
                    open_tool_call_ids = ?sink_snapshot_before_turn_end.open_tool_call_ids,
                    open_plan_item_id = ?sink_snapshot_before_turn_end.open_plan_item_id,
                    background_work_count = self.background_work_registry.tracker_count(),
                    "session.actor.prompt.conn_resolved"
                );
                let stop = map_stop_reason(&resp.stop_reason);
                let emit_empty_turn_error = should_emit_empty_turn_error(
                    &stop,
                    prompt_diagnostics,
                    &sink_snapshot_before_turn_end,
                );
                if emit_empty_turn_error {
                    tracing::warn!(
                        session_id = %self.session_id,
                        prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                        turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                        stop_reason = ?resp.stop_reason,
                        last_raw_kind = ?prompt_diagnostics.last_raw_kind,
                        last_raw_age_ms = age_ms(prompt_diagnostics.last_raw_at),
                        last_transient_status_age_ms = age_ms(prompt_diagnostics.last_transient_status_at),
                        last_transient_status = prompt_diagnostics.last_transient_status.as_deref().unwrap_or(""),
                        last_usage_age_ms = age_ms(prompt_diagnostics.last_usage_at),
                        "session.actor.prompt.empty_turn_error_emitted"
                    );
                }
                let outcome = if matches!(stop, anyharness_contract::v1::StopReason::Cancelled) {
                    SessionTurnOutcome::Cancelled
                } else if emit_empty_turn_error {
                    SessionTurnOutcome::Failed
                } else {
                    SessionTurnOutcome::Completed
                };
                let stop_reason = stop.to_string();
                let terminal = if emit_empty_turn_error {
                    PromptTerminalEvent::ErrorAndTurnEnded {
                        message: EMPTY_TURN_ERROR_MESSAGE.to_string(),
                        code: Some(EMPTY_TURN_ERROR_CODE.to_string()),
                        details: None,
                        stop_reason: stop,
                    }
                } else {
                    PromptTerminalEvent::TurnEnded(stop)
                };
                let committed = match self.persist_prompt_terminal(outcome, terminal).await {
                    Ok(committed) => committed,
                    Err(error) => {
                        tracing::error!(
                            session_id = %self.session_id,
                            failure_code = "terminal_persist_exhausted",
                            error_class = terminal_persist_error_class(&error),
                            "provider result left a durable open turn for startup repair"
                        );
                        return true;
                    }
                };
                tracing::info!(
                    session_id = %self.session_id,
                    prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                    turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                    "session.actor.prompt.turn_ended_emitted"
                );
                let now = chrono::Utc::now().to_rfc3339();
                self.handle
                    .set_execution_phase(SessionExecutionPhase::Idle)
                    .await;
                let _ = self
                    .caps
                    .state
                    .update_status(&self.session_id, "idle", &now);
                tracing::info!(
                    session_id = %self.session_id,
                    prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                    turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                    updated_at = %now,
                    "session.actor.prompt.status_idle_written"
                );
                if let Some(callback) = self.hooks.on_turn_finish.as_ref() {
                    callback(SessionTurnFinishResult {
                        session_id: self.session_id.clone(),
                        turn_id: committed.turn_id.clone(),
                        prompt_id: prompt_diagnostics.prompt_id.clone(),
                        outcome,
                        stop_reason: Some(stop_reason),
                        last_event_seq: committed.last_event_seq,
                        error_details: None,
                    });
                }
                if let Err(error) = apply_pending_config_changes_if_idle(
                    &self.conn,
                    &self.native_session_id,
                    &self.agent_kind,
                    &self.session_id,
                    self.caps.state.as_ref(),
                    &self.event_sink,
                    &mut self.persisted_config_state,
                    &mut self.startup_state,
                )
                .await
                {
                    tracing::warn!(session_id = %self.session_id, error = %error, "failed to apply pending config changes after turn end");
                }
                false
            }
            Err(e) => {
                let sink_snapshot_on_error = {
                    let sink = self.event_sink.lock().await;
                    sink.debug_snapshot()
                };
                // Inspect the structured ACP error before flattening it for
                // diagnostics. The sink path below consumes the bounded
                // classification by value and preserves the raw cause.
                let provider_model_code = classify_provider_model_error(&self.agent_kind, &e);
                let error_message = e.to_string();
                // Seat usage-limit classification runs FIRST, gated on this
                // session actually running on a recorded serving seat — a
                // limit error on a non-seat route must never produce seat
                // events or cooling.
                let seat_usage_limit = self.serving_seat_id.as_ref().and_then(|seat_id| {
                    classify_seat_usage_limit_error(&error_message)
                        .map(|observation| (seat_id.clone(), observation))
                });
                let (error_details, error_code) = if let Some((seat_id, observation)) =
                    seat_usage_limit
                {
                    (
                        Some(self.observe_seat_usage_limit(seat_id, observation)),
                        Some(SEAT_USAGE_LIMIT_CODE.to_string()),
                    )
                } else if let Some(details) = classify_provider_rate_limit_error(&error_message) {
                    (Some(details), Some(PROVIDER_RATE_LIMIT_CODE.to_string()))
                } else if let Some(code) = provider_model_code {
                    (None, Some(code.to_string()))
                } else if let Some(details) = classify_network_connection_error(&error_message) {
                    (Some(details), Some(NETWORK_CONNECTION_CODE.to_string()))
                } else {
                    (None, None)
                };
                tracing::warn!(
                    target: "anyharness.turn.failed",
                    session_id = %self.session_id,
                    prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                    turn_id = ?sink_snapshot_on_error.current_turn_id,
                    error = %error_message,
                    error_class = error_code.as_deref().unwrap_or("unclassified"),
                    conn = "failed",
                    prompt_elapsed_ms = prompt_diagnostics.prompt_started_at.elapsed().as_millis() as u64,
                    last_raw_kind = ?prompt_diagnostics.last_raw_kind,
                    last_raw_age_ms = age_ms(prompt_diagnostics.last_raw_at),
                    last_agent_chunk_age_ms = age_ms(prompt_diagnostics.last_agent_chunk_at),
                    last_agent_preview = prompt_diagnostics.last_agent_preview.as_deref().unwrap_or(""),
                    last_agent_thought_age_ms = age_ms(prompt_diagnostics.last_agent_thought_at),
                    last_transient_status_age_ms = age_ms(prompt_diagnostics.last_transient_status_at),
                    last_transient_status = prompt_diagnostics.last_transient_status.as_deref().unwrap_or(""),
                    open_assistant_item_id = ?sink_snapshot_on_error.open_assistant_item_id,
                    open_tool_call_ids = ?sink_snapshot_on_error.open_tool_call_ids,
                    open_plan_item_id = ?sink_snapshot_on_error.open_plan_item_id,
                    background_work_count = self.background_work_registry.tracker_count(),
                    "session.actor.prompt.conn_failed"
                );
                let committed = match self
                    .persist_prompt_terminal(
                        SessionTurnOutcome::Failed,
                        PromptTerminalEvent::Error {
                            message: error_message,
                            code: error_code,
                            details: error_details.clone(),
                        },
                    )
                    .await
                {
                    Ok(committed) => committed,
                    Err(error) => {
                        tracing::error!(
                            session_id = %self.session_id,
                            failure_code = "terminal_persist_exhausted",
                            error_class = terminal_persist_error_class(&error),
                            "provider failure left a durable open turn for startup repair"
                        );
                        return true;
                    }
                };
                let now = chrono::Utc::now().to_rfc3339();
                self.handle
                    .set_execution_phase(SessionExecutionPhase::Errored)
                    .await;
                let _ = self
                    .caps
                    .state
                    .update_status(&self.session_id, "errored", &now);
                if let Some(callback) = self.hooks.on_turn_finish.as_ref() {
                    callback(SessionTurnFinishResult {
                        session_id: self.session_id.clone(),
                        turn_id: committed.turn_id,
                        prompt_id: prompt_diagnostics.prompt_id.clone(),
                        outcome: SessionTurnOutcome::Failed,
                        stop_reason: None,
                        last_event_seq: committed.last_event_seq,
                        error_details,
                    });
                }
                true
            }
        }
    }

    /// A classified seat usage-limit error: mark the serving seat cooling
    /// (locally — never a network call) and build the typed turn-error
    /// details. The cooling deadline is the reset the error carried, else the
    /// top of the next 5-hour window (`seat_cooling::next_five_hour_window_top`),
    /// clamped to one week (`seat_cooling::clamp_cooling_deadline`) so the
    /// reported `reset_at` matches what the store can actually hold.
    /// `seat_id` is the vault uuid — never the token.
    fn observe_seat_usage_limit(
        &self,
        seat_id: String,
        observation: crate::integrations::acp::provider_errors::SeatUsageLimitObservation,
    ) -> anyharness_contract::v1::ErrorEventDetails {
        use crate::domains::agents::seat_cooling::{clamp_cooling_deadline, next_five_hour_window_top};
        let now_epoch_s = chrono::Utc::now().timestamp();
        let cooling_until_epoch_s = clamp_cooling_deadline(
            now_epoch_s,
            observation
                .reset_at_epoch_s
                .unwrap_or_else(|| next_five_hour_window_top(now_epoch_s)),
        );
        if let Some(store) = self.caps.seat_cooling.as_ref() {
            store.mark_cooling(
                &seat_id,
                &self.agent_kind,
                cooling_until_epoch_s,
                Some(observation.window),
                now_epoch_s,
            );
            // The status document's cooling banner must move the moment the
            // machine knows (agent_auth spec §2: event-refreshed, never
            // computed on read). Degrade-with-warn inside; never gates.
            if let Some(agent_status) = self.caps.agent_status.as_ref() {
                agent_status.refresh(
                    &self.agent_kind,
                    crate::domains::agent_auth::status::RefreshCause::SeatCooling,
                );
            }
        } else {
            tracing::warn!(
                session_id = %self.session_id,
                seat_id = %seat_id,
                "seat usage limit observed but no seat-cooling store is wired; not marking cooling"
            );
        }
        tracing::warn!(
            session_id = %self.session_id,
            seat_id = %seat_id,
            window = observation.window,
            cooling_until_epoch_s,
            "seat usage limit observed; seat marked cooling"
        );
        let reset_at = chrono::DateTime::from_timestamp(cooling_until_epoch_s, 0)
            .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
            .unwrap_or_default();
        anyharness_contract::v1::ErrorEventDetails::SeatUsageLimit {
            seat_id,
            window: observation.window.to_string(),
            reset_at,
        }
    }
}

fn map_terminal_outcome(outcome: SessionTurnOutcome) -> TerminalTurnOutcome {
    match outcome {
        SessionTurnOutcome::Completed => TerminalTurnOutcome::Completed,
        SessionTurnOutcome::Failed => TerminalTurnOutcome::Failed,
        SessionTurnOutcome::Cancelled => TerminalTurnOutcome::Cancelled,
    }
}

pub(in crate::live::sessions::actor) async fn commit_staged_terminal_with_retry(
    event_sink: &std::sync::Arc<tokio::sync::Mutex<crate::live::sessions::sink::SessionEventSink>>,
    session_id: &str,
) -> anyhow::Result<TerminalTurnCommit> {
    for attempt in 0..TERMINAL_PERSIST_ATTEMPTS {
        let result = {
            let mut sink = event_sink.lock().await;
            sink.commit_staged_prompt_terminal()
        };
        match result {
            Ok(committed) => return Ok(committed),
            Err(error) if attempt + 1 < TERMINAL_PERSIST_ATTEMPTS => {
                let delay_ms = TERMINAL_PERSIST_BASE_DELAY_MS
                    .saturating_mul(1_u64 << attempt)
                    .min(TERMINAL_PERSIST_MAX_DELAY_MS);
                tracing::warn!(
                    session_id,
                    attempt = attempt + 1,
                    failure_code = "terminal_persist_retry",
                    error_class = terminal_persist_error_class(&error),
                    "terminal turn persistence deferred"
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            Err(error) => return Err(error),
        }
    }
    unreachable!("terminal persistence loop returns on its final attempt")
}

pub(in crate::live::sessions::actor) fn terminal_persist_error_class(
    error: &anyhow::Error,
) -> &'static str {
    if error.downcast_ref::<rusqlite::Error>().is_some() {
        "sqlite"
    } else {
        "runtime"
    }
}
