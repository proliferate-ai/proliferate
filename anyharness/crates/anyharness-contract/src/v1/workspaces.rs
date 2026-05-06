use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{OriginContext, SessionDefaultControl};

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
#[serde(rename_all = "snake_case")]
pub enum WorkspaceCleanupOperation {
    Retire,
    Purge,
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
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_failed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_attempted_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_summary: Option<WorkspaceExecutionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_context: Option<WorkspaceCreatorContext>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceRetireBlockerCode {
    UnsupportedWorkspace,
    WorkspaceAccessBlocked,
    DirtyWorkingTree,
    ConflictedFiles,
    ActiveGitOperation,
    LiveSession,
    PendingPrompt,
    PendingInteraction,
    ActiveTerminal,
    RunningCommand,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceRetireBlockerSeverity {
    Blocking,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRetireBlocker {
    pub code: WorkspaceRetireBlockerCode,
    pub message: String,
    pub severity: WorkspaceRetireBlockerSeverity,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<crate::v1::git::GitOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRetirePreflightResponse {
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    pub can_retire: bool,
    pub materialized: bool,
    pub merged_into_base: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_oid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_oid: Option<String>,
    pub head_matches_base: bool,
    pub readiness_fingerprint: String,
    pub blockers: Vec<WorkspaceRetireBlocker>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceRetireOutcome {
    Retired,
    AlreadyRetired,
    Blocked,
    CleanupFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRetireResponse {
    pub workspace: Workspace,
    pub outcome: WorkspaceRetireOutcome,
    pub preflight: WorkspaceRetirePreflightResponse,
    pub cleanup_attempted: bool,
    pub cleanup_succeeded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePurgePreflightResponse {
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    pub can_purge: bool,
    pub materialized: bool,
    pub blockers: Vec<WorkspaceRetireBlocker>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspacePurgeOutcome {
    Deleted,
    Blocked,
    CleanupFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePurgeResponse {
    pub outcome: WorkspacePurgeOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<Workspace>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preflight: Option<WorkspacePurgePreflightResponse>,
    pub already_deleted: bool,
    pub cleanup_attempted: bool,
    pub cleanup_succeeded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_message: Option<String>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub session_default_controls: Vec<SessionDefaultControl>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::v1::{SessionDefaultControlKey, SessionDefaultControlValue};

    #[test]
    fn workspace_launch_model_omits_empty_session_default_controls() {
        let model = WorkspaceSessionLaunchModel {
            id: "sonnet".to_string(),
            display_name: "Sonnet".to_string(),
            is_default: true,
            session_default_controls: vec![],
        };

        let json = serde_json::to_value(model).expect("serialize launch model");

        assert!(json.get("sessionDefaultControls").is_none());
    }

    #[test]
    fn workspace_launch_model_serializes_session_default_controls() {
        let model = WorkspaceSessionLaunchModel {
            id: "sonnet".to_string(),
            display_name: "Sonnet".to_string(),
            is_default: true,
            session_default_controls: vec![SessionDefaultControl {
                key: SessionDefaultControlKey::Effort,
                label: "Effort".to_string(),
                default_value: Some("high".to_string()),
                values: vec![SessionDefaultControlValue {
                    value: "high".to_string(),
                    label: "High".to_string(),
                    description: None,
                    is_default: true,
                }],
            }],
        };

        let json = serde_json::to_value(model).expect("serialize launch model");

        assert_eq!(
            json.get("sessionDefaultControls"),
            Some(&serde_json::json!([{
                "key": "effort",
                "label": "Effort",
                "defaultValue": "high",
                "values": [{
                    "value": "high",
                    "label": "High",
                    "isDefault": true
                }]
            }]))
        );
    }
}
