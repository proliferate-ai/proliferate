use anyharness_contract::v1::{
    DetectProjectSetupResponse, GetSetupStatusResponse, StartWorkspaceSetupRequest,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::access::{assert_workspace_not_retired, map_access_error};
use super::blocking::run_blocking;
use super::error::ApiError;
use super::workspaces_contract::{detection_result_to_contract, setup_command_run_to_contract};
use crate::app::AppState;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::domains::workspaces::setup_runtime::{StartWorkspaceSetupInput, WorkspaceSetupError};

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/detect-setup",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Detected project setup hints", body = DetectProjectSetupResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn detect_project_setup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<DetectProjectSetupResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
    let workspace_runtime = state.workspace_runtime.clone();
    let result = run_blocking("detect-setup", move || {
        workspace_runtime.detect_setup(&workspace_id)
    })
    .await?
    .map_err(|e| {
        if e.to_string().contains("not found") {
            ApiError::not_found(e.to_string(), "WORKSPACE_NOT_FOUND")
        } else {
            ApiError::internal(e.to_string())
        }
    })?;
    Ok(Json(detection_result_to_contract(result)))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/setup-status",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Setup execution status", body = GetSetupStatusResponse),
        (status = 404, description = "No setup execution found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn get_setup_status(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<GetSetupStatusResponse>, ApiError> {
    let run = state
        .workspace_setup_runtime
        .latest_setup_run(&workspace_id)
        .map_err(map_workspace_setup_error)?
        .ok_or_else(|| {
            ApiError::not_found(
                "No setup execution found for this workspace".to_string(),
                "SETUP_NOT_FOUND",
            )
        })?;

    Ok(Json(setup_command_run_to_contract(run)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/setup-rerun",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Setup execution restarted", body = GetSetupStatusResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "No setup script configured", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn rerun_setup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<GetSetupStatusResponse>, ApiError> {
    let run = state
        .workspace_setup_runtime
        .rerun_setup(workspace_id)
        .await
        .map_err(map_workspace_setup_error)?;
    Ok(Json(setup_command_run_to_contract(run)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/setup-start",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = StartWorkspaceSetupRequest,
    responses(
        (status = 200, description = "Setup execution started", body = GetSetupStatusResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Invalid setup command", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn start_setup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<StartWorkspaceSetupRequest>,
) -> Result<Json<GetSetupStatusResponse>, ApiError> {
    let run = state
        .workspace_setup_runtime
        .start_setup(StartWorkspaceSetupInput {
            workspace_id,
            command: req.command,
            base_ref: req.base_ref,
        })
        .await
        .map_err(map_workspace_setup_error)?;
    Ok(Json(setup_command_run_to_contract(run)))
}

pub(super) fn map_workspace_setup_error(error: WorkspaceSetupError) -> ApiError {
    match error {
        WorkspaceSetupError::InvalidCommand => {
            ApiError::bad_request("Setup command must not be empty.", "INVALID_SETUP_COMMAND")
        }
        WorkspaceSetupError::WorkspaceNotFound(_) => {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        }
        WorkspaceSetupError::SetupNotFound => ApiError::not_found(
            "No previous setup execution found for this workspace".to_string(),
            "SETUP_NOT_FOUND",
        ),
        WorkspaceSetupError::Access(error) => map_access_error(error),
        WorkspaceSetupError::TaskFailed(error) => {
            ApiError::internal(format!("workspace setup task failed: {error}"))
        }
        WorkspaceSetupError::Unexpected(error) => ApiError::internal(error.to_string()),
    }
}
