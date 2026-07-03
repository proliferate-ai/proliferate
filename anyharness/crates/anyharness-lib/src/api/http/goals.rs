use anyharness_contract::v1::{
    ClearSessionGoalResponse, SessionGoalResponse, SetSessionGoalRequest,
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::goals::runtime::GoalOpError;

#[utoipa::path(
    put,
    path = "/v1/sessions/{session_id}/goal",
    params(("session_id" = String, Path, description = "Session ID")),
    request_body = SetSessionGoalRequest,
    responses(
        (status = 200, description = "Goal set through the native mechanism and confirmed", body = SessionGoalResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session cannot take goal mutations", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "goals"
)]
pub async fn set_session_goal(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    Json(request): Json<SetSessionGoalRequest>,
) -> Result<Json<SessionGoalResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let goal = state
        .goal_runtime
        .set_goal(&session_id, request)
        .await
        .map_err(map_goal_op_error)?;
    Ok(Json(SessionGoalResponse { goal }))
}

#[utoipa::path(
    delete,
    path = "/v1/sessions/{session_id}/goal",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Goal cleared through the native mechanism", body = ClearSessionGoalResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Session cannot take goal mutations", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "goals"
)]
pub async fn clear_session_goal(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
) -> Result<Json<ClearSessionGoalResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let cleared = state
        .goal_runtime
        .clear_goal(&session_id)
        .await
        .map_err(map_goal_op_error)?;
    Ok(Json(ClearSessionGoalResponse { cleared }))
}

fn map_goal_op_error(error: GoalOpError) -> ApiError {
    match error {
        GoalOpError::SessionNotFound => ApiError::not_found("Session not found", "NOT_FOUND"),
        GoalOpError::Unsupported => ApiError::conflict(
            "This agent does not support goals.",
            "GOALS_UNSUPPORTED",
        ),
        GoalOpError::SessionNotLive => ApiError::conflict(
            "The session is not running; goals mutate only through the live native session.",
            "SESSION_NOT_LIVE",
        ),
        GoalOpError::EmptyObjective => {
            ApiError::bad_request("Goal objective must not be empty.", "GOAL_OBJECTIVE_EMPTY")
        }
        GoalOpError::ObjectiveTooLarge => ApiError::bad_request(
            "Goal objective is too large.",
            "GOAL_OBJECTIVE_TOO_LARGE",
        ),
        GoalOpError::NotConfirmed => ApiError::conflict(
            "The goal mutation was accepted but its native confirmation did not arrive; the session's goal events remain authoritative.",
            "GOAL_NOT_CONFIRMED",
        ),
        GoalOpError::Rejected(detail) => {
            ApiError::bad_request(format!("Agent rejected goal operation: {detail}"), "GOAL_REJECTED")
        }
        GoalOpError::AgentUnavailable(detail) => ApiError::service_unavailable(
            format!("The agent could not service the goal operation: {detail}"),
            "AGENT_UNAVAILABLE",
        ),
        GoalOpError::Store(error) => ApiError::internal(error.to_string()),
    }
}
