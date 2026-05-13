use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::commands::RuntimeCommandMetadata;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SafeStopState {
    Safe,
    Blocked,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SafeStopBlockerCode {
    ActiveSession,
    ActiveTurn,
    PendingInteraction,
    PendingPrompt,
    ActiveTerminal,
    ActiveProcess,
    WorkspaceOperationInProgress,
    RuntimeStateUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SafeStopBlocker {
    pub code: SafeStopBlockerCode,
    pub message: String,
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeReadinessState {
    Ready,
    InstallRequired,
    CredentialsRequired,
    LoginRequired,
    Unsupported,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub state: RuntimeReadinessState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeWorkspaceRoot {
    pub path: String,
    pub kind: String,
    pub workspace_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInventoryCapabilities {
    pub supports_process_spawn: bool,
    pub supports_pty: bool,
    pub supports_filesystem: bool,
    pub supports_git: bool,
    pub supports_network_egress: bool,
    pub supports_port_forwarding: bool,
    pub supports_browser: bool,
    pub supports_computer_use: bool,
    pub supports_docker: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeToolVersions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub python_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uv_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInventoryResponse {
    pub reported_at: String,
    pub runtime_version: String,
    pub runtime_home: String,
    pub os_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,
    pub arch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distro: Option<String>,
    pub shell: String,
    pub package_managers: Vec<String>,
    pub workspace_roots: Vec<RuntimeWorkspaceRoot>,
    pub capabilities: RuntimeInventoryCapabilities,
    pub versions: RuntimeToolVersions,
    pub provider_readiness: Vec<RuntimeReadinessEntry>,
    pub mcp_readiness: Vec<RuntimeReadinessEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_catalog_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collection_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOperationCount {
    pub kind: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActivityResponse {
    pub reported_at: String,
    pub workspace_count: usize,
    pub total_session_count: usize,
    pub active_session_count: usize,
    pub active_turn_count: usize,
    pub pending_interaction_count: usize,
    pub pending_prompt_count: usize,
    pub active_terminal_count: usize,
    pub active_process_count: usize,
    pub workspace_operation_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operation_counts: Vec<RuntimeOperationCount>,
    pub safe_stop_state: SafeStopState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub safe_stop_reasons: Vec<SafeStopBlocker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collection_errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrepareStopRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_metadata: Option<RuntimeCommandMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrepareStopResponse {
    pub prepared_at: String,
    pub safe_stop_state: SafeStopState,
    pub blockers: Vec<SafeStopBlocker>,
    pub activity: RuntimeActivityResponse,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
