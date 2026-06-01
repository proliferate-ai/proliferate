use anyharness_contract::v1::{
    Workspace, WorkspaceRetireBlocker, WorkspaceRetireBlockerCode, WorkspaceRetireBlockerSeverity,
    WorkspaceRetireOutcome, WorkspaceRetirePreflightResponse, WorkspaceRetireResponse,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::blocking::run_blocking;
use super::error::ApiError;
use super::workspaces_contract::workspace_to_contract;
use crate::app::AppState;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::retire_preflight::RetirePreflightMode;

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/retire/preflight",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Retire preflight", body = WorkspaceRetirePreflightResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retire_workspace_preflight(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetirePreflightResponse>, ApiError> {
    Ok(Json(build_retire_preflight(&state, &workspace_id).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/retire",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Retire workspace result", body = WorkspaceRetireResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retire_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetireResponse>, ApiError> {
    let current = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if current.lifecycle_state == "retired" {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        if current.cleanup_operation.as_deref() == Some("purge") {
            return Ok(Json(WorkspaceRetireResponse {
                workspace: workspace_to_contract(&state, current).await?,
                outcome: WorkspaceRetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(
                    "workspace is in purge cleanup state; use purge retry instead".to_string(),
                ),
            }));
        }
        let cleanup_succeeded = current.cleanup_state == "complete";
        let cleanup_message = retired_cleanup_message(&current);
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, current).await?,
            outcome: WorkspaceRetireOutcome::AlreadyRetired,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded,
            cleanup_message,
        }));
    }

    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.can_retire {
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }

    let _exclusive = state
        .workspace_operation_gate
        .acquire_exclusive(&workspace_id)
        .await;
    let workspace = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if workspace.lifecycle_state == "retired" {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        if workspace.cleanup_operation.as_deref() == Some("purge") {
            return Ok(Json(WorkspaceRetireResponse {
                workspace: workspace_to_contract(&state, workspace).await?,
                outcome: WorkspaceRetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(
                    "workspace is in purge cleanup state; use purge retry instead".to_string(),
                ),
            }));
        }
        let cleanup_succeeded = workspace.cleanup_state == "complete";
        let cleanup_message = retired_cleanup_message(&workspace);
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::AlreadyRetired,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded,
            cleanup_message,
        }));
    }
    if state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(&workspace_id)
        .is_err()
    {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }

    let mut preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.can_retire {
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }
    if let Some(active) = state
        .workspace_runtime
        .find_active_worktree_by_path_excluding_id(&workspace.path, &workspace.id)
        .map_err(|e| ApiError::internal(e.to_string()))?
    {
        preflight.can_retire = false;
        preflight
            .blockers
            .push(active_path_owner_retire_blocker(&active));
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(format!(
                "cleanup blocked because active workspace {} also owns path {}",
                active.id, active.path
            )),
        }));
    }

    let attempted_at = chrono::Utc::now().to_rfc3339();
    let pending = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            "pending",
            Some("retire"),
            None,
            None,
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;

    let cleanup_result = {
        let runtime = state.workspace_runtime.clone();
        let workspace = pending.clone();
        run_blocking("retire worktree cleanup", move || {
            runtime.retire_worktree_materialization(&workspace)
        })
        .await?
    };

    let (outcome, cleanup_succeeded, cleanup_message, cleanup_state, error_at) =
        match cleanup_result {
            Ok(()) => (
                WorkspaceRetireOutcome::Retired,
                true,
                None,
                "complete",
                None,
            ),
            Err(error) => {
                let message = error.to_string();
                (
                    WorkspaceRetireOutcome::CleanupFailed,
                    false,
                    Some(message),
                    "failed",
                    Some(chrono::Utc::now().to_rfc3339()),
                )
            }
        };
    let final_record = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            cleanup_state,
            Some("retire"),
            cleanup_message.as_deref(),
            error_at.as_deref(),
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;

    Ok(Json(WorkspaceRetireResponse {
        workspace: workspace_to_contract(&state, final_record).await?,
        outcome,
        preflight,
        cleanup_attempted: true,
        cleanup_succeeded,
        cleanup_message,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/retire/cleanup-retry",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Cleanup retry result", body = WorkspaceRetireResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retry_retire_cleanup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetireResponse>, ApiError> {
    let workspace = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if workspace.lifecycle_state != "retired"
        || !matches!(workspace.cleanup_state.as_str(), "failed" | "pending")
        || workspace.cleanup_operation.as_deref() == Some("purge")
    {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some("cleanup retry is only available for retired workspaces with pending or failed cleanup".to_string()),
        }));
    }

    let _exclusive = state
        .workspace_operation_gate
        .acquire_exclusive(&workspace_id)
        .await;
    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.blockers.is_empty() {
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(
                "cleanup retry blocked because workspace safety preflight failed".to_string(),
            ),
        }));
    }
    if let Some(active) = state
        .workspace_runtime
        .find_active_worktree_by_path_excluding_id(&workspace.path, &workspace.id)
        .map_err(|e| ApiError::internal(e.to_string()))?
    {
        let mut preflight = build_retire_preflight(&state, &workspace_id).await?;
        preflight
            .blockers
            .push(active_path_owner_retire_blocker(&active));
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(format!(
                "cleanup retry blocked because active workspace {} now owns path {}",
                active.id, active.path
            )),
        }));
    }
    let attempted_at = chrono::Utc::now().to_rfc3339();
    let _ = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            "pending",
            Some("retire"),
            None,
            None,
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let cleanup_result = {
        let runtime = state.workspace_runtime.clone();
        let workspace = workspace.clone();
        run_blocking("retire cleanup retry", move || {
            runtime.retire_worktree_materialization(&workspace)
        })
        .await?
    };
    let (outcome, cleanup_succeeded, cleanup_message, cleanup_state, error_at) =
        match cleanup_result {
            Ok(()) => (
                WorkspaceRetireOutcome::Retired,
                true,
                None,
                "complete",
                None,
            ),
            Err(error) => {
                let message = error.to_string();
                (
                    WorkspaceRetireOutcome::CleanupFailed,
                    false,
                    Some(message),
                    "failed",
                    Some(chrono::Utc::now().to_rfc3339()),
                )
            }
        };
    let final_record = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            cleanup_state,
            Some("retire"),
            cleanup_message.as_deref(),
            error_at.as_deref(),
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    Ok(Json(WorkspaceRetireResponse {
        workspace: workspace_to_contract(&state, final_record).await?,
        outcome,
        preflight,
        cleanup_attempted: true,
        cleanup_succeeded,
        cleanup_message,
    }))
}

async fn build_retire_preflight(
    state: &AppState,
    workspace_id: &str,
) -> Result<WorkspaceRetirePreflightResponse, ApiError> {
    let current = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let mode = if current.lifecycle_state == "retired"
        && matches!(current.cleanup_state.as_str(), "pending" | "failed")
        && current.cleanup_operation.as_deref() != Some("purge")
    {
        RetirePreflightMode::RetiredCleanupRetry
    } else {
        RetirePreflightMode::ActiveRetire
    };
    let result = state
        .retire_preflight_checker
        .check_workspace(current, mode)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(WorkspaceRetirePreflightResponse {
        workspace_id: result.workspace.id,
        workspace_kind: result.workspace_kind,
        lifecycle_state: result.lifecycle_state,
        cleanup_state: result.cleanup_state,
        cleanup_operation: result.cleanup_operation,
        can_retire: result.can_retire && mode == RetirePreflightMode::ActiveRetire,
        materialized: result.materialized,
        merged_into_base: result.merged_into_base,
        base_ref: result.base_ref,
        base_oid: result.base_oid,
        head_oid: result.head_oid,
        head_matches_base: result.head_matches_base,
        readiness_fingerprint: result.readiness_fingerprint,
        blockers: result.blockers,
    })
}

async fn workspace_contract_by_id(
    state: &AppState,
    workspace_id: &str,
) -> Result<Workspace, ApiError> {
    let record = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    workspace_to_contract(state, record).await
}

fn active_path_owner_retire_blocker(active: &WorkspaceRecord) -> WorkspaceRetireBlocker {
    WorkspaceRetireBlocker {
        code: WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
        message: format!(
            "Another active workspace ({}) owns checkout path {}.",
            active.id, active.path
        ),
        severity: WorkspaceRetireBlockerSeverity::Blocking,
        retryable: true,
        session_id: None,
        terminal_id: None,
        command_run_id: None,
        path: Some(active.path.clone()),
        paths: None,
        operation: None,
    }
}

fn retired_cleanup_message(workspace: &WorkspaceRecord) -> Option<String> {
    match workspace.cleanup_state.as_str() {
        "complete" => None,
        "failed" => workspace
            .cleanup_error_message
            .clone()
            .or_else(|| Some("retired workspace cleanup failed".to_string())),
        "pending" => Some("retired workspace cleanup is still pending".to_string()),
        _ => Some(format!(
            "retired workspace cleanup is not complete: {}",
            workspace.cleanup_state
        )),
    }
}
