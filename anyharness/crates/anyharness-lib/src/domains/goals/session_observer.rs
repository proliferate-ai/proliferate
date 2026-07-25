//! Goal mirror ingestion as a [`SessionEventObserver`].
//!
//! Sidecars emit goal state as zero-length `AgentMessageChunk` updates
//! tagged `_meta.anyharness.transcriptEvent = goal_updated | goal_met |
//! goal_cleared` (GoalPort wire contract v1). The sink keeps these out of
//! the transcript (`NON_TRANSCRIPT_CHUNK_EVENTS`) and offers them here as
//! [`SessionObservation::NonTranscriptChunk`]; this observer transitions the
//! mirror row through [`GoalService`] and returns the committed envelopes.
//!
//! Same dispatch/partial-failure/threading contracts as
//! [`PlanSessionObserver`](crate::domains::plans::session_observer::PlanSessionObserver):
//! runs synchronously under the sink lock; either fails without committing
//! event rows or commits and returns every committed envelope.

use std::sync::Arc;

use super::service::{GoalEventContext, GoalIngestKind, GoalService};
use crate::live::sessions::model::{
    ObserverEffects, SessionEventObserver, SessionObservation, SessionObserverContext,
};

pub struct GoalSessionObserver {
    goals: Arc<GoalService>,
}

impl GoalSessionObserver {
    pub fn new(goals: Arc<GoalService>) -> Self {
        Self { goals }
    }
}

impl SessionEventObserver for GoalSessionObserver {
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
            Some("goal_updated") => GoalIngestKind::Updated,
            Some("goal_met") => GoalIngestKind::Met,
            Some("goal_cleared") => GoalIngestKind::Cleared,
            _ => return ObserverEffects::default(),
        };
        let context = GoalEventContext {
            session_id: ctx.session_id.clone(),
            workspace_id: ctx.workspace_id.clone(),
            turn_id: ctx.turn_id.clone(),
            next_seq: ctx.next_seq,
        };
        match self
            .goals
            .ingest_wire_event(&context, kind, anyharness.get("goal"))
        {
            Ok(envelopes) => ObserverEffects {
                persisted_events: envelopes,
            },
            Err(error) => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "failed to ingest goal wire event"
                );
                ObserverEffects::default()
            }
        }
    }
}
