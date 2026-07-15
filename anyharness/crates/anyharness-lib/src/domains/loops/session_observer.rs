//! Loop-mirror ingestion as a [`SessionEventObserver`].
//!
//! The sidecar LoopPorts (and, on Codex, the runtime-emulated
//! `LoopSchedulerExtension`) emit loop state as zero-length
//! `AgentMessageChunk` updates tagged `meta.anyharness.transcriptEvent =
//! loop_upserted | loop_removed | loop_fired` with the normalized
//! [`LoopWire`] payload in `meta.anyharness.loop` (`loop_removed` carries
//! only `meta.anyharness.loopId`). The dispatcher keeps these chunks out of
//! the transcript (`NON_TRANSCRIPT_CHUNK_EVENTS`) and surfaces them here as
//! [`SessionObservation::NonTranscriptChunk`].
//!
//! # Dispatch contract
//!
//! Registered after the goal observer in the ordered pass (see
//! `app/sessions.rs`): loops consume and feed nothing in-pass, so ordering
//! relative to goals is unconstrained beyond "after goals" per the task
//! sequencing note.
//!
//! # Threading contract
//!
//! `observe` runs synchronously under the sink lock, on the per-session
//! thread. All event-emitting work happens inline; no async hand-off.

use std::sync::Arc;

use super::service::{LoopEventContext, LoopNativeEventKind, LoopService};
use super::wire::{
    LoopWire, LOOP_FIRED_TRANSCRIPT_EVENT, LOOP_REMOVED_TRANSCRIPT_EVENT,
    LOOP_UPSERTED_TRANSCRIPT_EVENT,
};
use crate::live::sessions::model::{
    AcpChunkPayload, ObserverEffects, SessionEventObserver, SessionObservation,
    SessionObserverContext,
};

pub struct LoopSessionObserver {
    loops: Arc<LoopService>,
}

impl LoopSessionObserver {
    pub fn new(loops: Arc<LoopService>) -> Self {
        Self { loops }
    }

    fn observe_loop_chunk(
        &self,
        ctx: &SessionObserverContext,
        payload: &AcpChunkPayload,
    ) -> ObserverEffects {
        let meta = parse_loop_chunk_meta(payload.meta.as_ref());
        let Some(anyharness_meta) = meta.anyharness else {
            return ObserverEffects::default();
        };
        let kind = match anyharness_meta.transcript_event.as_deref() {
            Some(LOOP_UPSERTED_TRANSCRIPT_EVENT) => LoopNativeEventKind::Upserted,
            Some(LOOP_REMOVED_TRANSCRIPT_EVENT) => LoopNativeEventKind::Removed,
            Some(LOOP_FIRED_TRANSCRIPT_EVENT) => LoopNativeEventKind::Fired,
            _ => return ObserverEffects::default(),
        };
        let wire = match anyharness_meta.r#loop {
            Some(value) => match serde_json::from_value::<LoopWire>(value) {
                Ok(wire) => Some(wire),
                Err(error) => {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        error = %error,
                        "malformed loop wire payload on tagged chunk"
                    );
                    return ObserverEffects::default();
                }
            },
            None => None,
        };
        let context = LoopEventContext {
            workspace_id: ctx.workspace_id.clone(),
            session_id: ctx.session_id.clone(),
            source_agent_kind: ctx.agent_kind.clone(),
            turn_id: ctx.turn_id.clone(),
            next_seq: ctx.next_seq,
        };
        match self
            .loops
            .ingest_native_event(context, kind, wire, anyharness_meta.loop_id)
        {
            Ok(batch) => ObserverEffects {
                persisted_events: batch.envelopes,
            },
            Err(error) => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "failed to ingest native loop notification"
                );
                ObserverEffects::default()
            }
        }
    }
}

impl SessionEventObserver for LoopSessionObserver {
    fn observe(
        &self,
        ctx: &SessionObserverContext,
        obs: SessionObservation<'_>,
    ) -> ObserverEffects {
        match obs {
            SessionObservation::NonTranscriptChunk(payload) => self.observe_loop_chunk(ctx, payload),
            // Loop state arrives only on tagged protocol chunks.
            SessionObservation::ToolCall { .. }
            | SessionObservation::AssistantMessageCompleted(_)
            | SessionObservation::Event(_) => ObserverEffects::default(),
        }
    }
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopChunkAnyHarnessMeta {
    transcript_event: Option<String>,
    /// Kept raw so a malformed wire payload is diagnosed per-event instead
    /// of silently voiding the whole meta parse. Present for
    /// upserted/fired; absent for removed.
    r#loop: Option<serde_json::Value>,
    /// Present on `loop_removed` (and, redundantly, on the others).
    #[serde(default)]
    loop_id: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct LoopChunkMeta {
    #[serde(default)]
    anyharness: Option<LoopChunkAnyHarnessMeta>,
}

fn parse_loop_chunk_meta(meta: Option<&serde_json::Value>) -> LoopChunkMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_loop_chunk_meta_reads_event_and_wire_payload() {
        let meta = parse_loop_chunk_meta(Some(&json!({
            "anyharness": {
                "schemaVersion": 1,
                "transcriptEvent": "loop_upserted",
                "loop": {
                    "loopId": "cron-1",
                    "prompt": "ping",
                    "schedule": { "kind": "cron", "expr": "*/1 * * * *" },
                    "recurring": true,
                    "status": "active",
                    "native": true,
                    "lastFiredAtMs": null,
                    "fireCount": 0,
                    "updatedAtMs": 1
                }
            }
        })));
        let anyharness = meta.anyharness.expect("anyharness meta");
        assert_eq!(anyharness.transcript_event.as_deref(), Some("loop_upserted"));
        let wire: LoopWire = serde_json::from_value(anyharness.r#loop.expect("loop payload"))
            .expect("parse loop wire");
        assert_eq!(wire.loop_id, "cron-1");
    }

    #[test]
    fn parse_loop_chunk_meta_tolerates_removed_without_loop() {
        let meta = parse_loop_chunk_meta(Some(&json!({
            "anyharness": {
                "schemaVersion": 1,
                "transcriptEvent": "loop_removed",
                "loopId": "cron-1"
            }
        })));
        let anyharness = meta.anyharness.expect("anyharness meta");
        assert_eq!(anyharness.transcript_event.as_deref(), Some("loop_removed"));
        assert!(anyharness.r#loop.is_none());
        assert_eq!(anyharness.loop_id.as_deref(), Some("cron-1"));
    }

    #[test]
    fn parse_loop_chunk_meta_defaults_on_missing_or_malformed_meta() {
        assert!(parse_loop_chunk_meta(None).anyharness.is_none());
        assert!(parse_loop_chunk_meta(Some(&json!("not an object")))
            .anyharness
            .is_none());
    }
}
