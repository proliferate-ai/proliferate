use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{
    AvailableCommandsUpdatePayload, CurrentModeUpdatePayload, SessionInfoUpdatePayload,
    UsageUpdatePayload,
};
use tokio::sync::Mutex;

use crate::domains::plans::service::PlanService;
use crate::domains::reviews::service::ReviewService;
use crate::live::sessions::actor::config::apply::set_select_option_current_value_for_purpose;
use crate::live::sessions::actor::config::persist::{
    emit_live_config_update, persist_current_config_state_from_startup,
};
use crate::live::sessions::actor::config::types::{ConfigPurpose, PersistedSessionConfigState};
use crate::live::sessions::actor::notifications::plans::{
    maybe_ingest_claude_exit_plan, maybe_ingest_codex_completed_plan,
    maybe_ingest_tagged_completed_plan,
};
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::background_work::BackgroundWorkRegistry;
use crate::live::sessions::event_sink::{AcpChunkPayload, AcpToolPayload, SessionEventSink};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::sessions::runtime_event::{RuntimeEventInjectionResult, RuntimeInjectedSessionEvent};
use crate::sessions::store::SessionStore;
pub(in crate::live::sessions::actor) async fn inject_runtime_event(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    handle: &Arc<LiveSessionHandle>,
    event: RuntimeInjectedSessionEvent,
) -> RuntimeEventInjectionResult {
    let touch_session_activity = event.updates_session_activity_at();
    let result = event_sink.lock().await.inject_runtime_event(event);
    if touch_session_activity {
        if let Ok(envelope) = &result {
            handle.mark_activity_at(envelope.timestamp.clone()).await;
        }
    }
    result
}

pub(in crate::live::sessions::actor) async fn normalize_notification(
    notif: &acp::SessionNotification,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_store: &SessionStore,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    plan_service: Arc<PlanService>,
    review_service: Option<Arc<ReviewService>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    use acp::SessionUpdate::*;
    match &notif.update {
        AgentMessageChunk(chunk) => {
            let payload = AcpChunkPayload {
                content: serialize_content_block(&chunk.content),
                meta: serialize_meta(chunk.meta.as_ref()),
                message_id: chunk.message_id.clone(),
            };
            if maybe_ingest_codex_completed_plan(
                event_sink,
                plan_service.as_ref(),
                review_service.as_deref(),
                session_id,
                workspace_id,
                source_agent_kind,
                &payload,
            )
            .await
            {
                return;
            }
            let completed = {
                let mut sink = event_sink.lock().await;
                sink.agent_message_chunk(payload)
            };
            maybe_ingest_tagged_completed_plan(
                event_sink,
                plan_service.as_ref(),
                review_service.as_deref(),
                session_id,
                workspace_id,
                source_agent_kind,
                completed,
            )
            .await;
        }
        AgentThoughtChunk(chunk) => {
            let mut sink = event_sink.lock().await;
            sink.agent_thought_chunk(AcpChunkPayload {
                content: serialize_content_block(&chunk.content),
                meta: serialize_meta(chunk.meta.as_ref()),
                message_id: chunk.message_id.clone(),
            });
        }
        ToolCall(tc) => {
            let payload = AcpToolPayload {
                tool_call_id: tc.tool_call_id.to_string(),
                title: Some(tc.title.clone()),
                kind: serde_json::to_value(tc.kind)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from)),
                status: serde_json::to_value(tc.status)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from)),
                content: Some(
                    tc.content
                        .iter()
                        .filter_map(|c| serde_json::to_value(c).ok())
                        .collect(),
                ),
                locations: Some(
                    tc.locations
                        .iter()
                        .filter_map(|l| serde_json::to_value(l).ok())
                        .collect(),
                ),
                raw_input: tc
                    .raw_input
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                raw_output: tc
                    .raw_output
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                meta: serialize_meta(tc.meta.as_ref()),
            };
            let turn_id = {
                let mut sink = event_sink.lock().await;
                sink.tool_call(payload.clone());
                sink.current_turn_id()
            };
            background_work_registry
                .observe_tool_payload(turn_id.clone(), &payload)
                .await;
            maybe_ingest_claude_exit_plan(
                event_sink,
                plan_service.as_ref(),
                review_service.as_deref(),
                session_id,
                workspace_id,
                source_agent_kind,
                turn_id,
                &payload,
            )
            .await;
        }
        ToolCallUpdate(tcu) => {
            let payload = AcpToolPayload {
                tool_call_id: tcu.tool_call_id.to_string(),
                title: tcu.fields.title.clone(),
                kind: tcu
                    .fields
                    .kind
                    .as_ref()
                    .and_then(|k| serde_json::to_value(k).ok())
                    .and_then(|v| v.as_str().map(String::from)),
                status: tcu
                    .fields
                    .status
                    .as_ref()
                    .and_then(|s| serde_json::to_value(s).ok())
                    .and_then(|v| v.as_str().map(String::from)),
                content: tcu.fields.content.as_ref().map(|cs| {
                    cs.iter()
                        .filter_map(|c| serde_json::to_value(c).ok())
                        .collect()
                }),
                locations: tcu.fields.locations.as_ref().map(|ls| {
                    ls.iter()
                        .filter_map(|l| serde_json::to_value(l).ok())
                        .collect()
                }),
                raw_input: tcu
                    .fields
                    .raw_input
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                raw_output: tcu
                    .fields
                    .raw_output
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                meta: serialize_meta(tcu.meta.as_ref()),
            };
            let turn_id = {
                let mut sink = event_sink.lock().await;
                sink.tool_call_update(payload.clone());
                sink.current_turn_id()
            };
            background_work_registry
                .observe_tool_payload(turn_id.clone(), &payload)
                .await;
            maybe_ingest_claude_exit_plan(
                event_sink,
                plan_service.as_ref(),
                review_service.as_deref(),
                session_id,
                workspace_id,
                source_agent_kind,
                turn_id,
                &payload,
            )
            .await;
        }
        Plan(plan) => {
            let entries = plan
                .entries
                .iter()
                .filter_map(|e| serde_json::to_value(e).ok())
                .collect();
            let mut sink = event_sink.lock().await;
            sink.plan(entries);
        }
        AvailableCommandsUpdate(cmds) => {
            let payload = AvailableCommandsUpdatePayload {
                available_commands: cmds
                    .available_commands
                    .iter()
                    .filter_map(|c| serde_json::to_value(c).ok())
                    .collect(),
            };
            let mut sink = event_sink.lock().await;
            sink.available_commands_update(payload);
        }
        CurrentModeUpdate(mode) => {
            let next_mode_id = mode.current_mode_id.to_string();
            startup_state.set_current_mode_id(next_mode_id.clone());
            set_select_option_current_value_for_purpose(
                &mut startup_state.config_options,
                ConfigPurpose::Mode,
                &next_mode_id,
            );
            let now = chrono::Utc::now().to_rfc3339();
            if startup_state.has_raw_or_legacy_mode_control() {
                emit_live_config_update(
                    source_agent_kind,
                    session_id,
                    session_store,
                    event_sink,
                    persisted_config_state,
                    startup_state,
                    now.clone(),
                )
                .await
                .map(|()| true)
                .unwrap_or_else(|error| {
                    tracing::warn!(session_id = %session_id, error = %error, "failed to persist live config after current mode update");
                    false
                })
            } else {
                persist_current_config_state_from_startup(
                    session_store,
                    event_sink,
                    session_id,
                    persisted_config_state,
                    startup_state,
                    now.clone(),
                )
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(session_id = %session_id, error = %error, "failed to persist current session state after current mode update");
                    false
                })
            };
            let payload = CurrentModeUpdatePayload {
                current_mode_id: next_mode_id,
            };
            let mut sink = event_sink.lock().await;
            sink.current_mode_update(payload);
        }
        ConfigOptionUpdate(config) => {
            startup_state.config_options = config.config_options.clone();
            if let Err(error) = emit_live_config_update(
                source_agent_kind,
                session_id,
                session_store,
                event_sink,
                persisted_config_state,
                startup_state,
                chrono::Utc::now().to_rfc3339(),
            )
            .await
            {
                tracing::warn!(session_id = %session_id, error = %error, "failed to persist config option update");
            }
        }
        SessionInfoUpdate(info) => {
            let title = info
                .title
                .as_opt_ref()
                .and_then(|t| t.map(|s| s.to_string()));

            let updated_at = info
                .updated_at
                .as_opt_ref()
                .and_then(|t| t.map(|s| s.to_string()));

            if let Some(ref t) = title {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = session_store.update_title(session_id, t, &now);
            }

            let payload = SessionInfoUpdatePayload { title, updated_at };
            let mut sink = event_sink.lock().await;
            sink.session_info_update(payload);
        }
        UsageUpdate(usage) => {
            let payload = UsageUpdatePayload {
                used: usage.used,
                size: usage.size,
                cost: serde_json::to_value(&usage.cost).ok(),
            };
            let mut sink = event_sink.lock().await;
            sink.usage_update(payload);
        }
        UserMessageChunk(_) => {
            tracing::trace!("ACP UserMessageChunk echo received (deduplicated)");
        }
        #[allow(unreachable_patterns)]
        other => {
            tracing::debug!("unrecognized ACP SessionUpdate variant: {other:?}");
        }
    }
}

pub(in crate::live::sessions::actor) fn persist_raw_notification(
    session_store: &SessionStore,
    session_id: &str,
    kind: &str,
    notif: &acp::SessionNotification,
) -> anyhow::Result<()> {
    let payload_json = serde_json::to_string(notif)?;
    session_store.append_raw_notification(
        session_id,
        kind,
        &chrono::Utc::now().to_rfc3339(),
        &payload_json,
    )
}

pub(in crate::live::sessions::actor) fn serialize_content_block(
    content: &acp::ContentBlock,
) -> serde_json::Value {
    serde_json::to_value(content).unwrap_or(serde_json::json!({ "type": "text", "text": "" }))
}

pub(in crate::live::sessions::actor) fn serialize_meta(
    meta: Option<&acp::Meta>,
) -> Option<serde_json::Value> {
    meta.and_then(|value| serde_json::to_value(value).ok())
}
