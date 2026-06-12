use std::time::Instant;

use anyharness_contract::v1::{
    CreateWorkspaceRequest, ResolveWorkspaceFromPathRequest, ResolveWorkspaceResponse,
    UpdateWorkspaceDisplayNameRequest, Workspace,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};

use super::access::{assert_workspace_auth_scope, assert_workspace_mutable};
use super::blocking::run_blocking;
use super::error::ApiError;
use super::workspaces_contract::{
    map_set_workspace_display_name_error, request_origin_or_api_default,
    resolve_workspace_response_to_contract, workspace_to_contract,
    workspace_to_contract_with_summary,
};
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::sessions::execution_summary::idle_workspace_execution_summary;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

#[utoipa::path(
    post,
    path = "/v1/workspaces/resolve",
    request_body = ResolveWorkspaceFromPathRequest,
    responses(
        (status = 200, description = "Resolved workspace", body = ResolveWorkspaceResponse),
        (status = 400, description = "Invalid path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn resolve_workspace(
    State(state): State<AppState>,
    Json(req): Json<ResolveWorkspaceFromPathRequest>,
) -> Result<Json<ResolveWorkspaceResponse>, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let path = req.path;
    let origin = request_origin_or_api_default(req.origin, "resolve_workspace");
    let creator_context = req
        .creator_context
        .map(WorkspaceCreatorContext::from_contract);
    let result = run_blocking("resolve", move || {
        workspace_runtime.resolve_from_path_with_origin_and_creator_context(
            &path,
            origin,
            creator_context,
        )
    })
    .await?
    .map_err(|e| ApiError::bad_request(e.to_string(), "WORKSPACE_RESOLVE_FAILED"))?;
    Ok(Json(
        resolve_workspace_response_to_contract(&state, result).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces",
    request_body = CreateWorkspaceRequest,
    responses(
        (status = 200, description = "Created workspace", body = ResolveWorkspaceResponse),
        (status = 400, description = "Invalid path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn create_workspace(
    State(state): State<AppState>,
    Json(req): Json<CreateWorkspaceRequest>,
) -> Result<Json<ResolveWorkspaceResponse>, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let path = req.path;
    let origin = request_origin_or_api_default(req.origin, "create_workspace");
    let creator_context = req
        .creator_context
        .map(WorkspaceCreatorContext::from_contract);
    let result = run_blocking("create", move || {
        workspace_runtime.create_workspace_with_origin_and_creator_context(
            &path,
            origin,
            creator_context,
        )
    })
    .await?
    .map_err(|e| ApiError::bad_request(e.to_string(), "WORKSPACE_CREATE_FAILED"))?;
    Ok(Json(
        resolve_workspace_response_to_contract(&state, result).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces",
    responses(
        (status = 200, description = "List workspaces", body = Vec<Workspace>),
    ),
    tag = "workspaces"
)]
pub async fn list_workspaces(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
) -> Result<Json<Vec<Workspace>>, ApiError> {
    let span = FlowHeaders::from_headers(&headers).span();
    async move {
        let started = Instant::now();
        tracing::info!("[anyharness-latency] workspace.http.list.request_received");
        let workspace_runtime = state.workspace_runtime.clone();
        let records_started = Instant::now();
        let records = run_blocking("list", move || workspace_runtime.list_workspaces())
            .await?
            .map_err(|e| ApiError::internal(e.to_string()))?;
        tracing::info!(
            workspace_count = records.len(),
            elapsed_ms = records_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] workspace.http.list.records_loaded"
        );
        let summaries_started = Instant::now();
        let summaries = state
            .session_runtime
            .workspace_execution_summaries()
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?;
        tracing::info!(
            summary_count = summaries.len(),
            elapsed_ms = summaries_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] workspace.http.list.execution_summaries_loaded"
        );
        let response_started = Instant::now();
        let scoped_workspace_id = match &auth {
            AuthContext::UserClaim(claim) => Some(claim.anyharness_workspace_id.as_str()),
            _ => None,
        };
        let response = records
            .into_iter()
            .filter(|record| {
                scoped_workspace_id
                    .map(|workspace_id| record.id == workspace_id)
                    .unwrap_or(true)
            })
            .map(|record| {
                let workspace_id = record.id.clone();
                workspace_to_contract_with_summary(
                    record,
                    summaries
                        .get(&workspace_id)
                        .cloned()
                        .unwrap_or_else(idle_workspace_execution_summary),
                )
            })
            .collect::<Vec<_>>();
        tracing::info!(
            workspace_count = response.len(),
            elapsed_ms = response_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] workspace.http.list.response_built"
        );
        Ok(Json(response))
    }
    .instrument(span)
    .await
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace", body = Workspace),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn get_workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Workspace>, ApiError> {
    assert_workspace_auth_scope(&auth, &workspace_id)?;
    let workspace_runtime = state.workspace_runtime.clone();
    let record = run_blocking("get", move || {
        workspace_runtime.get_workspace(&workspace_id)
    })
    .await?
    .map_err(|e| ApiError::internal(e.to_string()))?
    .ok_or_else(|| ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND"))?;
    Ok(Json(workspace_to_contract(&state, record).await?))
}

#[utoipa::path(
    patch,
    path = "/v1/workspaces/{workspace_id}/display-name",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = UpdateWorkspaceDisplayNameRequest,
    responses(
        (status = 200, description = "Updated workspace display name", body = Workspace),
        (status = 400, description = "Invalid display name", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn update_workspace_display_name(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<UpdateWorkspaceDisplayNameRequest>,
) -> Result<Json<Workspace>, ApiError> {
    assert_workspace_mutable(&state, &workspace_id)?;
    let workspace_runtime = state.workspace_runtime.clone();
    let workspace_id_for_task = workspace_id.clone();
    let display_name = req.display_name;
    let record = run_blocking("display-name", move || {
        workspace_runtime.set_display_name(&workspace_id_for_task, display_name.as_deref())
    })
    .await?
    .map_err(map_set_workspace_display_name_error)?;

    Ok(Json(workspace_to_contract(&state, record).await?))
}
