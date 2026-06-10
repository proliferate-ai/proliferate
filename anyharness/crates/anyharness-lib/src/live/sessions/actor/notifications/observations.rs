//! The observer dispatch pass: feeds the special observations collected by
//! the sink's `ingest` to the registered [`SessionEventObserver`]s.
//!
//! Scoping decision (deliberate): observers receive ONLY the collected
//! special observations (non-transcript chunks, tool payloads, completed
//! assistant messages) plus feed-forward of envelopes emitted by earlier
//! observers in the same pass — NOT every routine envelope the sink persists.
//! This matches the legacy behavior exactly: the plan sniffers only ever saw
//! those three inputs, and the reviews observer sees the plan envelopes via
//! feed-forward.

use std::sync::Arc;

use anyharness_contract::v1::SessionEventEnvelope;
use tokio::sync::Mutex;

use crate::live::sessions::model::{
    SessionEventObserver, SessionObservation, SessionObserverContext,
};
use crate::live::sessions::sink::{SessionEventSink, SinkObservation};

fn as_observation(collected: &SinkObservation) -> SessionObservation<'_> {
    match collected {
        SinkObservation::NonTranscriptChunk(payload) => {
            SessionObservation::NonTranscriptChunk(payload)
        }
        SinkObservation::ToolCall { turn_id, payload } => SessionObservation::ToolCall {
            turn_id: turn_id.clone(),
            payload,
        },
        SinkObservation::AssistantMessageCompleted(completed) => {
            SessionObservation::AssistantMessageCompleted(completed)
        }
    }
}

/// Runs the single ordered observer pass for each collected observation.
///
/// Contract (mirrors the trait docs in `live/sessions/model.rs`):
/// - One sink lock is held across the whole pass.
/// - Before an observation's pass, if any observer answers
///   `needs_transcript_boundary`, open streaming items are closed first
///   (their completion events consume seqs BEFORE the observation's context
///   is built) — the legacy plan-ingestion behavior.
/// - Observers run in registration order; each observer's returned envelopes
///   are published immediately (the sink advances) and fed forward as
///   `SessionObservation::Event` to LATER observers only.
pub(in crate::live::sessions::actor) async fn dispatch_observations(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    observers: &[Arc<dyn SessionEventObserver>],
    session_id: &str,
    workspace_id: &str,
    agent_kind: &str,
    observations: Vec<SinkObservation>,
) {
    if observations.is_empty() || observers.is_empty() {
        return;
    }
    let mut sink = event_sink.lock().await;
    for collected in &observations {
        {
            let obs = as_observation(collected);
            if observers
                .iter()
                .any(|observer| observer.needs_transcript_boundary(&obs))
            {
                sink.close_open_transcript_items();
            }
        }

        // Envelopes emitted by earlier observers, to feed forward.
        let mut feed: Vec<SessionEventEnvelope> = Vec::new();
        for observer in observers {
            let mut emissions: Vec<SessionEventEnvelope> = Vec::new();
            for envelope in &feed {
                let ctx = observation_ctx(&sink, session_id, workspace_id, agent_kind);
                let effects = observer.observe(&ctx, SessionObservation::Event(envelope));
                if !effects.persisted_events.is_empty() {
                    emissions.extend(effects.persisted_events.iter().cloned());
                    sink.publish_persisted_events(effects.persisted_events);
                }
            }
            let ctx = observation_ctx(&sink, session_id, workspace_id, agent_kind);
            let effects = observer.observe(&ctx, as_observation(collected));
            if !effects.persisted_events.is_empty() {
                emissions.extend(effects.persisted_events.iter().cloned());
                sink.publish_persisted_events(effects.persisted_events);
            }
            feed.extend(emissions);
        }
    }
}

fn observation_ctx(
    sink: &SessionEventSink,
    session_id: &str,
    workspace_id: &str,
    agent_kind: &str,
) -> SessionObserverContext {
    SessionObserverContext {
        session_id: session_id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: agent_kind.to_string(),
        turn_id: sink.current_turn_id(),
        next_seq: sink.next_seq(),
    }
}
