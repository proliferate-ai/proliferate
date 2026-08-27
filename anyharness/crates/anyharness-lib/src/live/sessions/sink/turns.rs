use super::SessionEventSink;
use crate::observability::lifecycle;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemStartedEvent, PromptProvenance, SessionEvent, StopReason,
    TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus, TurnEndedEvent,
    TurnStartedEvent,
};

impl SessionEventSink {
    pub fn begin_turn(
        &mut self,
        prompt_text: String,
        prompt_id: Option<String>,
        content_parts: Vec<ContentPart>,
        prompt_provenance: Option<PromptProvenance>,
    ) -> anyhow::Result<String> {
        self.prepare_for_prompt_turn()?;

        let turn_id = uuid::Uuid::new_v4().to_string();
        tracing::debug!(turn_id = %turn_id, "event_sink: beginning turn");
        self.turn_assistant_messages.clear();
        self.turn_first_output_stamped = false;
        self.current_turn_id = Some(turn_id.clone());
        self.engine_initiated_turn = false;
        self.turn_lifecycle = Some(lifecycle::begin_turn_execute(
            &self.session_id,
            &turn_id,
            false,
        ));
        self.emit_with_ids(
            SessionEvent::TurnStarted(TurnStartedEvent::default()),
            Some(turn_id.clone()),
            None,
        );

        let item_id = uuid::Uuid::new_v4().to_string();
        // Bind the vendor OpenCode `messageId` echo to this
        // prompt turn's user-message identity. Cleared at `turn_ended`; never
        // set for engine-initiated turns.
        self.current_user_item_id = Some(item_id.clone());
        let item = TranscriptItemPayload {
            kind: TranscriptItemKind::UserMessage,
            status: TranscriptItemStatus::Completed,
            source_agent_kind: self.source_agent_kind.clone(),
            is_transient: false,
            message_id: None,
            prompt_id,
            title: None,
            tool_call_id: None,
            native_tool_name: None,
            parent_tool_call_id: None,
            raw_input: None,
            raw_output: None,
            content_parts: if content_parts.is_empty() {
                vec![ContentPart::Text { text: prompt_text }]
            } else {
                content_parts
            },
            prompt_provenance,
        };
        self.emit_with_ids(
            SessionEvent::ItemStarted(ItemStartedEvent { item: item.clone() }),
            Some(turn_id.clone()),
            Some(item_id.clone()),
        );
        self.emit_with_ids(
            SessionEvent::ItemCompleted(ItemCompletedEvent { item }),
            Some(turn_id),
            Some(item_id),
        );
        Ok(self.current_turn_id.clone().unwrap_or_default())
    }

    pub(super) fn prepare_for_prompt_turn(&mut self) -> anyhow::Result<()> {
        // A dangling engine-initiated turn (goal pursuit that never reached a
        // quiescent goal event, e.g. the sidecar died mid-continuation) must
        // not swallow the incoming prompt turn.
        if let Some(engine_initiated) = self.staged_terminal_is_engine_initiated() {
            anyhow::ensure!(
                engine_initiated,
                "a prompt terminal remains durably unresolved"
            );
            self.commit_staged_prompt_terminal()?;
        }
        self.end_engine_initiated_turn_if_open()?;
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        Ok(())
    }

    pub fn turn_ended(&mut self, stop_reason: StopReason) {
        self.finish_turn_lifecycle(&stop_reason.to_string());
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        self.emit_with_ids(
            SessionEvent::TurnEnded(TurnEndedEvent { stop_reason }),
            self.current_turn_id.clone(),
            None,
        );
        // The turn is over: anything that arrives from here on is
        // engine-initiated (goal continuation/evaluation) and must open its
        // own turn instead of being glued onto this one.
        self.current_turn_id = None;
        self.current_user_item_id = None;
        self.engine_initiated_turn = false;
    }

    /// Returns the open turn id, opening a synthetic engine-initiated turn if
    /// none is open. Goal continuation/evaluation turns run without a prompt
    /// lifecycle, so their transcript activity arrives with no turn open;
    /// without this they would render fused into the previous turn's group
    /// (no per-turn chrome, replies concatenated).
    pub(super) fn ensure_open_turn(&mut self) -> String {
        if let Some(turn_id) = self.current_turn_id.clone() {
            return turn_id;
        }
        let turn_id = uuid::Uuid::new_v4().to_string();
        tracing::debug!(turn_id = %turn_id, "event_sink: opening engine-initiated turn");
        self.turn_assistant_messages.clear();
        self.turn_first_output_stamped = false;
        self.current_turn_id = Some(turn_id.clone());
        self.engine_initiated_turn = true;
        self.engine_turn_has_events = false;
        self.turn_lifecycle = Some(lifecycle::begin_turn_execute(
            &self.session_id,
            &turn_id,
            true,
        ));
        self.emit_with_ids(
            SessionEvent::TurnStarted(TurnStartedEvent::default()),
            Some(turn_id.clone()),
            None,
        );
        turn_id
    }

    /// Ends the open turn only when it was engine-initiated. Prompt-begun
    /// turns are owned by the prompt lifecycle and never auto-closed.
    pub(super) fn end_engine_initiated_turn_if_open(&mut self) -> anyhow::Result<()> {
        if self.engine_initiated_turn && self.current_turn_id.is_some() {
            if self.engine_turn_has_events {
                self.stage_prompt_terminal(
                    crate::live::sessions::model::TerminalTurnOutcome::Completed,
                    super::PromptTerminalEvent::TurnEnded(StopReason::EndTurn),
                )?;
                self.commit_staged_prompt_terminal()?;
            } else {
                self.turn_ended(StopReason::EndTurn);
            }
        }
        Ok(())
    }

    /// Closes an engine-initiated turn that never received content. A
    /// goal_updated tag opens the turn eagerly (before the goal observer
    /// classifies the update); when the observer drops it (stale accounting
    /// echo after a clear, idempotent duplicate) nothing would ever close the
    /// bare TurnStarted and the transcript would show a phantom in-progress
    /// turn. Called after each notification's observer dispatch; the empty
    /// started/ended pair renders as nothing.
    pub fn sweep_empty_engine_turn(&mut self) {
        if self.engine_initiated_turn
            && self.current_turn_id.is_some()
            && !self.engine_turn_has_events
        {
            self.turn_ended(StopReason::EndTurn);
        }
    }
}

impl SessionEventSink {
    /// Records time-to-first-output on the open turn's guard, once per turn.
    /// The first assistant item to open is the first output; later items and
    /// engine-initiated turns without a guard stamp nothing.
    pub(in crate::live::sessions) fn stamp_first_output(&mut self) {
        if self.turn_first_output_stamped {
            return;
        }
        let Some(operation) = self.turn_lifecycle.as_mut() else {
            return;
        };
        let elapsed = operation.elapsed_ms();
        operation.append([lifecycle::turn_first_output(elapsed)]);
        self.turn_first_output_stamped = true;
    }

    /// Closes the open turn's lifecycle operation with the stop reason the
    /// turn actually ended on. A turn with no open guard (a subagent-wake turn,
    /// or a sink restored from a staged snapshot) closes nothing rather than
    /// inventing a record.
    pub(in crate::live::sessions) fn finish_turn_lifecycle(&mut self, stop_reason: &str) {
        let Some(mut operation) = self.turn_lifecycle.take() else {
            return;
        };
        operation.append([lifecycle::turn_stop_reason(stop_reason)]);
        operation.terminal(lifecycle::turn_outcome(stop_reason), None);
    }

    /// Closes the open turn's lifecycle operation with the outcome the durable
    /// terminal transaction actually committed. This is the production path for
    /// a prompt turn: `turn_ended` covers the engine-initiated close.
    pub(in crate::live::sessions) fn commit_turn_lifecycle(
        &mut self,
        outcome: crate::live::sessions::model::TerminalTurnOutcome,
    ) {
        use crate::live::sessions::model::TerminalTurnOutcome;
        let Some(mut operation) = self.turn_lifecycle.take() else {
            return;
        };
        operation.append([lifecycle::turn_stop_reason(outcome.as_str())]);
        match outcome {
            TerminalTurnOutcome::Completed => operation.succeeded(),
            TerminalTurnOutcome::Cancelled => {
                operation.terminal(lifecycle::LifecycleOutcome::Cancelled, None)
            }
            TerminalTurnOutcome::Failed => operation.terminal(
                lifecycle::LifecycleOutcome::Failed,
                Some(lifecycle::TURN_ERROR),
            ),
        }
    }
}
