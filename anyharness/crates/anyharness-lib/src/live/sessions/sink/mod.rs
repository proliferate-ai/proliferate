use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::broadcast;

use self::state::{PlanItemState, StreamingItemState, ToolItemState};
use crate::live::sessions::model::EventPersist;
use crate::observability::transcript_phase::TranscriptPhaseDebugState;
use anyharness_contract::v1::{GoalStatus, SessionEvent, SessionEventEnvelope};

mod assistant;
mod background_work;
mod config;
mod ingest;
mod interactions;
mod lifecycle;
mod metadata;
mod normalization;
mod pending_prompts;
mod plans;
pub(crate) mod publish;
mod reasoning;
mod runtime_events;
mod state;
mod tools;
mod turns;

#[cfg(test)]
mod tests;

pub use state::{
    AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage, SessionEventSinkDebugSnapshot,
};

pub(in crate::live::sessions) use ingest::{ActorBoundUpdate, SinkObservation};

pub struct SessionEventSink {
    session_id: String,
    source_agent_kind: String,
    workspace_root: PathBuf,
    next_seq: i64,
    event_tx: broadcast::Sender<SessionEventEnvelope>,
    store: Arc<dyn EventPersist>,

    current_turn_id: Option<String>,
    /// True while the open turn was synthesized for engine-initiated activity
    /// (goal continuation/evaluation) rather than begun by a prompt. Only
    /// such turns may be auto-closed by terminal goal events.
    engine_initiated_turn: bool,
    /// Whether the open engine-initiated turn has carried anything beyond its
    /// own TurnStarted. A tag-opened turn whose goal update the observer then
    /// drops (stale echo, idempotent no-op) stays empty — the post-dispatch
    /// sweep closes it so it cannot dangle as a phantom in-progress turn.
    engine_turn_has_events: bool,
    open_assistant_item: Option<StreamingItemState>,
    open_reasoning_item: Option<StreamingItemState>,
    open_plan_item: Option<PlanItemState>,
    tool_items: HashMap<String, ToolItemState>,
    transcript_phase_debug: TranscriptPhaseDebugState,
}

impl SessionEventSink {
    pub fn new(
        session_id: String,
        source_agent_kind: String,
        workspace_root: PathBuf,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        store: Arc<dyn EventPersist>,
    ) -> Self {
        Self {
            session_id,
            source_agent_kind,
            workspace_root,
            next_seq: 1,
            event_tx,
            store,
            current_turn_id: None,
            engine_initiated_turn: false,
            engine_turn_has_events: false,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
            transcript_phase_debug: TranscriptPhaseDebugState::default(),
        }
    }

    pub fn resume_from_seq(
        session_id: String,
        source_agent_kind: String,
        workspace_root: PathBuf,
        last_seq: i64,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        store: Arc<dyn EventPersist>,
    ) -> Self {
        Self {
            session_id,
            source_agent_kind,
            workspace_root,
            next_seq: last_seq + 1,
            event_tx,
            store,
            current_turn_id: None,
            engine_initiated_turn: false,
            engine_turn_has_events: false,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
            transcript_phase_debug: TranscriptPhaseDebugState::default(),
        }
    }

    pub fn next_seq(&self) -> i64 {
        self.next_seq
    }

    pub fn current_turn_id(&self) -> Option<String> {
        self.current_turn_id.clone()
    }

    pub fn close_open_transcript_items(&mut self) {
        self.close_open_items();
    }

    pub fn publish_persisted_events(&mut self, envelopes: Vec<SessionEventEnvelope>) {
        // Observer-persisted goal events flow back through here after being
        // attributed to the current turn, so this is the one spot that sees a
        // goal reach quiescence AFTER its event already carries the right
        // turn id. A quiescent goal ends the engine-initiated turn its
        // pursuit opened (see `ensure_open_turn`); prompt-begun turns are
        // never auto-closed — their lifecycle ends them.
        let goal_reached_quiescence = envelopes
            .iter()
            .any(|envelope| goal_event_quiesces_turn(&envelope.event));
        if self.engine_initiated_turn
            && envelopes
                .iter()
                .any(|envelope| envelope.turn_id == self.current_turn_id)
        {
            self.engine_turn_has_events = true;
        }
        for envelope in envelopes {
            if envelope.seq >= self.next_seq {
                self.next_seq = envelope.seq + 1;
            }
            let _ = self.event_tx.send(envelope);
        }
        if goal_reached_quiescence {
            self.end_engine_initiated_turn_if_open();
        }
    }

    pub fn debug_snapshot(&self) -> SessionEventSinkDebugSnapshot {
        SessionEventSinkDebugSnapshot {
            current_turn_id: self.current_turn_id.clone(),
            open_assistant_item_id: self
                .open_assistant_item
                .as_ref()
                .map(|item| item.item_id.clone()),
            open_assistant_chars: self
                .open_assistant_item
                .as_ref()
                .map(|item| item.text.chars().count())
                .unwrap_or(0),
            open_reasoning_item_id: self
                .open_reasoning_item
                .as_ref()
                .map(|item| item.item_id.clone()),
            open_reasoning_chars: self
                .open_reasoning_item
                .as_ref()
                .map(|item| item.text.chars().count())
                .unwrap_or(0),
            open_plan_item_id: self
                .open_plan_item
                .as_ref()
                .map(|item| item.item_id.clone()),
            open_tool_call_ids: self.tool_items.keys().cloned().collect(),
            next_seq: self.next_seq,
        }
    }
}

/// A goal event that means the pursuit engine has gone quiet: met/cleared,
/// or any update whose status is no longer `active` (paused, blocked, failed).
/// Active-status ticks (accounting updates between continuation steps) do not
/// quiesce the turn.
fn goal_event_quiesces_turn(event: &SessionEvent) -> bool {
    match event {
        SessionEvent::GoalMet(_) | SessionEvent::GoalCleared(_) => true,
        SessionEvent::GoalUpdated(payload) => payload.goal.status != GoalStatus::Active,
        _ => false,
    }
}
