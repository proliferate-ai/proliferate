use anyharness_contract::v1::{RuntimeConfigRevision, SessionMcpBindingSummary};

use crate::sessions::mcp_bindings::model::SessionMcpServer;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfigSessionContext {
    pub revision: RuntimeConfigRevision,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
    pub skills: Vec<RuntimeConfigSessionSkill>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfigSessionSkill {
    pub skill_id: String,
    pub display_name: String,
    pub description: String,
    pub instructions: String,
    pub resources: Vec<RuntimeConfigSessionSkillResource>,
    pub required_mcp_servers: Vec<String>,
    pub credential_binding_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfigSessionSkillResource {
    pub resource_id: String,
    pub display_name: Option<String>,
    pub content_type: String,
    pub content: String,
}
