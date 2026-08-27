use std::fmt;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::OriginContext;
use super::{
    Goal, InteractionKind, McpElicitationInteractionPayload, PermissionInteractionContext,
    PermissionInteractionOption, SessionActivity, SessionLiveConfigSnapshot,
    SessionMcpBindingSummary, UserInputQuestion,
};

mod pending_prompts;
pub use pending_prompts::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Starting,
    Idle,
    Running,
    Completed,
    Errored,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionExecutionPhase {
    Starting,
    Running,
    AwaitingInteraction,
    Idle,
    Errored,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingInteractionSummary {
    pub request_id: String,
    pub kind: InteractionKind,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source: PendingInteractionSource,
    pub payload: PendingInteractionPayloadSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingInteractionSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_plan_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PendingInteractionPayloadSummary {
    Permission {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        options: Vec<PermissionInteractionOption>,
        #[serde(skip_serializing_if = "Option::is_none")]
        context: Option<PermissionInteractionContext>,
    },
    UserInput {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        questions: Vec<UserInputQuestion>,
    },
    McpElicitation {
        #[serde(flatten)]
        payload: McpElicitationInteractionPayload,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionSummary {
    pub phase: SessionExecutionPhase,
    pub has_live_handle: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_interactions: Vec<PendingInteractionSummary>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub workspace_id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_config: Option<SessionLiveConfigSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_summary: Option<SessionExecutionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
    pub status: SessionStatus,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_prompts: Vec<PendingPromptSummary>,
    #[serde(default)]
    pub action_capabilities: SessionActionCapabilities,
    /// Deprecated in favor of `activity.goal` — kept for existing SDK
    /// consumers; every write still moves this field too.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_goal: Option<Goal>,
    /// `SessionActivity` (turn/goal/loops/processes/agents) — the
    /// session-activity-architecture aggregate. `None` when the runtime has
    /// not yet assembled it for this read path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<SessionActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionActionCapabilities {
    #[serde(default)]
    pub fork: bool,
    #[serde(default)]
    pub targeted_fork: bool,
    #[serde(default)]
    pub supports_goals: bool,
    #[serde(default)]
    pub supports_loops: bool,
    /// Whether loops ride native harness state (Claude session crons) or are
    /// runtime-emulated (Codex `LoopSchedulerExtension`). Meaningless when
    /// `supports_loops` is `false`.
    #[serde(default)]
    pub loops_native: bool,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateSessionRequest {
    /// Optional caller-selected canonical lowercase v4 UUID. Repeating a
    /// create request with the same id resumes that exact session instead of
    /// creating another one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub workspace_id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Stateless N-1 compatibility input. The HTTP boundary translates it to
    /// `controlValues.mode` before the request enters the session domain.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub control_values: std::collections::BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_append: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagents_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForkSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<ForkSessionTarget>,
    /// Forks ADR rung 2: optional caller-reserved child session id. When set it
    /// is both the child's durable id and the fork operation's idempotency key,
    /// so repeating the request with the same payload resumes/returns the same
    /// child. An `Idempotency-Key` header serves the same role when this is
    /// absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForkSessionTarget {
    #[serde(rename = "type")]
    pub target_type: ForkSessionTargetType,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ForkSessionTargetType {
    BeforeUserMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForkSessionResponse {
    pub session: Session,
    pub session_link: SessionLinkSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_start: Option<ForkChildStartSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForkChildStartSummary {
    pub status: ForkChildStartStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ForkChildStartStatus {
    Started,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionLinkSummary {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_id: Option<String>,
    pub relation: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub workspace_relation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
}

impl fmt::Debug for CreateSessionRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CreateSessionRequest")
            .field("session_id", &self.session_id)
            .field("workspace_id", &self.workspace_id)
            .field("agent_kind", &self.agent_kind)
            .field("model_id", &self.model_id)
            .field("mode_id", &self.mode_id)
            .field(
                "control_keys",
                &self.control_values.keys().collect::<Vec<_>>(),
            )
            .field(
                "system_prompt_append_count",
                &self
                    .system_prompt_append
                    .as_ref()
                    .map(|entries| entries.len()),
            )
            .field("subagents_enabled", &self.subagents_enabled)
            .field("origin", &self.origin)
            .finish()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeSessionRequest {}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionTitleRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum PromptInputBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<String>,
        #[serde(rename = "attachmentId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        attachment_id: Option<String>,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<PromptAttachmentSource>,
    },
    #[serde(rename = "resource")]
    Resource {
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
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
        source: Option<PromptAttachmentSource>,
    },
    #[serde(rename = "resource_link")]
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
    #[serde(rename = "plan_reference")]
    PlanReference {
        #[serde(rename = "planId")]
        plan_id: String,
        #[serde(rename = "snapshotHash")]
        snapshot_hash: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromptAttachmentSource {
    Upload,
    Paste,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSessionRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    pub blocks: Vec<PromptInputBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSessionResponse {
    pub session: Session,
    pub status: PromptSessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued_seq: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromptSessionStatus {
    Running,
    Queued,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ResolveInteractionRequest {
    #[serde(rename_all = "camelCase")]
    Selected {
        option_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Decision {
        decision: InteractionDecision,
    },
    #[serde(rename_all = "camelCase")]
    Submitted {
        answers: Vec<UserInputSubmittedAnswer>,
    },
    #[serde(rename_all = "camelCase")]
    Accepted {
        fields: Vec<McpElicitationSubmittedField>,
    },
    Declined,
    Cancelled,
    Dismissed,
}

impl fmt::Debug for ResolveInteractionRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Selected { option_id } => f
                .debug_struct("Selected")
                .field("option_id", option_id)
                .finish(),
            Self::Decision { decision } => f
                .debug_struct("Decision")
                .field("decision", decision)
                .finish(),
            Self::Submitted { answers } => f
                .debug_struct("Submitted")
                .field("answer_count", &answers.len())
                .field(
                    "question_ids",
                    &answers
                        .iter()
                        .map(|answer| answer.question_id.as_str())
                        .collect::<Vec<_>>(),
                )
                .finish(),
            Self::Accepted { fields } => f
                .debug_struct("Accepted")
                .field("field_count", &fields.len())
                .field(
                    "field_ids",
                    &fields
                        .iter()
                        .map(|field| field.field_id.as_str())
                        .collect::<Vec<_>>(),
                )
                .finish(),
            Self::Declined => f.write_str("Declined"),
            Self::Cancelled => f.write_str("Cancelled"),
            Self::Dismissed => f.write_str("Dismissed"),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserInputSubmittedAnswer {
    pub question_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_option_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

impl fmt::Debug for UserInputSubmittedAnswer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("UserInputSubmittedAnswer")
            .field("question_id", &self.question_id)
            .field(
                "has_selected_option_label",
                &self.selected_option_label.is_some(),
            )
            .field("has_text", &self.text.is_some())
            .finish()
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationSubmittedField {
    pub field_id: String,
    pub value: McpElicitationSubmittedValue,
}

impl fmt::Debug for McpElicitationSubmittedField {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("McpElicitationSubmittedField")
            .field("field_id", &self.field_id)
            .field("value_kind", &self.value.kind())
            .finish()
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpElicitationSubmittedValue {
    String { value: String },
    Integer { value: i64 },
    Number { value: f64 },
    Boolean { value: bool },
    Option { option_id: String },
    OptionArray { option_ids: Vec<String> },
}

impl McpElicitationSubmittedValue {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::String { .. } => "string",
            Self::Integer { .. } => "integer",
            Self::Number { .. } => "number",
            Self::Boolean { .. } => "boolean",
            Self::Option { .. } => "option",
            Self::OptionArray { .. } => "option_array",
        }
    }
}

impl fmt::Debug for McpElicitationSubmittedValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("McpElicitationSubmittedValue")
            .field(&self.kind())
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationUrlRevealResponse {
    pub url: String,
}

impl fmt::Debug for McpElicitationUrlRevealResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("McpElicitationUrlRevealResponse")
            .field("url", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InteractionDecision {
    Allow,
    Deny,
}

#[cfg(test)]
mod tests;
