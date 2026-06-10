use serde::Deserialize;

use crate::domains::sessions::model::SessionBackgroundWorkState;
use anyharness_contract::v1::{ContentPart, FileReadScope, PlanEntry, TranscriptItemPayload};

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
pub(super) struct StreamingItemState {
    pub(super) item_id: String,
    pub(super) parent_tool_call_id: Option<String>,
    pub(super) message_id: Option<String>,
    pub(super) text: String,
    pub(super) is_transient: bool,
}

#[derive(Debug, Clone)]
pub struct CompletedAssistantMessage {
    pub message_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone)]
pub(super) struct PlanItemState {
    pub(super) item_id: String,
    pub(super) entries: Vec<PlanEntry>,
}

#[derive(Debug, Clone)]
pub(super) struct ToolItemState {
    pub(super) item: TranscriptItemPayload,
    pub(super) terminal_parts: Vec<ContentPart>,
    pub(super) snapshot_parts: Vec<ContentPart>,
}

#[derive(Debug, Clone)]
pub(super) struct NormalizedFileReference {
    pub(super) raw_path: String,
    pub(super) workspace_path: Option<String>,
    pub(super) basename: String,
    pub(super) line: Option<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct FileReadLineScope {
    pub(super) scope: FileReadScope,
    pub(super) line: Option<i64>,
    pub(super) start_line: Option<i64>,
    pub(super) end_line: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(super) struct ParsedMeta {
    #[serde(default)]
    pub(super) anyharness: Option<AnyHarnessMeta>,
    #[serde(rename = "claudeCode")]
    pub(super) claude_code: Option<ClaudeCodeMeta>,
    #[serde(default)]
    pub(super) terminal_info: Option<TerminalInfoMeta>,
    #[serde(default)]
    pub(super) terminal_output: Option<TerminalOutputMeta>,
    #[serde(default)]
    pub(super) terminal_exit: Option<TerminalExitMeta>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AnyHarnessMeta {
    pub(super) transcript_event: Option<String>,
    pub(super) native_tool_name: Option<String>,
    pub(super) tool_kind: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClaudeCodeMeta {
    pub(super) tool_name: Option<String>,
    pub(super) parent_tool_use_id: Option<String>,
    #[serde(default)]
    pub(super) tool_response: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(super) struct TerminalInfoMeta {
    pub(super) terminal_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(super) struct TerminalOutputMeta {
    pub(super) terminal_id: String,
    pub(super) data: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(super) struct TerminalExitMeta {
    pub(super) terminal_id: String,
    pub(super) exit_code: i64,
    pub(super) signal: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct BackgroundWorkMetadata {
    pub(super) state: SessionBackgroundWorkState,
    pub(super) agent_id: Option<String>,
    pub(super) output_file: String,
}

pub(super) const ANYHARNESS_META_KEY: &str = "_anyharness";
pub(super) const ANYHARNESS_TRANSCRIPT_META_KEY: &str = "anyharness";
pub(super) const ANYHARNESS_TRANSCRIPT_EVENT_KEY: &str = "transcriptEvent";
pub(super) const ASSISTANT_MESSAGE_COMPLETED_EVENT: &str = "assistant_message_completed";
pub(super) const TRANSIENT_STATUS_EVENT: &str = "transient_status";
pub(super) const BACKGROUND_WORK_TRACKER_KIND: &str = "claude_async_agent";

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
