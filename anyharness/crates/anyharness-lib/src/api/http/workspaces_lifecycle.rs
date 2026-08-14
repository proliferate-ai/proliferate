//! The two lifecycle transitions: `POST /archive` and `POST /unarchive`.
//!
//! Both handlers are thin on purpose. Every ordering guarantee — the pre-gate
//! fast path, the bounded lease, the load-row-after-lease rule, the quiesce, the
//! flip, the detached tail, the awaited cancel — lives in the archive subdomain,
//! because those orderings ARE the feature and a handler is the wrong place to
//! own them. What lives here is the wire: parse the body's resolved knobs, call
//! the facade, map the outcome.
//!
//! Neither route takes session-mutation permits, and that is a decision rather
//! than an omission. Today's destructive flows admit every session before taking
//! their lease; archive replaces that with the exclusive lease plus
//! load-row-after-lease plus quiesce, which subsume what the permits provided.
//! Taking permits would let one stuck session mutation block archiving a
//! workspace — the exact failure archiving exists to give the user a way out of.

use anyharness_contract::v1::{
    ArchiveWorkspaceRequest, ArchiveWorkspaceResponse, UnarchiveWorkspaceRequest,
    UnarchiveWorkspaceResponse,
};
use axum::extract::{Path, State};
use axum::Json;

use super::error::ApiError;
use super::workspaces_lifecycle_contract::{
    archive_options_from_request, archive_outcome_to_contract, unarchive_options_from_request,
    unarchive_outcome_to_contract,
};
use crate::app::AppState;

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/archive",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = ArchiveWorkspaceRequest,
    responses(
        (status = 200, description = "Archived the workspace", body = ArchiveWorkspaceResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "The workspace cannot be archived right now", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Archiving failed; retryable", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn archive_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    body: Option<Json<ArchiveWorkspaceRequest>>,
) -> Result<Json<ArchiveWorkspaceResponse>, ApiError> {
    // An absent body is a valid archive with both knobs off. Idempotent
    // convergence re-POSTs are the reason: they are allowed to be as bare as
    // `curl -X POST`.
    let request = body.map(|Json(request)| request).unwrap_or_default();
    let outcome = state
        .workspace_archive_service
        .archive(&workspace_id, archive_options_from_request(request))
        .await?;
    Ok(Json(archive_outcome_to_contract(&state, outcome).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/unarchive",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = UnarchiveWorkspaceRequest,
    responses(
        (status = 200, description = "Unarchived the workspace", body = UnarchiveWorkspaceResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "The restore needs a decision, or something else holds the workspace", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "The restore failed; retryable", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn unarchive_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    body: Option<Json<UnarchiveWorkspaceRequest>>,
) -> Result<Json<UnarchiveWorkspaceResponse>, ApiError> {
    let request = body.map(|Json(request)| request).unwrap_or_default();
    let outcome = state
        .workspace_archive_service
        .unarchive(&workspace_id, unarchive_options_from_request(request))
        .await?;
    Ok(Json(unarchive_outcome_to_contract(&state, outcome).await?))
}
