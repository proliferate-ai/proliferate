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
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();

        let turn_id = uuid::Uuid::new_v4().to_string();
        self.current_turn_id = Some(turn_id.clone());
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
    }
}
