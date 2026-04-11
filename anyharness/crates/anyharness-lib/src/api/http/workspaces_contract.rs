use anyharness_contract::v1::{
    DetectProjectSetupResponse, GetSetupStatusResponse, SetupHint, SetupHintCategory,
    SetupScriptStatus, Workspace, WorkspaceKind, WorkspaceSessionLaunchAgent,
    WorkspaceSessionLaunchCatalog, WorkspaceSessionLaunchModel, WorkspaceSurface,
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
    SetWorkspaceDisplayNameError,
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

pub(crate) fn detection_result_to_contract(
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
    let repo_root_id = record
        .repo_root_id
        .clone()
        .unwrap_or_else(|| record.id.clone());
    Workspace {
        id: record.id,
        kind: match record.kind.as_str() {
            "worktree" => WorkspaceKind::Worktree,
            _ => WorkspaceKind::Local,
        },
        repo_root_id,
        path: record.path,
        surface: match record.surface.as_str() {
            "cowork" => WorkspaceSurface::Cowork,
            _ => WorkspaceSurface::Standard,
        },
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
