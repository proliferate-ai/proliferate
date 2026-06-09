use super::super::service::{SubagentError, SubagentService, MAX_SUBAGENTS_PER_PARENT};
use crate::domains::workspaces::model::WorkspaceSurface;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};

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
    if parent.closed_at.is_some() || parent.status == "closed" {
        return Err(ProductMcpContextError::conflict("parent session is closed"));
    }
    let workspace = workspace_runtime
        .get_workspace(&request.workspace_id)?
        .ok_or_else(|| ProductMcpContextError::not_found("workspace not found"))?;
    if workspace.surface != WorkspaceSurface::Standard {
        return Err(ProductMcpContextError::conflict(
            "subagents are only available in standard workspaces",
        ));
    }
    let existing_subagent_count = service
        .list_subagents(&request.session_id)
        .map_err(|error| ProductMcpContextError::Internal(error.into()))?
        .len();
    let create_block_reason = match service.validate_parent_can_spawn(&request.session_id) {
        Ok(_) => None,
        Err(error) => Some(resolve_create_block_reason(error)?),
    };

    Ok(SubagentMcpContext {
        parent_session_id: request.session_id.clone(),
        workspace_id: request.workspace_id.clone(),
        can_create: create_block_reason.is_none(),
        create_block_reason,
        existing_subagent_count,
        max_subagents_per_parent: MAX_SUBAGENTS_PER_PARENT,
    })
}

fn resolve_create_block_reason(error: SubagentError) -> Result<String, ProductMcpContextError> {
    match error {
        reason @ (SubagentError::Disabled
        | SubagentError::DepthLimit
        | SubagentError::FanoutLimit
        | SubagentError::MutationBlocked(_)) => Ok(reason.to_string()),
        not_found @ (SubagentError::ParentNotFound(_)
        | SubagentError::ChildNotFound(_)
        | SubagentError::WorkspaceNotFound(_)) => {
            Err(ProductMcpContextError::not_found(not_found.to_string()))
        }
        conflict @ (SubagentError::IneligibleWorkspace
        | SubagentError::CrossWorkspace
        | SubagentError::NotOwned
        | SubagentError::TargetRequired
        | SubagentError::ConflictingTarget
        | SubagentError::Closed) => Err(ProductMcpContextError::conflict(conflict.to_string())),
        SubagentError::Link(error) => Err(ProductMcpContextError::Internal(error.into())),
        SubagentError::Internal(error) => Err(ProductMcpContextError::Internal(error)),
    }
}
