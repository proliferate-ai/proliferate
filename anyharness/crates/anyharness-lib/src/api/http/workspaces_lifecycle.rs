//! Workspace retire lifecycle handlers: auth/admission → parse → ONE facade
//! call → map. The retire state machine itself lives in
//! `domains/workspaces/retire.rs` with its decisions in `retire_policy.rs`
//! (grid PR 9, structure violation #5).

use crate::api::http::workspaces_purge::admit_all_workspace_sessions;
use crate::domains::sessions::admission::SessionMutationKind;
use anyharness_contract::v1::{WorkspaceRetirePreflightResponse, WorkspaceRetireResponse};
use axum::{
    extract::{Path, State},
    Json,
};

use super::error::ApiError;
use super::workspaces_lifecycle_contract::{retire_preflight_to_contract, retire_result_to_contract};
use crate::app::AppState;

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
    let view = state.workspace_retire_service.preflight(&workspace_id).await?;
    Ok(Json(retire_preflight_to_contract(view)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/retire",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 409, description = "Session execution is controlled by an active workflow run", body = anyharness_contract::v1::ProblemDetails),
        (status = 200, description = "Retire workspace result", body = WorkspaceRetireResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retire_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetireResponse>, ApiError> {
    // Spec 2b RETIRE-01 ruling (option B): retirement can dematerialize the
    // workspace a controlled session is running in, so it fails closed like
    // purge — sorted permits for every workspace session are held across the
    // whole retirement.
    let admission =
        admit_all_workspace_sessions(&state, &workspace_id, SessionMutationKind::WorkspaceRetire)
            .await?;
    // PR1227-WORKSPACE-FENCE-02: carry the admitted id set into the under-lease
    // re-check; the permits are held until this handler returns.
    let admitted_session_ids = admission.session_ids.clone();
    let _admission_permits = admission.permits;

    let result = state
        .workspace_retire_service
        .retire(&workspace_id, admitted_session_ids)
        .await?;
    retire_result_to_contract(&state, result).await.map(Json)
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
    let result = state
        .workspace_retire_service
        .retry_cleanup(&workspace_id)
        .await?;
    retire_result_to_contract(&state, result).await.map(Json)
}
