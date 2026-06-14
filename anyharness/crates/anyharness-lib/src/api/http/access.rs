use crate::api::auth::{require_workspace_scope, AuthContext, AuthError};
use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::domains::workspaces::access_gate::WorkspaceAccessError;
use crate::domains::workspaces::model::WorkspaceLifecycleState;

pub fn map_access_error(error: WorkspaceAccessError) -> ApiError {
    match error {
        WorkspaceAccessError::WorkspaceNotFound(id) => {
            ApiError::not_found(format!("workspace not found: {id}"), "WORKSPACE_NOT_FOUND")
        }
        WorkspaceAccessError::SessionNotFound(id) => {
            ApiError::not_found(format!("session not found: {id}"), "SESSION_NOT_FOUND")
        }
        WorkspaceAccessError::TerminalNotFound(id) => {
            ApiError::not_found(format!("terminal not found: {id}"), "TERMINAL_NOT_FOUND")
        }
        WorkspaceAccessError::MutationBlocked { workspace_id, mode } => ApiError::conflict(
            format!(
                "workspace {workspace_id} is not writable while mode={}",
                mode.as_str()
            ),
            "WORKSPACE_MUTATION_BLOCKED",
        ),
        WorkspaceAccessError::LiveSessionStartBlocked { workspace_id, mode } => ApiError::conflict(
            format!(
                "workspace {workspace_id} cannot start live sessions while mode={}",
                mode.as_str()
            ),
            "WORKSPACE_LIVE_SESSION_BLOCKED",
        ),
        WorkspaceAccessError::WorkspaceRetired(workspace_id) => ApiError::conflict(
            format!("workspace {workspace_id} is retired"),
            "WORKSPACE_RETIRED",
        ),
        WorkspaceAccessError::Unexpected(error) => ApiError::internal(format!(
            "workspace access state could not be verified: {error}"
        )),
    }
}

pub fn assert_workspace_mutable(state: &AppState, workspace_id: &str) -> Result<(), ApiError> {
    state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(workspace_id)
        .map_err(map_access_error)
}

pub fn assert_workspace_not_retired(state: &AppState, workspace_id: &str) -> Result<(), ApiError> {
    let workspace = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("Workspace not found", "WORKSPACE_NOT_FOUND"))?;
    if workspace.lifecycle_state == WorkspaceLifecycleState::Retired {
        return Err(ApiError::conflict(
            format!("workspace {workspace_id} is retired"),
            "WORKSPACE_RETIRED",
        ));
    }
    Ok(())
}

pub fn assert_workspace_auth_scope(auth: &AuthContext, workspace_id: &str) -> Result<(), ApiError> {
    let AuthContext::UserClaim(claim) = auth else {
        return Ok(());
    };
    require_workspace_scope(claim, workspace_id).map_err(auth_scope_error_to_api)
}

pub fn assert_session_auth_scope(
    state: &AppState,
    auth: &AuthContext,
    session_id: &str,
) -> Result<(), ApiError> {
    let AuthContext::UserClaim(claim) = auth else {
        return Ok(());
    };
    if let Some(scoped_session_id) = claim.anyharness_session_id.as_deref() {
        if scoped_session_id != session_id {
            return Err(auth_scope_error_to_api(AuthError::ScopeMismatch));
        }
    }
    let session = state
        .session_service
        .get_session(session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("Session not found", "SESSION_NOT_FOUND"))?;
    require_workspace_scope(claim, &session.workspace_id).map_err(auth_scope_error_to_api)
}

pub async fn assert_terminal_auth_scope(
    state: &AppState,
    auth: &AuthContext,
    terminal_id: &str,
) -> Result<(), ApiError> {
    let AuthContext::UserClaim(claim) = auth else {
        return Ok(());
    };
    let terminal_handle = state
        .terminal_service
        .lookup_terminal(terminal_id)
        .await
        .ok_or_else(|| ApiError::not_found("Terminal not found", "TERMINAL_NOT_FOUND"))?;
    let terminal = terminal_handle
        .snapshot()
        .await
        .map_err(|_| ApiError::not_found("Terminal not found", "TERMINAL_NOT_FOUND"))?;
    require_workspace_scope(claim, &terminal.workspace_id).map_err(auth_scope_error_to_api)
}

pub fn assert_terminal_command_auth_scope(
    state: &AppState,
    auth: &AuthContext,
    command_run_id: &str,
) -> Result<(), ApiError> {
    let AuthContext::UserClaim(claim) = auth else {
        return Ok(());
    };
    let run = state
        .terminal_service
        .get_command_run(command_run_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("Command run not found", "COMMAND_RUN_NOT_FOUND"))?;
    require_workspace_scope(claim, &run.workspace_id).map_err(auth_scope_error_to_api)
}

fn auth_scope_error_to_api(error: AuthError) -> ApiError {
    match error {
        AuthError::ScopeMismatch => ApiError::forbidden(
            "Direct-attach token is not scoped to this resource.",
            "DIRECT_ATTACH_SCOPE_MISMATCH",
        ),
        _ => ApiError::forbidden(
            "Direct-attach token cannot access this resource.",
            "DIRECT_ATTACH_FORBIDDEN",
        ),
    }
}

pub fn assert_session_mutable(state: &AppState, session_id: &str) -> Result<(), ApiError> {
    state
        .workspace_access_gate
        .assert_can_mutate_for_session(session_id)
        .map_err(map_access_error)
}

pub async fn assert_terminal_mutable(state: &AppState, terminal_id: &str) -> Result<(), ApiError> {
    state
        .workspace_access_gate
        .assert_can_mutate_for_terminal(terminal_id)
        .await
        .map_err(map_access_error)
}
