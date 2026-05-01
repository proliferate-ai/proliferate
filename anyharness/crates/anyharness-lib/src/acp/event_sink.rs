use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use serde::Deserialize;
use tokio::sync::broadcast;

use super::persistence_sanitizer::sanitize_session_event_for_sqlite;
use crate::plans::service::PlanEventContext;
use crate::sessions::model::{SessionBackgroundWorkState, SessionEventRecord};
use crate::sessions::runtime_event::{RuntimeEventInjectionError, RuntimeInjectedSessionEvent};
use crate::sessions::store::SessionStore;
use anyharness_contract::v1::{
    AvailableCommandsUpdatePayload, ConfigOptionUpdatePayload, ContentPart,
    CurrentModeUpdatePayload, ErrorEvent, ErrorEventDetails, FileChangeOperation, FileOpenTarget,
    FileReadScope, InteractionKind, InteractionOutcome, InteractionRequestedEvent,
    InteractionResolvedEvent, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent,
    PendingPromptAddedPayload, PendingPromptRemovedPayload, PendingPromptUpdatedPayload, PlanEntry,
    PromptProvenance, SessionEndReason, SessionEndedEvent, SessionEvent, SessionEventEnvelope,
    SessionInfoUpdatePayload, SessionStartedEvent, SessionStateUpdatePayload, StopReason,
    TranscriptItemDeltaPayload, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
    TurnEndedEvent, TurnStartedEvent, UsageUpdatePayload,
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
    is_transient: bool,
}

#[derive(Debug, Clone)]
pub struct CompletedAssistantMessage {
    pub message_id: Option<String>,
    pub text: String,
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
    #[serde(default)]
    anyharness: Option<AnyHarnessMeta>,
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
struct AnyHarnessMeta {
    transcript_event: Option<String>,
    native_tool_name: Option<String>,
    tool_kind: Option<String>,
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

#[derive(Debug, Clone)]
struct BackgroundWorkMetadata {
    state: SessionBackgroundWorkState,
    agent_id: Option<String>,
    output_file: String,
}

const ANYHARNESS_META_KEY: &str = "_anyharness";
const ANYHARNESS_TRANSCRIPT_META_KEY: &str = "anyharness";
const ANYHARNESS_TRANSCRIPT_EVENT_KEY: &str = "transcriptEvent";
const ASSISTANT_MESSAGE_COMPLETED_EVENT: &str = "assistant_message_completed";
const TRANSIENT_STATUS_EVENT: &str = "transient_status";
const BACKGROUND_WORK_TRACKER_KIND: &str = "claude_async_agent";

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

#[derive(Debug, Clone, Default)]
pub struct SessionEventSinkDebugSnapshot {
    pub current_turn_id: Option<String>,
    pub open_assistant_item_id: Option<String>,
    pub open_assistant_chars: usize,
    pub open_reasoning_item_id: Option<String>,
    pub open_reasoning_chars: usize,
    pub open_plan_item_id: Option<String>,
    pub open_tool_call_ids: Vec<String>,
    pub next_seq: i64,
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

    pub fn current_turn_id(&self) -> Option<String> {
        self.current_turn_id.clone()
    }

    pub fn plan_event_context(&self) -> PlanEventContext {
        PlanEventContext {
            session_id: self.session_id.clone(),
            source_agent_kind: self.source_agent_kind.clone(),
            turn_id: self.current_turn_id.clone(),
            next_seq: self.next_seq,
        }
    }

    pub fn close_open_transcript_items(&mut self) {
        self.close_open_items();
    }

    pub fn publish_persisted_events(&mut self, envelopes: Vec<SessionEventEnvelope>) {
        for envelope in envelopes {
            if envelope.seq >= self.next_seq {
                self.next_seq = envelope.seq + 1;
            }
            let _ = self.event_tx.send(envelope);
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

    pub fn begin_turn(
        &mut self,
        prompt_text: String,
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

    pub fn pending_prompt_added(&mut self, payload: PendingPromptAddedPayload) {
        self.emit_with_ids(SessionEvent::PendingPromptAdded(payload), None, None);
    }

    pub fn pending_prompt_updated(&mut self, payload: PendingPromptUpdatedPayload) {
        self.emit_with_ids(SessionEvent::PendingPromptUpdated(payload), None, None);
    }

    pub fn pending_prompt_removed(&mut self, payload: PendingPromptRemovedPayload) {
        self.emit_with_ids(SessionEvent::PendingPromptRemoved(payload), None, None);
    }

    pub fn error(&mut self, message: String, code: Option<String>) {
        self.error_with_details(message, code, None);
    }

    pub fn error_with_details(
        &mut self,
        message: String,
        code: Option<String>,
        details: Option<ErrorEventDetails>,
    ) {
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        let item_id = uuid::Uuid::new_v4().to_string();
        self.emit_with_ids(
            SessionEvent::Error(ErrorEvent {
                message,
                code,
                details,
            }),
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

    pub fn interaction_requested(&mut self, event: InteractionRequestedEvent) {
        self.close_open_items();
        let tool_call_id = event.source.tool_call_id.clone();
        self.emit_with_ids(
            SessionEvent::InteractionRequested(event),
            self.current_turn_id.clone(),
            tool_call_id,
        );
    }

    pub fn interaction_resolved(
        &mut self,
        request_id: String,
        kind: InteractionKind,
        outcome: InteractionOutcome,
    ) {
        self.emit_with_ids(
            SessionEvent::InteractionResolved(InteractionResolvedEvent {
                request_id,
                kind,
                outcome,
            }),
            self.current_turn_id.clone(),
            None,
        );
    }

    pub fn resolve_background_tool_call(
        &mut self,
        turn_id: String,
        tool_call_id: String,
        state: SessionBackgroundWorkState,
        agent_id: Option<String>,
        output_file: String,
        result_text: String,
    ) {
        self.tool_items.remove(&tool_call_id);
        let raw_output = Some(background_work_raw_output(
            None,
            BackgroundWorkMetadata {
                state,
                agent_id,
                output_file,
            },
        ));

        let replacement_parts = vec![ContentPart::ToolResultText {
            text: result_text,
            text_truncated: None,
            text_original_bytes: None,
        }];
        self.emit_with_ids(
            SessionEvent::ItemDelta(ItemDeltaEvent {
                delta: TranscriptItemDeltaPayload {
                    is_transient: None,
                    status: Some(TranscriptItemStatus::Completed),
                    title: None,
                    native_tool_name: None,
                    parent_tool_call_id: None,
                    raw_input: None,
                    raw_output: raw_output.clone(),
                    append_text: None,
                    append_reasoning: None,
                    replace_content_parts: Some(replacement_parts.clone()),
                    append_content_parts: None,
                },
            }),
            Some(turn_id.clone()),
            Some(tool_call_id.clone()),
        );

        self.emit_with_ids(
            SessionEvent::ItemCompleted(ItemCompletedEvent {
                item: TranscriptItemPayload {
                    kind: TranscriptItemKind::ToolInvocation,
                    status: TranscriptItemStatus::Completed,
                    source_agent_kind: self.source_agent_kind.clone(),
                    is_transient: false,
                    message_id: None,
                    title: None,
                    tool_call_id: Some(tool_call_id.clone()),
                    native_tool_name: None,
                    parent_tool_call_id: None,
                    raw_input: None,
                    raw_output,
                    content_parts: replacement_parts,
                    prompt_provenance: None,
                },
            }),
            Some(turn_id),
            Some(tool_call_id),
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

    fn close_open_items(&mut self) {
        let _ = self.close_assistant_item();
        self.close_reasoning_item();
    }

    fn close_assistant_item(&mut self) -> Option<CompletedAssistantMessage> {
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

    fn close_reasoning_item(&mut self) {
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

    fn close_plan_item(&mut self) {
        if let Some(item) = self.open_plan_item.take() {
            let payload = TranscriptItemPayload {
                kind: TranscriptItemKind::Plan,
                status: TranscriptItemStatus::Completed,
                source_agent_kind: self.source_agent_kind.clone(),
                is_transient: false,
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
                prompt_provenance: None,
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
        publish_session_event(
            &self.session_id,
            &mut self.next_seq,
            &self.event_tx,
            &self.store,
            event,
            turn_id,
            item_id,
        );
    }

    pub(crate) fn inject_runtime_event(
        &mut self,
        event: RuntimeInjectedSessionEvent,
    ) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
        let touch_session_activity = event.updates_session_activity_at();
        publish_session_event_strict(
            &self.session_id,
            &mut self.next_seq,
            &self.event_tx,
            &self.store,
            event.into_session_event(),
            None,
            None,
            touch_session_activity,
        )
    }
}

pub(crate) fn publish_session_event(
    session_id: &str,
    next_seq: &mut i64,
    event_tx: &broadcast::Sender<SessionEventEnvelope>,
    store: &SessionStore,
    event: SessionEvent,
    turn_id: Option<String>,
    item_id: Option<String>,
) -> SessionEventEnvelope {
    let seq = *next_seq;
    *next_seq += 1;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let event_type = event.event_type().to_string();
    tracing::info!(
        session_id = %session_id,
        seq = seq,
        event_type = %event_type,
        "event_sink: emitting event"
    );

    let envelope = SessionEventEnvelope {
        session_id: session_id.to_string(),
        seq,
        timestamp: timestamp.clone(),
        turn_id: turn_id.clone(),
        item_id: item_id.clone(),
        event,
    };

    let persisted_event = sanitize_session_event_for_sqlite(&envelope.event);
    let payload_json = serde_json::to_string(&persisted_event).unwrap_or_default();
    tracing::debug!(session_id = %session_id, seq = seq, "event_sink: event persisted");
    let record = SessionEventRecord {
        id: 0,
        session_id: session_id.to_string(),
        seq,
        timestamp,
        event_type,
        turn_id,
        item_id,
        payload_json,
    };
    if let Err(e) = store.append_event(&record) {
        tracing::warn!(error = %e, "failed to persist session event");
    }

    let _ = event_tx.send(envelope.clone());
    envelope
}

pub(crate) fn publish_session_event_strict(
    session_id: &str,
    next_seq: &mut i64,
    event_tx: &broadcast::Sender<SessionEventEnvelope>,
    store: &SessionStore,
    event: SessionEvent,
    turn_id: Option<String>,
    item_id: Option<String>,
    touch_session_activity: bool,
) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
    let seq = *next_seq;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let event_type = event.event_type().to_string();
    let envelope = SessionEventEnvelope {
        session_id: session_id.to_string(),
        seq,
        timestamp: timestamp.clone(),
        turn_id: turn_id.clone(),
        item_id: item_id.clone(),
        event,
    };
    let persisted_event = sanitize_session_event_for_sqlite(&envelope.event);
    let payload_json = serde_json::to_string(&persisted_event)
        .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))?;
    let record = SessionEventRecord {
        id: 0,
        session_id: session_id.to_string(),
        seq,
        timestamp,
        event_type,
        turn_id,
        item_id,
        payload_json,
    };
    if touch_session_activity {
        store
            .append_event_and_touch_session(&record)
            .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))?;
    } else {
        store
            .append_event(&record)
            .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))?;
    }
    *next_seq += 1;
    let _ = event_tx.send(envelope.clone());
    Ok(envelope)
}

fn parse_meta(meta: Option<&serde_json::Value>) -> ParsedMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

fn is_assistant_message_completed_marker(meta: Option<&serde_json::Value>) -> bool {
    meta.and_then(|value| value.get(ANYHARNESS_TRANSCRIPT_META_KEY))
        .and_then(|value| value.get(ANYHARNESS_TRANSCRIPT_EVENT_KEY))
        .and_then(serde_json::Value::as_str)
        == Some(ASSISTANT_MESSAGE_COMPLETED_EVENT)
}

fn is_transient_status_marker(meta: Option<&serde_json::Value>) -> bool {
    parse_meta(meta)
        .anyharness
        .and_then(|meta| meta.transcript_event)
        .as_deref()
        == Some(TRANSIENT_STATUS_EVENT)
}

fn merge_snapshot_detail_parts(
    previous: Vec<ContentPart>,
    next: Vec<ContentPart>,
) -> Vec<ContentPart> {
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
        patch_truncated: previous_patch_truncated,
        patch_original_bytes: previous_patch_original_bytes,
        preview: previous_preview,
        preview_truncated: previous_preview_truncated,
        preview_original_bytes: previous_preview_original_bytes,
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
        patch_truncated,
        patch_original_bytes,
        preview,
        preview_truncated,
        preview_original_bytes,
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
            patch_truncated: previous_patch_truncated,
            patch_original_bytes: previous_patch_original_bytes,
            preview: previous_preview,
            preview_truncated: previous_preview_truncated,
            preview_original_bytes: previous_preview_original_bytes,
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
        new_workspace_path: choose_option_string(new_workspace_path, previous_new_workspace_path),
        new_basename: choose_option_string(new_basename, previous_new_basename),
        open_target: merged_open_target,
        additions: additions.or(previous_additions),
        deletions: deletions.or(previous_deletions),
        patch: merged_patch,
        patch_truncated: patch_truncated.or(previous_patch_truncated),
        patch_original_bytes: patch_original_bytes.or(previous_patch_original_bytes),
        preview: choose_option_string(preview, previous_preview),
        preview_truncated: preview_truncated.or(previous_preview_truncated),
        preview_original_bytes: preview_original_bytes.or(previous_preview_original_bytes),
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
            data_truncated: None,
            data_original_bytes: None,
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
                        data_truncated: None,
                        data_original_bytes: None,
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
            data_truncated: None,
            data_original_bytes: None,
            exit_code: None,
            signal: None,
        });
    }

    if let Some(exit) = &meta.terminal_exit {
        parts.push(ContentPart::TerminalOutput {
            terminal_id: exit.terminal_id.clone(),
            event: anyharness_contract::v1::TerminalLifecycleEvent::Exit,
            data: None,
            data_truncated: None,
            data_original_bytes: None,
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
                patch_truncated: None,
                patch_original_bytes: None,
                preview: new_text,
                preview_truncated: None,
                preview_original_bytes: None,
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
                preview_truncated: None,
                preview_original_bytes: None,
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
                patch_truncated: None,
                patch_original_bytes: None,
                preview: extract_preview(raw_input).or_else(|| extract_preview(raw_output)),
                preview_truncated: None,
                preview_original_bytes: None,
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
            parts.push(ContentPart::ToolInputText {
                text,
                text_truncated: None,
                text_original_bytes: None,
            });
        }
        if let Some(text) = extract_subagent_result_text(payload, raw_output, meta) {
            parts.push(ContentPart::ToolResultText {
                text,
                text_truncated: None,
                text_original_bytes: None,
            });
        }
        return parts;
    }

    if let Some(text) = extract_result_text(payload, raw_output, raw_input) {
        parts.push(ContentPart::ToolResultText {
            text,
            text_truncated: None,
            text_original_bytes: None,
        });
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

fn extract_background_work_metadata(
    raw_input: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Option<BackgroundWorkMetadata> {
    if !matches!(
        raw_input,
        Some(value) if value.get("run_in_background").and_then(serde_json::Value::as_bool) == Some(true)
    ) {
        return None;
    }

    let tool_response = meta.claude_code.as_ref()?.tool_response.as_ref()?;
    if meta.claude_code.as_ref()?.tool_name.as_deref() != Some("Agent") {
        return None;
    }
    if tool_response
        .get("isAsync")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return None;
    }

    let output_file = tool_response
        .get("outputFile")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();

    let agent_id = tool_response
        .get("agentId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);

    Some(BackgroundWorkMetadata {
        state: SessionBackgroundWorkState::Pending,
        agent_id,
        output_file,
    })
}

fn extract_existing_background_work_metadata(
    raw_output: Option<&serde_json::Value>,
) -> Option<BackgroundWorkMetadata> {
    let raw_output = raw_output?.as_object()?;
    let anyharness = raw_output.get(ANYHARNESS_META_KEY)?.as_object()?;
    let background_work = anyharness.get("backgroundWork")?.as_object()?;

    let state = background_work
        .get("state")
        .and_then(serde_json::Value::as_str)
        .map(SessionBackgroundWorkState::parse)?;
    let output_file = raw_output
        .get("outputFile")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let agent_id = raw_output
        .get("agentId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);

    Some(BackgroundWorkMetadata {
        state,
        agent_id,
        output_file,
    })
}

fn background_work_raw_output(
    existing: Option<serde_json::Value>,
    metadata: BackgroundWorkMetadata,
) -> serde_json::Value {
    let mut base = match existing {
        Some(serde_json::Value::Object(map)) => serde_json::Value::Object(map),
        Some(value) => {
            let mut map = serde_json::Map::new();
            map.insert("value".to_string(), value);
            serde_json::Value::Object(map)
        }
        None => serde_json::Value::Object(serde_json::Map::new()),
    };

    let map = base
        .as_object_mut()
        .expect("background work raw output is always object-backed");
    map.insert("isAsync".to_string(), serde_json::Value::Bool(true));
    map.insert(
        "agentId".to_string(),
        metadata
            .agent_id
            .clone()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    );
    map.insert(
        "outputFile".to_string(),
        serde_json::Value::String(metadata.output_file.clone()),
    );

    let anyharness_meta = map
        .entry(ANYHARNESS_META_KEY.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let anyharness_meta = anyharness_meta
        .as_object_mut()
        .expect("_anyharness metadata must be an object");
    anyharness_meta.insert(
        "backgroundWork".to_string(),
        serde_json::json!({
            "trackerKind": BACKGROUND_WORK_TRACKER_KIND,
            "state": metadata.state.as_str(),
        }),
    );

    base
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
    use crate::sessions::model::{SessionBackgroundWorkState, SessionRecord};
    use crate::sessions::runtime_event::{RuntimeEventInjectionError, RuntimeInjectedSessionEvent};
    use crate::sessions::store::SessionStore;
    use anyharness_contract::v1::{
        ContentPart, SessionEvent, SessionEventEnvelope, StopReason, TranscriptItemKind,
        TranscriptItemStatus,
    };

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

        sink.begin_turn("hello".to_string(), Vec::new(), None);
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
    fn injected_runtime_event_persists_strictly_and_keeps_sequence() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::resume_from_seq(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            5,
            tx,
            store.clone(),
        );

        let envelope = sink
            .inject_runtime_event(RuntimeInjectedSessionEvent::SessionInfoUpdate {
                title: Some("Renamed".to_string()),
                updated_at: Some("2026-04-04T00:02:00Z".to_string()),
            })
            .expect("inject event");

        assert_eq!(envelope.seq, 6);
        assert_eq!(sink.next_seq(), 7);
        let persisted = store.list_events("session-1").expect("list events");
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].seq, 6);
        assert_eq!(persisted[0].event_type, "session_info_update");
        assert_eq!(rx.try_recv().expect("broadcast event").seq, 6);
    }

    #[test]
    fn injected_runtime_event_errors_when_persistence_fails() {
        let store = SessionStore::new(Db::open_in_memory().expect("open db"));
        let (tx, _rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "missing-session".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store,
        );

        let error = sink
            .inject_runtime_event(RuntimeInjectedSessionEvent::SessionInfoUpdate {
                title: Some("Renamed".to_string()),
                updated_at: None,
            })
            .expect_err("persistence should fail");

        assert!(matches!(
            error,
            RuntimeEventInjectionError::PersistenceFailed(_)
        ));
        assert_eq!(sink.next_seq(), 1);
    }

    #[test]
    fn assistant_completion_marker_closes_matching_open_message() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "codex".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store.clone(),
        );

        sink.begin_turn("hello".to_string(), Vec::new(), None);
        sink.agent_message_chunk(AcpChunkPayload {
            content: json!("Hel"),
            message_id: Some("2d313586-97aa-436b-932c-7e0c0b286f87".to_string()),
            ..Default::default()
        });
        sink.agent_message_chunk(AcpChunkPayload {
            content: json!("lo"),
            message_id: Some("2d313586-97aa-436b-932c-7e0c0b286f87".to_string()),
            ..Default::default()
        });
        sink.agent_message_chunk(assistant_completion_marker(
            "2d313586-97aa-436b-932c-7e0c0b286f87",
        ));

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
            ]
        );
        assert_eq!(events[3].item_id, events[4].item_id);
        assert_eq!(events[4].item_id, events[5].item_id);

        let SessionEvent::ItemCompleted(completed) = &events[5].event else {
            panic!("expected item_completed");
        };
        assert!(matches!(
            &completed.item.kind,
            TranscriptItemKind::AssistantMessage
        ));
        assert!(matches!(
            &completed.item.status,
            TranscriptItemStatus::Completed
        ));
        assert_eq!(
            completed.item.message_id.as_deref(),
            Some("2d313586-97aa-436b-932c-7e0c0b286f87")
        );
        assert_eq!(
            completed.item.content_parts,
            vec![ContentPart::Text {
                text: "Hello".to_string(),
            }]
        );
    }

    #[test]
    fn assistant_completion_marker_ignores_mismatched_message_id() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "codex".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store,
        );

        sink.begin_turn("hello".to_string(), Vec::new(), None);
        sink.agent_message_chunk(AcpChunkPayload {
            content: json!("Hello"),
            message_id: Some("2d313586-97aa-436b-932c-7e0c0b286f87".to_string()),
            ..Default::default()
        });
        sink.agent_message_chunk(assistant_completion_marker(
            "f760973a-2eb1-4258-9de1-f643dce51c70",
        ));

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
            ]
        );
    }

    #[test]
    fn transient_status_marker_sets_transient_reasoning_and_replaces_text() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "codex".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store,
        );

        sink.begin_turn("hello".to_string(), Vec::new(), None);
        sink.agent_thought_chunk(transient_status_chunk("Authenticating MCP server"));
        sink.agent_thought_chunk(transient_status_chunk("Waiting for browser auth"));
        sink.turn_ended(StopReason::EndTurn);

        let events = drain_events(&mut rx);
        let SessionEvent::ItemStarted(started) = &events[3].event else {
            panic!("expected transient item_started");
        };
        assert!(started.item.is_transient);
        assert_eq!(
            started.item.content_parts,
            vec![ContentPart::Reasoning {
                text: "Authenticating MCP server".to_string(),
                visibility: anyharness_contract::v1::ReasoningVisibility::Private,
            }]
        );

        let SessionEvent::ItemDelta(delta) = &events[4].event else {
            panic!("expected transient item_delta");
        };
        assert_eq!(delta.delta.is_transient, Some(true));
        assert_eq!(delta.delta.append_reasoning, None);
        assert_eq!(
            delta.delta.replace_content_parts,
            Some(vec![ContentPart::Reasoning {
                text: "Waiting for browser auth".to_string(),
                visibility: anyharness_contract::v1::ReasoningVisibility::Private,
            }])
        );

        let SessionEvent::ItemCompleted(completed) = &events[5].event else {
            panic!("expected transient item_completed");
        };
        assert!(completed.item.is_transient);
        assert_eq!(
            completed.item.content_parts,
            vec![ContentPart::Reasoning {
                text: "Waiting for browser auth".to_string(),
                visibility: anyharness_contract::v1::ReasoningVisibility::Private,
            }]
        );
    }

    #[test]
    fn regular_thought_chunks_remain_non_transient_and_append() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "codex".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store,
        );

        sink.begin_turn("hello".to_string(), Vec::new(), None);
        sink.agent_thought_chunk(AcpChunkPayload {
            content: json!("Thinking"),
            message_id: Some("reasoning-1".to_string()),
            ..Default::default()
        });
        sink.agent_thought_chunk(AcpChunkPayload {
            content: json!(" harder"),
            message_id: Some("reasoning-1".to_string()),
            ..Default::default()
        });

        let events = drain_events(&mut rx);
        let SessionEvent::ItemStarted(started) = &events[3].event else {
            panic!("expected reasoning item_started");
        };
        assert!(!started.item.is_transient);

        let SessionEvent::ItemDelta(delta) = &events[4].event else {
            panic!("expected reasoning item_delta");
        };
        assert_eq!(delta.delta.is_transient, Some(false));
        assert_eq!(delta.delta.append_reasoning.as_deref(), Some(" harder"));
        assert_eq!(delta.delta.replace_content_parts, None);
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

        sink.begin_turn("plan this".to_string(), Vec::new(), None);
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

    #[test]
    fn background_resolution_reuses_existing_tool_item_id() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store.clone(),
        );

        sink.begin_turn("delegate".to_string(), Vec::new(), None);
        sink.tool_call(super::AcpToolPayload {
            tool_call_id: "tool-1".to_string(),
            title: Some("Launch investigator".to_string()),
            kind: Some("other".to_string()),
            status: Some("in_progress".to_string()),
            raw_input: Some(json!({ "run_in_background": true })),
            meta: Some(json!({
                "claudeCode": {
                    "toolName": "Agent",
                    "toolResponse": {
                        "isAsync": true,
                        "agentId": "agent-1",
                        "outputFile": "/tmp/agent.output"
                    }
                }
            })),
            ..Default::default()
        });
        sink.tool_call_update(super::AcpToolPayload {
            tool_call_id: "tool-1".to_string(),
            status: Some("completed".to_string()),
            content: Some(vec![json!({
                "type": "tool_result_text",
                "text": "Async agent launched successfully.\nThe agent is working in the background."
            })]),
            ..Default::default()
        });

        let turn_id = sink.current_turn_id().expect("turn id");
        sink.resolve_background_tool_call(
            turn_id,
            "tool-1".to_string(),
            SessionBackgroundWorkState::Completed,
            Some("agent-1".to_string()),
            "/tmp/agent.output".to_string(),
            "Final synthesized result.".to_string(),
        );

        let events = drain_events(&mut rx);
        let background_delta = events
            .iter()
            .rev()
            .find(|event| event.event.event_type() == "item_delta")
            .expect("background delta");
        let background_completed = events
            .iter()
            .rev()
            .find(|event| event.event.event_type() == "item_completed")
            .expect("background completion");

        assert_eq!(background_delta.item_id.as_deref(), Some("tool-1"));
        assert_eq!(background_completed.item_id.as_deref(), Some("tool-1"));
        let delta_payload = match &background_delta.event {
            SessionEvent::ItemDelta(event) => &event.delta,
            other => panic!("expected item_delta, got {}", other.event_type()),
        };
        let raw_output = delta_payload
            .raw_output
            .as_ref()
            .and_then(serde_json::Value::as_object)
            .expect("background raw_output");
        assert_eq!(
            raw_output
                .get("_anyharness")
                .and_then(serde_json::Value::as_object)
                .and_then(|value| value.get("backgroundWork"))
                .and_then(serde_json::Value::as_object)
                .and_then(|value| value.get("state"))
                .and_then(serde_json::Value::as_str),
            Some("completed")
        );
        assert_eq!(
            store
                .list_events("session-1")
                .expect("persisted events")
                .last()
                .expect("last event")
                .item_id
                .as_deref(),
            Some("tool-1")
        );
    }

    #[test]
    fn async_launch_completion_preserves_background_metadata_on_completed_item() {
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(32);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            tx,
            store,
        );

        sink.begin_turn("delegate".to_string(), Vec::new(), None);
        sink.tool_call(super::AcpToolPayload {
            tool_call_id: "tool-1".to_string(),
            title: Some("Task".to_string()),
            kind: Some("think".to_string()),
            status: Some("in_progress".to_string()),
            raw_input: Some(json!({})),
            meta: Some(json!({
                "claudeCode": {
                    "toolName": "Agent"
                }
            })),
            ..Default::default()
        });
        sink.tool_call_update(super::AcpToolPayload {
            tool_call_id: "tool-1".to_string(),
            title: Some("Pick favorite file from desktop".to_string()),
            status: Some("in_progress".to_string()),
            raw_input: Some(json!({
                "description": "Pick favorite file from desktop",
                "run_in_background": true,
            })),
            meta: Some(json!({
                "claudeCode": {
                    "toolName": "Agent"
                }
            })),
            ..Default::default()
        });
        sink.tool_call_update(super::AcpToolPayload {
            tool_call_id: "tool-1".to_string(),
            status: Some("in_progress".to_string()),
            meta: Some(json!({
                "claudeCode": {
                    "toolName": "Agent",
                    "toolResponse": {
                        "isAsync": true,
                        "agentId": "agent-1",
                        "outputFile": "/tmp/agent.output"
                    }
                }
            })),
            ..Default::default()
        });
        sink.tool_call_update(super::AcpToolPayload {
            tool_call_id: "tool-1".to_string(),
            status: Some("completed".to_string()),
            raw_output: Some(json!([
                {
                    "type": "text",
                    "text": "Async agent launched successfully.\nThe agent is working in the background."
                }
            ])),
            content: Some(vec![json!({
                "type": "tool_result_text",
                "text": "Async agent launched successfully.\nThe agent is working in the background."
            })]),
            meta: Some(json!({
                "claudeCode": {
                    "toolName": "Agent"
                }
            })),
            ..Default::default()
        });

        let events = drain_events(&mut rx);
        let completed = events
            .iter()
            .rev()
            .find_map(|event| match &event.event {
                SessionEvent::ItemCompleted(completed)
                    if event.item_id.as_deref() == Some("tool-1") =>
                {
                    Some(&completed.item)
                }
                _ => None,
            })
            .expect("completed tool item");

        let raw_output = completed
            .raw_output
            .as_ref()
            .and_then(serde_json::Value::as_object)
            .expect("completed raw_output");
        assert_eq!(
            raw_output
                .get("_anyharness")
                .and_then(serde_json::Value::as_object)
                .and_then(|value| value.get("backgroundWork"))
                .and_then(serde_json::Value::as_object)
                .and_then(|value| value.get("state"))
                .and_then(serde_json::Value::as_str),
            Some("pending")
        );
        assert_eq!(
            raw_output
                .get("outputFile")
                .and_then(serde_json::Value::as_str),
            Some("/tmp/agent.output")
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
                mcp_bindings_ciphertext: None,
                mcp_binding_summaries_json: None,
                mcp_binding_policy:
                    crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
                system_prompt_append: None,
                subagents_enabled: true,
                action_capabilities_json: None,
                origin: None,
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

    fn assistant_completion_marker(message_id: &str) -> AcpChunkPayload {
        AcpChunkPayload {
            content: json!(""),
            meta: Some(json!({
                "anyharness": {
                    "transcriptEvent": "assistant_message_completed",
                    "codexItemId": "item-1",
                },
            })),
            message_id: Some(message_id.to_string()),
        }
    }

    fn transient_status_chunk(text: &str) -> AcpChunkPayload {
        AcpChunkPayload {
            content: json!(text),
            meta: Some(json!({
                "anyharness": {
                    "transcriptEvent": "transient_status",
                },
            })),
            message_id: Some("status-stream".to_string()),
        }
    }
}
