use anyharness_contract::v1::{EditPendingPromptRequest, PromptInputBlock, Session};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, HeaderValue},
    Extension, Json,
};
use serde::Deserialize;

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use super::sessions_contract::session_to_contract;
use super::sessions_errors::map_pending_prompt_mutation_error;
use super::sessions_leases::acquire_session_operation_lease;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::sessions::runtime::PendingPromptQueueError;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    patch,
    path = "/v1/sessions/{session_id}/pending-prompts/{seq}",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("seq" = i64, Path, description = "Queue row sequence number"),
    ),
    request_body = anyharness_contract::v1::EditPendingPromptRequest,
    responses(
        (status = 200, description = "Pending prompt updated", body = Session),
        (status = 404, description = "Session or pending prompt not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn edit_pending_prompt(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, seq)): Path<(String, i64)>,
    Json(req): Json<EditPendingPromptRequest>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let blocks = req.blocks.unwrap_or_else(|| {
        vec![PromptInputBlock::Text {
            text: req.text.unwrap_or_default(),
        }]
    });
    let _lease =
        acquire_session_operation_lease(&state, &session_id, WorkspaceOperationKind::SessionPrompt)
            .await?;
    let updated = state
        .session_runtime
        .edit_pending_prompt(&session_id, seq, blocks)
        .await
        .map_err(map_pending_prompt_mutation_error)?;
    Ok(Json(session_to_contract(&state, &updated).await?))
}

#[utoipa::path(
    delete,
    path = "/v1/sessions/{session_id}/pending-prompts/{seq}",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("seq" = i64, Path, description = "Queue row sequence number"),
    ),
    responses(
        (status = 200, description = "Pending prompt deleted", body = Session),
        (status = 404, description = "Session or pending prompt not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn delete_pending_prompt(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, seq)): Path<(String, i64)>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let _lease =
        acquire_session_operation_lease(&state, &session_id, WorkspaceOperationKind::SessionPrompt)
            .await?;
    let updated = state
        .session_runtime
        .delete_pending_prompt(&session_id, seq)
        .await
        .map_err(map_pending_prompt_mutation_error)?;
    Ok(Json(session_to_contract(&state, &updated).await?))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/prompt-attachments/{attachment_id}",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("attachment_id" = String, Path, description = "Prompt attachment ID"),
    ),
    responses(
        (status = 200, description = "Prompt attachment bytes"),
        (status = 404, description = "Session or attachment not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_prompt_attachment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, attachment_id)): Path<(String, String)>,
) -> Result<(HeaderMap, Vec<u8>), ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    state
        .session_service
        .get_session(&session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;
    let attachment = state
        .session_service
        .store()
        .find_prompt_attachment(&session_id, &attachment_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Prompt attachment not found: {attachment_id}"),
                "PROMPT_ATTACHMENT_NOT_FOUND",
            )
        })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        "cache-control",
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    if let Some(mime_type) = attachment.mime_type.as_deref() {
        if let Ok(value) = HeaderValue::from_str(mime_type) {
            headers.insert("content-type", value);
        }
    }
    let content = state
        .session_service
        .read_prompt_attachment_content(&attachment)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok((headers, content))
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderPendingPromptsRequest {
    pub seqs: Vec<i64>,
}

#[utoipa::path(
    put,
    path = "/v1/sessions/{session_id}/pending-prompts/order",
    params(
        ("session_id" = String, Path, description = "Session ID"),
    ),
    request_body = inline(ReorderPendingPromptsRequest),
    responses(
        (status = 200, description = "Pending prompts reordered", body = Session),
        (status = 400, description = "Invalid reorder request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn reorder_pending_prompts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    Json(req): Json<ReorderPendingPromptsRequest>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let _lease =
        acquire_session_operation_lease(&state, &session_id, WorkspaceOperationKind::SessionPrompt)
            .await?;
    let updated = state
        .session_runtime
        .reorder_pending_prompts(&session_id, req.seqs)
        .await
        .map_err(map_pending_prompt_queue_error)?;
    Ok(Json(session_to_contract(&state, &updated).await?))
}

// ---------------------------------------------------------------------------
// Steer
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/pending-prompts/{seq}/steer",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("seq" = i64, Path, description = "Queue row sequence number"),
    ),
    responses(
        (status = 200, description = "Pending prompt steered", body = Session),
        (status = 404, description = "Session or pending prompt not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn steer_pending_prompt(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, seq)): Path<(String, i64)>,
) -> Result<Json<Session>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let _lease =
        acquire_session_operation_lease(&state, &session_id, WorkspaceOperationKind::SessionPrompt)
            .await?;
    let updated = state
        .session_runtime
        .steer_pending_prompt(&session_id, seq)
        .await
        .map_err(map_pending_prompt_queue_error)?;
    Ok(Json(session_to_contract(&state, &updated).await?))
}

fn map_pending_prompt_queue_error(error: PendingPromptQueueError) -> ApiError {
    match error {
        PendingPromptQueueError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        PendingPromptQueueError::NotFound => {
            ApiError::not_found("Pending prompt not found", "PENDING_PROMPT_NOT_FOUND")
        }
        PendingPromptQueueError::InvalidReorder(msg) => {
            ApiError::bad_request(msg, "INVALID_REORDER")
        }
        PendingPromptQueueError::Internal(error) => ApiError::internal(error.to_string()),
    }
}
