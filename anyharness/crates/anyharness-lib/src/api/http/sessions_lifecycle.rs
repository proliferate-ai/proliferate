use crate::api::http::access::admit_session_mutation;
use crate::domains::sessions::admission::SessionMutationKind;
use std::time::Instant;

use anyharness_contract::v1::Session;
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};

use super::access::{assert_session_auth_scope, assert_workspace_auth_scope};
use super::error::ApiError;
use super::sessions_contract::session_to_contract;
use super::sessions_errors::map_session_lifecycle_error;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/cancel",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 409, description = "Session execution is controlled by an active workflow run", body = anyharness_contract::v1::ProblemDetails),
        (status = 200, description = "Session cancelled", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn cancel_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let _admission_permit =
        admit_session_mutation(&state, &session_id, SessionMutationKind::Cancel).await?;
    let updated = state
        .session_runtime
        .cancel_live_session(&session_id)
        .await
        .map_err(map_session_lifecycle_error)?;

    Ok(Json(session_to_contract(&state, &updated).await?))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/close",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 409, description = "Session execution is controlled by an active workflow run", body = anyharness_contract::v1::ProblemDetails),
        (status = 200, description = "Session closed", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn close_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let _admission_permit =
        admit_session_mutation(&state, &session_id, SessionMutationKind::Close).await?;
    let record = state
        .session_runtime
        .close_live_session(&session_id)
        .await
        .map_err(map_session_lifecycle_error)?;
    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/dismiss",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 409, description = "Session execution is controlled by an active workflow run", body = anyharness_contract::v1::ProblemDetails),
        (status = 200, description = "Session dismissed", body = Session),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn dismiss_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let _admission_permit =
        admit_session_mutation(&state, &session_id, SessionMutationKind::Dismiss).await?;
    let record = state
        .session_runtime
        .dismiss_live_session(&session_id)
        .await
        .map_err(map_session_lifecycle_error)?;
    Ok(Json(session_to_contract(&state, &record).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/sessions/restore",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Restored most recently dismissed session", body = Option<Session>),
    ),
    tag = "sessions"
)]
pub async fn restore_dismissed_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<Option<Session>>, ApiError> {
    assert_workspace_auth_scope(&auth, &workspace_id)?;
    let span = FlowHeaders::from_headers(&headers).span();
    async move {
        let started = Instant::now();
        tracing::info!(
            workspace_id = %workspace_id,
            "[workspace-latency] session.http.restore.request_received"
        );
        let restored = loop {
            let Some(candidate) = state
                .session_service
                .find_last_dismissed_in_workspace(&workspace_id)
                .map_err(|error| ApiError::internal(error.to_string()))?
            else {
                break None;
            };
            let _permit =
                admit_session_mutation(&state, &candidate.id, SessionMutationKind::Restore).await?;
            let _lease = state
                .workspace_operation_gate
                .acquire_shared(&workspace_id, WorkspaceOperationKind::SessionResume)
                .await;
            if let Some(restored) = state
                .session_runtime
                .restore_dismissed_session(&workspace_id, &candidate.id)
                .await
                .map_err(map_session_lifecycle_error)?
            {
                break Some(restored);
            }
            // The dismissed stack changed while this request waited for the
            // candidate's permit. Drop both guards and retry the new head.
        };
        tracing::info!(
            workspace_id = %workspace_id,
            restored = restored.is_some(),
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.http.restore.completed"
        );

        match restored {
            Some(record) => Ok(Json(Some(session_to_contract(&state, &record).await?))),
            None => Ok(Json(None)),
        }
    }
    .instrument(span)
    .await
}
