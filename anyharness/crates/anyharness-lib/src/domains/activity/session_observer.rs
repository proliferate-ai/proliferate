//! Activity-roster ingestion as a [`SessionEventObserver`].
//!
//! The sidecars/integration modules emit background-process and subagent
//! state as zero-length `AgentMessageChunk` updates tagged
//! `meta.anyharness.transcriptEvent = process_upserted | subagent_upserted`
//! with the normalized wire payload in `meta.anyharness.process` /
//! `meta.anyharness.subagent`. The dispatcher keeps these chunks out of the
//! transcript (`NON_TRANSCRIPT_CHUNK_EVENTS`) and surfaces them here as
//! [`SessionObservation::NonTranscriptChunk`].
//!
//! These rosters are strictly read-only: there is no write path at all, only
//! this ingest.
//!
//! # Dispatch contract
//!
//! Registered after the goal observer in the ordered pass (see
//! `app/sessions.rs`): activity consumes and feeds nothing in-pass.
//!
//! # Threading contract
//!
//! `observe` runs synchronously under the sink lock, on the per-session
//! thread. All event-emitting work happens inline; no async hand-off.

use std::sync::Arc;

use super::service::{ActivityEventContext, ActivityService};
use super::wire::{
    ActivityProcessWire, ActivitySubagentWire, PROCESS_UPSERTED_TRANSCRIPT_EVENT,
    SUBAGENT_UPSERTED_TRANSCRIPT_EVENT,
};
use crate::live::sessions::model::{
    AcpChunkPayload, ObserverEffects, SessionEventObserver, SessionObservation,
    SessionObserverContext,
};

pub struct ActivitySessionObserver {
    activity: Arc<ActivityService>,
}

impl ActivitySessionObserver {
    pub fn new(activity: Arc<ActivityService>) -> Self {
        Self { activity }
    }

    fn observe_activity_chunk(
        &self,
        ctx: &SessionObserverContext,
        payload: &AcpChunkPayload,
    ) -> ObserverEffects {
        let meta = parse_activity_chunk_meta(payload.meta.as_ref());
        let Some(anyharness_meta) = meta.anyharness else {
            return ObserverEffects::default();
        };
        let context = ActivityEventContext {
            workspace_id: ctx.workspace_id.clone(),
            session_id: ctx.session_id.clone(),
            source_agent_kind: ctx.agent_kind.clone(),
            turn_id: ctx.turn_id.clone(),
            next_seq: ctx.next_seq,
        };
        match anyharness_meta.transcript_event.as_deref() {
            Some(PROCESS_UPSERTED_TRANSCRIPT_EVENT) => {
                let Some(value) = anyharness_meta.process else {
                    return ObserverEffects::default();
                };
                let wire = match serde_json::from_value::<ActivityProcessWire>(value) {
                    Ok(wire) => wire,
                    Err(error) => {
                        tracing::warn!(
                            session_id = %ctx.session_id,
                            error = %error,
                            "malformed activity process wire payload on tagged chunk"
                        );
                        return ObserverEffects::default();
                    }
                };
                match self.activity.ingest_process_upserted(context, wire) {
                    Ok(batch) => ObserverEffects {
                        persisted_events: batch.envelopes,
                    },
                    Err(error) => {
                        tracing::warn!(
                            session_id = %ctx.session_id,
                            error = %error,
                            "failed to ingest native process notification"
                        );
                        ObserverEffects::default()
                    }
                }
            }
            Some(SUBAGENT_UPSERTED_TRANSCRIPT_EVENT) => {
                let Some(value) = anyharness_meta.subagent else {
                    return ObserverEffects::default();
                };
                let wire = match serde_json::from_value::<ActivitySubagentWire>(value) {
                    Ok(wire) => wire,
                    Err(error) => {
                        tracing::warn!(
                            session_id = %ctx.session_id,
                            error = %error,
                            "malformed activity subagent wire payload on tagged chunk"
                        );
                        return ObserverEffects::default();
                    }
                };
                match self.activity.ingest_subagent_upserted(context, wire) {
                    Ok(batch) => ObserverEffects {
                        persisted_events: batch.envelopes,
                    },
                    Err(error) => {
                        tracing::warn!(
                            session_id = %ctx.session_id,
                            error = %error,
                            "failed to ingest native subagent notification"
                        );
                        ObserverEffects::default()
                    }
                }
            }
            _ => ObserverEffects::default(),
        }
    }
}

impl SessionEventObserver for ActivitySessionObserver {
    fn observe(
        &self,
        ctx: &SessionObserverContext,
        obs: SessionObservation<'_>,
    ) -> ObserverEffects {
        match obs {
            SessionObservation::NonTranscriptChunk(payload) => {
                self.observe_activity_chunk(ctx, payload)
            }
            // Roster state arrives only on tagged protocol chunks.
            SessionObservation::ToolCall { .. }
            | SessionObservation::AssistantMessageCompleted(_)
            | SessionObservation::Event(_) => ObserverEffects::default(),
        }
    }
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityChunkAnyHarnessMeta {
    transcript_event: Option<String>,
    /// Kept raw so a malformed wire payload is diagnosed per-event instead
    /// of silently voiding the whole meta parse.
    #[serde(default)]
    process: Option<serde_json::Value>,
    /// Both forks nest the subagent payload under `subagent`
    /// (claude-agent-acp `{ subagent }`, codex-acp `json!({ "subagent": .. })`),
    /// NOT `agent` — reading `agent` dropped every subagent_upserted. `alias`
    /// keeps any legacy emitter working.
    #[serde(default, alias = "agent")]
    subagent: Option<serde_json::Value>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct ActivityChunkMeta {
    #[serde(default)]
    anyharness: Option<ActivityChunkAnyHarnessMeta>,
}

fn parse_activity_chunk_meta(meta: Option<&serde_json::Value>) -> ActivityChunkMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_activity_chunk_meta_reads_process_payload() {
        let meta = parse_activity_chunk_meta(Some(&json!({
            "anyharness": {
                "schemaVersion": 1,
                "transcriptEvent": "process_upserted",
                "process": {
                    "id": "proc-1",
                    "command": "sleep 30",
                    "status": "running",
                    "startedAtMs": 1_782_000_000_000_i64
                }
            }
        })));
        let anyharness = meta.anyharness.expect("anyharness meta");
        assert_eq!(
            anyharness.transcript_event.as_deref(),
            Some("process_upserted")
        );
        let wire: ActivityProcessWire =
            serde_json::from_value(anyharness.process.expect("process payload"))
                .expect("parse process wire");
        assert_eq!(wire.id, "proc-1");
    }

    #[test]
    fn parse_activity_chunk_meta_reads_subagent_payload() {
        // Both forks nest the payload under `subagent`.
        let meta = parse_activity_chunk_meta(Some(&json!({
            "anyharness": {
                "schemaVersion": 1,
                "transcriptEvent": "subagent_upserted",
                "subagent": {
                    "id": "agent-1",
                    "background": true,
                    "status": "running"
                }
            }
        })));
        let anyharness = meta.anyharness.expect("anyharness meta");
        assert_eq!(
            anyharness.transcript_event.as_deref(),
            Some("subagent_upserted")
        );
        assert!(anyharness.subagent.is_some());
    }

    #[test]
    fn parse_activity_chunk_meta_accepts_legacy_agent_key_alias() {
        let meta = parse_activity_chunk_meta(Some(&json!({
            "anyharness": {
                "schemaVersion": 1,
                "transcriptEvent": "subagent_upserted",
                "agent": { "id": "agent-1", "background": true, "status": "running" }
            }
        })));
        assert!(meta.anyharness.expect("anyharness meta").subagent.is_some());
    }

    #[test]
    fn parse_activity_chunk_meta_defaults_on_missing_or_malformed_meta() {
        assert!(parse_activity_chunk_meta(None).anyharness.is_none());
        assert!(parse_activity_chunk_meta(Some(&json!("not an object")))
            .anyharness
            .is_none());
    }
}
