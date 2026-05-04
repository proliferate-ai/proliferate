use anyharness_contract::v1::{
    ProblemDetails, ScheduleSubagentWakeRequest, ScheduleSubagentWakeResponse,
    SessionSubagentsResponse,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::Value;

use super::access::assert_workspace_mutable;
use super::error::ApiError;
use crate::app::AppState;
use crate::sessions::subagents::mcp::handle_json_rpc;
use crate::sessions::subagents::service::SubagentError;
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/subagents",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Subagent parent/child context", body = SessionSubagentsResponse),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_session_subagents(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionSubagentsResponse>, ApiError> {
    let context = state
        .subagent_service
        .subagent_context(&session_id)
        .map_err(map_subagent_error)?;
    Ok(Json(context))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/subagents/{child_session_id}/wake",
    params(
        ("session_id" = String, Path, description = "Parent session ID"),
        ("child_session_id" = String, Path, description = "Child subagent session ID"),
    ),
    request_body = ScheduleSubagentWakeRequest,
    responses(
        (status = 200, description = "Scheduled a one-shot parent wake for the child subagent", body = ScheduleSubagentWakeResponse),
        (status = 400, description = "Invalid subagent wake request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Workspace or subagent state blocks wake scheduling", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn schedule_subagent_wake(
    State(state): State<AppState>,
    Path((session_id, child_session_id)): Path<(String, String)>,
    Json(_body): Json<ScheduleSubagentWakeRequest>,
) -> Result<Json<ScheduleSubagentWakeResponse>, ApiError> {
    let parent = state
        .session_service
        .get_session(&session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("Session not found", "SESSION_NOT_FOUND"))?;
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&parent.workspace_id, WorkspaceOperationKind::SubagentWrite)
        .await;
    assert_workspace_mutable(&state, &parent.workspace_id)?;

    let (link, inserted) = state
        .subagent_service
        .schedule_wake_for_child(&session_id, &child_session_id)
        .map_err(map_subagent_error)?;

    Ok(Json(ScheduleSubagentWakeResponse {
        parent_session_id: session_id,
        child_session_id,
        session_link_id: link.id,
        wake_scheduled: true,
        already_scheduled: !inserted,
    }))
}

pub async fn get_subagents_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_subagents_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let capability_header = headers
        .get(state.subagent_session_hooks.capability_header_name())
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::unauthorized(
                "Missing subagent capability token.",
                "SUBAGENT_MCP_UNAUTHORIZED",
            )
        })?;
    let is_valid = state
        .subagent_session_hooks
        .validate_capability_token(capability_header, &workspace_id, &session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if !is_valid {
        return Err(ApiError::unauthorized(
            "Invalid subagent capability token.",
            "SUBAGENT_MCP_UNAUTHORIZED",
        ));
    }
    let _operation = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::SubagentWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;

    let response = handle_json_rpc(
        state.subagent_service.as_ref(),
        state.session_runtime.as_ref(),
        state.workspace_runtime.as_ref(),
        &workspace_id,
        &session_id,
        body,
    )
    .await
    .map_err(|error| ApiError::bad_request(error.to_string(), "SUBAGENT_MCP_REQUEST_INVALID"))?;

    match response {
        Some(payload) => Ok((StatusCode::OK, Json(payload)).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

#[allow(dead_code)]
fn _problem_details_reference(_: ProblemDetails) {}

fn map_subagent_error(error: SubagentError) -> ApiError {
    match error {
        SubagentError::ParentNotFound(session_id) | SubagentError::ChildNotFound(session_id) => {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        }
        SubagentError::WorkspaceNotFound(workspace_id) => ApiError::not_found(
            format!("Workspace not found: {workspace_id}"),
            "WORKSPACE_NOT_FOUND",
        ),
        SubagentError::NotOwned => ApiError::conflict(
            "Child session is not owned by this parent session.",
            "SUBAGENT_NOT_OWNED",
        ),
        SubagentError::IneligibleWorkspace => ApiError::conflict(
            "Subagents are only available in standard workspaces.",
            "SUBAGENT_INELIGIBLE_WORKSPACE",
        ),
        SubagentError::CrossWorkspace => ApiError::conflict(
            "Subagent child must be in the same workspace.",
            "SUBAGENT_CROSS_WORKSPACE",
        ),
        SubagentError::DepthLimit => ApiError::conflict(
            "Subagent children cannot create subagents.",
            "SUBAGENT_DEPTH_LIMIT",
        ),
        SubagentError::FanoutLimit => ApiError::conflict(
            "Parent already has the maximum number of subagents.",
            "SUBAGENT_FANOUT_LIMIT",
        ),
        SubagentError::MutationBlocked(_) => ApiError::conflict(
            "Workspace is not writable right now.",
            "WORKSPACE_MUTATION_BLOCKED",
        ),
        other => ApiError::internal(other.to_string()),
    }
}
