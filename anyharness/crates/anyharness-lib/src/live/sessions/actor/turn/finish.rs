use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionExecutionPhase, StopReason};
use tokio::sync::{mpsc, Mutex};

use crate::acp::provider_errors::{classify_provider_rate_limit_error, PROVIDER_RATE_LIMIT_CODE};
use crate::live::sessions::actor::background_work::handle_background_work_update;
use crate::live::sessions::actor::config::queue::apply_pending_config_changes_if_idle;
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::handle::handle_notification_with_resume_replay_filter;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::{SessionActorConfig, SessionStartupState};
use crate::live::sessions::actor::turn::diagnostics::{age_ms, PromptDiagnostics};
use crate::live::sessions::actor::turn::types::SessionTurnFinishResult;
use crate::live::sessions::background_work::{BackgroundWorkRegistry, BackgroundWorkUpdate};
use crate::live::sessions::event_sink::{SessionEventSink, SessionEventSinkDebugSnapshot};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};
use crate::sessions::extensions::SessionTurnOutcome;
use crate::sessions::store::SessionStore;

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
    stop_reason: &acp::StopReason,
) -> StopReason {
    match stop_reason {
        acp::StopReason::EndTurn => StopReason::EndTurn,
        acp::StopReason::MaxTokens => StopReason::MaxTokens,
        acp::StopReason::MaxTurnRequests => StopReason::MaxTurnRequests,
        acp::StopReason::Refusal => StopReason::Refusal,
        acp::StopReason::Cancelled => StopReason::Cancelled,
        #[allow(unreachable_patterns)]
        _ => StopReason::Cancelled,
    }
}

pub(in crate::live::sessions::actor) struct PromptFinishContext<'a> {
    pub config: &'a SessionActorConfig,
    pub conn: &'a acp::ClientSideConnection,
    pub native_session_id: &'a str,
    pub notification_rx: &'a mut mpsc::UnboundedReceiver<acp::SessionNotification>,
    pub background_work_rx: &'a mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    pub background_work_registry: &'a mut BackgroundWorkRegistry,
    pub event_sink: &'a Arc<Mutex<SessionEventSink>>,
    pub persisted_config_state: &'a mut PersistedSessionConfigState,
    pub startup_state: &'a mut SessionStartupState,
    pub resume_replay_filter: &'a mut ResumeReplayFilter,
    pub handle: &'a Arc<LiveSessionHandle>,
    pub store: &'a SessionStore,
    pub session_id: &'a str,
    pub workspace_id: &'a str,
    pub source_agent_kind: &'a str,
}

pub(in crate::live::sessions::actor) async fn finish_prompt_result(
    context: PromptFinishContext<'_>,
    result: acp::Result<acp::PromptResponse>,
    latency: Option<&LatencyRequestContext>,
    prompt_diagnostics: &mut PromptDiagnostics,
) -> bool {
    let PromptFinishContext {
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
    } = context;
    let latency_fields = latency_trace_fields(latency);

    match result {
        Ok(resp) => {
            while let Ok(notif) = notification_rx.try_recv() {
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
                )
                .await;
            }
            while let Ok(update) = background_work_rx.try_recv() {
                handle_background_work_update(event_sink, store, session_id, update).await;
            }
            let sink_snapshot_before_turn_end = {
                let sink = event_sink.lock().await;
                sink.debug_snapshot()
            };
            tracing::info!(
                session_id = %session_id,
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                stop_reason = ?resp.stop_reason,
                prompt_elapsed_ms = prompt_diagnostics.prompt_started_at.elapsed().as_millis() as u64,
                last_raw_kind = ?prompt_diagnostics.last_raw_kind,
                last_raw_age_ms = age_ms(prompt_diagnostics.last_raw_at),
                last_agent_chunk_age_ms = age_ms(prompt_diagnostics.last_agent_chunk_at),
                last_agent_preview = prompt_diagnostics.last_agent_preview.as_deref().unwrap_or(""),
                open_assistant_item_id = ?sink_snapshot_before_turn_end.open_assistant_item_id,
                open_tool_call_ids = ?sink_snapshot_before_turn_end.open_tool_call_ids,
                open_plan_item_id = ?sink_snapshot_before_turn_end.open_plan_item_id,
                background_work_count = background_work_registry.tracker_count(),
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
                    session_id = %session_id,
                    flow_id = latency_fields.flow_id,
                    flow_kind = latency_fields.flow_kind,
                    flow_source = latency_fields.flow_source,
                    prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                    turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                    stop_reason = ?resp.stop_reason,
                    last_raw_kind = ?prompt_diagnostics.last_raw_kind,
                    last_raw_age_ms = age_ms(prompt_diagnostics.last_raw_at),
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
            let mut sink = event_sink.lock().await;
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
                session_id = %session_id,
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                "session.actor.prompt.turn_ended_emitted"
            );
            let now = chrono::Utc::now().to_rfc3339();
            handle
                .set_execution_phase(SessionExecutionPhase::Idle)
                .await;
            let _ = store.update_status(session_id, "idle", &now);
            tracing::info!(
                session_id = %session_id,
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                turn_id = ?sink_snapshot_before_turn_end.current_turn_id,
                updated_at = %now,
                "session.actor.prompt.status_idle_written"
            );
            if let Some(callback) = config.on_turn_finish.as_ref() {
                callback(SessionTurnFinishResult {
                    session_id: session_id.to_owned(),
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
                conn,
                native_session_id,
                source_agent_kind,
                session_id,
                store,
                event_sink,
                persisted_config_state,
                startup_state,
            )
            .await
            {
                tracing::warn!(session_id = %session_id, error = %error, "failed to apply pending config changes after turn end");
            }
            false
        }
        Err(e) => {
            let sink_snapshot_on_error = {
                let sink = event_sink.lock().await;
                sink.debug_snapshot()
            };
            tracing::warn!(
                session_id = %session_id,
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = ?prompt_diagnostics.prompt_id.as_deref(),
                turn_id = ?sink_snapshot_on_error.current_turn_id,
                error = %e,
                prompt_elapsed_ms = prompt_diagnostics.prompt_started_at.elapsed().as_millis() as u64,
                last_raw_kind = ?prompt_diagnostics.last_raw_kind,
                last_raw_age_ms = age_ms(prompt_diagnostics.last_raw_at),
                last_agent_chunk_age_ms = age_ms(prompt_diagnostics.last_agent_chunk_at),
                last_agent_preview = prompt_diagnostics.last_agent_preview.as_deref().unwrap_or(""),
                open_assistant_item_id = ?sink_snapshot_on_error.open_assistant_item_id,
                open_tool_call_ids = ?sink_snapshot_on_error.open_tool_call_ids,
                open_plan_item_id = ?sink_snapshot_on_error.open_plan_item_id,
                background_work_count = background_work_registry.tracker_count(),
                "session.actor.prompt.conn_failed"
            );
            let error_message = e.to_string();
            let error_details = classify_provider_rate_limit_error(&error_message);
            let error_code = error_details
                .as_ref()
                .map(|_| PROVIDER_RATE_LIMIT_CODE.to_string());
            let mut sink = event_sink.lock().await;
            sink.error_with_details(error_message, error_code, error_details.clone());
            let last_event_seq = sink.debug_snapshot().next_seq - 1;
            drop(sink);
            let now = chrono::Utc::now().to_rfc3339();
            handle
                .set_execution_phase(SessionExecutionPhase::Errored)
                .await;
            let _ = store.update_status(session_id, "errored", &now);
            if let Some(callback) = config.on_turn_finish.as_ref() {
                callback(SessionTurnFinishResult {
                    session_id: session_id.to_owned(),
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
