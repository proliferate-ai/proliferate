use super::normalization::meta::is_assistant_message_completed_marker;
use super::normalization::text::extract_text;
use super::state::{AcpChunkPayload, CompletedAssistantMessage, StreamingItemState};
use super::SessionEventSink;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, SessionEvent,
    TranscriptItemDeltaPayload, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
};

impl SessionEventSink {
    pub fn agent_message_chunk(
        &mut self,
        payload: AcpChunkPayload,
    ) -> Option<CompletedAssistantMessage> {
        if is_assistant_message_completed_marker(payload.meta.as_ref()) {
            return self.close_assistant_item_by_message_id(payload.message_id.as_deref());
        }

        let text = extract_text(&payload.content);
        if text.is_empty() {
            return None;
        }
        let parent_tool_call_id = self.meta_parent_tool_call_id(payload.meta.as_ref());
        let message_id = payload.message_id.clone();

        self.close_reasoning_item();

        let should_open_new = self
            .open_assistant_item
            .as_ref()
            .map(|item| {
                item.parent_tool_call_id != parent_tool_call_id
                    || (message_id.is_some() && item.message_id != message_id)
            })
            .unwrap_or(true);

        if should_open_new {
            let _ = self.close_assistant_item();
            let item_id = uuid::Uuid::new_v4().to_string();
            let item = TranscriptItemPayload {
                kind: TranscriptItemKind::AssistantMessage,
                status: TranscriptItemStatus::InProgress,
                source_agent_kind: self.source_agent_kind.clone(),
                is_transient: false,
                message_id: message_id.clone(),
                prompt_id: None,
                title: None,
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id: parent_tool_call_id.clone(),
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Text { text: text.clone() }],
                prompt_provenance: None,
            };
            self.emit_with_ids(
                SessionEvent::ItemStarted(ItemStartedEvent { item }),
                self.current_turn_id.clone(),
                Some(item_id.clone()),
            );
            self.open_assistant_item = Some(StreamingItemState {
                item_id,
                parent_tool_call_id,
                message_id,
                text,
                is_transient: false,
            });
            return None;
        }

        if self.open_assistant_item.is_some() {
            let item_id = {
                let item = self.open_assistant_item.as_mut().expect("assistant item");
                item.text.push_str(&text);
                item.item_id.clone()
            };
            self.emit_with_ids(
                SessionEvent::ItemDelta(ItemDeltaEvent {
                    delta: TranscriptItemDeltaPayload {
                        is_transient: None,
                        status: None,
                        title: None,
                        native_tool_name: None,
                        parent_tool_call_id: None,
                        raw_input: None,
                        raw_output: None,
                        append_text: Some(text),
                        append_reasoning: None,
                        replace_content_parts: None,
                        append_content_parts: None,
                    },
                }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
        None
    }

    pub(super) fn close_assistant_item(&mut self) -> Option<CompletedAssistantMessage> {
        if let Some(item) = self.open_assistant_item.take() {
            let StreamingItemState {
                item_id,
                parent_tool_call_id,
                message_id,
                text,
                is_transient: _,
            } = item;
            let completed = CompletedAssistantMessage {
                message_id: message_id.clone(),
                text: text.clone(),
            };
            let payload = TranscriptItemPayload {
                kind: TranscriptItemKind::AssistantMessage,
                status: TranscriptItemStatus::Completed,
                source_agent_kind: self.source_agent_kind.clone(),
                is_transient: false,
                message_id,
                prompt_id: None,
                title: None,
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id,
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Text { text }],
                prompt_provenance: None,
            };
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: payload }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
            return Some(completed);
        }
        None
    }

    fn close_assistant_item_by_message_id(
        &mut self,
        message_id: Option<&str>,
    ) -> Option<CompletedAssistantMessage> {
        let Some(message_id) = message_id else {
            return None;
        };
        let is_current_message = self
            .open_assistant_item
            .as_ref()
            .and_then(|item| item.message_id.as_deref())
            .is_some_and(|open_message_id| open_message_id == message_id);

        if is_current_message {
            return self.close_assistant_item();
        }
        None
    }
}
