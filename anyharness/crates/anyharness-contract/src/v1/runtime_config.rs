use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use super::SessionMcpBindingSummary;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeConfigSource {
    Desktop,
    Worker,
    Test,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigExternalScope {
    pub provider: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigRevision {
    pub id: String,
    pub sequence: i64,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_scope: Option<RuntimeConfigExternalScope>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigRevisionExpectation {
    pub revision_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<i64>,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_scope: Option<RuntimeConfigExternalScope>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRuntimeConfigRequest {
    pub revision: RuntimeConfigRevision,
    pub manifest: RuntimeConfigManifest,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifact_payloads: Vec<RuntimeArtifactPayload>,
    pub source: RuntimeConfigSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRuntimeConfigResponse {
    pub applied: bool,
    pub revision: RuntimeConfigRevision,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigStatusResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<RuntimeConfigRevision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<RuntimeConfigManifest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifact_payloads: Vec<RuntimeArtifactPayload>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigManifest {
    #[serde(default)]
    pub mcp_servers: Vec<RuntimeMcpServer>,
    #[serde(default)]
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
    #[serde(default)]
    pub skills: Vec<RuntimeSkill>,
    #[serde(default)]
    pub artifacts: Vec<RuntimeArtifactRef>,
    #[serde(default)]
    pub warnings: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpServer {
    pub id: String,
    pub connection_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_entry_id: Option<String>,
    pub server_name: String,
    pub transport: RuntimeMcpTransport,
    pub launch: RuntimeMcpLaunch,
    #[serde(default)]
    pub credential_refs: Vec<RuntimeCredentialRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeMcpTransport {
    Http,
    Stdio,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeMcpLaunch {
    Http {
        url: RuntimeMcpValue,
        #[serde(default)]
        headers: Vec<RuntimeMcpNamedValue>,
        #[serde(default)]
        query: Vec<RuntimeMcpNamedValue>,
    },
    Stdio {
        command: RuntimeMcpValue,
        #[serde(default)]
        args: Vec<RuntimeMcpValue>,
        #[serde(default)]
        env: Vec<RuntimeMcpNamedValue>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpNamedValue {
    pub name: String,
    pub value: RuntimeMcpValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeMcpValue {
    Literal {
        value: String,
    },
    Credential {
        #[serde(rename = "credentialRef")]
        credential_ref: String,
    },
    Template {
        parts: Vec<RuntimeMcpTemplatePart>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeMcpTemplatePart {
    Literal {
        value: String,
    },
    Credential {
        #[serde(rename = "credentialRef")]
        credential_ref: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkill {
    pub id: String,
    pub source_kind: RuntimeSkillSourceKind,
    pub display_name: String,
    pub description: String,
    pub instruction_artifact: RuntimeArtifactRef,
    #[serde(default)]
    pub resources: Vec<RuntimeArtifactRef>,
    #[serde(default)]
    pub required_mcp_server_ids: Vec<String>,
    #[serde(default)]
    pub credential_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSkillSourceKind {
    Catalog,
    Plugin,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactRef {
    pub hash: String,
    pub content_type: String,
    pub byte_size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactPayload {
    pub hash: String,
    pub content_type: String,
    pub byte_size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCredentialRef {
    pub credential_ref: String,
    pub used_in: RuntimeCredentialUse,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_server_id: Option<String>,
    pub field_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCredentialUse {
    McpLaunch,
    McpLaunchHeader,
    McpLaunchQuery,
    McpLaunchArg,
    McpLaunchEnv,
    SkillBinding,
}
