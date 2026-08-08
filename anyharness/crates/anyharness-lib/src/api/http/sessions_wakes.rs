//! Arming a session-scoped wake as the human.
//!
//! §4's agent-detail composer has a "Wake me on reply" toggle. It writes the
//! same `session_wake_schedules` row `schedule_agent_wake` writes, consumed by
//! the same turn-finish transaction, firing the same pointer — one mechanism
//! for agents and humans, per the ADR. The watcher is the pane's own session
//! (the parent); the target is the agent being watched.

use anyharness_contract::v1::{ScheduleAgentWakeRequest, ScheduleAgentWakeResponse};
use axum::{
    extract::{Path, State},
    Extension, Json,
};

use super::access::{assert_session_auth_scope, assert_workspace_mutable};
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::api::http::access::admit_session_mutation;
use crate::app::AppState;
use crate::domains::sessions::admission::SessionMutationKind;
use crate::domains::sessions::authorize::AgentAccessError;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/wakes/{target_session_id}",
    params(
        ("session_id" = String, Path, description = "Watcher session ID — the session that gets woken"),
        ("target_session_id" = String, Path, description = "Target session ID — the agent being waited on"),
    ),
    request_body = ScheduleAgentWakeRequest,
    responses(
        (status = 200, description = "Armed a one-shot wake on the target's next finished turn", body = ScheduleAgentWakeResponse),
        (status = 400, description = "Invalid wake request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Workspace or session state blocks wake scheduling", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn schedule_agent_wake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, target_session_id)): Path<(String, String)>,
    Json(_body): Json<ScheduleAgentWakeRequest>,
) -> Result<Json<ScheduleAgentWakeResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let _admission_permit =
        admit_session_mutation(&state, &session_id, SessionMutationKind::AgentWake).await?;
    let watcher = state
        .session_service
        .get_session(&session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("Session not found", "SESSION_NOT_FOUND"))?;
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&watcher.workspace_id, WorkspaceOperationKind::SubagentWrite)
        .await;
    assert_workspace_mutable(&state, &watcher.workspace_id)?;

    let armed = state
        .agent_wake_service
        .arm(&session_id, &target_session_id)
        .map_err(map_agent_access_error)?;

    Ok(Json(ScheduleAgentWakeResponse {
        watcher_session_id: armed.watcher_session_id,
        target_session_id: armed.target.id,
        wake_scheduled: true,
        already_scheduled: !armed.created,
    }))
}

fn map_agent_access_error(error: AgentAccessError) -> ApiError {
    match error {
        AgentAccessError::CallerNotFound(id) | AgentAccessError::TargetNotFound(id) => {
            ApiError::not_found(format!("Session not found: {id}"), "SESSION_NOT_FOUND")
        }
        AgentAccessError::CallerClosed => ApiError::conflict(
            "Session is closed and cannot be woken".to_string(),
            "SESSION_CLOSED",
        ),
        AgentAccessError::TargetClosed => ApiError::conflict(
            "Target session is closed and will not finish another turn".to_string(),
            "SESSION_CLOSED",
        ),
        AgentAccessError::TargetDismissed => ApiError::conflict(
            "Target session is dismissed and will not finish another turn".to_string(),
            "SESSION_DISMISSED",
        ),
        // Same shape discovery presents: internal-only sessions are filtered
        // from list/search, so access refusals must not reveal they exist.
        AgentAccessError::TargetInternalOnly => {
            ApiError::not_found("Session not found".to_string(), "SESSION_NOT_FOUND")
        }
        AgentAccessError::SelfTarget => ApiError::bad_request(
            "A session cannot schedule a wake on itself".to_string(),
            "INVALID_TARGET",
        ),
        AgentAccessError::Internal(error) => {
            ApiError::bad_request(error.to_string(), "BAD_REQUEST")
        }
    }
}
