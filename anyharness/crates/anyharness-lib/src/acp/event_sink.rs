use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use serde::Deserialize;
use tokio::sync::broadcast;

use crate::sessions::model::SessionEventRecord;
use crate::sessions::store::SessionStore;
use anyharness_contract::v1::{
    AvailableCommandsUpdatePayload, ConfigOptionUpdatePayload, ContentPart,
    CurrentModeUpdatePayload, ErrorEvent, FileChangeOperation, FileOpenTarget, FileReadScope,
    ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, PermissionOutcome,
    PermissionRequestedEvent, PermissionResolvedEvent, PlanEntry, SessionEndReason,
    SessionEndedEvent, SessionEvent, SessionEventEnvelope, SessionInfoUpdatePayload,
    SessionStartedEvent, SessionStateUpdatePayload, StopReason, TranscriptItemDeltaPayload, TranscriptItemKind,
    TranscriptItemPayload, TranscriptItemStatus, TurnEndedEvent, TurnStartedEvent,
    UsageUpdatePayload,
};

#[derive(Debug, Clone, Default)]
pub struct AcpChunkPayload {
    pub content: serde_json::Value,
    pub meta: Option<serde_json::Value>,
    pub message_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AcpToolPayload {
    pub tool_call_id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub content: Option<Vec<serde_json::Value>>,
    pub locations: Option<Vec<serde_json::Value>>,
    pub raw_input: Option<serde_json::Value>,
    pub raw_output: Option<serde_json::Value>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
struct StreamingItemState {
    item_id: String,
    parent_tool_call_id: Option<String>,
    message_id: Option<String>,
    text: String,
}

#[derive(Debug, Clone)]
struct PlanItemState {
    item_id: String,
    entries: Vec<PlanEntry>,
}

#[derive(Debug, Clone)]
struct ToolItemState {
    item: TranscriptItemPayload,
    terminal_parts: Vec<ContentPart>,
    snapshot_parts: Vec<ContentPart>,
}

#[derive(Debug, Clone)]
struct NormalizedFileReference {
    raw_path: String,
    workspace_path: Option<String>,
    basename: String,
    line: Option<i64>,
}

#[derive(Debug, Clone)]
struct FileReadLineScope {
    scope: FileReadScope,
    line: Option<i64>,
    start_line: Option<i64>,
    end_line: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ParsedMeta {
    #[serde(rename = "claudeCode")]
    claude_code: Option<ClaudeCodeMeta>,
    #[serde(default)]
    terminal_info: Option<TerminalInfoMeta>,
    #[serde(default)]
    terminal_output: Option<TerminalOutputMeta>,
    #[serde(default)]
    terminal_exit: Option<TerminalExitMeta>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCodeMeta {
    tool_name: Option<String>,
    parent_tool_use_id: Option<String>,
    #[serde(default)]
    tool_response: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TerminalInfoMeta {
    terminal_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TerminalOutputMeta {
    terminal_id: String,
    data: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TerminalExitMeta {
    terminal_id: String,
    exit_code: i64,
    signal: Option<String>,
}

pub struct SessionEventSink {
    session_id: String,
    source_agent_kind: String,
    workspace_root: PathBuf,
    next_seq: i64,
    event_tx: broadcast::Sender<SessionEventEnvelope>,
    store: SessionStore,

    current_turn_id: Option<String>,
    open_assistant_item: Option<StreamingItemState>,
    open_reasoning_item: Option<StreamingItemState>,
    open_plan_item: Option<PlanItemState>,
    tool_items: HashMap<String, ToolItemState>,
}

impl SessionEventSink {
    pub fn new(
        session_id: String,
        source_agent_kind: String,
        workspace_root: PathBuf,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        store: SessionStore,
    ) -> Self {
        Self {
            session_id,
            source_agent_kind,
            workspace_root,
            next_seq: 1,
            event_tx,
            store,
            current_turn_id: None,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
        }
    }

    pub fn resume_from_seq(
        session_id: String,
        source_agent_kind: String,
        workspace_root: PathBuf,
        last_seq: i64,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        store: SessionStore,
    ) -> Self {
        Self {
            session_id,
            source_agent_kind,
            workspace_root,
            next_seq: last_seq + 1,
            event_tx,
            store,
            current_turn_id: None,
            open_assistant_item: None,
            open_reasoning_item: None,
            open_plan_item: None,
            tool_items: HashMap::new(),
        }
    }

    pub fn session_started(&mut self, native_session_id: String) {
        self.emit_with_ids(
            SessionEvent::SessionStarted(SessionStartedEvent {
                native_session_id,
                source_agent_kind: self.source_agent_kind.clone(),
            }),
            None,
            None,
        );
    }

    pub fn next_seq(&self) -> i64 {
        self.next_seq
    }

    pub fn session_ended(&mut self, reason: SessionEndReason) {
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        self.emit_with_ids(
            SessionEvent::SessionEnded(SessionEndedEvent { reason }),
            None,
            None,
        );
    }

    pub fn begin_turn(&mut self, prompt_text: String) {
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
            message_id: None,
            title: None,
            tool_call_id: None,
            native_tool_name: None,
            parent_tool_call_id: None,
            raw_input: None,
            raw_output: None,
            content_parts: vec![ContentPart::Text { text: prompt_text }],
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
    }

    pub fn agent_message_chunk(&mut self, payload: AcpChunkPayload) {
        let text = extract_text(&payload.content);
        if text.is_empty() {
            return;
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
            self.close_assistant_item();
            let item_id = uuid::Uuid::new_v4().to_string();
            let item = TranscriptItemPayload {
                kind: TranscriptItemKind::AssistantMessage,
                status: TranscriptItemStatus::InProgress,
                source_agent_kind: self.source_agent_kind.clone(),
                message_id: message_id.clone(),
                title: None,
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id: parent_tool_call_id.clone(),
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Text { text: text.clone() }],
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
            });
            return;
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
    }

    pub fn agent_thought_chunk(&mut self, payload: AcpChunkPayload) {
        let text = extract_text(&payload.content);
        if text.is_empty() {
            return;
        }
        let parent_tool_call_id = self.meta_parent_tool_call_id(payload.meta.as_ref());
        let message_id = payload.message_id.clone();

        let should_open_new = self
            .open_reasoning_item
            .as_ref()
            .map(|item| {
                item.parent_tool_call_id != parent_tool_call_id
                    || (message_id.is_some() && item.message_id != message_id)
            })
            .unwrap_or(true);

        if should_open_new {
            self.close_reasoning_item();
            let item_id = uuid::Uuid::new_v4().to_string();
            let item = TranscriptItemPayload {
                kind: TranscriptItemKind::Reasoning,
                status: TranscriptItemStatus::InProgress,
                source_agent_kind: self.source_agent_kind.clone(),
                message_id: message_id.clone(),
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
            });
            return;
        }

        if self.open_reasoning_item.is_some() {
            let item_id = {
                let item = self.open_reasoning_item.as_mut().expect("reasoning item");
                item.text.push_str(&text);
                item.item_id.clone()
            };
            self.emit_with_ids(
                SessionEvent::ItemDelta(ItemDeltaEvent {
                    delta: TranscriptItemDeltaPayload {
                        status: None,
                        title: None,
                        native_tool_name: None,
                        parent_tool_call_id: None,
                        raw_input: None,
                        raw_output: None,
                        append_text: None,
                        append_reasoning: Some(text),
                        replace_content_parts: None,
                        append_content_parts: None,
                    },
                }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
    }

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
            message_id: None,
            title: Some("Plan".to_string()),
            tool_call_id: None,
            native_tool_name: None,
            parent_tool_call_id: None,
            raw_input: None,
            raw_output: None,
            content_parts: vec![ContentPart::Plan {
                entries: entries.clone(),
            }],
        };
        self.emit_with_ids(
            SessionEvent::ItemStarted(ItemStartedEvent { item }),
            self.current_turn_id.clone(),
            Some(item_id.clone()),
        );
        self.open_plan_item = Some(PlanItemState { item_id, entries });
    }

    pub fn available_commands_update(&mut self, payload: AvailableCommandsUpdatePayload) {
        self.emit_with_ids(SessionEvent::AvailableCommandsUpdate(payload), None, None);
    }

    pub fn current_mode_update(&mut self, payload: CurrentModeUpdatePayload) {
        self.emit_with_ids(SessionEvent::CurrentModeUpdate(payload), None, None);
    }

    pub fn config_option_update(&mut self, payload: ConfigOptionUpdatePayload) {
        self.emit_with_ids(SessionEvent::ConfigOptionUpdate(payload), None, None);
    }

    pub fn session_state_update(&mut self, payload: SessionStateUpdatePayload) {
        self.emit_with_ids(SessionEvent::SessionStateUpdate(payload), None, None);
    }

    pub fn session_info_update(&mut self, payload: SessionInfoUpdatePayload) {
        self.emit_with_ids(SessionEvent::SessionInfoUpdate(payload), None, None);
    }

    pub fn usage_update(&mut self, payload: UsageUpdatePayload) {
        self.emit_with_ids(SessionEvent::UsageUpdate(payload), None, None);
    }

    pub fn error(&mut self, message: String, code: Option<String>) {
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        let item_id = uuid::Uuid::new_v4().to_string();
        self.emit_with_ids(
            SessionEvent::Error(ErrorEvent { message, code }),
            self.current_turn_id.clone(),
            Some(item_id),
        );
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

    pub fn permission_requested(&mut self, event: PermissionRequestedEvent) {
        self.close_open_items();
        self.emit_with_ids(
            SessionEvent::PermissionRequested(event.clone()),
            self.current_turn_id.clone(),
            event.tool_call_id,
        );
    }

    pub fn permission_resolved(&mut self, request_id: String, outcome: PermissionOutcome) {
        self.emit_with_ids(
            SessionEvent::PermissionResolved(PermissionResolvedEvent {
                request_id,
                outcome,
            }),
            self.current_turn_id.clone(),
            None,
        );
    }

    fn meta_parent_tool_call_id(&self, meta: Option<&serde_json::Value>) -> Option<String> {
        if self.source_agent_kind != "claude" {
            return None;
        }
        parse_meta(meta)
            .claude_code
            .and_then(|meta| meta.parent_tool_use_id)
    }

    fn build_tool_item(
        &self,
        payload: &AcpToolPayload,
        previous: Option<&ToolItemState>,
    ) -> ToolItemState {
        let meta = parse_meta(payload.meta.as_ref());
        let native_tool_name = if self.source_agent_kind == "claude" {
            meta.claude_code
                .as_ref()
                .and_then(|meta| meta.tool_name.clone())
                .or_else(|| previous.and_then(|prev| prev.item.native_tool_name.clone()))
        } else {
            previous.and_then(|prev| prev.item.native_tool_name.clone())
        };
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
        let tool_kind = payload
            .kind
            .clone()
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
            message_id: None,
            title: Some(title),
            tool_call_id: Some(payload.tool_call_id.clone()),
            native_tool_name,
            parent_tool_call_id,
            raw_input,
            raw_output,
            content_parts,
        };

        ToolItemState {
            item,
            terminal_parts,
            snapshot_parts,
        }
    }

    fn close_open_items(&mut self) {
        self.close_assistant_item();
        self.close_reasoning_item();
    }

    fn close_assistant_item(&mut self) {
        if let Some(item) = self.open_assistant_item.take() {
            let StreamingItemState {
                item_id,
                parent_tool_call_id,
                message_id,
                text,
            } = item;
            let payload = TranscriptItemPayload {
                kind: TranscriptItemKind::AssistantMessage,
                status: TranscriptItemStatus::Completed,
                source_agent_kind: self.source_agent_kind.clone(),
                message_id,
                title: None,
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id,
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Text { text }],
            };
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: payload }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
    }

    fn close_reasoning_item(&mut self) {
        if let Some(item) = self.open_reasoning_item.take() {
            let StreamingItemState {
                item_id,
                parent_tool_call_id,
                message_id,
                text,
            } = item;
            let payload = TranscriptItemPayload {
                kind: TranscriptItemKind::Reasoning,
                status: TranscriptItemStatus::Completed,
                source_agent_kind: self.source_agent_kind.clone(),
                message_id,
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
            };
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: payload }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
    }

    fn close_plan_item(&mut self) {
        if let Some(item) = self.open_plan_item.take() {
            let payload = TranscriptItemPayload {
                kind: TranscriptItemKind::Plan,
                status: TranscriptItemStatus::Completed,
                source_agent_kind: self.source_agent_kind.clone(),
                message_id: None,
                title: Some("Plan".to_string()),
                tool_call_id: None,
                native_tool_name: None,
                parent_tool_call_id: None,
                raw_input: None,
                raw_output: None,
                content_parts: vec![ContentPart::Plan {
                    entries: item.entries,
                }],
            };
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: payload }),
                self.current_turn_id.clone(),
                Some(item.item_id),
            );
        }
    }

    fn close_tool_items(&mut self) {
        let items: Vec<(String, ToolItemState)> = self.tool_items.drain().collect();
        for (item_id, state) in items {
            self.emit_with_ids(
                SessionEvent::ItemCompleted(ItemCompletedEvent { item: state.item }),
                self.current_turn_id.clone(),
                Some(item_id),
            );
        }
    }

    fn emit_with_ids(
        &mut self,
        event: SessionEvent,
        turn_id: Option<String>,
        item_id: Option<String>,
    ) {
        let seq = self.next_seq;
        self.next_seq += 1;
        let timestamp = chrono::Utc::now().to_rfc3339();
        let event_type = event.event_type().to_string();
        tracing::info!(
            session_id = %self.session_id,
            seq = seq,
            event_type = %event_type,
            "event_sink: emitting event"
        );

        let envelope = SessionEventEnvelope {
            session_id: self.session_id.clone(),
            seq,
            timestamp: timestamp.clone(),
            turn_id: turn_id.clone(),
            item_id: item_id.clone(),
            event,
        };

        let payload_json = serde_json::to_string(&envelope.event).unwrap_or_default();
        tracing::debug!(
            session_id = %self.session_id,
            seq = seq,
            payload = %payload_json,
            "event_sink: event payload"
        );
        let record = SessionEventRecord {
            id: 0,
            session_id: self.session_id.clone(),
            seq,
            timestamp,
            event_type,
            turn_id,
            item_id,
            payload_json,
        };
        if let Err(e) = self.store.append_event(&record) {
            tracing::warn!(error = %e, "failed to persist session event");
        }

        let _ = self.event_tx.send(envelope);
    }
}

fn parse_meta(meta: Option<&serde_json::Value>) -> ParsedMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

fn merge_snapshot_detail_parts(previous: Vec<ContentPart>, next: Vec<ContentPart>) -> Vec<ContentPart> {
    if next.is_empty() {
        return previous;
    }

    let mut previous_file_changes = previous
        .into_iter()
        .filter(|part| matches!(part, ContentPart::FileChange { .. }))
        .collect::<Vec<_>>();
    let mut merged = Vec::with_capacity(next.len() + previous_file_changes.len());

    for next_part in next {
        let Some(identity) = file_change_identity(&next_part) else {
            merged.push(next_part);
            continue;
        };

        let Some(index) = previous_file_changes
            .iter()
            .position(|part| file_change_identity(part).as_ref() == Some(&identity))
        else {
            merged.push(next_part);
            continue;
        };

        let previous_part = previous_file_changes.remove(index);
        merged.push(merge_file_change_part(previous_part, next_part));
    }

    merged.extend(previous_file_changes);
    merged
}

fn file_change_identity(part: &ContentPart) -> Option<(String, String)> {
    let ContentPart::FileChange {
        path,
        workspace_path,
        new_path,
        new_workspace_path,
        ..
    } = part
    else {
        return None;
    };

    Some((
        workspace_path.clone().unwrap_or_else(|| path.clone()),
        new_workspace_path
            .clone()
            .or_else(|| new_path.clone())
            .unwrap_or_default(),
    ))
}

fn merge_file_change_part(previous: ContentPart, next: ContentPart) -> ContentPart {
    let ContentPart::FileChange {
        operation: previous_operation,
        path: previous_path,
        workspace_path: previous_workspace_path,
        basename: previous_basename,
        new_path: previous_new_path,
        new_workspace_path: previous_new_workspace_path,
        new_basename: previous_new_basename,
        open_target: previous_open_target,
        additions: previous_additions,
        deletions: previous_deletions,
        patch: previous_patch,
        preview: previous_preview,
        native_tool_name: previous_native_tool_name,
    } = previous
    else {
        return next;
    };

    let ContentPart::FileChange {
        operation,
        path,
        workspace_path,
        basename,
        new_path,
        new_workspace_path,
        new_basename,
        open_target,
        additions,
        deletions,
        patch,
        preview,
        native_tool_name,
    } = next
    else {
        return ContentPart::FileChange {
            operation: previous_operation,
            path: previous_path,
            workspace_path: previous_workspace_path,
            basename: previous_basename,
            new_path: previous_new_path,
            new_workspace_path: previous_new_workspace_path,
            new_basename: previous_new_basename,
            open_target: previous_open_target,
            additions: previous_additions,
            deletions: previous_deletions,
            patch: previous_patch,
            preview: previous_preview,
            native_tool_name: previous_native_tool_name,
        };
    };

    let merged_patch = patch.or(previous_patch);
    let merged_open_target = if merged_patch.is_some() {
        Some(FileOpenTarget::Diff)
    } else if matches!(open_target, Some(FileOpenTarget::Diff))
        || matches!(previous_open_target, Some(FileOpenTarget::Diff))
    {
        Some(FileOpenTarget::Diff)
    } else {
        open_target.or(previous_open_target)
    };

    ContentPart::FileChange {
        operation,
        path: choose_string(path, previous_path),
        workspace_path: choose_option_string(workspace_path, previous_workspace_path),
        basename: choose_option_string(basename, previous_basename),
        new_path: choose_option_string(new_path, previous_new_path),
        new_workspace_path: choose_option_string(
            new_workspace_path,
            previous_new_workspace_path,
        ),
        new_basename: choose_option_string(new_basename, previous_new_basename),
        open_target: merged_open_target,
        additions: additions.or(previous_additions),
        deletions: deletions.or(previous_deletions),
        patch: merged_patch,
        preview: choose_option_string(preview, previous_preview),
        native_tool_name: choose_option_string(native_tool_name, previous_native_tool_name),
    }
}

fn choose_string(next: String, previous: String) -> String {
    if next.trim().is_empty() {
        previous
    } else {
        next
    }
}

fn choose_option_string(next: Option<String>, previous: Option<String>) -> Option<String> {
    next.filter(|value| !value.trim().is_empty()).or(previous)
}

fn extract_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Object(map) => {
            if map.get("type").and_then(serde_json::Value::as_str) == Some("text") {
                return map
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            String::new()
        }
        _ => String::new(),
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

fn normalize_terminal_parts(payload: &AcpToolPayload, meta: &ParsedMeta) -> Vec<ContentPart> {
    let mut parts = Vec::new();

    if let Some(info) = &meta.terminal_info {
        parts.push(ContentPart::TerminalOutput {
            terminal_id: info.terminal_id.clone(),
            event: anyharness_contract::v1::TerminalLifecycleEvent::Start,
            data: None,
            exit_code: None,
            signal: None,
        });
    } else if let Some(content) = &payload.content {
        for item in content {
            if item.get("type").and_then(serde_json::Value::as_str) == Some("terminal") {
                if let Some(terminal_id) =
                    item.get("terminalId").and_then(serde_json::Value::as_str)
                {
                    parts.push(ContentPart::TerminalOutput {
                        terminal_id: terminal_id.to_string(),
                        event: anyharness_contract::v1::TerminalLifecycleEvent::Start,
                        data: None,
                        exit_code: None,
                        signal: None,
                    });
                }
            }
        }
    }

    if let Some(output) = &meta.terminal_output {
        parts.push(ContentPart::TerminalOutput {
            terminal_id: output.terminal_id.clone(),
            event: anyharness_contract::v1::TerminalLifecycleEvent::Output,
            data: Some(output.data.clone()),
            exit_code: None,
            signal: None,
        });
    }

    if let Some(exit) = &meta.terminal_exit {
        parts.push(ContentPart::TerminalOutput {
            terminal_id: exit.terminal_id.clone(),
            event: anyharness_contract::v1::TerminalLifecycleEvent::Exit,
            data: None,
            exit_code: Some(exit.exit_code),
            signal: exit.signal.clone(),
        });
    }

    parts
}

fn normalize_snapshot_parts(
    payload: &AcpToolPayload,
    tool_kind: Option<&str>,
    native_tool_name: Option<String>,
    workspace_root: &Path,
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Vec<ContentPart> {
    let mut parts = normalize_file_parts(
        payload,
        tool_kind,
        native_tool_name.clone(),
        workspace_root,
        raw_input,
        raw_output,
    );
    if !parts.is_empty() {
        return parts;
    }

    parts.extend(normalize_text_parts(
        payload,
        tool_kind,
        native_tool_name.as_deref(),
        raw_input,
        raw_output,
        meta,
    ));

    parts
}

fn normalize_file_parts(
    payload: &AcpToolPayload,
    tool_kind: Option<&str>,
    native_tool_name: Option<String>,
    workspace_root: &Path,
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
) -> Vec<ContentPart> {
    let mut parts = Vec::new();
    let locations = payload.locations.as_ref();

    if let Some(content) = &payload.content {
        for item in content {
            if item.get("type").and_then(serde_json::Value::as_str) != Some("diff") {
                continue;
            }

            let diff_path = item
                .get("path")
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            let old_text = item
                .get("oldText")
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            let new_text = item
                .get("newText")
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            let patch = item
                .get("patch")
                .and_then(serde_json::Value::as_str)
                .map(String::from)
                .or_else(|| {
                    synthesize_patch(
                        diff_path.as_deref(),
                        old_text.as_deref(),
                        new_text.as_deref(),
                    )
                });
            let additions = item
                .get("additions")
                .and_then(serde_json::Value::as_i64)
                .or_else(|| new_text.as_ref().map(|text| count_lines(text)));
            let deletions = item
                .get("deletions")
                .and_then(serde_json::Value::as_i64)
                .or_else(|| old_text.as_ref().map(|text| count_lines(text)));

            let (path, new_path) =
                resolve_file_references(raw_input, locations, diff_path.clone(), workspace_root);
            let operation = determine_file_operation(
                native_tool_name.as_deref(),
                tool_kind,
                raw_input,
                old_text.as_deref(),
                new_text.as_deref(),
                path.as_ref().map(|entry| entry.raw_path.as_str()),
                new_path.as_ref().map(|entry| entry.raw_path.as_str()),
            );
            let path = path.or_else(|| {
                diff_path.as_deref().and_then(|entry| {
                    normalize_file_reference(
                        entry,
                        workspace_root,
                        extract_location_line(locations),
                    )
                })
            });

            parts.push(ContentPart::FileChange {
                operation,
                path: path
                    .as_ref()
                    .map(|entry| entry.raw_path.clone())
                    .or(diff_path)
                    .unwrap_or_else(|| payload.title.clone().unwrap_or_else(|| "file".to_string())),
                workspace_path: path.as_ref().and_then(|entry| entry.workspace_path.clone()),
                basename: path.as_ref().map(|entry| entry.basename.clone()),
                new_path: new_path.as_ref().map(|entry| entry.raw_path.clone()),
                new_workspace_path: new_path
                    .as_ref()
                    .and_then(|entry| entry.workspace_path.clone()),
                new_basename: new_path.as_ref().map(|entry| entry.basename.clone()),
                open_target: Some(
                    if patch.is_some() || old_text.is_some() || new_text.is_some() {
                        FileOpenTarget::Diff
                    } else {
                        FileOpenTarget::File
                    },
                ),
                additions,
                deletions,
                patch,
                preview: new_text,
                native_tool_name: native_tool_name.clone(),
            });
        }
    }

    if !parts.is_empty() {
        return parts;
    }

    let (path, new_path) = resolve_file_references(raw_input, locations, None, workspace_root);
    if is_file_read(tool_kind, native_tool_name.as_deref()) {
        if let Some(path) = path {
            let line_scope = determine_file_read_scope(raw_input, locations);
            let NormalizedFileReference {
                raw_path,
                workspace_path,
                basename,
                line,
            } = path;
            return vec![ContentPart::FileRead {
                path: raw_path,
                workspace_path,
                basename: Some(basename),
                line: line_scope.line.or(line),
                scope: Some(line_scope.scope),
                start_line: line_scope.start_line,
                end_line: line_scope.end_line,
                preview: extract_preview(raw_output),
            }];
        }
        return vec![];
    }

    if let Some(operation) = determine_operation_without_diff(
        native_tool_name.as_deref(),
        tool_kind,
        raw_input,
        path.as_ref().map(|entry| entry.raw_path.as_str()),
        new_path.as_ref().map(|entry| entry.raw_path.as_str()),
    ) {
        if let Some(path) = path.clone().or(new_path.clone()) {
            return vec![ContentPart::FileChange {
                operation,
                path: path.raw_path,
                workspace_path: path.workspace_path,
                basename: Some(path.basename),
                new_path: new_path.as_ref().map(|entry| entry.raw_path.clone()),
                new_workspace_path: new_path
                    .as_ref()
                    .and_then(|entry| entry.workspace_path.clone()),
                new_basename: new_path.as_ref().map(|entry| entry.basename.clone()),
                open_target: Some(FileOpenTarget::File),
                additions: None,
                deletions: None,
                patch: None,
                preview: extract_preview(raw_input).or_else(|| extract_preview(raw_output)),
                native_tool_name,
            }];
        }
    }

    Vec::new()
}

fn is_file_read(tool_kind: Option<&str>, native_tool_name: Option<&str>) -> bool {
    native_tool_name == Some("Read") || tool_kind == Some("read")
}

fn is_subagent_tool(tool_kind: Option<&str>, native_tool_name: Option<&str>) -> bool {
    native_tool_name == Some("Agent") || tool_kind == Some("think")
}

fn normalize_text_parts(
    payload: &AcpToolPayload,
    tool_kind: Option<&str>,
    native_tool_name: Option<&str>,
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Vec<ContentPart> {
    let mut parts = Vec::new();

    if is_subagent_tool(tool_kind, native_tool_name) {
        if let Some(text) = extract_subagent_input_text(meta, raw_input) {
            parts.push(ContentPart::ToolInputText { text });
        }
        if let Some(text) = extract_subagent_result_text(payload, raw_output, meta) {
            parts.push(ContentPart::ToolResultText { text });
        }
        return parts;
    }

    if let Some(text) = extract_result_text(payload, raw_output, raw_input) {
        parts.push(ContentPart::ToolResultText { text });
    }

    parts
}

fn extract_subagent_input_text(
    meta: &ParsedMeta,
    raw_input: Option<&serde_json::Value>,
) -> Option<String> {
    extract_claude_tool_response_field(meta, "prompt").or_else(|| {
        raw_input
            .and_then(|value| value.get("prompt"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(String::from)
    })
}

fn extract_subagent_result_text(
    payload: &AcpToolPayload,
    raw_output: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Option<String> {
    if let Some(content) = extract_claude_tool_response_content(meta) {
        return Some(content);
    }

    if payload.status.as_deref() == Some("completed") {
        return extract_result_text_without_input_fallback(payload, raw_output);
    }

    None
}

fn determine_operation_without_diff(
    native_tool_name: Option<&str>,
    tool_kind: Option<&str>,
    raw_input: Option<&serde_json::Value>,
    path: Option<&str>,
    new_path: Option<&str>,
) -> Option<FileChangeOperation> {
    match native_tool_name {
        Some("Write") => return Some(FileChangeOperation::Create),
        Some("Edit") => return Some(FileChangeOperation::Edit),
        Some("Delete") => return Some(FileChangeOperation::Delete),
        Some("Move") | Some("Rename") => return Some(FileChangeOperation::Move),
        _ => {}
    }

    match tool_kind {
        Some("delete") => Some(FileChangeOperation::Delete),
        Some("move") => Some(FileChangeOperation::Move),
        Some("edit") => {
            if path.is_some() && new_path.is_some() && path != new_path {
                Some(FileChangeOperation::Move)
            } else {
                Some(FileChangeOperation::Edit)
            }
        }
        _ => {
            let old_path = raw_input
                .and_then(|value| value.get("old_path"))
                .and_then(serde_json::Value::as_str);
            let next_path = raw_input
                .and_then(|value| value.get("new_path"))
                .and_then(serde_json::Value::as_str);
            if old_path.is_some() && next_path.is_some() && old_path != next_path {
                Some(FileChangeOperation::Move)
            } else {
                None
            }
        }
    }
}

fn determine_file_operation(
    native_tool_name: Option<&str>,
    tool_kind: Option<&str>,
    raw_input: Option<&serde_json::Value>,
    old_text: Option<&str>,
    new_text: Option<&str>,
    path: Option<&str>,
    new_path: Option<&str>,
) -> FileChangeOperation {
    if let Some(operation) =
        determine_operation_without_diff(native_tool_name, tool_kind, raw_input, path, new_path)
    {
        return operation;
    }

    match (old_text, new_text) {
        (None, Some(_)) => FileChangeOperation::Create,
        (Some(_), Some("")) => FileChangeOperation::Delete,
        (Some(old), Some(new)) if old.is_empty() && !new.is_empty() => FileChangeOperation::Create,
        (Some(old), Some(new)) if !old.is_empty() && new.is_empty() => FileChangeOperation::Delete,
        _ => FileChangeOperation::Edit,
    }
}

fn resolve_file_references(
    raw_input: Option<&serde_json::Value>,
    locations: Option<&Vec<serde_json::Value>>,
    preferred_path: Option<String>,
    workspace_root: &Path,
) -> (
    Option<NormalizedFileReference>,
    Option<NormalizedFileReference>,
) {
    let input_path = raw_input
        .and_then(|value| value.get("file_path"))
        .and_then(serde_json::Value::as_str)
        .map(String::from)
        .or_else(|| {
            raw_input
                .and_then(|value| value.get("path"))
                .and_then(serde_json::Value::as_str)
                .map(String::from)
        })
        .or_else(|| {
            raw_input
                .and_then(|value| value.get("parsed_cmd"))
                .and_then(serde_json::Value::as_array)
                .and_then(|items| {
                    items.iter().find_map(|item| {
                        item.get("path")
                            .and_then(serde_json::Value::as_str)
                            .map(String::from)
                    })
                })
        });
    let old_path = raw_input
        .and_then(|value| value.get("old_path"))
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    let new_path = raw_input
        .and_then(|value| value.get("new_path"))
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    let location_path = locations.and_then(|items| {
        items.iter().find_map(|item| {
            item.get("path")
                .and_then(serde_json::Value::as_str)
                .map(String::from)
        })
    });
    let location_line = extract_location_line(locations);

    let path = old_path
        .clone()
        .or(input_path)
        .or(preferred_path)
        .or(location_path)
        .or_else(|| new_path.clone());

    let normalized_new_path = match (&old_path, &new_path) {
        (Some(old), Some(new)) if old != new => Some(new.clone()),
        _ => None,
    };

    (
        path.and_then(|entry| normalize_file_reference(&entry, workspace_root, location_line)),
        normalized_new_path
            .and_then(|entry| normalize_file_reference(&entry, workspace_root, location_line)),
    )
}

fn determine_file_read_scope(
    raw_input: Option<&serde_json::Value>,
    locations: Option<&Vec<serde_json::Value>>,
) -> FileReadLineScope {
    let start_line = extract_i64_keys(
        raw_input,
        &[
            "start_line",
            "startLine",
            "line_start",
            "lineStart",
            "from_line",
            "fromLine",
        ],
    );
    let end_line = extract_i64_keys(
        raw_input,
        &[
            "end_line", "endLine", "line_end", "lineEnd", "to_line", "toLine",
        ],
    );

    if let Some(start) = start_line {
        let end = end_line.unwrap_or(start);
        if start == end {
            return FileReadLineScope {
                scope: FileReadScope::Line,
                line: Some(start),
                start_line: Some(start),
                end_line: Some(end),
            };
        }
        return FileReadLineScope {
            scope: FileReadScope::Range,
            line: None,
            start_line: Some(start),
            end_line: Some(end),
        };
    }

    let line = extract_i64_keys(raw_input, &["line", "lineNumber", "line_number"]);

    if let Some(line) = line {
        return FileReadLineScope {
            scope: FileReadScope::Line,
            line: Some(line),
            start_line: Some(line),
            end_line: Some(line),
        };
    }

    FileReadLineScope {
        scope: if raw_input.is_some() || locations.is_some() {
            FileReadScope::Full
        } else {
            FileReadScope::Unknown
        },
        line: None,
        start_line: None,
        end_line: None,
    }
}

fn extract_location_line(locations: Option<&Vec<serde_json::Value>>) -> Option<i64> {
    locations.and_then(|items| {
        items
            .iter()
            .find_map(|item| item.get("line").and_then(read_i64_value))
    })
}

fn extract_i64_keys(value: Option<&serde_json::Value>, keys: &[&str]) -> Option<i64> {
    let value = value?;
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(read_i64_value)
}

fn read_i64_value(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|raw| i64::try_from(raw).ok()))
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
}

fn normalize_file_reference(
    raw_path: &str,
    workspace_root: &Path,
    line: Option<i64>,
) -> Option<NormalizedFileReference> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let workspace_path = normalize_workspace_path(trimmed, workspace_root);
    Some(NormalizedFileReference {
        raw_path: trimmed.to_string(),
        basename: path_basename(workspace_path.as_deref().unwrap_or(trimmed)),
        workspace_path,
        line,
    })
}

fn normalize_workspace_path(raw_path: &str, workspace_root: &Path) -> Option<String> {
    let path = Path::new(raw_path);
    if path.is_absolute() {
        let normalized_root = lexical_normalize_absolute(workspace_root)?;
        let normalized_path = lexical_normalize_absolute(path)?;
        let relative = normalized_path.strip_prefix(&normalized_root).ok()?;
        return Some(path_to_string(relative));
    }

    lexical_normalize_relative(path).map(|relative| path_to_string(relative.as_path()))
}

fn lexical_normalize_absolute(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
        }
    }

    Some(normalized)
}

fn lexical_normalize_relative(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    Some(normalized)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|entry| entry.to_string_lossy().to_string())
        .filter(|entry| !entry.is_empty())
        .unwrap_or_else(|| path.to_string())
}

fn synthesize_patch(
    path: Option<&str>,
    old_text: Option<&str>,
    new_text: Option<&str>,
) -> Option<String> {
    if old_text.is_none() && new_text.is_none() {
        return None;
    }

    let path = path.unwrap_or("file");
    let mut patch = format!("--- a/{path}\n+++ b/{path}\n");

    if let Some(old_text) = old_text {
        for line in old_text.lines() {
            patch.push('-');
            patch.push_str(line);
            patch.push('\n');
        }
    }

    if let Some(new_text) = new_text {
        for line in new_text.lines() {
            patch.push('+');
            patch.push_str(line);
            patch.push('\n');
        }
    }

    Some(patch)
}

fn extract_preview(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Object(map) => {
            if let Some(text) = map
                .get("aggregated_output")
                .and_then(serde_json::Value::as_str)
            {
                return Some(text.to_string());
            }
            if let Some(text) = map
                .get("formatted_output")
                .and_then(serde_json::Value::as_str)
            {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("stdout").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("stderr").and_then(serde_json::Value::as_str) {
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
            if let Some(text) = map.get("content").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("new_string").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("text").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            None
        }
        serde_json::Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(extract_preview_value)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn extract_preview_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Object(map) => {
            if map.get("type").and_then(serde_json::Value::as_str) == Some("text") {
                return map
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .map(String::from);
            }
            map.get("content")
                .and_then(|content| content.get("text"))
                .and_then(serde_json::Value::as_str)
                .map(String::from)
        }
        _ => None,
    }
}

fn extract_claude_tool_response_field(meta: &ParsedMeta, key: &str) -> Option<String> {
    meta.claude_code
        .as_ref()
        .and_then(|meta| meta.tool_response.as_ref())
        .and_then(|value| value.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(String::from)
}

fn extract_claude_tool_response_content(meta: &ParsedMeta) -> Option<String> {
    meta.claude_code
        .as_ref()
        .and_then(|meta| meta.tool_response.as_ref())
        .and_then(|value| value.get("content"))
        .and_then(|value| extract_preview(Some(value)))
}

fn extract_result_text(
    payload: &AcpToolPayload,
    raw_output: Option<&serde_json::Value>,
    raw_input: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(content) = &payload.content {
        let text = content
            .iter()
            .filter_map(extract_preview_value)
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            return Some(text);
        }
    }

    extract_preview(raw_output).or_else(|| extract_preview(raw_input))
}

fn extract_result_text_without_input_fallback(
    payload: &AcpToolPayload,
    raw_output: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(content) = &payload.content {
        let text = content
            .iter()
            .filter_map(extract_preview_value)
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            return Some(text);
        }
    }

    extract_preview(raw_output)
}

fn extract_tool_kind_from_item(item: &ToolItemState) -> Option<String> {
    item.snapshot_parts.iter().find_map(|part| match part {
        ContentPart::ToolCall { tool_kind, .. } => tool_kind.clone(),
        _ => None,
    })
}

fn count_lines(text: &str) -> i64 {
    if text.is_empty() {
        0
    } else {
        text.lines().count() as i64
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;
    use tokio::sync::broadcast;

    use super::{AcpChunkPayload, SessionEventSink};
    use crate::persistence::Db;
    use crate::sessions::model::SessionRecord;
    use crate::sessions::store::SessionStore;
    use anyharness_contract::v1::{SessionEventEnvelope, StopReason};

    #[test]
    fn assistant_chunking_emits_one_item_lifecycle_with_monotonic_seq() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store.clone(),
        );

        sink.begin_turn("hello".to_string());
        sink.agent_message_chunk(AcpChunkPayload {
            content: json!("Hel"),
            ..Default::default()
        });
        sink.agent_message_chunk(AcpChunkPayload {
            content: json!("lo"),
            ..Default::default()
        });
        sink.turn_ended(StopReason::EndTurn);

        let events = drain_events(&mut rx);
        let event_types = events
            .iter()
            .map(|event| event.event.event_type())
            .collect::<Vec<_>>();

        assert_eq!(
            event_types,
            vec![
                "turn_started",
                "item_started",
                "item_completed",
                "item_started",
                "item_delta",
                "item_completed",
                "turn_ended",
            ]
        );
        assert!(events
            .windows(2)
            .all(|window| window[0].seq < window[1].seq));
        assert_eq!(events[3].item_id, events[4].item_id);
        assert_eq!(events[4].item_id, events[5].item_id);
        assert_eq!(
            store
                .list_events("session-1")
                .expect("persisted events")
                .len(),
            events.len()
        );
    }

    #[test]
    fn plan_updates_reuse_the_same_plan_item_until_turn_end() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store.clone(),
        );

        sink.begin_turn("plan this".to_string());
        sink.plan(vec![json!({ "content": "Step 1", "status": "pending" })]);
        sink.plan(vec![json!({ "content": "Step 1", "status": "completed" })]);
        sink.turn_ended(StopReason::EndTurn);

        let events = drain_events(&mut rx);
        let event_types = events
            .iter()
            .map(|event| event.event.event_type())
            .collect::<Vec<_>>();

        assert_eq!(
            event_types,
            vec![
                "turn_started",
                "item_started",
                "item_completed",
                "item_started",
                "item_delta",
                "item_completed",
                "turn_ended",
            ]
        );
        assert_eq!(events[3].item_id, events[4].item_id);
        assert_eq!(events[4].item_id, events[5].item_id);
        assert_eq!(
            store
                .list_events("session-1")
                .expect("persisted events")
                .len(),
            events.len()
        );
    }

    fn seeded_store() -> SessionStore {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                rusqlite::params!["workspace-1", "2026-04-04T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

        let store = SessionStore::new(db);
        store
            .insert(&SessionRecord {
                id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
                native_session_id: Some("native-1".to_string()),
                requested_model_id: None,
                current_model_id: None,
                requested_mode_id: None,
                current_mode_id: None,
                title: None,
                thinking_level_id: None,
                thinking_budget_tokens: None,
                status: "idle".to_string(),
                created_at: "2026-04-04T00:00:00Z".to_string(),
                updated_at: "2026-04-04T00:00:00Z".to_string(),
                last_prompt_at: None,
                closed_at: None,
                dismissed_at: None,
            })
            .expect("seed session");
        store
    }

    fn drain_events(
        rx: &mut broadcast::Receiver<SessionEventEnvelope>,
    ) -> Vec<SessionEventEnvelope> {
        let mut events = Vec::new();
        while let Ok(event) = rx.try_recv() {
            events.push(event);
        }
        events
    }
}
