use super::normalization::meta::is_transient_status_marker;
use super::normalization::text::extract_text;
use super::state::{AcpChunkPayload, StreamingItemState};
use super::SessionEventSink;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, SessionEvent,
    TranscriptItemDeltaPayload, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
};

impl SessionEventSink {
    pub fn agent_thought_chunk(&mut self, payload: AcpChunkPayload) {
        let text = extract_text(&payload.content);
        if text.is_empty() {
            return;
        }
        let is_transient = is_transient_status_marker(payload.meta.as_ref());
        let parent_tool_call_id = self.meta_parent_tool_call_id(payload.meta.as_ref());
        let message_id = payload.message_id.clone();

        let should_open_new = self
            .open_reasoning_item
            .as_ref()
            .map(|item| {
                item.parent_tool_call_id != parent_tool_call_id
                    || (message_id.is_some() && item.message_id != message_id)
                    || item.is_transient != is_transient
            })
            .unwrap_or(true);

        if should_open_new {
            self.close_reasoning_item();
            let item_id = uuid::Uuid::new_v4().to_string();
            let item = TranscriptItemPayload {
                kind: TranscriptItemKind::Reasoning,
                status: TranscriptItemStatus::InProgress,
                source_agent_kind: self.source_agent_kind.clone(),
                is_transient,
                message_id: message_id.clone(),
                prompt_id: None,
                title: None,
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id: parent_tool_call_id.clone(),
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Reasoning {
                    text: text.clone(),
                    visibility: anyharness_contract::v1::ReasoningVisibility::Private,
                }],
                prompt_provenance: None,
            };
            self.emit_with_ids(
                SessionEvent::ItemStarted(ItemStartedEvent { item }),
                self.current_turn_id.clone(),
                Some(item_id.clone()),
            );
            self.open_reasoning_item = Some(StreamingItemState {
                item_id,
                parent_tool_call_id,
                message_id,
                text,
                is_transient,
            });
            return;
        }

        if self.open_reasoning_item.is_some() {
            let item_id = {
                let item = self.open_reasoning_item.as_mut().expect("reasoning item");
                if item.is_transient {
                    item.text = text.clone();
                } else {
                    item.text.push_str(&text);
                }
                item.item_id.clone()
            };
            self.emit_with_ids(
                SessionEvent::ItemDelta(ItemDeltaEvent {
                    delta: TranscriptItemDeltaPayload {
                        is_transient: Some(is_transient),
                        status: None,
                        title: None,
                        native_tool_name: None,
                        parent_tool_call_id: None,
                        raw_input: None,
                        raw_output: None,
                        append_text: None,
                        append_reasoning: if is_transient {
                            None
                        } else {
                            Some(text.clone())
                        },
                        replace_content_parts: if is_transient {
                            Some(vec![ContentPart::Reasoning {
                                text,
                                visibility: anyharness_contract::v1::ReasoningVisibility::Private,
                            }])
                        } else {
                            None
                        },
                        append_content_parts: None,
                    },
                }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
    }

    pub(super) fn close_reasoning_item(&mut self) {
        if let Some(item) = self.open_reasoning_item.take() {
            let StreamingItemState {
                item_id,
                parent_tool_call_id,
                message_id,
                text,
                is_transient,
            } = item;
            let payload = TranscriptItemPayload {
                kind: TranscriptItemKind::Reasoning,
                status: TranscriptItemStatus::Completed,
                source_agent_kind: self.source_agent_kind.clone(),
                is_transient,
                message_id,
                prompt_id: None,
                title: None,
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id,
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Reasoning {
                    text,
                    visibility: anyharness_contract::v1::ReasoningVisibility::Private,
                }],
                prompt_provenance: None,
            };
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: payload }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
    }
}
