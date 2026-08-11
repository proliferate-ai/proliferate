use anyharness_contract::v1::{
    SessionSubagentsResponse, SubagentLifecycleResponse, WorkspaceSubagentsResponse,
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};

use super::access::{assert_session_auth_scope, assert_workspace_auth_scope};
use super::error::ApiError;
use super::subagents_contract::{
    lifecycle_response, session_roster_response, workspace_roster_response,
};
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::agent_operations::model::AgentIdentity;

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/subagents",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Current durable subagent roster", body = WorkspaceSubagentsResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_workspace_subagents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceSubagentsResponse>, ApiError> {
    assert_workspace_auth_scope(&auth, &workspace_id)?;
    let roster = state
        .agent_operations
        .workspace_subagent_roster(&workspace_id)
        .await?;
    Ok(Json(workspace_roster_response(roster)))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{parent_session_id}/subagents",
    params(("parent_session_id" = String, Path, description = "Parent session ID")),
    responses(
        (status = 200, description = "Parent and current durable subagents", body = SessionSubagentsResponse),
        (status = 404, description = "Agent not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn get_session_subagents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(parent_session_id): Path<String>,
) -> Result<Json<SessionSubagentsResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &parent_session_id)?;
    let caller = state
        .agent_operations
        .authenticated_caller(parent_session_id);
    let roster = state
        .agent_operations
        .session_subagent_roster(&caller)
        .await?;
    Ok(Json(session_roster_response(roster)))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{parent_session_id}/subagents/{child_session_id}/close",
    params(
        ("parent_session_id" = String, Path, description = "Parent session ID"),
        ("child_session_id" = String, Path, description = "Child subagent session ID"),
    ),
    responses(
        (status = 200, description = "Subagent relationship is Closed", body = SubagentLifecycleResponse),
        (status = 404, description = "Agent not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Subagent lifecycle conflict", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn close_subagent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((parent_session_id, child_session_id)): Path<(String, String)>,
) -> Result<Json<SubagentLifecycleResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &parent_session_id)?;
    let caller = state
        .agent_operations
        .authenticated_caller(parent_session_id);
    let target = AgentIdentity::new(
        state.agent_operations.runtime_identity().clone(),
        child_session_id,
    );
    let result = state
        .agent_operations
        .close_subagent_lifecycle(&caller, &target)
        .await?;
    Ok(Json(lifecycle_response(result)))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{parent_session_id}/subagents/{child_session_id}/open",
    params(
        ("parent_session_id" = String, Path, description = "Parent session ID"),
        ("child_session_id" = String, Path, description = "Child subagent session ID"),
    ),
    responses(
        (status = 200, description = "Subagent relationship is Open", body = SubagentLifecycleResponse),
        (status = 404, description = "Agent not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Subagent lifecycle conflict", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn open_subagent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((parent_session_id, child_session_id)): Path<(String, String)>,
) -> Result<Json<SubagentLifecycleResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &parent_session_id)?;
    let caller = state
        .agent_operations
        .authenticated_caller(parent_session_id);
    let target = AgentIdentity::new(
        state.agent_operations.runtime_identity().clone(),
        child_session_id,
    );
    let result = state
        .agent_operations
        .open_subagent_lifecycle(&caller, &target)
        .await?;
    Ok(Json(lifecycle_response(result)))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{parent_session_id}/subagents/{child_session_id}/promote",
    params(
        ("parent_session_id" = String, Path, description = "Parent session ID"),
        ("child_session_id" = String, Path, description = "Child subagent session ID"),
    ),
    responses(
        (status = 200, description = "Subagent promoted to an ordinary agent", body = SubagentLifecycleResponse),
        (status = 404, description = "Agent not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Open the subagent before promotion", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn promote_subagent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((parent_session_id, child_session_id)): Path<(String, String)>,
) -> Result<Json<SubagentLifecycleResponse>, ApiError> {
    assert_session_auth_scope(&state, &auth, &parent_session_id)?;
    let caller = state
        .agent_operations
        .authenticated_caller(parent_session_id);
    let target = AgentIdentity::new(
        state.agent_operations.runtime_identity().clone(),
        child_session_id,
    );
    let result = state
        .agent_operations
        .promote_subagent_lifecycle(&caller, &target)
        .await?;
    Ok(Json(lifecycle_response(result)))
}
