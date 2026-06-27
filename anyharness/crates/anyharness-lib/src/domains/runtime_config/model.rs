use anyharness_contract::v1::{
    RuntimeArtifactPayload, RuntimeArtifactRef, RuntimeArtifactStatus, RuntimeConfigExternalScope,
    RuntimeConfigManifest, RuntimeConfigRevision, RuntimeCredentialValue, SessionMcpBindingSummary,
};

use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfigSessionContext {
    pub revision: RuntimeConfigRevision,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
    pub skills: Vec<RuntimeConfigSessionSkill>,
}

#[derive(Debug, Clone, Default)]
pub struct RuntimeConfigExtraSkills {
    pub workspace_id: String,
    pub skills: Vec<anyharness_contract::v1::RuntimeSkill>,
    pub artifacts: Vec<RuntimeArtifactRef>,
    pub artifact_payloads: Vec<RuntimeArtifactPayload>,
}

impl RuntimeConfigExtraSkills {
    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeConfigApplyInput {
    pub revision: RuntimeConfigRevision,
    pub manifest: RuntimeConfigManifest,
    pub artifact_payloads: Vec<RuntimeArtifactPayload>,
    pub credential_values: Vec<RuntimeCredentialValue>,
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeConfigApplyOutcome {
    pub applied: bool,
    pub revision: RuntimeConfigRevision,
}

impl RuntimeConfigApplyOutcome {
    pub fn status(&self) -> &'static str {
        if self.applied {
            "applied"
        } else {
            "stale"
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RuntimeConfigStatus {
    pub artifacts: Vec<RuntimeArtifactStatus>,
    pub current_revision: Option<RuntimeConfigRevision>,
    pub manifest: Option<RuntimeConfigManifest>,
}

#[derive(Debug, Clone)]
pub(crate) struct RuntimeConfigRecord {
    pub revision: RuntimeConfigRevision,
    pub manifest: RuntimeConfigManifest,
    pub artifact_payloads: Vec<RuntimeArtifactPayload>,
}

pub(crate) fn default_external_scope() -> RuntimeConfigExternalScope {
    RuntimeConfigExternalScope {
        provider: "local".to_string(),
        id: "default".to_string(),
        target_id: None,
    }
}

pub(crate) fn scope_key(scope: Option<&RuntimeConfigExternalScope>) -> String {
    let scope = scope.cloned().unwrap_or_else(default_external_scope);
    match scope.target_id.as_deref() {
        Some(target_id) if !target_id.is_empty() => {
            format!("{}:{}:{}", scope.provider, scope.id, target_id)
        }
        _ => format!("{}:{}", scope.provider, scope.id),
    }
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
