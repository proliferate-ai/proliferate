use anyharness_contract::v1::{
    ClearSessionLoopsResponse, SessionLoopResponse, SessionLoopsResponse, SetSessionLoopRequest,
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::loops::runtime::LoopOpError;

#[utoipa::path(
    put,
    path = "/v1/sessions/{session_id}/loops",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = SetSessionLoopRequest,
    responses(
        (status = 200, description = "Loop armed (native cron set, or emulated loop scheduled)", body = SessionLoopResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session cannot take loop mutations", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "loops"
)]
pub async fn set_session_loop(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    Json(request): Json<SetSessionLoopRequest>,
) -> Result<Json<SessionLoopResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let r#loop = state
        .loop_runtime
        .set_loop(&session_id, request)
        .await
        .map_err(map_loop_op_error)?;
    Ok(Json(SessionLoopResponse { r#loop }))
}

#[utoipa::path(
    put,
    path = "/v1/sessions/{session_id}/loops/{loop_id}",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("loop_id" = String, Path, description = "Loop ID"),
    ),
    request_body = SetSessionLoopRequest,
    responses(
        (status = 200, description = "Loop edited (emulated loops only)", body = SessionLoopResponse),
        (status = 404, description = "Session or loop not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session cannot take loop mutations", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "loops"
)]
pub async fn edit_session_loop(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, loop_id)): Path<(String, String)>,
    Json(request): Json<SetSessionLoopRequest>,
) -> Result<Json<SessionLoopResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let r#loop = state
        .loop_runtime
        .edit_loop(&session_id, &loop_id, request)
        .await
        .map_err(map_loop_op_error)?;
    Ok(Json(SessionLoopResponse { r#loop }))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/loops",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "The session's active loops", body = SessionLoopsResponse),
    ),
    tag = "loops"
)]
pub async fn list_session_loops(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionLoopsResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let loops = state
        .loop_runtime
        .list_loops(&session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(SessionLoopsResponse { loops }))
}

#[utoipa::path(
    delete,
    path = "/v1/sessions/{session_id}/loops",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "All loops cleared", body = ClearSessionLoopsResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session cannot take loop mutations", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "loops"
)]
pub async fn clear_session_loops(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<ClearSessionLoopsResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let cleared = state
        .loop_runtime
        .clear_loop(&session_id, None)
        .await
        .map_err(map_loop_op_error)?;
    Ok(Json(ClearSessionLoopsResponse { cleared }))
}

#[utoipa::path(
    delete,
    path = "/v1/sessions/{session_id}/loops/{loop_id}",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("loop_id" = String, Path, description = "Loop ID"),
    ),
    responses(
        (status = 200, description = "The loop was cleared", body = ClearSessionLoopsResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session cannot take loop mutations", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "loops"
)]
pub async fn clear_session_loop(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, loop_id)): Path<(String, String)>,
) -> Result<Json<ClearSessionLoopsResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let cleared = state
        .loop_runtime
        .clear_loop(&session_id, Some(loop_id))
        .await
        .map_err(map_loop_op_error)?;
    Ok(Json(ClearSessionLoopsResponse { cleared }))
}

fn map_loop_op_error(error: LoopOpError) -> ApiError {
    match error {
        LoopOpError::SessionNotFound => ApiError::not_found("Session not found", "NOT_FOUND"),
        LoopOpError::LoopNotFound => ApiError::not_found("Loop not found", "NOT_FOUND"),
        LoopOpError::Unsupported => {
            ApiError::conflict("This agent does not support loops.", "LOOPS_UNSUPPORTED")
        }
        LoopOpError::NativeEditUnsupported => ApiError::conflict(
            "Editing a native loop by id is not supported; clear and re-set.",
            "LOOP_NATIVE_EDIT_UNSUPPORTED",
        ),
        LoopOpError::SessionNotLive => ApiError::conflict(
            "The session is not running; loops mutate only through the live native session.",
            "SESSION_NOT_LIVE",
        ),
        LoopOpError::EmptyPrompt => {
            ApiError::bad_request("Loop prompt must not be empty.", "LOOP_PROMPT_EMPTY")
        }
        LoopOpError::PromptTooLarge => {
            ApiError::bad_request("Loop prompt is too large.", "LOOP_PROMPT_TOO_LARGE")
        }
        LoopOpError::InvalidSchedule(detail) => {
            ApiError::bad_request(format!("Loop schedule is invalid: {detail}"), "LOOP_SCHEDULE_INVALID")
        }
        LoopOpError::NotConfirmed => ApiError::conflict(
            "The loop mutation was accepted but its native confirmation did not arrive.",
            "LOOP_NOT_CONFIRMED",
        ),
        LoopOpError::Rejected(detail) => {
            ApiError::bad_request(format!("Agent rejected loop operation: {detail}"), "LOOP_REJECTED")
        }
        LoopOpError::AgentUnavailable(detail) => ApiError::service_unavailable(
            format!("The agent could not service the loop operation: {detail}"),
            "AGENT_UNAVAILABLE",
        ),
        LoopOpError::Store(error) => ApiError::internal(error.to_string()),
    }
}
