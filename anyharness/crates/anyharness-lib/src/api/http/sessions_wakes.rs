//! Arming a session-scoped wake as the human.
//!
//! §4's agent-detail composer has a "Wake me on reply" toggle. It writes the
//! same `session_wake_schedules` row `schedule_agent_wake` writes, consumed by
//! the same turn-finish transaction, firing the same pointer — one mechanism
//! for agents and humans, per the ADR. The watcher is the pane's own session
//! (the parent); the target is the agent being watched.
//!
//! What differs from the agent tool is reach. `authorize` is deliberately
//! runtime-wide — that is the AGENT contract (ruling 4) — so it cannot be the
//! whole gate for a human token that is scoped to a workspace or a session.
//! Both sessions in the URL clear that scope here, and every refusal this route
//! cannot serve is answered as the 404 discovery already gives an unknown id,
//! so the status spread is not an existence oracle for sessions the caller
//! cannot see. The documented statuses stay 200/400/404/409; a store failure is
//! an undocumented 5xx like everywhere else, never a 400.

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
use crate::domains::sessions::wakes::AgentWakeReason;
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
    // The TARGET is a second session this route reaches across, so it clears the
    // same scope the watcher does. Without it a workspace-scoped token could arm
    // on any session in the runtime and then read the target's title back out of
    // the pointer the wake fires. Runtime-wide reach is the AGENT contract
    // (`authorize`); a human token only reaches what its scope already shows.
    assert_target_session_auth_scope(&state, &auth, &target_session_id)?;
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

    // An explicit schedule, not a reply arm: nothing but the target's turn
    // finish consumes it, so an incidental message between the two sessions
    // cannot cancel what the human asked for.
    let armed = state
        .agent_wake_service
        .arm(
            &session_id,
            &target_session_id,
            AgentWakeReason::ExplicitSchedule,
        )
        .map_err(map_agent_access_error)?;

    Ok(Json(ScheduleAgentWakeResponse {
        watcher_session_id: armed.watcher_session_id,
        target_session_id: armed.target.id,
        wake_scheduled: true,
        already_scheduled: !armed.created,
    }))
}

/// Scope the target the way discovery does: everything a scoped token may not
/// see collapses to the SAME 404 a missing session gets, so the status spread
/// cannot be read as an existence oracle for sessions outside the scope. A
/// session-scoped direct-attach token reaches exactly its own session, so it
/// cannot arm across sessions at all — that token is deliberately narrow, and
/// widening it is not this route's call.
fn assert_target_session_auth_scope(
    state: &AppState,
    auth: &AuthContext,
    target_session_id: &str,
) -> Result<(), ApiError> {
    match assert_session_auth_scope(state, auth, target_session_id) {
        Ok(()) => Ok(()),
        Err(error) if error.is_server_error() => Err(error),
        Err(_) => Err(ApiError::not_found(
            "Session not found",
            "SESSION_NOT_FOUND",
        )),
    }
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
        // A store failure is ours, not the caller's: it must not be reported as
        // a bad request, which would tell the caller to change something it
        // cannot change and hide the fault from 5xx alerting.
        AgentAccessError::Internal(error) => {
            ApiError::internal(format!("wake could not be scheduled: {error}"))
        }
    }
}
