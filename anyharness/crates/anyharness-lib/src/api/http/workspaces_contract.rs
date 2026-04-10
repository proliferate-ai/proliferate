use anyharness_contract::v1::{
    DetectProjectSetupResponse, GetSetupStatusResponse, SetupHint, SetupHintCategory,
    SetupScriptStatus, Workspace, WorkspaceKind, WorkspaceSessionLaunchAgent,
    WorkspaceSessionLaunchCatalog, WorkspaceSessionLaunchModel,
};

use super::error::ApiError;
use crate::sessions::service::{
    WorkspaceSessionLaunchAgentData, WorkspaceSessionLaunchCatalogData,
    WorkspaceSessionLaunchModelData,
};
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::setup_execution::{SetupJobSnapshot, SetupJobStatus};
use crate::workspaces::types::{
    DetectedHintCategory, DetectedSetupHint, ProjectSetupDetectionResult,
    RegisterRepoWorkspaceError, SetWorkspaceDisplayNameError,
};

pub(super) fn setup_snapshot_to_contract(snapshot: SetupJobSnapshot) -> GetSetupStatusResponse {
    GetSetupStatusResponse {
        status: match snapshot.status {
            SetupJobStatus::Queued => SetupScriptStatus::Queued,
            SetupJobStatus::Running => SetupScriptStatus::Running,
            SetupJobStatus::Succeeded => SetupScriptStatus::Succeeded,
            SetupJobStatus::Failed => SetupScriptStatus::Failed,
        },
        command: snapshot.command,
        exit_code: snapshot.exit_code,
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
        duration_ms: snapshot.duration_ms,
    }
}

pub(super) fn detection_result_to_contract(
    result: ProjectSetupDetectionResult,
) -> DetectProjectSetupResponse {
    DetectProjectSetupResponse {
        hints: result
            .hints
            .into_iter()
            .map(setup_hint_to_contract)
            .collect(),
    }
}

pub(super) fn map_register_repo_workspace_error(error: RegisterRepoWorkspaceError) -> ApiError {
    match error {
        RegisterRepoWorkspaceError::NotGitRepo => ApiError::bad_request(
            "Selected folder is not a Git repository.",
            "REPO_WORKSPACE_NOT_GIT_REPO",
        ),
        RegisterRepoWorkspaceError::WorktreeNotAllowed => ApiError::bad_request(
            "Select the main repository root, not a worktree.",
            "REPO_WORKSPACE_WORKTREE_UNSUPPORTED",
        ),
        RegisterRepoWorkspaceError::Unexpected(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn map_set_workspace_display_name_error(
    error: SetWorkspaceDisplayNameError,
) -> ApiError {
    match error {
        SetWorkspaceDisplayNameError::NotFound(workspace_id) => ApiError::not_found(
            format!("Workspace not found: {workspace_id}"),
            "WORKSPACE_NOT_FOUND",
        ),
        SetWorkspaceDisplayNameError::TooLong(limit) => ApiError::bad_request(
            format!("workspace display name cannot exceed {limit} characters"),
            "WORKSPACE_DISPLAY_NAME_TOO_LONG",
        ),
        SetWorkspaceDisplayNameError::Unexpected(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn workspace_to_contract_with_summary(
    record: WorkspaceRecord,
    execution_summary: anyharness_contract::v1::WorkspaceExecutionSummary,
) -> Workspace {
    Workspace {
        id: record.id,
        kind: match record.kind.as_str() {
            "worktree" => WorkspaceKind::Worktree,
            "local" => WorkspaceKind::Local,
            _ => WorkspaceKind::Repo,
        },
        path: record.path,
        source_repo_root_path: record.source_repo_root_path,
        source_workspace_id: record.source_workspace_id,
        git_provider: record.git_provider,
        git_owner: record.git_owner,
        git_repo_name: record.git_repo_name,
        original_branch: record.original_branch,
        current_branch: record.current_branch,
        display_name: record.display_name,
        execution_summary: Some(execution_summary),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

pub(super) fn workspace_session_launch_catalog_to_contract(
    catalog: WorkspaceSessionLaunchCatalogData,
) -> WorkspaceSessionLaunchCatalog {
    WorkspaceSessionLaunchCatalog {
        workspace_id: catalog.workspace_id,
        agents: catalog
            .agents
            .into_iter()
            .map(workspace_session_launch_agent_to_contract)
            .collect(),
    }
}

fn setup_hint_to_contract(hint: DetectedSetupHint) -> SetupHint {
    SetupHint {
        id: hint.id,
        label: hint.label,
        suggested_command: hint.suggested_command,
        detected_file: hint.detected_file,
        category: match hint.category {
            DetectedHintCategory::BuildTool => SetupHintCategory::BuildTool,
            DetectedHintCategory::SecretSync => SetupHintCategory::SecretSync,
        },
    }
}

fn workspace_session_launch_agent_to_contract(
    agent: WorkspaceSessionLaunchAgentData,
) -> WorkspaceSessionLaunchAgent {
    WorkspaceSessionLaunchAgent {
        kind: agent.kind,
        display_name: agent.display_name,
        default_model_id: agent.default_model_id,
        models: agent
            .models
            .into_iter()
            .map(workspace_session_launch_model_to_contract)
            .collect(),
    }
}

fn workspace_session_launch_model_to_contract(
    model: WorkspaceSessionLaunchModelData,
) -> WorkspaceSessionLaunchModel {
    WorkspaceSessionLaunchModel {
        id: model.id,
        display_name: model.display_name,
        is_default: model.is_default,
    }
}
