use anyharness_contract::v1::{
    GetSessionLiveConfigResponse, Session, SetSessionConfigOptionRequest,
    SetSessionConfigOptionResponse, UpdateSessionTitleRequest,
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};

use super::access::{
    assert_session_auth_scope, assert_session_mutable, assert_session_not_workflow_held,
};
use super::error::ApiError;
use super::sessions_contract::session_to_contract;
use super::sessions_errors::{
    map_get_live_config_snapshot_error, map_set_session_config_option_error,
    map_update_session_title_error,
};
use super::sessions_leases::acquire_session_operation_lease;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    patch,
    path = "/v1/sessions/{session_id}/title",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = UpdateSessionTitleRequest,
    responses(
        (status = 200, description = "Updated session title", body = Session),
        (status = 400, description = "Invalid title", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn update_session_title(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    Json(req): Json<UpdateSessionTitleRequest>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    assert_session_mutable(&state, &session_id)?;
    assert_session_not_workflow_held(&state, &session_id)?;
    let record = state
        .session_service
        .update_session_title(&session_id, &req.title)
        .map_err(map_update_session_title_error)?;

    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/live-config",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Current live config snapshot", body = GetSessionLiveConfigResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_live_session_config(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<GetSessionLiveConfigResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let live_config = state
        .session_service
        .get_live_config_snapshot_checked(&session_id)
        .map_err(map_get_live_config_snapshot_error)?;
    Ok(Json(GetSessionLiveConfigResponse { live_config }))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/config-options",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = SetSessionConfigOptionRequest,
    responses(
        (status = 200, description = "Session config option applied or queued", body = SetSessionConfigOptionResponse),
        (status = 400, description = "Invalid config option", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn set_session_config_option(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    Json(req): Json<SetSessionConfigOptionRequest>,
) -> Result<Json<SetSessionConfigOptionResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    tracing::debug!(
        session_id = %session_id,
        config_id = %req.config_id,
        value = %req.value,
        "Setting session config option"
    );
    let _lease =
        acquire_session_operation_lease(&state, &session_id, WorkspaceOperationKind::SessionResume)
            .await?;
    let (session, live_config, apply_state) = state
        .session_runtime
        .set_live_session_config_option(&session_id, &req.config_id, &req.value)
        .await
        .map_err(map_set_session_config_option_error)?;
    tracing::debug!(
        session_id = %session_id,
        config_id = %req.config_id,
        value = %req.value,
        apply_state = ?apply_state,
        "Session config option set"
    );
    Ok(Json(SetSessionConfigOptionResponse {
        session: state
            .session_runtime
            .session_view_with_live_config(&session, live_config.clone())
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?
            .into_contract(),
        live_config,
        apply_state,
    }))
}
