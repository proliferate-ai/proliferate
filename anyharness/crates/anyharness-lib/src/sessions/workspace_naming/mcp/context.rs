use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};
use crate::sessions::store::SessionStore;
use crate::sessions::workspace_naming::eligibility;
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::runtime::WorkspaceRuntime;

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
    let available = eligibility::validate_tool_call(session_store, &workspace, &session).is_ok()
        && workspace_access_gate
            .assert_can_mutate_for_workspace(&request.workspace_id)
            .is_ok();

    Ok(WorkspaceNamingMcpContext {
        workspace_id: request.workspace_id.clone(),
        session_id: request.session_id.clone(),
        available,
    })
}
