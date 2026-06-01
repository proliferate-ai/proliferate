use super::error::ApiError;
use crate::app::AppState;
use crate::domains::workspaces::operation_gate::{WorkspaceOperationKind, WorkspaceOperationLease};

pub(super) async fn acquire_session_operation_lease(
    state: &AppState,
    session_id: &str,
    kind: WorkspaceOperationKind,
) -> Result<WorkspaceOperationLease, ApiError> {
    let session = state
        .session_service
        .get_session(session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;
    Ok(state
        .workspace_operation_gate
        .acquire_shared(&session.workspace_id, kind)
        .await)
}

pub(super) async fn acquire_session_exclusive_operation_lease(
    state: &AppState,
    session_id: &str,
    kind: WorkspaceOperationKind,
) -> Result<crate::domains::workspaces::operation_gate::WorkspaceExclusiveOperationLease, ApiError>
{
    let session = state
        .session_service
        .get_session(session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;
    Ok(state
        .workspace_operation_gate
        .acquire_exclusive_with_kind(&session.workspace_id, kind)
        .await)
}
