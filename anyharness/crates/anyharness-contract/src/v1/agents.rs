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
