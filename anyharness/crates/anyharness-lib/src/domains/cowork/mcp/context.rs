use crate::domains::cowork::runtime::CoworkRuntime;
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};
use crate::workspaces::model::WorkspaceRecord;

#[derive(Debug, Clone)]
pub struct CoworkMcpContext {
    pub session_id: String,
    pub workspace: WorkspaceRecord,
    pub workspace_delegation_enabled: bool,
}

pub fn resolve_context(
    runtime: &CoworkRuntime,
    request: &ProductMcpRequestContext,
) -> Result<CoworkMcpContext, ProductMcpContextError> {
    let (thread, workspace, _session) = runtime
        .validate_canonical_thread(&request.workspace_id, &request.session_id)
        .map_err(map_context_error)?;

    Ok(CoworkMcpContext {
        session_id: request.session_id.clone(),
        workspace,
        workspace_delegation_enabled: thread.workspace_delegation_enabled,
    })
}

fn map_context_error(error: anyhow::Error) -> ProductMcpContextError {
    let message = error.to_string();
    match message.as_str() {
        "workspace not found" | "session not found" => ProductMcpContextError::not_found(message),
        "session does not belong to workspace"
        | "workspace is not a cowork workspace"
        | "session is not the canonical cowork session"
        | "cowork thread does not belong to workspace" => ProductMcpContextError::conflict(message),
        _ => ProductMcpContextError::Internal(error),
    }
}
