use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionExecutionPhase, StopReason};
use tokio::sync::mpsc;

use crate::acp::provider_errors::{
    classify_network_connection_error, classify_provider_rate_limit_error,
    NETWORK_CONNECTION_CODE, PROVIDER_RATE_LIMIT_CODE,
};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::live::sessions::actor::config::queue::apply_pending_config_changes_if_idle;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::actor::turn::diagnostics::{age_ms, PromptDiagnostics};
use crate::live::sessions::actor::turn::types::SessionTurnFinishResult;
use crate::live::sessions::background_work::BackgroundWorkUpdate;
use crate::live::sessions::sink::SessionEventSinkDebugSnapshot;

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
                    session_id = %self.session_id,
                    prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                    turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                    stop_reason = ?resp.stop_reason,
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
                let mut sink = self.event_sink.lock().await;
                if emit_empty_turn_error {
                    sink.error(
                        EMPTY_TURN_ERROR_MESSAGE.to_string(),
                        Some(EMPTY_TURN_ERROR_CODE.to_string()),
                    );
                }
                sink.turn_ended(stop);
                let last_event_seq = sink.debug_snapshot().next_seq - 1;
                drop(sink);
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
                        turn_id: sink_snapshot_before_turn_end
                            .current_turn_id
                            .clone()
                            .unwrap_or_default(),
                        outcome,
                        stop_reason: Some(stop_reason),
                        last_event_seq,
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
                tracing::warn!(
                    session_id = %self.session_id,
                    prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                    turn_id = ?sink_snapshot_on_error.current_turn_id,
                    error = %e,
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
                let error_message = e.to_string();
                let (error_details, error_code) =
                    match classify_provider_rate_limit_error(&error_message) {
                        Some(details) => (Some(details), Some(PROVIDER_RATE_LIMIT_CODE.to_string())),
                        None => match classify_network_connection_error(&error_message) {
                            Some(details) => {
                                (Some(details), Some(NETWORK_CONNECTION_CODE.to_string()))
                            }
                            None => (None, None),
                        },
                    };
                let mut sink = self.event_sink.lock().await;
                sink.error_with_details(error_message, error_code, error_details.clone());
                let last_event_seq = sink.debug_snapshot().next_seq - 1;
                drop(sink);
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
                        turn_id: sink_snapshot_on_error
                            .current_turn_id
                            .clone()
                            .unwrap_or_default(),
                        outcome: SessionTurnOutcome::Failed,
                        stop_reason: None,
                        last_event_seq,
                        error_details,
                    });
                }
                true
            }
        }
    }
}
