use super::state::PlanItemState;
use super::SessionEventSink;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, PlanEntry, SessionEvent,
    TranscriptItemDeltaPayload, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
};

impl SessionEventSink {
    pub fn plan(&mut self, entries: Vec<serde_json::Value>) {
        self.close_open_items();
        let entries = normalize_plan_entries(&entries);

        if self.open_plan_item.is_some() {
            let item_id = {
                let existing = self.open_plan_item.as_mut().expect("plan item");
                existing.entries = entries.clone();
                existing.item_id.clone()
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
                        append_text: None,
                        append_reasoning: None,
                        replace_content_parts: Some(vec![ContentPart::Plan {
                            entries: entries.clone(),
                        }]),
                        append_content_parts: None,
                    },
                }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
            return;
        }

        let item_id = self
            .current_turn_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let item = TranscriptItemPayload {
            kind: TranscriptItemKind::Plan,
            status: TranscriptItemStatus::InProgress,
            source_agent_kind: self.source_agent_kind.clone(),
            is_transient: false,
            message_id: None,
            prompt_id: None,
            title: Some("Plan".to_string()),
            tool_call_id: None,
            native_tool_name: None,
            parent_tool_call_id: None,
            raw_input: None,
            raw_output: None,
            content_parts: vec![ContentPart::Plan {
                entries: entries.clone(),
            }],
            prompt_provenance: None,
        };
        self.emit_with_ids(
            SessionEvent::ItemStarted(ItemStartedEvent { item }),
            self.current_turn_id.clone(),
            Some(item_id.clone()),
        );
        self.open_plan_item = Some(PlanItemState { item_id, entries });
    }

    pub(super) fn close_plan_item(&mut self) {
        if let Some(item) = self.open_plan_item.take() {
            let payload = TranscriptItemPayload {
                kind: TranscriptItemKind::Plan,
                status: TranscriptItemStatus::Completed,
                source_agent_kind: self.source_agent_kind.clone(),
                is_transient: false,
                message_id: None,
                prompt_id: None,
                title: Some("Plan".to_string()),
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id: None,
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Plan {
                    entries: item.entries,
                }],
                prompt_provenance: None,
            };
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: payload }),
                self.current_turn_id.clone(),
                Some(item.item_id),
            );
        }
    }
}

fn normalize_plan_entries(entries: &[serde_json::Value]) -> Vec<PlanEntry> {
    entries
        .iter()
        .map(|entry| PlanEntry {
            content: entry
                .get("content")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_else(|| entry.as_str().unwrap_or(""))
                .to_string(),
            status: entry
                .get("status")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("pending")
                .to_string(),
        })
        .collect()
}
