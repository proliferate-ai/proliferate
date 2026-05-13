use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{SessionMcpBindingSummary, SessionMcpServer};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionPluginBundle {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plugins: Vec<SessionPlugin>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionPlugin {
    pub plugin_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<SessionPluginSkill>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<SessionMcpServer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub credential_bindings: Vec<SessionPluginCredentialBinding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionPluginSkill {
    pub skill_id: String,
    pub display_name: String,
    pub description: String,
    pub instructions: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<SessionPluginSkillResource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_mcp_servers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub credential_binding_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionPluginSkillResource {
    pub resource_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub content_type: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionPluginCredentialBinding {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub status: SessionPluginCredentialBindingStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionPluginCredentialBindingStatus {
    Ready,
    Missing,
    NeedsReconnect,
    UnsupportedTarget,
}
