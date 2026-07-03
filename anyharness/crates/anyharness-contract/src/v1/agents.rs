use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstallState {
    Installed,
    InstallRequired,
    Installing,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentCredentialState {
    Ready,
    MissingEnv,
    LoginRequired,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentReadinessState {
    Ready,
    InstallRequired,
    CredentialsRequired,
    LoginRequired,
    Unsupported,
    Error,
}

// --- Artifact status ---

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactStatus {
    pub role: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// --- Agent summary ---

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    pub kind: String,
    pub display_name: String,
    pub install_state: AgentInstallState,
    pub native_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native: Option<ArtifactStatus>,
    pub agent_process: ArtifactStatus,
    pub credential_state: AgentCredentialState,
    pub readiness: AgentReadinessState,
    pub supports_login: bool,
    pub expected_env_vars: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// --- Launch options ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModelCatalogStatus {
    Candidate,
    Active,
    Deprecated,
    Hidden,
}

/// The thinking/effort control surfaced per model: the values the model
/// supports and the observed default (the runtime joins these from the
/// bundled catalog's `controls.effort.{values, observedValue}`).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelEffort {
    pub values: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchModelOption {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_opt_in: Option<bool>,
    // --- Enriched catalog fields (joined from the bundled catalog-v2 entry
    // with the same id, so cloud snapshots stored from this payload carry the
    // same richness as the gateway-models endpoint). All optional. ---
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ModelCatalogStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<ModelEffort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fast_mode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchOption {
    pub kind: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    pub models: Vec<AgentLaunchModelOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchOptionsResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub agents: Vec<AgentLaunchOption>,
}

// --- Install ---

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallAgentRequest {
    #[serde(default)]
    pub reinstall: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_process_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallAgentResponse {
    pub agent: AgentSummary,
    pub already_installed: bool,
    pub installed_artifacts: Vec<ArtifactStatus>,
}

// --- Login ---

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentLoginRequest {}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentLoginResponse {
    pub kind: String,
    pub label: String,
    pub mode: String,
    pub command: LoginCommand,
    pub reuses_user_state: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LoginCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentLoginTerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoginTerminalRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: AgentLoginTerminalStatus,
    pub cwd: String,
    pub command_display: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentLoginTerminalResponse {
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub agent_login_terminal: AgentLoginTerminalRecord,
}

// --- Reconcile ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReconcileOutcome {
    Installed,
    AlreadyInstalled,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReconcileJobStatus {
    Idle,
    Queued,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileAgentsRequest {
    #[serde(default)]
    pub reinstall: bool,
    /// When true, only agents already installed on disk are reconciled to the
    /// catalog pins; missing agents are skipped (they install on demand at
    /// session start). Defaults to false (full-scope reconcile).
    #[serde(default)]
    pub installed_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileAgentResult {
    pub kind: String,
    pub outcome: ReconcileOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub installed_artifacts: Vec<ArtifactStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileAgentsResponse {
    pub status: ReconcileJobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    pub reinstall: bool,
    pub results: Vec<ReconcileAgentResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Coarse, low-cardinality reconcile status for `/health`. Per-agent detail
/// stays on `GET /v1/agents/reconcile`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentReconcileSummary {
    pub status: ReconcileJobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_agent: Option<String>,
    pub installed: u32,
    pub already_installed: u32,
    pub skipped: u32,
    pub failed: u32,
}
