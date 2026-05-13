use super::super::service::{SubagentService, MAX_SUBAGENTS_PER_PARENT};
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug, Clone)]
pub struct SubagentMcpContext {
    pub parent_session_id: String,
    pub workspace_id: String,
    pub can_create: bool,
    pub create_block_reason: Option<String>,
    pub existing_subagent_count: usize,
    pub max_subagents_per_parent: usize,
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
    let existing_subagent_count = service
        .list_subagents(&request.session_id)
        .map_err(|error| ProductMcpContextError::Internal(error.into()))?
        .len();
    let create_block_reason = service
        .validate_parent_can_spawn(&request.session_id)
        .err()
        .map(|error| error.to_string());

    Ok(SubagentMcpContext {
        parent_session_id: request.session_id.clone(),
        workspace_id: request.workspace_id.clone(),
        can_create: create_block_reason.is_none(),
        create_block_reason,
        existing_subagent_count,
        max_subagents_per_parent: MAX_SUBAGENTS_PER_PARENT,
    })
}
