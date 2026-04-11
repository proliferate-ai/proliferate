use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::workspaces::access_gate::WorkspaceAccessError;

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
    }
}

pub fn assert_workspace_mutable(state: &AppState, workspace_id: &str) -> Result<(), ApiError> {
    state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(workspace_id)
        .map_err(map_access_error)
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
