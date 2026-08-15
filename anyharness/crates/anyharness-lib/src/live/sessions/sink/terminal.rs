use anyharness_contract::v1::{
    ErrorEvent, ErrorEventDetails, SessionEvent, StopReason, TurnEndedEvent,
};

use super::state::{PlanItemState, StreamingItemState, ToolItemState};
use super::SessionEventSink;
use crate::domains::sessions::model::bounded_assistant_text;
use crate::live::sessions::model::{TerminalTurnOutcome, TerminalTurnPersistenceInput};
use crate::observability::transcript_phase::record_transcript_phase_event;
use std::collections::HashMap;

pub(in crate::live::sessions) enum PromptTerminalEvent {
    TurnEnded(StopReason),
    ErrorAndTurnEnded {
        message: String,
        code: Option<String>,
        details: Option<ErrorEventDetails>,
        stop_reason: StopReason,
    },
    Error {
        message: String,
        code: Option<String>,
        details: Option<ErrorEventDetails>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::live::sessions) struct TerminalTurnCommit {
    pub turn_id: String,
    pub last_event_seq: i64,
}

#[derive(Clone)]
struct TerminalSinkState {
    next_seq: i64,
    current_turn_id: Option<String>,
    engine_initiated_turn: bool,
    engine_turn_has_events: bool,
    engine_terminal_outcome: Option<TerminalTurnOutcome>,
    open_assistant_item: Option<StreamingItemState>,
    open_reasoning_item: Option<StreamingItemState>,
    open_plan_item: Option<PlanItemState>,
    tool_items: HashMap<String, ToolItemState>,
    turn_assistant_messages: Vec<String>,
}

pub(in crate::live::sessions) struct StagedTerminalTurn {
    pub(super) input: TerminalTurnPersistenceInput,
    final_state: Option<TerminalSinkState>,
    pub(super) is_drafting: bool,
    engine_initiated: bool,
}

impl SessionEventSink {
    fn terminal_state(&self) -> TerminalSinkState {
        TerminalSinkState {
            next_seq: self.next_seq,
            current_turn_id: self.current_turn_id.clone(),
            engine_initiated_turn: self.engine_initiated_turn,
            engine_turn_has_events: self.engine_turn_has_events,
            engine_terminal_outcome: self.engine_terminal_outcome,
            open_assistant_item: self.open_assistant_item.clone(),
            open_reasoning_item: self.open_reasoning_item.clone(),
            open_plan_item: self.open_plan_item.clone(),
            tool_items: self.tool_items.clone(),
            turn_assistant_messages: self.turn_assistant_messages.clone(),
        }
    }

    fn apply_terminal_state(&mut self, state: TerminalSinkState) {
        self.next_seq = state.next_seq;
        self.current_turn_id = state.current_turn_id;
        self.engine_initiated_turn = state.engine_initiated_turn;
        self.engine_turn_has_events = state.engine_turn_has_events;
        self.engine_terminal_outcome = state.engine_terminal_outcome;
        self.open_assistant_item = state.open_assistant_item;
        self.open_reasoning_item = state.open_reasoning_item;
        self.open_plan_item = state.open_plan_item;
        self.tool_items = state.tool_items;
        self.turn_assistant_messages = state.turn_assistant_messages;
    }

    pub(in crate::live::sessions) fn requested_engine_terminal_outcome(
        &self,
    ) -> Option<TerminalTurnOutcome> {
        (self.engine_initiated_turn
            && self.engine_turn_has_events
            && self.current_turn_id.is_some())
        .then_some(self.engine_terminal_outcome)
        .flatten()
    }

    pub(in crate::live::sessions) fn has_staged_terminal(&self) -> bool {
        self.staged_terminal.is_some()
    }

    /// Admission gate for any operation that changes durable or live state
    /// and then emits a session event. Callers must inspect this while holding
    /// the sink lock, before performing the associated mutation. Once a
    /// terminal batch is frozen, that batch owns the next event sequence until
    /// it commits or startup repair retires it.
    pub(in crate::live::sessions) fn event_mutations_admitted(&self) -> bool {
        self.staged_terminal.is_none()
    }

    pub(in crate::live::sessions) fn staged_terminal_is_engine_initiated(&self) -> Option<bool> {
        self.staged_terminal
            .as_ref()
            .map(|staged| staged.engine_initiated)
    }

    /// Freeze the terminal event batch once. The method mutates only in-memory
    /// sink state; durability and publication happen in
    /// [`commit_staged_prompt_terminal`](Self::commit_staged_prompt_terminal).
    pub(in crate::live::sessions) fn stage_prompt_terminal(
        &mut self,
        outcome: TerminalTurnOutcome,
        terminal: PromptTerminalEvent,
    ) -> anyhow::Result<()> {
        if self.staged_terminal.is_some() {
            anyhow::bail!("a terminal turn is already staged");
        }
        let turn_id = self
            .current_turn_id
            .clone()
            .filter(|turn_id| !turn_id.is_empty())
            .ok_or_else(|| anyhow::anyhow!("cannot finish a prompt without an open turn"))?;
        let original_state = self.terminal_state();
        self.staged_terminal = Some(StagedTerminalTurn {
            input: TerminalTurnPersistenceInput {
                terminal_id: uuid::Uuid::new_v4().to_string(),
                session_id: self.session_id.clone(),
                turn_id: turn_id.clone(),
                outcome,
                assistant_text: None,
                events: Vec::new(),
                completed_at: chrono::Utc::now().to_rfc3339(),
            },
            final_state: None,
            is_drafting: true,
            engine_initiated: original_state.engine_initiated_turn,
        });

        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        match terminal {
            PromptTerminalEvent::TurnEnded(stop_reason) => self.emit_with_ids(
                SessionEvent::TurnEnded(TurnEndedEvent { stop_reason }),
                Some(turn_id),
                None,
            ),
            PromptTerminalEvent::ErrorAndTurnEnded {
                message,
                code,
                details,
                stop_reason,
            } => {
                self.emit_with_ids(
                    SessionEvent::Error(ErrorEvent {
                        message,
                        code,
                        details,
                    }),
                    Some(turn_id.clone()),
                    Some(uuid::Uuid::new_v4().to_string()),
                );
                self.emit_with_ids(
                    SessionEvent::TurnEnded(TurnEndedEvent { stop_reason }),
                    Some(turn_id),
                    None,
                );
            }
            PromptTerminalEvent::Error {
                message,
                code,
                details,
            } => self.emit_with_ids(
                SessionEvent::Error(ErrorEvent {
                    message,
                    code,
                    details,
                }),
                Some(turn_id),
                Some(uuid::Uuid::new_v4().to_string()),
            ),
        }
        self.current_turn_id = None;
        self.engine_initiated_turn = false;
        self.engine_turn_has_events = false;
        self.engine_terminal_outcome = None;
        let assistant_text = bounded_assistant_text(&self.turn_assistant_messages);
        self.staged_terminal
            .as_mut()
            .expect("terminal stage exists")
            .input
            .assistant_text = assistant_text;
        self.turn_assistant_messages.clear();
        let final_state = self.terminal_state();
        let mut staged = self
            .staged_terminal
            .take()
            .expect("terminal stage exists after drafting");
        staged.final_state = Some(final_state);
        staged.is_drafting = false;
        self.apply_terminal_state(original_state);
        self.staged_terminal = Some(staged);
        Ok(())
    }

    /// Attempt the frozen terminal transaction. A failure leaves the exact
    /// input resident for a bounded actor retry; no seq is advanced further,
    /// no event is broadcast, and the turn-finish callback must not run.
    pub(in crate::live::sessions) fn commit_staged_prompt_terminal(
        &mut self,
    ) -> anyhow::Result<TerminalTurnCommit> {
        let input = self
            .staged_terminal
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no terminal turn is staged"))?;
        self.store.persist_terminal_turn(&input.input)?;

        let committed = self
            .staged_terminal
            .take()
            .expect("terminal stage exists after persistence");
        let last_event_seq = committed
            .input
            .events
            .last()
            .map(|event| event.seq)
            .ok_or_else(|| anyhow::anyhow!("terminal event batch is empty"))?;
        let turn_id = committed.input.turn_id.clone();
        self.apply_terminal_state(
            committed
                .final_state
                .expect("terminal final state exists after drafting"),
        );
        for envelope in committed.input.events {
            record_transcript_phase_event(&mut self.transcript_phase_debug, &envelope);
            let _ = self.event_tx.send(envelope);
        }
        Ok(TerminalTurnCommit {
            turn_id,
            last_event_seq,
        })
    }
}
