use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::workspace_naming::eligibility::{
    self, WorkspaceNamingAvailabilityError,
};
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};

#[derive(Debug, Clone)]
pub struct WorkspaceNamingMcpContext {
    pub workspace_id: String,
    pub session_id: String,
    pub available: bool,
}

pub fn resolve_context(
    workspace_runtime: &WorkspaceRuntime,
    workspace_access_gate: &WorkspaceAccessGate,
    session_store: &SessionStore,
    request: &ProductMcpRequestContext,
) -> Result<WorkspaceNamingMcpContext, ProductMcpContextError> {
    let session = session_store
        .find_by_id(&request.session_id)?
        .ok_or_else(|| ProductMcpContextError::not_found("session not found"))?;
    if session.workspace_id != request.workspace_id {
        return Err(ProductMcpContextError::conflict(
            "session does not belong to workspace",
        ));
    }
    let workspace = workspace_runtime
        .get_workspace(&request.workspace_id)?
        .ok_or_else(|| ProductMcpContextError::not_found("workspace not found"))?;
    let mut available =
        match eligibility::validate_tool_call_availability(session_store, &workspace, &session) {
            Ok(()) => true,
            Err(WorkspaceNamingAvailabilityError::Unavailable(_)) => false,
            Err(WorkspaceNamingAvailabilityError::Internal(error)) => {
                return Err(ProductMcpContextError::Internal(error));
            }
        };
    if available {
        available =
            match workspace_access_gate.assert_can_mutate_for_workspace(&request.workspace_id) {
                Ok(()) => true,
                Err(
                    WorkspaceAccessError::MutationBlocked { .. }
                    | WorkspaceAccessError::WorkspaceRetired(_),
                ) => false,
                Err(error) => return Err(ProductMcpContextError::Internal(error.into())),
            };
    }

    Ok(WorkspaceNamingMcpContext {
        workspace_id: request.workspace_id.clone(),
        session_id: request.session_id.clone(),
        available,
    })
}
