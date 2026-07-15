use super::SessionEventSink;
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
    ) -> String {
        // A dangling engine-initiated turn (goal pursuit that never reached a
        // quiescent goal event, e.g. the sidecar died mid-continuation) must
        // not swallow the incoming prompt turn.
        self.end_engine_initiated_turn_if_open();
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();

        let turn_id = uuid::Uuid::new_v4().to_string();
        tracing::debug!(turn_id = %turn_id, "event_sink: beginning turn");
        self.current_turn_id = Some(turn_id.clone());
        self.engine_initiated_turn = false;
        self.emit_with_ids(
            SessionEvent::TurnStarted(TurnStartedEvent::default()),
            Some(turn_id.clone()),
            None,
        );

        let item_id = uuid::Uuid::new_v4().to_string();
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
        self.current_turn_id.clone().unwrap_or_default()
    }

    pub fn turn_ended(&mut self, stop_reason: StopReason) {
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
        self.current_turn_id = Some(turn_id.clone());
        self.engine_initiated_turn = true;
        self.emit_with_ids(
            SessionEvent::TurnStarted(TurnStartedEvent::default()),
            Some(turn_id.clone()),
            None,
        );
        turn_id
    }

    /// Ends the open turn only when it was engine-initiated. Prompt-begun
    /// turns are owned by the prompt lifecycle and never auto-closed.
    pub(super) fn end_engine_initiated_turn_if_open(&mut self) {
        if self.engine_initiated_turn && self.current_turn_id.is_some() {
            self.turn_ended(StopReason::EndTurn);
        }
    }
}
