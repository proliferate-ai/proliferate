use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::broadcast;

use self::state::{PlanItemState, StreamingItemState, ToolItemState};
use crate::domains::sessions::extensions::{
    SessionInteractionRequestedContext, SessionInteractionResolvedContext,
};
use crate::live::sessions::model::{EventPersist, TerminalTurnOutcome};
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
mod subagent_wakes;
mod terminal;
mod tools;
mod turns;

#[cfg(test)]
mod tests;

pub use state::{
    AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage, SessionEventSinkDebugSnapshot,
};

pub(in crate::live::sessions) use ingest::{ActorBoundUpdate, SinkObservation};
pub(in crate::live::sessions) use subagent_wakes::SubagentWakeTurnStartOutcome;
pub(in crate::live::sessions) use terminal::{
    PromptTerminalEvent, StagedTerminalTurn, TerminalTurnCommit,
};

pub struct SessionEventSink {
    session_id: String,
    source_agent_kind: String,
    workspace_root: PathBuf,
    next_seq: i64,
    event_sequence_owned: bool,
    inbound_event_mutations_open: bool,
    event_tx: broadcast::Sender<SessionEventEnvelope>,
    store: Arc<dyn EventPersist>,

    current_turn_id: Option<String>,
    /// The `item_id` of the current prompt turn's user-message item, set by
    /// `begin_turn` and cleared at `turn_ended`. Only a prompt-begun turn has a
    /// known user item; engine-initiated turns leave this `None`. the OpenCode side-door bridge
    /// uses it to bind a vendor OpenCode `messageId` echo to the right runtime
    /// `(turn_id, item_id)` identity, and only ever while a turn is open — a
    /// replayed history echo (no open turn) is never misattributed.
    current_user_item_id: Option<String>,
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
    turn_assistant_messages: Vec<String>,
    staged_terminal: Option<StagedTerminalTurn>,
    engine_terminal_outcome: Option<TerminalTurnOutcome>,
    transcript_phase_debug: TranscriptPhaseDebugState,
    on_interaction_requested: Option<Arc<dyn Fn(SessionInteractionRequestedContext) + Send + Sync>>,
    on_interaction_resolved: Option<Arc<dyn Fn(SessionInteractionResolvedContext) + Send + Sync>>,
    /// The open turn's `anyharness.turn.execute` guard.
    ///
    /// Replacing it (a new turn opens before the old one closed) or dropping
    /// the sink emits an `abandoned` terminal, so a turn that vanishes is
    /// counted rather than silently missing from the success rate. The guard
    /// is inert in a process with no diagnostics producer, which is every
    /// test.
    turn_lifecycle: Option<crate::observability::lifecycle::RuntimeLifecycleOperation>,
    /// Whether the open turn has already stamped `first_output_ms` on its
    /// guard. Reset whenever a turn opens; set when the first assistant item
    /// opens, so a turn with many assistant items reports the first only.
    turn_first_output_stamped: bool,
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
            event_sequence_owned: true,
            inbound_event_mutations_open: true,
            event_tx,
            store,
            current_turn_id: None,
            current_user_item_id: None,
            engine_initiated_turn: false,
            engine_turn_has_events: false,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
            turn_assistant_messages: Vec::new(),
            staged_terminal: None,
            engine_terminal_outcome: None,
            transcript_phase_debug: TranscriptPhaseDebugState::default(),
            on_interaction_requested: None,
            on_interaction_resolved: None,
            turn_lifecycle: None,
            turn_first_output_stamped: false,
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
            event_sequence_owned: true,
            inbound_event_mutations_open: true,
            event_tx,
            store,
            current_turn_id: None,
            current_user_item_id: None,
            engine_initiated_turn: false,
            engine_turn_has_events: false,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
            turn_assistant_messages: Vec::new(),
            staged_terminal: None,
            engine_terminal_outcome: None,
            transcript_phase_debug: TranscriptPhaseDebugState::default(),
            on_interaction_requested: None,
            on_interaction_resolved: None,
            turn_lifecycle: None,
            turn_first_output_stamped: false,
        }
    }

    pub fn next_seq(&self) -> i64 {
        self.next_seq
    }

    pub(in crate::live::sessions) fn inbound_event_mutations_admitted(&self) -> bool {
        self.inbound_event_mutations_open && self.event_mutations_admitted()
    }

    pub(in crate::live::sessions) fn close_inbound_event_mutations(&mut self) {
        self.inbound_event_mutations_open = false;
    }

    /// Permanently close this actor generation's event sequence. The caller
    /// must hold the shared sink mutex until this flag changes so every writer
    /// admitted before the fence has completed before ownership is released.
    pub(in crate::live::sessions) fn seal_event_sequence(&mut self) {
        self.event_sequence_owned = false;
        self.inbound_event_mutations_open = false;
    }

    pub fn current_turn_id(&self) -> Option<String> {
        self.current_turn_id.clone()
    }

    /// The open prompt turn's `(turn_id, item_id)` user-message identity, or
    /// `None` when no prompt turn is open (engine-initiated turn, or between
    /// turns). The side-door fork binds a vendor OpenCode `messageId` echo to this.
    pub(in crate::live::sessions) fn current_user_message_identity(
        &self,
    ) -> Option<(String, String)> {
        match (&self.current_turn_id, &self.current_user_item_id) {
            (Some(turn_id), Some(item_id)) => Some((turn_id.clone(), item_id.clone())),
            _ => None,
        }
    }

    pub fn close_open_transcript_items(&mut self) {
        self.close_open_items();
    }

    pub fn publish_persisted_events(&mut self, envelopes: Vec<SessionEventEnvelope>) {
        if !self.event_sequence_owned {
            tracing::error!(
                session_id = %self.session_id,
                failure_code = "event_sequence_relinquished",
                "persisted events rejected after event sequence relinquishment"
            );
            return;
        }
        // Observer-persisted goal events flow back through here after being
        // attributed to the current turn, so this is the one spot that sees a
        // goal reach quiescence AFTER its event already carries the right
        // turn id. A quiescent goal ends the engine-initiated turn its
        // pursuit opened (see `ensure_open_turn`); prompt-begun turns are
        // never auto-closed — their lifecycle ends them.
        let engine_terminal_outcome = envelopes
            .iter()
            .filter_map(|envelope| goal_event_terminal_outcome(&envelope.event))
            .last();
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
        if let Some(outcome) = engine_terminal_outcome {
            if self.engine_initiated_turn && self.engine_turn_has_events {
                self.engine_terminal_outcome = Some(outcome);
            }
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
fn goal_event_terminal_outcome(event: &SessionEvent) -> Option<TerminalTurnOutcome> {
    match event {
        SessionEvent::GoalMet(_) => Some(TerminalTurnOutcome::Completed),
        SessionEvent::GoalCleared(_) => Some(TerminalTurnOutcome::Cancelled),
        SessionEvent::GoalUpdated(payload) => match payload.goal.status {
            GoalStatus::Active => None,
            GoalStatus::Met => Some(TerminalTurnOutcome::Completed),
            GoalStatus::Failed | GoalStatus::Blocked => Some(TerminalTurnOutcome::Failed),
            GoalStatus::Cleared | GoalStatus::Paused => Some(TerminalTurnOutcome::Cancelled),
        },
        _ => None,
    }
}
