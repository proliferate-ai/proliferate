use anyharness_contract::v1::{
    DetectProjectSetupResponse, GetSetupStatusResponse, SetupHint, SetupHintCategory,
    SetupScriptStatus, Workspace, WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind,
    WorkspaceLifecycleState, WorkspaceSessionLaunchAgent, WorkspaceSessionLaunchCatalog,
    WorkspaceSessionLaunchModel, WorkspaceSurface,
};

use super::error::ApiError;
use crate::sessions::service::{
    WorkspaceSessionLaunchAgentData, WorkspaceSessionLaunchCatalogData,
    WorkspaceSessionLaunchModelData,
};
use crate::terminals::model::{TerminalCommandRunRecord, TerminalCommandRunStatus};
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::types::{
    DetectedHintCategory, DetectedSetupHint, ProjectSetupDetectionResult,
    SetWorkspaceDisplayNameError,
};

pub(super) fn setup_command_run_to_contract(
    run: TerminalCommandRunRecord,
) -> GetSetupStatusResponse {
    GetSetupStatusResponse {
        status: match run.status {
            TerminalCommandRunStatus::Queued => SetupScriptStatus::Queued,
            TerminalCommandRunStatus::Running => SetupScriptStatus::Running,
            TerminalCommandRunStatus::Succeeded => SetupScriptStatus::Succeeded,
            TerminalCommandRunStatus::Failed
            | TerminalCommandRunStatus::Interrupted
            | TerminalCommandRunStatus::TimedOut => SetupScriptStatus::Failed,
        },
        command: run.command,
        exit_code: run.exit_code,
        stdout: run.stdout,
        stderr: run.stderr.or_else(|| {
            if run.status == TerminalCommandRunStatus::Interrupted {
                Some("setup command interrupted".to_string())
            } else if run.status == TerminalCommandRunStatus::TimedOut {
                Some("setup command timed out".to_string())
            } else {
                None
            }
        }),
        duration_ms: run.duration_ms,
        terminal_id: run.terminal_id,
        command_run_id: Some(run.id),
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
        lifecycle_state: match record.lifecycle_state.as_str() {
            "retired" => WorkspaceLifecycleState::Retired,
            _ => WorkspaceLifecycleState::Active,
        },
        cleanup_state: match record.cleanup_state.as_str() {
            "pending" => WorkspaceCleanupState::Pending,
            "complete" => WorkspaceCleanupState::Complete,
            "failed" => WorkspaceCleanupState::Failed,
            _ => WorkspaceCleanupState::None,
        },
        cleanup_operation: workspace_cleanup_operation_to_contract(
            record.cleanup_operation.as_deref(),
        ),
        cleanup_error_message: record.cleanup_error_message,
        cleanup_failed_at: record.cleanup_failed_at,
        cleanup_attempted_at: record.cleanup_attempted_at,
        execution_summary: Some(execution_summary),
        origin: record
            .origin
            .as_ref()
            .map(crate::origin::OriginContext::to_contract),
        creator_context: record
            .creator_context
            .as_ref()
            .map(crate::workspaces::creator_context::WorkspaceCreatorContext::to_contract),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

pub(super) fn workspace_cleanup_operation_to_contract(
    operation: Option<&str>,
) -> Option<WorkspaceCleanupOperation> {
    match operation {
        Some("retire") => Some(WorkspaceCleanupOperation::Retire),
        Some("purge") => Some(WorkspaceCleanupOperation::Purge),
        _ => None,
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
