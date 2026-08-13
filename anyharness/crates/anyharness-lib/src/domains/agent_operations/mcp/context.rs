use crate::domains::agent_operations::model::AuthenticatedAgentCaller;
use crate::domains::agent_operations::runtime::AgentOperations;
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};

#[derive(Debug, Clone)]
pub struct WorkspaceMcpContext {
    pub caller: AuthenticatedAgentCaller,
}

pub fn resolve_context(
    operations: &AgentOperations,
    request: &ProductMcpRequestContext,
) -> Result<WorkspaceMcpContext, ProductMcpContextError> {
    if request.product_mcp_id != super::definition::ID {
        return Err(ProductMcpContextError::not_found("Workspace MCP not found"));
    }
    let caller = operations.authenticated_caller(request.session_id.clone());
    operations
        .verify_caller_workspace(&caller, &request.workspace_id)
        .map_err(|error| match error {
            crate::domains::agent_operations::runtime::AgentOperationsError::Internal(error) => {
                ProductMcpContextError::Internal(error)
            }
            _ => ProductMcpContextError::not_found("calling agent not found"),
        })?;
    Ok(WorkspaceMcpContext { caller })
}
