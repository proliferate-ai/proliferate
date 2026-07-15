use anyharness_contract::v1::{
    DetectProjectSetupResponse, GetSetupStatusResponse, RepoRoot, RepoRootKind,
    ResolveWorkspaceResponse, SetupHint, SetupHintCategory, SetupScriptStatus, Workspace,
    WorkspaceAvailability, WorkspaceCleanupOperation as ContractWorkspaceCleanupOperation,
    WorkspaceCleanupState as ContractWorkspaceCleanupState, WorkspaceKind as ContractWorkspaceKind,
    WorkspaceLifecycleState as ContractWorkspaceLifecycleState,
    WorkspaceSurface as ContractWorkspaceSurface,
};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::terminals::model::{TerminalCommandRunRecord, TerminalCommandRunStatus};
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorkspaceSurface,
};
use crate::domains::workspaces::runtime::WorkspaceResolution;
use crate::domains::workspaces::types::{
    DetectedHintCategory, DetectedSetupHint, ProjectSetupDetectionResult,
    SetWorkspaceDisplayNameError,
};
use crate::origin::OriginContext;

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

pub(super) async fn resolve_workspace_response_to_contract(
    state: &AppState,
    result: WorkspaceResolution,
) -> Result<ResolveWorkspaceResponse, ApiError> {
    Ok(ResolveWorkspaceResponse {
        repo_root: repo_root_to_contract(result.repo_root),
        workspace: workspace_to_contract(state, result.workspace).await?,
    })
}

pub(crate) async fn workspace_to_contract(
    state: &AppState,
    record: WorkspaceRecord,
) -> Result<Workspace, ApiError> {
    let execution_summary = state
        .session_runtime
        .workspace_execution_summary(&record.id)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(workspace_to_contract_with_summary(
        record,
        execution_summary,
    ))
}

pub(super) fn workspace_to_contract_with_summary(
    record: WorkspaceRecord,
    execution_summary: anyharness_contract::v1::WorkspaceExecutionSummary,
) -> Workspace {
    // Only local-checkout workspaces (`Local`/`Worktree`) can report a missing
    // directory; the predicate is shared with the session-creation pre-flight
    // gate so both surface the same condition.
    let availability = if record.checkout_directory_missing() {
        WorkspaceAvailability::WorkspaceDirectoryMissing
    } else {
        WorkspaceAvailability::Available
    };
    Workspace {
        id: record.id,
        kind: workspace_kind_to_contract(record.kind),
        repo_root_id: record.repo_root_id,
        path: record.path,
        surface: workspace_surface_to_contract(record.surface),
        availability,
        original_branch: record.original_branch,
        current_branch: record.current_branch,
        display_name: record.display_name,
        lifecycle_state: workspace_lifecycle_to_contract(record.lifecycle_state),
        cleanup_state: workspace_cleanup_to_contract(record.cleanup_state),
        cleanup_operation: record
            .cleanup_operation
            .map(workspace_cleanup_operation_to_contract),
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
            .map(crate::domains::workspaces::creator_context::WorkspaceCreatorContext::to_contract),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

pub(super) fn workspace_kind_to_contract(kind: WorkspaceKind) -> ContractWorkspaceKind {
    match kind {
        WorkspaceKind::Local => ContractWorkspaceKind::Local,
        WorkspaceKind::Worktree => ContractWorkspaceKind::Worktree,
    }
}

pub(super) fn workspace_surface_to_contract(surface: WorkspaceSurface) -> ContractWorkspaceSurface {
    match surface {
        WorkspaceSurface::Standard => ContractWorkspaceSurface::Standard,
        WorkspaceSurface::Cowork => ContractWorkspaceSurface::Cowork,
    }
}

pub(super) fn workspace_lifecycle_to_contract(
    value: WorkspaceLifecycleState,
) -> ContractWorkspaceLifecycleState {
    match value {
        WorkspaceLifecycleState::Active => ContractWorkspaceLifecycleState::Active,
        WorkspaceLifecycleState::Retired => ContractWorkspaceLifecycleState::Retired,
    }
}

pub(super) fn workspace_cleanup_to_contract(
    value: WorkspaceCleanupState,
) -> ContractWorkspaceCleanupState {
    match value {
        WorkspaceCleanupState::None => ContractWorkspaceCleanupState::None,
        WorkspaceCleanupState::Pending => ContractWorkspaceCleanupState::Pending,
        WorkspaceCleanupState::Complete => ContractWorkspaceCleanupState::Complete,
        WorkspaceCleanupState::Failed => ContractWorkspaceCleanupState::Failed,
    }
}

pub(super) fn workspace_cleanup_operation_to_contract(
    operation: WorkspaceCleanupOperation,
) -> ContractWorkspaceCleanupOperation {
    match operation {
        WorkspaceCleanupOperation::Retire => ContractWorkspaceCleanupOperation::Retire,
        WorkspaceCleanupOperation::Purge => ContractWorkspaceCleanupOperation::Purge,
    }
}

pub(super) fn request_origin_or_api_default(
    origin: Option<anyharness_contract::v1::OriginContext>,
    operation: &'static str,
) -> OriginContext {
    match origin {
        Some(origin) => OriginContext::from_contract(origin),
        None => {
            tracing::warn!(
                operation,
                "AnyHarness request omitted origin; defaulting to api/local_runtime"
            );
            OriginContext::api_local_runtime()
        }
    }
}

fn repo_root_to_contract(record: RepoRootRecord) -> RepoRoot {
    RepoRoot {
        id: record.id,
        kind: match record.kind.as_str() {
            "managed" => RepoRootKind::Managed,
            _ => RepoRootKind::External,
        },
        path: record.path,
        display_name: record.display_name,
        default_branch: record.default_branch,
        remote_provider: record.remote_provider,
        remote_owner: record.remote_owner,
        remote_repo_name: record.remote_repo_name,
        remote_url: record.remote_url,
        created_at: record.created_at,
        updated_at: record.updated_at,
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

#[cfg(test)]
mod tests {
    use anyharness_contract::v1::{WorkspaceExecutionPhase, WorkspaceExecutionSummary};

    use super::*;

    fn empty_summary() -> WorkspaceExecutionSummary {
        WorkspaceExecutionSummary {
            phase: WorkspaceExecutionPhase::Idle,
            total_session_count: 0,
            live_session_count: 0,
            running_count: 0,
            awaiting_interaction_count: 0,
            idle_count: 0,
            errored_count: 0,
            updated_at: None,
        }
    }

    fn record(kind: WorkspaceKind, path: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind,
            repo_root_id: "repo-root-1".to_string(),
            path: path.to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: None,
            current_branch: None,
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn contract_reports_missing_directory_for_deleted_local_checkout() {
        let path = std::env::temp_dir().join(format!(
            "anyharness-workspace-contract-missing-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = workspace_to_contract_with_summary(
            record(WorkspaceKind::Worktree, &path.to_string_lossy()),
            empty_summary(),
        );
        assert_eq!(
            workspace.availability,
            WorkspaceAvailability::WorkspaceDirectoryMissing
        );
    }

    #[test]
    fn contract_reports_available_when_checkout_present() {
        let dir = std::env::temp_dir().join(format!(
            "anyharness-workspace-contract-present-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let workspace = workspace_to_contract_with_summary(
            record(WorkspaceKind::Local, &dir.to_string_lossy()),
            empty_summary(),
        );
        assert_eq!(workspace.availability, WorkspaceAvailability::Available);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
