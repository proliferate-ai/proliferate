use anyharness_contract::v1::SessionMcpBindingSummary;

use crate::sessions::mcp_bindings::model::SessionMcpServer;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPluginBundle {
    pub plugins: Vec<SessionPlugin>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPlugin {
    pub plugin_id: String,
    pub version: Option<String>,
    pub skills: Vec<SessionPluginSkill>,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
    pub credential_bindings: Vec<SessionPluginCredentialBinding>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPluginSkill {
    pub skill_id: String,
    pub display_name: String,
    pub description: String,
    pub instructions: String,
    pub resources: Vec<SessionPluginSkillResource>,
    pub required_mcp_servers: Vec<String>,
    pub credential_binding_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPluginSkillResource {
    pub resource_id: String,
    pub display_name: Option<String>,
    pub content_type: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPluginCredentialBinding {
    pub id: String,
    pub display_name: Option<String>,
    pub status: SessionPluginCredentialBindingStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPluginCredentialBindingStatus {
    Ready,
    Missing,
    NeedsReconnect,
    UnsupportedTarget,
}
