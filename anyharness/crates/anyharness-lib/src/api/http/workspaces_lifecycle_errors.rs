//! The one place HTTP learns how the retire family fails. Grid PR 9: the
//! handler's inline `map_err` ladder became this single `From` impl, so the
//! status/code choices live at the edge and the domain stays HTTP-free.

use crate::api::http::error::ApiError;
use crate::domains::workspaces::retire::WorkspaceRetireError;

impl From<WorkspaceRetireError> for ApiError {
    fn from(error: WorkspaceRetireError) -> Self {
        match error {
            WorkspaceRetireError::WorkspaceNotFound => {
                ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
            }
            // PR1227-WORKSPACE-FENCE-02: a session id enumerated under the
            // exclusive lease was absent from the up-front admitted set (bound
            // after the snapshot, possibly already terminalized). Fail closed
            // with the same stable 409 code; the detail names the unadmitted
            // session id only.
            WorkspaceRetireError::SessionAppearedAfterAdmission { session_id } => {
                ApiError::conflict(
                    format!("session {session_id} appeared after destruction admission"),
                    "SESSION_CONTROLLED_BY_WORKFLOW",
                )
            }
            // PR1227-WORKSPACE-FENCE-01: the under-lease re-check observed a
            // workflow-controlled session created after up-front admission.
            WorkspaceRetireError::ControlledByWorkflow => ApiError::conflict(
                "session execution is controlled by an active workflow run",
                "SESSION_CONTROLLED_BY_WORKFLOW",
            ),
            WorkspaceRetireError::SessionListUnavailable => {
                ApiError::internal("session list failed")
            }
            WorkspaceRetireError::SessionAdmissionUnavailable => {
                ApiError::internal("session admission unavailable")
            }
            WorkspaceRetireError::CleanupTaskFailed { label, detail } => {
                ApiError::internal(format!("{label} task failed: {detail}"))
            }
            WorkspaceRetireError::Unexpected(error) => ApiError::internal(error.to_string()),
        }
    }
}
