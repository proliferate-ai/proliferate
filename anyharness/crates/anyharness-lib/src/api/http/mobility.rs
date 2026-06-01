use anyharness_contract::v1::{
    DestroyWorkspaceMobilitySourceRequest, DestroyWorkspaceMobilitySourceResponse,
    ExportWorkspaceMobilityArchiveRequest, InstallWorkspaceMobilityArchiveRequest,
    InstallWorkspaceMobilityArchiveResponse, UpdateWorkspaceMobilityRuntimeStateRequest,
    WorkspaceMobilityArchive, WorkspaceMobilityPreflightResponse, WorkspaceMobilityRuntimeState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use std::time::Instant;

use super::access::assert_workspace_not_retired;
use super::blocking::run_blocking;
use super::error::ApiError;
use super::mobility_archive_contract::from_contract_archive;
use super::mobility_contract::{
    to_contract_archive, to_contract_install_summary, to_contract_preflight,
};
use crate::app::AppState;
use crate::domains::mobility::model::WorkspaceMobilityExportOptions;
use crate::domains::mobility::service::MobilityError;
use crate::domains::workspaces::access_gate::WorkspaceAccessError;
use crate::domains::workspaces::access_model::WorkspaceAccessMode;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};

pub const MAX_MOBILITY_ARCHIVE_BODY_BYTES: usize =
    crate::domains::mobility::model::MAX_MOBILITY_ARCHIVE_BODY_BYTES;

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/preflight",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace mobility preflight", body = WorkspaceMobilityPreflightResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn preflight_workspace_mobility(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<WorkspaceMobilityPreflightResponse>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    tracing::info!(
        session_id = tracing::field::Empty,
        workspace_id = %workspace_id,
        flow_id = ?latency_fields.flow_id,
        flow_kind = ?latency_fields.flow_kind,
        flow_source = ?latency_fields.flow_source,
        prompt_id = ?latency_fields.prompt_id,
        "[workspace-latency] mobility.http.preflight.request_received"
    );
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
    let result = state
        .mobility_service
        .preflight_workspace(&workspace_id, &[])
        .await
        .map_err(map_mobility_error)?;
    tracing::info!(
        session_id = tracing::field::Empty,
        workspace_id = %workspace_id,
        can_move = result.can_move,
        blocker_count = result.blockers.len(),
        warning_count = result.warnings.len(),
        archive_estimated_bytes = result.archive_estimated_bytes.unwrap_or_default(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        flow_id = ?latency_fields.flow_id,
        flow_kind = ?latency_fields.flow_kind,
        flow_source = ?latency_fields.flow_source,
        prompt_id = ?latency_fields.prompt_id,
        "[workspace-latency] mobility.http.preflight.completed"
    );
    Ok(Json(to_contract_preflight(result)))
}

#[utoipa::path(
    put,
    path = "/v1/workspaces/{workspace_id}/mobility/runtime-state",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = UpdateWorkspaceMobilityRuntimeStateRequest,
    responses(
        (status = 200, description = "Workspace mobility runtime state", body = WorkspaceMobilityRuntimeState),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn update_workspace_mobility_runtime_state(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<UpdateWorkspaceMobilityRuntimeStateRequest>,
) -> Result<Json<WorkspaceMobilityRuntimeState>, ApiError> {
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MobilityWrite)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
    let record = state
        .workspace_access_gate
        .set_runtime_state(
            &workspace_id,
            WorkspaceAccessMode::from_contract(req.mode),
            req.handoff_op_id,
        )
        .map_err(map_access_error)?;
    Ok(Json(record.to_contract()))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/export",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = ExportWorkspaceMobilityArchiveRequest,
    responses(
        (status = 200, description = "Workspace mobility archive", body = WorkspaceMobilityArchive),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn export_workspace_mobility_archive(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<ExportWorkspaceMobilityArchiveRequest>,
) -> Result<Json<WorkspaceMobilityArchive>, ApiError> {
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MobilityWrite)
        .await;
    assert_workspace_mode(
        &state,
        &workspace_id,
        WorkspaceAccessMode::FrozenForHandoff,
        req.expected_handoff_op_id.as_deref(),
    )?;
    if !req.require_clean_git_state {
        return Err(ApiError::bad_request(
            "requireCleanGitState is required for mobility exports".to_string(),
            "MOBILITY_EXPORT_CLEAN_GIT_REQUIRED",
        ));
    }
    if req
        .expected_handoff_op_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        return Err(ApiError::bad_request(
            "expectedHandoffOpId is required when requireCleanGitState is true".to_string(),
            "MOBILITY_EXPORT_EXPECTED_HANDOFF_REQUIRED",
        ));
    }
    if req
        .expected_base_commit_sha
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        return Err(ApiError::bad_request(
            "expectedBaseCommitSha is required for mobility exports".to_string(),
            "MOBILITY_EXPORT_EXPECTED_BASE_REQUIRED",
        ));
    }
    if req
        .expected_branch_name
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        return Err(ApiError::bad_request(
            "expectedBranchName is required for mobility exports".to_string(),
            "MOBILITY_EXPORT_EXPECTED_BRANCH_REQUIRED",
        ));
    }
    let mobility_service = state.mobility_service.clone();
    let export_options = WorkspaceMobilityExportOptions {
        exclude_paths: req.exclude_paths,
        expected_base_commit_sha: req.expected_base_commit_sha,
        expected_branch_name: req.expected_branch_name,
        expected_handoff_op_id: req.expected_handoff_op_id,
        require_clean_git_state: req.require_clean_git_state,
    };
    let archive = run_blocking("mobility_export", move || {
        mobility_service.export_workspace_archive(&workspace_id, &export_options)
    })
    .await?
    .map_err(map_mobility_error)?;

    Ok(Json(to_contract_archive(archive)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/install",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = InstallWorkspaceMobilityArchiveRequest,
    responses(
        (status = 200, description = "Archive installed", body = InstallWorkspaceMobilityArchiveResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn install_workspace_mobility_archive(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<InstallWorkspaceMobilityArchiveRequest>,
) -> Result<Json<InstallWorkspaceMobilityArchiveResponse>, ApiError> {
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MobilityWrite)
        .await;
    state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(&workspace_id)
        .map_err(map_access_error)?;
    let mobility_service = state.mobility_service.clone();
    let operation_id = req.operation_id;
    let archive = from_contract_archive(
        req.archive,
        &workspace_id,
        state.session_service.attachment_storage(),
    )?;
    let summary = run_blocking("mobility_install", move || {
        mobility_service.install_workspace_archive(&workspace_id, &archive, operation_id.as_deref())
    })
    .await?
    .map_err(map_mobility_error)?;

    Ok(Json(to_contract_install_summary(summary)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/destroy-source",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = DestroyWorkspaceMobilitySourceRequest,
    responses(
        (status = 200, description = "Destroyed the old workspace source materialization", body = DestroyWorkspaceMobilitySourceResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn destroy_workspace_mobility_source(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(_req): Json<DestroyWorkspaceMobilitySourceRequest>,
) -> Result<Json<DestroyWorkspaceMobilitySourceResponse>, ApiError> {
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MobilityWrite)
        .await;
    assert_workspace_mode(
        &state,
        &workspace_id,
        WorkspaceAccessMode::RemoteOwned,
        None,
    )?;
    let mobility_service = state.mobility_service.clone();
    let workspace_id_for_destroy = workspace_id.clone();
    let summary = run_blocking("mobility_destroy_source", move || {
        mobility_service.destroy_source_workspace(&workspace_id_for_destroy)
    })
    .await?
    .map_err(map_mobility_error)?;

    Ok(Json(DestroyWorkspaceMobilitySourceResponse {
        workspace_id,
        deleted_session_ids: summary.deleted_session_ids,
        closed_terminal_ids: summary.closed_terminal_ids,
        source_destroyed: summary.source_destroyed,
    }))
}

fn map_access_error(error: WorkspaceAccessError) -> ApiError {
    match error {
        WorkspaceAccessError::WorkspaceNotFound(id) => {
            ApiError::not_found(format!("workspace not found: {id}"), "WORKSPACE_NOT_FOUND")
        }
        WorkspaceAccessError::SessionNotFound(id) => {
            ApiError::not_found(format!("session not found: {id}"), "SESSION_NOT_FOUND")
        }
        WorkspaceAccessError::TerminalNotFound(id) => {
            ApiError::not_found(format!("terminal not found: {id}"), "TERMINAL_NOT_FOUND")
        }
        WorkspaceAccessError::MutationBlocked { workspace_id, mode } => ApiError::conflict(
            format!(
                "workspace {workspace_id} is not writable while mode={}",
                mode.as_str()
            ),
            "WORKSPACE_MUTATION_BLOCKED",
        ),
        WorkspaceAccessError::LiveSessionStartBlocked { workspace_id, mode } => ApiError::conflict(
            format!(
                "workspace {workspace_id} cannot start live sessions while mode={}",
                mode.as_str()
            ),
            "WORKSPACE_LIVE_SESSION_BLOCKED",
        ),
        WorkspaceAccessError::WorkspaceRetired(workspace_id) => ApiError::conflict(
            format!("workspace {workspace_id} is retired"),
            "WORKSPACE_RETIRED",
        ),
    }
}

fn assert_workspace_mode(
    state: &AppState,
    workspace_id: &str,
    expected_mode: WorkspaceAccessMode,
    expected_handoff_op_id: Option<&str>,
) -> Result<(), ApiError> {
    assert_workspace_not_retired(state, workspace_id)?;
    let runtime_state = state
        .workspace_access_gate
        .runtime_state(workspace_id)
        .map_err(map_access_error)?;
    if runtime_state.mode == expected_mode {
        if let Some(expected_handoff_op_id) = expected_handoff_op_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if runtime_state.handoff_op_id.as_deref() != Some(expected_handoff_op_id) {
                return Err(ApiError::conflict(
                    format!(
                        "workspace {workspace_id} must be in {} mode for handoff {expected_handoff_op_id}",
                        expected_mode.as_str()
                    ),
                    "WORKSPACE_MOBILITY_HANDOFF_MISMATCH",
                ));
            }
        }
        return Ok(());
    }

    Err(ApiError::conflict(
        format!(
            "workspace {workspace_id} must be in {} mode, found {}",
            expected_mode.as_str(),
            runtime_state.mode.as_str()
        ),
        "WORKSPACE_MOBILITY_MODE_MISMATCH",
    ))
}

fn map_mobility_error(error: MobilityError) -> ApiError {
    match error {
        MobilityError::WorkspaceNotFound(_) => {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        }
        MobilityError::BaseCommitMismatch { archive, destination } => ApiError::conflict(
            format!(
                "Destination workspace HEAD did not match archive base commit (destination={destination}, archive={archive})"
            ),
            "MOBILITY_BASE_COMMIT_MISMATCH",
        ),
        MobilityError::SessionAlreadyExists(session_id) => ApiError::conflict(
            format!("Session already exists in destination workspace: {session_id}"),
            "MOBILITY_SESSION_EXISTS",
        ),
        MobilityError::NotGitWorkspace(detail)
        | MobilityError::Invalid(detail)
        | MobilityError::SizeLimitExceeded(detail) => {
            ApiError::bad_request(detail, "MOBILITY_INVALID")
        }
        MobilityError::DestinationConflict(detail) => {
            ApiError::conflict(detail, "MOBILITY_DESTINATION_CONFLICT")
        }
        MobilityError::Internal(error) => ApiError::internal(error.to_string()),
    }
}
