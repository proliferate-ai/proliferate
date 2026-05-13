use super::super::service::SubagentService;
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug, Clone)]
pub struct SubagentMcpContext {
    pub parent_session_id: String,
}

pub fn resolve_context(
    service: &SubagentService,
    workspace_runtime: &WorkspaceRuntime,
    request: &ProductMcpRequestContext,
) -> Result<SubagentMcpContext, ProductMcpContextError> {
    let parent = service
        .session_store()
        .find_by_id(&request.session_id)?
        .ok_or_else(|| ProductMcpContextError::not_found("parent session not found"))?;
    if parent.workspace_id != request.workspace_id {
        return Err(ProductMcpContextError::conflict(
            "parent session does not belong to workspace",
        ));
    }
    let workspace = workspace_runtime
        .get_workspace(&request.workspace_id)?
        .ok_or_else(|| ProductMcpContextError::not_found("workspace not found"))?;
    if workspace.surface != "standard" {
        return Err(ProductMcpContextError::conflict(
            "subagents are only available in standard workspaces",
        ));
    }

    Ok(SubagentMcpContext {
        parent_session_id: request.session_id.clone(),
    })
}
