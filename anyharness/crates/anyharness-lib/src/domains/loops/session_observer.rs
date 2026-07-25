//! Loop mirror ingestion as a [`SessionEventObserver`].
//!
//! Sidecars emit loop state as zero-length `AgentMessageChunk` updates
//! tagged `_meta.anyharness.transcriptEvent = loop_updated | loop_fired |
//! loop_cleared` (LoopPort wire contract v1), carrying `loop: LoopWire`
//! and/or `loopId`. Same dispatch/partial-failure/threading contracts as
//! the plans observer.

use std::sync::Arc;

use super::service::{LoopEventContext, LoopIngestKind, LoopService};
use crate::live::sessions::model::{
    ObserverEffects, SessionEventObserver, SessionObservation, SessionObserverContext,
};

pub struct LoopSessionObserver {
    loops: Arc<LoopService>,
}

impl LoopSessionObserver {
    pub fn new(loops: Arc<LoopService>) -> Self {
        Self { loops }
    }
}

impl SessionEventObserver for LoopSessionObserver {
    fn observe(
        &self,
        ctx: &SessionObserverContext,
        obs: SessionObservation<'_>,
    ) -> ObserverEffects {
        let SessionObservation::NonTranscriptChunk(payload) = obs else {
            return ObserverEffects::default();
        };
        let Some(anyharness) = payload
            .meta
            .as_ref()
            .and_then(|meta| meta.get("anyharness"))
        else {
            return ObserverEffects::default();
        };
        let kind = match anyharness
            .get("transcriptEvent")
            .and_then(serde_json::Value::as_str)
        {
            Some("loop_updated") => LoopIngestKind::Updated,
            Some("loop_fired") => LoopIngestKind::Fired,
            Some("loop_cleared") => LoopIngestKind::Cleared,
            _ => return ObserverEffects::default(),
        };
        let context = LoopEventContext {
            session_id: ctx.session_id.clone(),
            workspace_id: ctx.workspace_id.clone(),
            turn_id: ctx.turn_id.clone(),
            next_seq: ctx.next_seq,
        };
        let loop_id_hint = anyharness.get("loopId").and_then(serde_json::Value::as_str);
        match self
            .loops
            .ingest_wire_event(&context, kind, anyharness.get("loop"), loop_id_hint)
        {
            Ok(envelopes) => ObserverEffects {
                persisted_events: envelopes,
            },
            Err(error) => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "failed to ingest loop wire event"
                );
                ObserverEffects::default()
            }
        }
    }
}
