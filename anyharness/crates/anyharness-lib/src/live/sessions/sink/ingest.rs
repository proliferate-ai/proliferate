//! The sink's inbound door for ACP notifications: normalizes one
//! `SessionNotification` into transcript emission and reports back what the
//! actor still has to do. The sink stays meaning-blind — it never touches
//! durable session-row state or product reactors; arms that need those
//! (config/mode/session-info) are parsed here and returned as
//! [`ActorBoundUpdate`] for the actor to apply.

use agent_client_protocol as acp;
use anyharness_contract::v1::{AvailableCommandsUpdatePayload, UsageUpdatePayload};

use super::state::{AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage};
use super::SessionEventSink;

/// An observation collected (owned) during ingestion, to be offered to the
/// actor's observer dispatch pass after the sink finished its own handling.
pub(in crate::live::sessions) enum SinkObservation {
    /// Protocol chunk the sink kept out of the transcript
    /// (anyharness adapter meta tag).
    NonTranscriptChunk(AcpChunkPayload),
    /// Normalized tool traffic, after the sink recorded it.
    ToolCall {
        turn_id: Option<String>,
        payload: AcpToolPayload,
    },
    /// An assistant message that just completed assembly in the sink.
    AssistantMessageCompleted(CompletedAssistantMessage),
}

/// A notification arm the sink cannot finish on its own because it touches
/// `SessionStateDurable` and the actor's startup state. The sink parses the
/// protocol shape; the actor persists and emits.
pub(in crate::live::sessions) enum ActorBoundUpdate {
    CurrentMode {
        next_mode_id: String,
    },
    ConfigOptions(Vec<acp::schema::SessionConfigOption>),
    SessionInfo {
        title: Option<String>,
        updated_at: Option<String>,
    },
}

/// What one [`SessionEventSink::ingest`] call produced: the observations to
/// offer to observers, plus (at most one) actor-bound update.
#[derive(Default)]
pub(in crate::live::sessions) struct IngestOutcome {
    pub(in crate::live::sessions) observations: Vec<SinkObservation>,
    pub(in crate::live::sessions) needs_actor: Option<ActorBoundUpdate>,
}

impl SessionEventSink {
    /// Normalizes one ACP notification into the transcript. Sink-natural arms
    /// emit (and persist) their events internally; actor-natural arms are
    /// parsed and handed back via [`IngestOutcome::needs_actor`].
    pub(in crate::live::sessions) fn ingest(
        &mut self,
        notif: &acp::schema::SessionNotification,
    ) -> IngestOutcome {
        let mut outcome = IngestOutcome::default();
        use acp::schema::SessionUpdate::*;
        match &notif.update {
            AgentMessageChunk(chunk) => {
                let payload = AcpChunkPayload {
                    content: serialize_content_block(&chunk.content),
                    meta: serialize_meta(chunk.meta.as_ref()),
                    message_id: chunk.message_id.as_ref().map(|id| id.to_string()),
                };
                // Adapter-tagged chunks are protocol vocabulary that must stay
                // out of the transcript; they are offered to observers instead.
                if is_non_transcript_chunk(payload.meta.as_ref()) {
                    outcome
                        .observations
                        .push(SinkObservation::NonTranscriptChunk(payload));
                    return outcome;
                }
                if let Some(completed) = self.agent_message_chunk(payload) {
                    outcome
                        .observations
                        .push(SinkObservation::AssistantMessageCompleted(completed));
                }
            }
            AgentThoughtChunk(chunk) => {
                self.agent_thought_chunk(AcpChunkPayload {
                    content: serialize_content_block(&chunk.content),
                    meta: serialize_meta(chunk.meta.as_ref()),
                    message_id: chunk.message_id.as_ref().map(|id| id.to_string()),
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
                self.tool_call(payload.clone());
                outcome.observations.push(SinkObservation::ToolCall {
                    turn_id: self.current_turn_id(),
                    payload,
                });
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
                self.tool_call_update(payload.clone());
                outcome.observations.push(SinkObservation::ToolCall {
                    turn_id: self.current_turn_id(),
                    payload,
                });
            }
            Plan(plan) => {
                let entries = plan
                    .entries
                    .iter()
                    .filter_map(|e| serde_json::to_value(e).ok())
                    .collect();
                self.plan(entries);
            }
            AvailableCommandsUpdate(cmds) => {
                self.available_commands_update(AvailableCommandsUpdatePayload {
                    available_commands: cmds
                        .available_commands
                        .iter()
                        .filter_map(|c| serde_json::to_value(c).ok())
                        .collect(),
                });
            }
            CurrentModeUpdate(mode) => {
                outcome.needs_actor = Some(ActorBoundUpdate::CurrentMode {
                    next_mode_id: mode.current_mode_id.to_string(),
                });
            }
            ConfigOptionUpdate(config) => {
                outcome.needs_actor = Some(ActorBoundUpdate::ConfigOptions(
                    config.config_options.clone(),
                ));
            }
            SessionInfoUpdate(info) => {
                outcome.needs_actor = Some(ActorBoundUpdate::SessionInfo {
                    title: info
                        .title
                        .as_opt_ref()
                        .and_then(|t| t.map(|s| s.to_string())),
                    updated_at: info
                        .updated_at
                        .as_opt_ref()
                        .and_then(|t| t.map(|s| s.to_string())),
                });
            }
            UsageUpdate(usage) => {
                self.usage_update(UsageUpdatePayload {
                    used: usage.used,
                    size: usage.size,
                    cost: serde_json::to_value(&usage.cost).ok(),
                });
            }
            UserMessageChunk(_) => {
                tracing::trace!("ACP UserMessageChunk echo received (deduplicated)");
            }
            #[allow(unreachable_patterns)]
            other => {
                tracing::debug!("unrecognized ACP SessionUpdate variant: {other:?}");
            }
        }
        outcome
    }
}

/// Adapter meta tags whose chunks must not become transcript items. These
/// are anyharness protocol vocabulary (set by our own agent adapters), not
/// product meaning — product interpretation happens in the observers.
const NON_TRANSCRIPT_CHUNK_EVENTS: &[&str] = &["proposed_plan_delta", "proposed_plan_completed"];

fn is_non_transcript_chunk(meta: Option<&serde_json::Value>) -> bool {
    meta.and_then(|meta| meta.get("anyharness"))
        .and_then(|anyharness| anyharness.get("transcriptEvent"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|event| NON_TRANSCRIPT_CHUNK_EVENTS.contains(&event))
}

fn serialize_content_block(content: &acp::schema::ContentBlock) -> serde_json::Value {
    serde_json::to_value(content).unwrap_or(serde_json::json!({ "type": "text", "text": "" }))
}

fn serialize_meta(meta: Option<&acp::schema::Meta>) -> Option<serde_json::Value> {
    meta.and_then(|value| serde_json::to_value(value).ok())
}
