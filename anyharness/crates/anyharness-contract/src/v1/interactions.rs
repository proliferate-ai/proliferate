use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InteractionRequestedEvent {
    pub request_id: String,
    pub kind: InteractionKind,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source: InteractionSource,
    pub payload: InteractionPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InteractionResolvedEvent {
    pub request_id: String,
    pub kind: InteractionKind,
    pub outcome: InteractionOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InteractionKind {
    Permission,
    UserInput,
    McpElicitation,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_plan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InteractionPayload {
    Permission(PermissionInteractionPayload),
    UserInput(UserInputInteractionPayload),
    McpElicitation(McpElicitationInteractionPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionInteractionPayload {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<PermissionInteractionOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<PermissionInteractionContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionInteractionContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionInteractionOption {
    pub option_id: String,
    pub label: String,
    pub kind: PermissionInteractionOptionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionInteractionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserInputInteractionPayload {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub questions: Vec<UserInputQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserInputQuestion {
    pub question_id: String,
    pub header: String,
    pub question: String,
    pub is_other: bool,
    pub is_secret: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<UserInputQuestionOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserInputQuestionOption {
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationInteractionPayload {
    pub server_name: String,
    pub mode: McpElicitationMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum McpElicitationMode {
    Form(McpElicitationFormPayload),
    Url(McpElicitationUrlPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationFormPayload {
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<McpElicitationField>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationUrlPayload {
    pub message: String,
    pub url_display: String,
    pub requires_reveal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "fieldType", rename_all = "snake_case")]
pub enum McpElicitationField {
    Text(McpElicitationTextField),
    Number(McpElicitationNumberField),
    Boolean(McpElicitationBooleanField),
    SingleSelect(McpElicitationSelectField),
    MultiSelect(McpElicitationMultiSelectField),
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationFieldBase {
    pub field_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationTextField {
    #[serde(flatten)]
    pub base: McpElicitationFieldBase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<McpElicitationTextFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_length: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum McpElicitationTextFormat {
    Email,
    Uri,
    Date,
    DateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationNumberField {
    #[serde(flatten)]
    pub base: McpElicitationFieldBase,
    pub integer: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationBooleanField {
    #[serde(flatten)]
    pub base: McpElicitationFieldBase,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationSelectField {
    #[serde(flatten)]
    pub base: McpElicitationFieldBase,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<McpElicitationOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationMultiSelectField {
    #[serde(flatten)]
    pub base: McpElicitationFieldBase,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<McpElicitationOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_items: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_items: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationOption {
    pub option_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum InteractionOutcome {
    #[serde(rename_all = "camelCase")]
    Selected {
        option_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Submitted {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        answered_question_ids: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Accepted {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        accepted_field_ids: Vec<String>,
    },
    Declined,
    Cancelled,
    Dismissed,
}
