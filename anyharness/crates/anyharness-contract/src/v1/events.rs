use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::interactions::{InteractionRequestedEvent, InteractionResolvedEvent};
use super::SessionLiveConfigSnapshot;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventEnvelope {
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub event: SessionEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionRawNotificationEnvelope {
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    pub notification_kind: String,
    pub notification: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Normalized event union
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    SessionStarted(SessionStartedEvent),
    SessionEnded(SessionEndedEvent),
    TurnStarted(TurnStartedEvent),
    TurnEnded(TurnEndedEvent),
    ItemStarted(ItemStartedEvent),
    ItemDelta(ItemDeltaEvent),
    ItemCompleted(ItemCompletedEvent),

    AvailableCommandsUpdate(AvailableCommandsUpdatePayload),
    CurrentModeUpdate(CurrentModeUpdatePayload),
    ConfigOptionUpdate(ConfigOptionUpdatePayload),
    SessionStateUpdate(SessionStateUpdatePayload),
    SessionInfoUpdate(SessionInfoUpdatePayload),
    UsageUpdate(UsageUpdatePayload),

    PendingPromptAdded(PendingPromptAddedPayload),
    PendingPromptUpdated(PendingPromptUpdatedPayload),
    PendingPromptRemoved(PendingPromptRemovedPayload),

    #[serde(alias = "permission_requested")]
    InteractionRequested(InteractionRequestedEvent),
    #[serde(alias = "permission_resolved")]
    InteractionResolved(InteractionResolvedEvent),
    Error(ErrorEvent),
}

impl SessionEvent {
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::SessionStarted(_) => "session_started",
            Self::SessionEnded(_) => "session_ended",
            Self::TurnStarted(_) => "turn_started",
            Self::TurnEnded(_) => "turn_ended",
            Self::ItemStarted(_) => "item_started",
            Self::ItemDelta(_) => "item_delta",
            Self::ItemCompleted(_) => "item_completed",
            Self::AvailableCommandsUpdate(_) => "available_commands_update",
            Self::CurrentModeUpdate(_) => "current_mode_update",
            Self::ConfigOptionUpdate(_) => "config_option_update",
            Self::SessionStateUpdate(_) => "session_state_update",
            Self::SessionInfoUpdate(_) => "session_info_update",
            Self::UsageUpdate(_) => "usage_update",
            Self::PendingPromptAdded(_) => "pending_prompt_added",
            Self::PendingPromptUpdated(_) => "pending_prompt_updated",
            Self::PendingPromptRemoved(_) => "pending_prompt_removed",
            Self::InteractionRequested(_) => "interaction_requested",
            Self::InteractionResolved(_) => "interaction_resolved",
            Self::Error(_) => "error",
        }
    }
}

// ---------------------------------------------------------------------------
// Session / turn lifecycle
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartedEvent {
    pub native_session_id: String,
    pub source_agent_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionEndedEvent {
    pub reason: SessionEndReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionEndReason {
    Closed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct TurnStartedEvent {}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TurnEndedEvent {
    pub stop_reason: StopReason,
}

// ---------------------------------------------------------------------------
// Transcript items
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemStartedEvent {
    pub item: TranscriptItemPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemDeltaEvent {
    pub delta: TranscriptItemDeltaPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemCompletedEvent {
    pub item: TranscriptItemPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItemPayload {
    pub kind: TranscriptItemKind,
    pub status: TranscriptItemStatus,
    pub source_agent_kind: String,
    #[serde(default, rename = "isTransient", skip_serializing_if = "is_false")]
    pub is_transient: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<ContentPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptItemKind {
    UserMessage,
    AssistantMessage,
    Reasoning,
    ToolInvocation,
    Plan,
    ProposedPlan,
    ErrorItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptItemStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItemDeltaPayload {
    #[serde(rename = "isTransient")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_transient: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<TranscriptItemStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub append_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub append_reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replace_content_parts: Option<Vec<ContentPart>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub append_content_parts: Option<Vec<ContentPart>>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text {
        text: String,
    },
    Image {
        #[serde(rename = "attachmentId")]
        attachment_id: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<u64>,
    },
    Resource {
        #[serde(rename = "attachmentId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        attachment_id: Option<String>,
        uri: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(rename = "mimeType")]
        #[serde(skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
    },
    ResourceLink {
        uri: String,
        name: String,
        #[serde(rename = "mimeType")]
        #[serde(skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<u64>,
    },
    Reasoning {
        text: String,
        visibility: ReasoningVisibility,
    },
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        title: String,
        #[serde(rename = "toolKind")]
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_kind: Option<String>,
        #[serde(rename = "nativeToolName")]
        #[serde(skip_serializing_if = "Option::is_none")]
        native_tool_name: Option<String>,
    },
    TerminalOutput {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        event: TerminalLifecycleEvent,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<String>,
        #[serde(rename = "exitCode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        signal: Option<String>,
    },
    FileRead {
        path: String,
        #[serde(rename = "workspacePath")]
        #[serde(skip_serializing_if = "Option::is_none")]
        workspace_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        basename: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        line: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        scope: Option<FileReadScope>,
        #[serde(rename = "startLine")]
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<i64>,
        #[serde(rename = "endLine")]
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
    },
    FileChange {
        operation: FileChangeOperation,
        path: String,
        #[serde(rename = "workspacePath")]
        #[serde(skip_serializing_if = "Option::is_none")]
        workspace_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        basename: Option<String>,
        #[serde(rename = "newPath")]
        #[serde(skip_serializing_if = "Option::is_none")]
        new_path: Option<String>,
        #[serde(rename = "newWorkspacePath")]
        #[serde(skip_serializing_if = "Option::is_none")]
        new_workspace_path: Option<String>,
        #[serde(rename = "newBasename")]
        #[serde(skip_serializing_if = "Option::is_none")]
        new_basename: Option<String>,
        #[serde(rename = "openTarget")]
        #[serde(skip_serializing_if = "Option::is_none")]
        open_target: Option<FileOpenTarget>,
        #[serde(skip_serializing_if = "Option::is_none")]
        additions: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        deletions: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        patch: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
        #[serde(rename = "nativeToolName")]
        #[serde(skip_serializing_if = "Option::is_none")]
        native_tool_name: Option<String>,
    },
    Plan {
        entries: Vec<PlanEntry>,
    },
    ProposedPlan {
        #[serde(rename = "planId")]
        plan_id: String,
        title: String,
        #[serde(rename = "bodyMarkdown")]
        body_markdown: String,
        #[serde(rename = "snapshotHash")]
        snapshot_hash: String,
        #[serde(rename = "sourceSessionId")]
        source_session_id: String,
        #[serde(rename = "sourceTurnId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_turn_id: Option<String>,
        #[serde(rename = "sourceItemId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_item_id: Option<String>,
        #[serde(rename = "sourceKind")]
        source_kind: String,
        #[serde(rename = "sourceToolCallId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_tool_call_id: Option<String>,
    },
    PlanReference {
        #[serde(rename = "planId")]
        plan_id: String,
        title: String,
        #[serde(rename = "bodyMarkdown")]
        body_markdown: String,
        #[serde(rename = "snapshotHash")]
        snapshot_hash: String,
        #[serde(rename = "sourceSessionId")]
        source_session_id: String,
        #[serde(rename = "sourceTurnId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_turn_id: Option<String>,
        #[serde(rename = "sourceItemId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_item_id: Option<String>,
        #[serde(rename = "sourceKind")]
        source_kind: String,
        #[serde(rename = "sourceToolCallId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_tool_call_id: Option<String>,
    },
    ProposedPlanDecision {
        #[serde(rename = "planId")]
        plan_id: String,
        #[serde(rename = "decisionState")]
        decision_state: ProposedPlanDecisionState,
        #[serde(rename = "nativeResolutionState")]
        native_resolution_state: ProposedPlanNativeResolutionState,
        #[serde(rename = "decisionVersion")]
        decision_version: i64,
        #[serde(rename = "errorMessage")]
        #[serde(skip_serializing_if = "Option::is_none")]
        error_message: Option<String>,
    },
    ToolInputText {
        text: String,
    },
    ToolResultText {
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningVisibility {
    Private,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalLifecycleEvent {
    Start,
    Output,
    Exit,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileReadScope {
    Full,
    Line,
    Range,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileOpenTarget {
    File,
    Diff,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeOperation {
    Create,
    Edit,
    Delete,
    Move,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub content: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposedPlanDecisionState {
    Pending,
    Approved,
    Rejected,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposedPlanNativeResolutionState {
    None,
    PendingLink,
    PendingResolution,
    Finalized,
    Failed,
}

// ---------------------------------------------------------------------------
// Session metadata payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommandsUpdatePayload {
    pub available_commands: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurrentModeUpdatePayload {
    pub current_mode_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOptionUpdatePayload {
    pub live_config: SessionLiveConfigSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateUpdatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoUpdatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsageUpdatePayload {
    pub used: u64,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Pending prompt (queue) events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptAddedPayload {
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<ContentPart>,
    pub queued_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptUpdatedPayload {
    pub seq: i64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<ContentPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptRemovedPayload {
    pub seq: i64,
    pub reason: PendingPromptRemovalReason,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PendingPromptRemovalReason {
    Executed,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
}

impl std::fmt::Display for StopReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EndTurn => write!(f, "end_turn"),
            Self::MaxTokens => write!(f, "max_tokens"),
            Self::MaxTurnRequests => write!(f, "max_turn_requests"),
            Self::Refusal => write!(f, "refusal"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_part_plan_reference_round_trips() {
        let part = ContentPart::PlanReference {
            plan_id: "plan-123".to_string(),
            title: "Implementation plan".to_string(),
            body_markdown: "# Implementation plan\n\nDo it.".to_string(),
            snapshot_hash: "hash-123".to_string(),
            source_session_id: "session-123".to_string(),
            source_turn_id: Some("turn-123".to_string()),
            source_item_id: Some("item-123".to_string()),
            source_kind: "codex_turn_plan".to_string(),
            source_tool_call_id: Some("tool-123".to_string()),
        };

        let json = serde_json::to_value(&part).expect("serialize plan reference content part");
        assert_eq!(
            json,
            serde_json::json!({
                "type": "plan_reference",
                "planId": "plan-123",
                "title": "Implementation plan",
                "bodyMarkdown": "# Implementation plan\n\nDo it.",
                "snapshotHash": "hash-123",
                "sourceSessionId": "session-123",
                "sourceTurnId": "turn-123",
                "sourceItemId": "item-123",
                "sourceKind": "codex_turn_plan",
                "sourceToolCallId": "tool-123"
            })
        );

        let round_tripped: ContentPart =
            serde_json::from_value(json).expect("deserialize plan reference content part");
        assert_eq!(round_tripped, part);
    }
}
