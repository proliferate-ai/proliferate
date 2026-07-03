//! Goal-mirror ingestion as a [`SessionEventObserver`].
//!
//! The sidecar GoalPorts emit goal state as zero-length `AgentMessageChunk`
//! updates tagged `meta.anyharness.transcriptEvent = goal_updated | goal_met
//! | goal_cleared` with the normalized [`GoalWire`] payload in
//! `meta.anyharness.goal` (camelCase, pinned wire contract v1). The
//! dispatcher keeps these chunks out of the transcript
//! (`NON_TRANSCRIPT_CHUNK_EVENTS`) and surfaces them here as
//! [`SessionObservation::NonTranscriptChunk`].
//!
//! These notifications are the ONLY source of mirror transitions: external
//! mutations (`GoalRuntime`) record just a pending marker and wait for the
//! notification to round-trip through this observer.
//!
//! # Dispatch contract
//!
//! Observers run in a single ordered pass in registration order; envelopes
//! returned by observer `i` are published immediately and observed only by
//! observers `j > i`. This observer consumes no envelopes from earlier
//! observers and none of the later observers consume goal envelopes, so its
//! position in the pass is unconstrained.
//!
//! # Partial-failure contract
//!
//! [`GoalService::ingest_native_event`] persists the goal row and its event
//! rows in a single transaction and returns every committed envelope: on
//! `Err` nothing was committed and no envelopes are returned; on `Ok` the
//! full batch is returned so the sink can advance its counter and broadcast.
//!
//! # Threading contract
//!
//! `observe` runs synchronously under the sink lock, on the per-session
//! thread. All event-emitting work happens inline; no async hand-off.

use std::sync::Arc;

use super::service::{GoalEventContext, GoalNativeEventKind, GoalService};
use super::wire::{
    GoalWire, GOAL_CLEARED_TRANSCRIPT_EVENT, GOAL_MET_TRANSCRIPT_EVENT,
    GOAL_UPDATED_TRANSCRIPT_EVENT,
};
use crate::live::sessions::model::{
    AcpChunkPayload, ObserverEffects, SessionEventObserver, SessionObservation,
    SessionObserverContext,
};

pub struct GoalSessionObserver {
    goals: Arc<GoalService>,
}

impl GoalSessionObserver {
    pub fn new(goals: Arc<GoalService>) -> Self {
        Self { goals }
    }

    fn observe_goal_chunk(
        &self,
        ctx: &SessionObserverContext,
        payload: &AcpChunkPayload,
    ) -> ObserverEffects {
        let meta = parse_goal_chunk_meta(payload.meta.as_ref());
        let Some(anyharness_meta) = meta.anyharness else {
            return ObserverEffects::default();
        };
        let kind = match anyharness_meta.transcript_event.as_deref() {
            Some(GOAL_UPDATED_TRANSCRIPT_EVENT) => GoalNativeEventKind::Updated,
            Some(GOAL_MET_TRANSCRIPT_EVENT) => GoalNativeEventKind::Met,
            Some(GOAL_CLEARED_TRANSCRIPT_EVENT) => GoalNativeEventKind::Cleared,
            _ => return ObserverEffects::default(),
        };
        let wire = match anyharness_meta.goal {
            Some(value) => match serde_json::from_value::<GoalWire>(value) {
                Ok(wire) => Some(wire),
                Err(error) => {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        error = %error,
                        "malformed goal wire payload on tagged chunk"
                    );
                    return ObserverEffects::default();
                }
            },
            None => None,
        };
        let context = GoalEventContext {
            workspace_id: ctx.workspace_id.clone(),
            session_id: ctx.session_id.clone(),
            source_agent_kind: ctx.agent_kind.clone(),
            turn_id: ctx.turn_id.clone(),
            next_seq: ctx.next_seq,
        };
        match self.goals.ingest_native_event(context, kind, wire) {
            Ok(batch) => ObserverEffects {
                persisted_events: batch.envelopes,
            },
            Err(error) => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "failed to ingest native goal notification"
                );
                ObserverEffects::default()
            }
        }
    }
}

impl SessionEventObserver for GoalSessionObserver {
    fn observe(
        &self,
        ctx: &SessionObserverContext,
        obs: SessionObservation<'_>,
    ) -> ObserverEffects {
        match obs {
            SessionObservation::NonTranscriptChunk(payload) => {
                self.observe_goal_chunk(ctx, payload)
            }
            // Goal state arrives only on tagged protocol chunks.
            SessionObservation::ToolCall { .. }
            | SessionObservation::AssistantMessageCompleted(_)
            | SessionObservation::Event(_) => ObserverEffects::default(),
        }
    }
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoalChunkAnyHarnessMeta {
    transcript_event: Option<String>,
    /// Kept raw so a malformed wire payload is diagnosed per-event instead
    /// of silently voiding the whole meta parse.
    goal: Option<serde_json::Value>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct GoalChunkMeta {
    #[serde(default)]
    anyharness: Option<GoalChunkAnyHarnessMeta>,
}

fn parse_goal_chunk_meta(meta: Option<&serde_json::Value>) -> GoalChunkMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_goal_chunk_meta_reads_event_and_wire_payload() {
        let meta = parse_goal_chunk_meta(Some(&json!({
            "anyharness": {
                "schemaVersion": 1,
                "transcriptEvent": "goal_updated",
                "goal": {
                    "objective": "make CI green",
                    "status": "active",
                    "nativeStatus": "active",
                    "tokenBudget": null,
                    "tokensUsed": 12,
                    "timeUsedSeconds": 3,
                    "metReason": null,
                    "iterations": null,
                    "native": true,
                    "updatedAtMs": 1
                }
            }
        })));
        let anyharness = meta.anyharness.expect("anyharness meta");
        assert_eq!(anyharness.transcript_event.as_deref(), Some("goal_updated"));
        let goal: GoalWire = serde_json::from_value(anyharness.goal.expect("goal payload"))
            .expect("parse goal wire");
        assert_eq!(goal.objective, "make CI green");
        assert_eq!(goal.tokens_used, Some(12));
    }

    #[test]
    fn parse_goal_chunk_meta_defaults_on_missing_or_malformed_meta() {
        assert!(parse_goal_chunk_meta(None).anyharness.is_none());
        assert!(parse_goal_chunk_meta(Some(&json!("not an object")))
            .anyharness
            .is_none());
    }

    #[test]
    fn parse_goal_chunk_meta_tolerates_cleared_without_goal() {
        let meta = parse_goal_chunk_meta(Some(&json!({
            "anyharness": { "schemaVersion": 1, "transcriptEvent": "goal_cleared" }
        })));
        let anyharness = meta.anyharness.expect("anyharness meta");
        assert_eq!(anyharness.transcript_event.as_deref(), Some("goal_cleared"));
        assert!(anyharness.goal.is_none());
    }
}
