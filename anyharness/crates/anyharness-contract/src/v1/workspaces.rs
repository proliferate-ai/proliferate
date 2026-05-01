use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::OriginContext;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceExecutionPhase {
    Running,
    AwaitingInteraction,
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
    pub awaiting_interaction_count: usize,
    pub idle_count: usize,
    pub errored_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    Worktree,
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSurface {
    Standard,
    Cowork,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceLifecycleState {
    Active,
    Retired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceCleanupState {
    None,
    Pending,
    Complete,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceCreatorContext {
    Human {
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    Automation {
        #[serde(rename = "automationId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        automation_id: Option<String>,
        #[serde(rename = "automationRunId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        automation_run_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    Agent {
        #[serde(rename = "sourceSessionId")]
        source_session_id: String,
        #[serde(rename = "sourceSessionWorkspaceId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_session_workspace_id: Option<String>,
        #[serde(rename = "sessionLinkId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        session_link_id: Option<String>,
        #[serde(rename = "sourceWorkspaceId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_workspace_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub kind: WorkspaceKind,
    pub repo_root_id: String,
    pub path: String,
    pub surface: WorkspaceSurface,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_summary: Option<WorkspaceExecutionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_context: Option<WorkspaceCreatorContext>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorkspaceResponse {
    pub repo_root: crate::v1::RepoRoot,
    pub workspace: Workspace,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_context: Option<WorkspaceCreatorContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceRequest {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_context: Option<WorkspaceCreatorContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeWorkspaceRequest {
    pub repo_root_id: String,
    pub target_path: String,
    pub new_branch_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_context: Option<WorkspaceCreatorContext>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartWorkspaceSetupRequest {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
}
