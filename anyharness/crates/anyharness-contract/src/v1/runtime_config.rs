use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::SessionMcpBindingSummary;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeConfigResolutionReason {
    MissingArtifact,
    MissingCredential,
    ExpiredCredential,
    RevisionSuperseded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigResolutionProblem {
    pub revision_id: String,
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub request_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub request_kinds: Vec<RuntimeResolutionRequestKind>,
    pub reason: RuntimeConfigResolutionReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TargetRuntimeConfigRefreshRequest {
    pub revision: TargetRuntimeConfigRevision,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<RuntimeMcpServer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<RuntimeSkill>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<RuntimeArtifactRef>,
    pub source: RuntimeConfigSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TargetRuntimeConfigRevision {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<i64>,
    pub generated_at: String,
    pub content_hash: String,
    pub owner_scope: RuntimeConfigOwnerScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_target_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeConfigOwnerScope {
    Personal,
    Organization,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeConfigSource {
    Desktop,
    Worker,
    Test,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpServer {
    pub id: String,
    pub connection_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_entry_id: Option<String>,
    pub server_name: String,
    pub launch: RuntimeMcpLaunch,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub credential_refs: Vec<RuntimeCredentialRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case", tag = "transport")]
pub enum RuntimeMcpLaunch {
    Http(RuntimeMcpHttpLaunch),
    Stdio(RuntimeMcpStdioLaunch),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpHttpLaunch {
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub query: Vec<RuntimeMcpQueryParam>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<RuntimeMcpHeader>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpStdioLaunch {
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<RuntimeTextTemplate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<RuntimeMcpEnvVar>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpHeader {
    pub name: String,
    pub value: RuntimeTextTemplate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpQueryParam {
    pub name: String,
    pub value: RuntimeTextTemplate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMcpEnvVar {
    pub name: String,
    pub value: RuntimeTextTemplate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextTemplate {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<RuntimeTextTemplatePart>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RuntimeTextTemplatePart {
    Literal {
        value: String,
    },
    Credential {
        #[serde(rename = "ref")]
        credential_ref: String,
    },
    WorkspacePath,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCredentialRef {
    #[serde(rename = "ref")]
    pub credential_ref: String,
    pub kind: RuntimeCredentialKind,
    pub connection_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_entry_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_entry_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCredentialKind {
    SecretField,
    OauthAccessToken,
    LocalOauth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactRef {
    pub hash: String,
    pub content_type: String,
    pub byte_size: u64,
    pub kind: RuntimeArtifactKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeArtifactKind {
    SkillInstruction,
    SkillResource,
    PackageMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkill {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub display_name: String,
    pub description: String,
    pub instruction_artifact: RuntimeArtifactRef,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<RuntimeSkillResource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_mcp_server_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub credential_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkillResource {
    pub resource_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub artifact: RuntimeArtifactRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TargetRuntimeConfigResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<TargetRuntimeConfigRefreshRequest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_resolution_requests: Vec<RuntimeResolutionRequest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifact_cache: Vec<RuntimeArtifactCacheEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TargetRuntimeConfigApplyResponse {
    pub revision: TargetRuntimeConfigRevision,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_artifacts: Vec<RuntimeArtifactRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigPrefetchRequest {
    #[serde(default)]
    pub include_credentials: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigPrefetchResponse {
    pub revision_id: String,
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub request_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResolutionRequest {
    pub request_id: String,
    pub revision_id: String,
    pub content_hash: String,
    pub kind: RuntimeResolutionRequestKind,
    pub reason: RuntimeConfigResolutionReason,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<RuntimeArtifactRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub credential_refs: Vec<RuntimeCredentialRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeResolutionRequestKind {
    Artifact,
    Credential,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactCacheEntry {
    pub hash: String,
    pub content_type: String,
    pub byte_size: u64,
    pub cache_path: String,
    pub created_at: String,
    pub last_used_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResolutionFulfillRequest {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<RuntimeArtifactFulfillment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub credentials: Vec<RuntimeCredentialFulfillment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactFulfillment {
    pub hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCredentialFulfillment {
    #[serde(rename = "ref")]
    pub credential_ref: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redacted_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResolutionRejectRequest {
    pub reason: RuntimeConfigResolutionReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
