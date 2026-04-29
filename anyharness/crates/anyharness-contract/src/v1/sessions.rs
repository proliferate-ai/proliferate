use std::fmt;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    ContentPart, InteractionKind, McpElicitationInteractionPayload, PermissionInteractionContext,
    PermissionInteractionOption, SessionLiveConfigSnapshot, SessionMcpBindingSummary,
    SessionMcpServer, UserInputQuestion,
};

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
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptSummary {
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<ContentPart>,
    pub queued_at: String,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub workspace_id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_append: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<Vec<SessionMcpServer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
}

impl fmt::Debug for CreateSessionRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CreateSessionRequest")
            .field("workspace_id", &self.workspace_id)
            .field("agent_kind", &self.agent_kind)
            .field("model_id", &self.model_id)
            .field("mode_id", &self.mode_id)
            .field(
                "system_prompt_append_count",
                &self
                    .system_prompt_append
                    .as_ref()
                    .map(|entries| entries.len()),
            )
            .field(
                "mcp_server_count",
                &self.mcp_servers.as_ref().map(|servers| servers.len()),
            )
            .field(
                "mcp_binding_summary_count",
                &self
                    .mcp_binding_summaries
                    .as_ref()
                    .map(|summaries| summaries.len()),
            )
            .finish()
    }
}

#[derive(Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<Vec<SessionMcpServer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
}

impl fmt::Debug for ResumeSessionRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResumeSessionRequest")
            .field(
                "mcp_server_count",
                &self.mcp_servers.as_ref().map(|servers| servers.len()),
            )
            .field(
                "mcp_binding_summary_count",
                &self
                    .mcp_binding_summaries
                    .as_ref()
                    .map(|summaries| summaries.len()),
            )
            .finish()
    }
}

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
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSessionRequest {
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

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditPendingPromptRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<PromptInputBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
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
mod tests {
    use super::*;
    use crate::v1::{
        SessionMcpEnvVar, SessionMcpHeader, SessionMcpHttpServer, SessionMcpStdioServer,
    };

    #[test]
    fn create_session_request_serializes_model_mode_and_prompt() {
        let request = CreateSessionRequest {
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            model_id: Some("default".to_string()),
            mode_id: Some("bypassPermissions".to_string()),
            system_prompt_append: Some(vec!["Rename the branch".to_string()]),
            mcp_servers: Some(vec![
                SessionMcpServer::Http(SessionMcpHttpServer {
                    connection_id: "connection-1".to_string(),
                    catalog_entry_id: Some("github".to_string()),
                    server_name: "github".to_string(),
                    url: "https://api.github.com/mcp".to_string(),
                    headers: vec![SessionMcpHeader {
                        name: "Authorization".to_string(),
                        value: "Bearer secret".to_string(),
                    }],
                }),
                SessionMcpServer::Stdio(SessionMcpStdioServer {
                    connection_id: "connection-2".to_string(),
                    catalog_entry_id: Some("filesystem".to_string()),
                    server_name: "filesystem".to_string(),
                    command: "mcp-server-filesystem".to_string(),
                    args: vec!["/workspace".to_string()],
                    env: vec![SessionMcpEnvVar {
                        name: "LOG_LEVEL".to_string(),
                        value: "warn".to_string(),
                    }],
                }),
            ]),
            mcp_binding_summaries: None,
        };

        let json = serde_json::to_value(&request).expect("serialize create request");
        assert_eq!(
            json,
            serde_json::json!({
                "workspaceId": "workspace-1",
                "agentKind": "claude",
                "modelId": "default",
                "modeId": "bypassPermissions",
                "systemPromptAppend": ["Rename the branch"],
                "mcpServers": [
                    {
                        "transport": "http",
                        "connectionId": "connection-1",
                        "catalogEntryId": "github",
                        "serverName": "github",
                        "url": "https://api.github.com/mcp",
                        "headers": [
                            {
                                "name": "Authorization",
                                "value": "Bearer secret"
                            }
                        ]
                    },
                    {
                        "transport": "stdio",
                        "connectionId": "connection-2",
                        "catalogEntryId": "filesystem",
                        "serverName": "filesystem",
                        "command": "mcp-server-filesystem",
                        "args": ["/workspace"],
                        "env": [
                            {
                                "name": "LOG_LEVEL",
                                "value": "warn"
                            }
                        ]
                    }
                ]
            })
        );

        let round_tripped: CreateSessionRequest =
            serde_json::from_value(json).expect("deserialize create request");
        assert_eq!(round_tripped.model_id.as_deref(), Some("default"));
        assert_eq!(round_tripped.mode_id.as_deref(), Some("bypassPermissions"));
        assert_eq!(
            round_tripped.system_prompt_append,
            Some(vec!["Rename the branch".to_string()])
        );
        let Some(mcp_servers) = round_tripped.mcp_servers else {
            panic!("expected mcp servers");
        };
        assert_eq!(mcp_servers.len(), 2);
    }

    #[test]
    fn session_omits_removed_thinking_fields() {
        let session = Session {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            model_id: Some("default".to_string()),
            requested_model_id: Some("default".to_string()),
            mode_id: Some("default".to_string()),
            requested_mode_id: Some("default".to_string()),
            title: Some("Fix auth refresh".to_string()),
            live_config: None,
            execution_summary: None,
            mcp_binding_summaries: None,
            status: SessionStatus::Idle,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            pending_prompts: vec![],
        };

        let json = serde_json::to_value(&session).expect("serialize session");

        assert!(json.get("thinkingLevelId").is_none());
        assert!(json.get("thinkingBudgetTokens").is_none());
        assert_eq!(
            json.get("title"),
            Some(&serde_json::json!("Fix auth refresh"))
        );
    }

    #[test]
    fn update_session_title_request_serializes_title() {
        let request = UpdateSessionTitleRequest {
            title: "Tighten retry logic".to_string(),
        };

        let json = serde_json::to_value(&request).expect("serialize title update");
        assert_eq!(json, serde_json::json!({ "title": "Tighten retry logic" }));
    }

    #[test]
    fn resolve_interaction_request_debug_redacts_submitted_answers() {
        let request = ResolveInteractionRequest::Submitted {
            answers: vec![UserInputSubmittedAnswer {
                question_id: "secret".to_string(),
                selected_option_label: Some("do-not-log-option".to_string()),
                text: Some("do-not-log-text".to_string()),
            }],
        };

        let debug = format!("{request:?}");
        assert!(debug.contains("secret"));
        assert!(debug.contains("answer_count"));
        assert!(!debug.contains("do-not-log-option"));
        assert!(!debug.contains("do-not-log-text"));
    }

    #[test]
    fn mcp_url_reveal_response_debug_redacts_full_url() {
        let response = McpElicitationUrlRevealResponse {
            url: "https://accounts.example.com/oauth?token=do-not-log".to_string(),
        };

        let debug = format!("{response:?}");
        assert!(debug.contains("<redacted>"));
        assert!(!debug.contains("do-not-log"));
        assert!(!debug.contains("accounts.example.com"));
    }
}
