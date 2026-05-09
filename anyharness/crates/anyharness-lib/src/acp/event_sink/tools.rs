use super::background_work::{
    background_work_raw_output, extract_background_work_metadata,
    extract_existing_background_work_metadata,
};
use super::normalization::meta::parse_meta;
use super::normalization::snapshots::{merge_snapshot_detail_parts, normalize_snapshot_parts};
use super::normalization::terminals::normalize_terminal_parts;
use super::state::{AcpToolPayload, ToolItemState};
use super::SessionEventSink;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, SessionEvent,
    TranscriptItemDeltaPayload, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
};

impl SessionEventSink {
    pub fn tool_call(&mut self, payload: AcpToolPayload) {
        self.close_open_items();

        let item_id = payload.tool_call_id.clone();
        let item = self.build_tool_item(&payload, None);
        self.emit_with_ids(
            SessionEvent::ItemStarted(ItemStartedEvent {
                item: item.item.clone(),
            }),
            self.current_turn_id.clone(),
            Some(item_id.clone()),
        );

        if is_terminal_status(&item.item.status) {
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: item.item }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
            return;
        }

        self.tool_items.insert(payload.tool_call_id, item);
    }

    pub fn tool_call_update(&mut self, payload: AcpToolPayload) {
        let existing = self.tool_items.get(&payload.tool_call_id).cloned();
        let item = self.build_tool_item(&payload, existing.as_ref());
        let item_id = payload.tool_call_id.clone();

        if existing.is_none() {
            self.emit_with_ids(
                SessionEvent::ItemStarted(ItemStartedEvent {
                    item: item.item.clone(),
                }),
                self.current_turn_id.clone(),
                Some(item_id.clone()),
            );
        }

        self.emit_with_ids(
            SessionEvent::ItemDelta(ItemDeltaEvent {
                delta: TranscriptItemDeltaPayload {
                    is_transient: None,
                    status: Some(item.item.status.clone()),
                    title: item.item.title.clone(),
                    native_tool_name: item.item.native_tool_name.clone(),
                    parent_tool_call_id: item.item.parent_tool_call_id.clone(),
                    raw_input: item.item.raw_input.clone(),
                    raw_output: item.item.raw_output.clone(),
                    append_text: None,
                    append_reasoning: None,
                    replace_content_parts: Some(item.item.content_parts.clone()),
                    append_content_parts: None,
                },
            }),
            self.current_turn_id.clone(),
            Some(item_id.clone()),
        );

        if is_terminal_status(&item.item.status) {
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: item.item }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
            self.tool_items.remove(&payload.tool_call_id);
            return;
        }

        self.tool_items.insert(payload.tool_call_id, item);
    }

    fn build_tool_item(
        &self,
        payload: &AcpToolPayload,
        previous: Option<&ToolItemState>,
    ) -> ToolItemState {
        let meta = parse_meta(payload.meta.as_ref());
        let native_tool_name = meta
            .anyharness
            .as_ref()
            .and_then(|meta| meta.native_tool_name.clone())
            .or_else(|| {
                if self.source_agent_kind == "claude" {
                    meta.claude_code
                        .as_ref()
                        .and_then(|meta| meta.tool_name.clone())
                } else {
                    None
                }
            })
            .or_else(|| previous.and_then(|prev| prev.item.native_tool_name.clone()));
        let parent_tool_call_id = if self.source_agent_kind == "claude" {
            meta.claude_code
                .as_ref()
                .and_then(|meta| meta.parent_tool_use_id.clone())
                .or_else(|| previous.and_then(|prev| prev.item.parent_tool_call_id.clone()))
        } else {
            previous.and_then(|prev| prev.item.parent_tool_call_id.clone())
        };

        let title = payload
            .title
            .clone()
            .or_else(|| previous.and_then(|prev| prev.item.title.clone()))
            .unwrap_or_else(|| "Tool call".to_string());
        let tool_kind = meta
            .anyharness
            .as_ref()
            .and_then(|meta| meta.tool_kind.clone())
            .or_else(|| payload.kind.clone())
            .or_else(|| previous.and_then(extract_tool_kind_from_item));
        let status = payload
            .status
            .as_deref()
            .map(map_tool_status)
            .or_else(|| previous.map(|prev| prev.item.status.clone()))
            .unwrap_or(TranscriptItemStatus::InProgress);
        let raw_input = payload
            .raw_input
            .clone()
            .or_else(|| previous.and_then(|prev| prev.item.raw_input.clone()));
        let raw_output = payload
            .raw_output
            .clone()
            .or_else(|| previous.and_then(|prev| prev.item.raw_output.clone()));
        let background_work =
            extract_background_work_metadata(raw_input.as_ref(), &meta).or_else(|| {
                previous.and_then(|prev| {
                    extract_existing_background_work_metadata(prev.item.raw_output.as_ref())
                })
            });
        let raw_output = match background_work {
            Some(background_work) => Some(background_work_raw_output(raw_output, background_work)),
            None => raw_output,
        };

        let mut terminal_parts = previous
            .map(|prev| prev.terminal_parts.clone())
            .unwrap_or_default();
        for part in normalize_terminal_parts(payload, &meta) {
            if !terminal_parts.contains(&part) {
                terminal_parts.push(part);
            }
        }

        let previous_detail_parts = previous
            .map(|prev| {
                prev.snapshot_parts
                    .iter()
                    .filter(|part| !matches!(part, ContentPart::ToolCall { .. }))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let normalized_detail_parts = normalize_snapshot_parts(
            payload,
            tool_kind.as_deref(),
            native_tool_name.clone(),
            &self.workspace_root,
            raw_input.as_ref(),
            raw_output.as_ref(),
            &meta,
        );
        let detail_parts =
            merge_snapshot_detail_parts(previous_detail_parts, normalized_detail_parts);

        let mut snapshot_parts = vec![ContentPart::ToolCall {
            tool_call_id: payload.tool_call_id.clone(),
            title: title.clone(),
            tool_kind: tool_kind.clone(),
            native_tool_name: native_tool_name.clone(),
        }];
        snapshot_parts.extend(detail_parts);

        let mut content_parts = snapshot_parts.clone();
        content_parts.extend(terminal_parts.clone());

        let item = TranscriptItemPayload {
            kind: TranscriptItemKind::ToolInvocation,
            status,
            source_agent_kind: self.source_agent_kind.clone(),
            is_transient: false,
            message_id: None,
            prompt_id: None,
            title: Some(title),
            tool_call_id: Some(payload.tool_call_id.clone()),
            native_tool_name,
            parent_tool_call_id,
            raw_input,
            raw_output,
            content_parts,
            prompt_provenance: None,
        };

        ToolItemState {
            item,
            terminal_parts,
            snapshot_parts,
        }
    }

    pub(super) fn close_tool_items(&mut self) {
        let items: Vec<(String, ToolItemState)> = self.tool_items.drain().collect();
        for (item_id, state) in items {
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: state.item }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
    }
}

fn map_tool_status(status: &str) -> TranscriptItemStatus {
    match status {
        "completed" => TranscriptItemStatus::Completed,
        "failed" => TranscriptItemStatus::Failed,
        _ => TranscriptItemStatus::InProgress,
    }
}

fn is_terminal_status(status: &TranscriptItemStatus) -> bool {
    matches!(
        status,
        TranscriptItemStatus::Completed | TranscriptItemStatus::Failed
    )
}

fn extract_tool_kind_from_item(item: &ToolItemState) -> Option<String> {
    item.snapshot_parts.iter().find_map(|part| match part {
        ContentPart::ToolCall { tool_kind, .. } => tool_kind.clone(),
        _ => None,
    })
}
