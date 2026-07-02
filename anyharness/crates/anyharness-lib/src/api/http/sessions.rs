use std::time::Instant;

use anyharness_contract::v1::{CreateSessionRequest, Session};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::Deserialize;

use super::access::{assert_session_auth_scope, assert_workspace_auth_scope};
use super::error::ApiError;
use super::sessions_contract::{
    request_origin_or_api_default, session_to_contract, session_view_to_contract,
};
use super::sessions_errors::map_create_session_error;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

#[derive(Debug, Deserialize)]
pub struct ListSessionsQuery {
    pub workspace_id: Option<String>,
    pub include_dismissed: Option<bool>,
}

// ---------------------------------------------------------------------------
// Create session — eager: spawns the ACP actor before returning
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/sessions",
    request_body = CreateSessionRequest,
    responses(
        (status = 200, description = "Created session with live ACP actor", body = Session),
        (status = 400, description = "Invalid request", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn create_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<Session>, ApiError> {
    let span = FlowHeaders::from_headers(&headers).span();
    async move {
        let started = Instant::now();
        let workspace_id = req.workspace_id.clone();
        let agent_kind = req.agent_kind.clone();
        let model_id = req.model_id.clone();
        let mode_id = req.mode_id.clone();
        let origin = request_origin_or_api_default(req.origin.clone(), "create_session");
        assert_workspace_auth_scope(&auth, &workspace_id)?;
        let system_prompt_append_count = req
            .system_prompt_append
            .as_ref()
            .map(|entries| entries.len())
            .unwrap_or(0);
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
            system_prompt_append_count,
            "[workspace-latency] session.http.create.request_received"
        );
        let _lease = state
            .workspace_operation_gate
            .acquire_shared(&workspace_id, WorkspaceOperationKind::SessionStart)
            .await;
        let record = state
            .session_runtime
            .create_and_start_session(
                &workspace_id,
                &agent_kind,
                model_id.as_deref(),
                mode_id.as_deref(),
                req.system_prompt_append,
                Vec::new(),
                None,
                req.subagents_enabled.unwrap_or(true),
                origin,
            )
            .await
            .map_err(map_create_session_error)?;

        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.http.create.completed"
        );

        Ok(Json(session_to_contract(&state, &record).await?))
    }
    .instrument(span)
    .await
}

#[utoipa::path(
    get,
    path = "/v1/sessions",
    params(("workspace_id" = Option<String>, Query, description = "Filter by workspace")),
    responses(
        (status = 200, description = "List sessions", body = Vec<Session>),
    ),
    tag = "sessions"
)]
pub async fn list_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListSessionsQuery>,
) -> Result<Json<Vec<Session>>, ApiError> {
    let workspace_id = match &auth {
        AuthContext::UserClaim(claim) => {
            if let Some(requested_workspace_id) = query.workspace_id.as_deref() {
                if requested_workspace_id != claim.anyharness_workspace_id {
                    return Err(ApiError::forbidden(
                        "Direct-attach token is not scoped to this workspace.",
                        "DIRECT_ATTACH_SCOPE_MISMATCH",
                    ));
                }
            }
            Some(claim.anyharness_workspace_id.as_str())
        }
        _ => query.workspace_id.as_deref(),
    };
    let include_dismissed = query.include_dismissed.unwrap_or(false);
    let records = state
        .session_service
        .list_sessions(workspace_id, include_dismissed)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    tracing::debug!(
        workspace_id = workspace_id.unwrap_or("<all>"),
        include_dismissed,
        session_count = records.len(),
        "session.http.list.completed"
    );
    let views = state
        .session_runtime
        .session_views(&records)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(
        views.into_iter().map(session_view_to_contract).collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let record = state
        .session_service
        .get_session(&session_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;
    Ok(Json(session_to_contract(&state, &record).await?))
}
