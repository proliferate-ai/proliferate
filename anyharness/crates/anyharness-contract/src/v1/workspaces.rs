use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceExecutionPhase {
    Running,
    AwaitingPermission,
    Idle,
    Errored,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExecutionSummary {
    pub phase: WorkspaceExecutionPhase,
    pub total_session_count: usize,
    pub live_session_count: usize,
    pub running_count: usize,
    pub awaiting_permission_count: usize,
    pub idle_count: usize,
    pub errored_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    Repo,
    Worktree,
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSurfaceKind {
    Code,
    Cowork,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub kind: WorkspaceKind,
    pub surface_kind: WorkspaceSurfaceKind,
    pub path: String,
    pub source_repo_root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_repo_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_summary: Option<WorkspaceExecutionSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceDisplayNameRequest {
    /// New display name. `null` or an empty string clears the override and
    /// restores the default branch- or repo-derived label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionLaunchModel {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionLaunchAgent {
    pub kind: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    pub models: Vec<WorkspaceSessionLaunchModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionLaunchCatalog {
    pub workspace_id: String,
    pub agents: Vec<WorkspaceSessionLaunchAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorkspaceFromPathRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCoworkWorkspaceRequest {
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCoworkWorkspaceResponse {
    pub workspace: Workspace,
    pub session: super::Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceWorkspaceDefaultSessionRequest {
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceWorkspaceDefaultSessionResponse {
    pub workspace: Workspace,
    pub session: super::Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRepoWorkspaceRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeWorkspaceRequest {
    pub source_workspace_id: String,
    pub target_path: String,
    pub new_branch_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_script: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SetupScriptStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupScriptExecution {
    pub command: String,
    pub status: SetupScriptStatus,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeWorkspaceResponse {
    pub workspace: Workspace,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_script: Option<SetupScriptExecution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SetupHintCategory {
    BuildTool,
    SecretSync,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupHint {
    pub id: String,
    pub label: String,
    pub suggested_command: String,
    pub detected_file: String,
    pub category: SetupHintCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetectProjectSetupResponse {
    pub hints: Vec<SetupHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetSetupStatusResponse {
    pub status: SetupScriptStatus,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartWorkspaceSetupRequest {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
}
