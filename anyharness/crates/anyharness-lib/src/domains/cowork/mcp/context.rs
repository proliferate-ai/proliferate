use crate::domains::cowork::runtime::{CoworkCanonicalThreadError, CoworkRuntime};
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};

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
        .map_err(ProductMcpContextError::from)?;

    Ok(CoworkMcpContext {
        session_id: request.session_id.clone(),
        workspace,
        workspace_delegation_enabled: thread.workspace_delegation_enabled,
    })
}

impl From<CoworkCanonicalThreadError> for ProductMcpContextError {
    fn from(error: CoworkCanonicalThreadError) -> Self {
        match error {
            CoworkCanonicalThreadError::WorkspaceNotFound
            | CoworkCanonicalThreadError::SessionNotFound => {
                ProductMcpContextError::not_found(error.to_string())
            }
            CoworkCanonicalThreadError::SessionWorkspaceMismatch
            | CoworkCanonicalThreadError::SessionClosed
            | CoworkCanonicalThreadError::NotCoworkWorkspace
            | CoworkCanonicalThreadError::NotCanonicalCoworkSession
            | CoworkCanonicalThreadError::ThreadWorkspaceMismatch => {
                ProductMcpContextError::conflict(error.to_string())
            }
            CoworkCanonicalThreadError::Internal(error) => ProductMcpContextError::Internal(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_mapping_preserves_not_found_errors() {
        let error = ProductMcpContextError::from(CoworkCanonicalThreadError::WorkspaceNotFound);

        assert!(matches!(error, ProductMcpContextError::NotFound(_)));
    }

    #[test]
    fn context_mapping_preserves_conflict_errors() {
        for error in [
            CoworkCanonicalThreadError::SessionWorkspaceMismatch,
            CoworkCanonicalThreadError::SessionClosed,
            CoworkCanonicalThreadError::NotCoworkWorkspace,
            CoworkCanonicalThreadError::NotCanonicalCoworkSession,
            CoworkCanonicalThreadError::ThreadWorkspaceMismatch,
        ] {
            let message = error.to_string();
            let error = ProductMcpContextError::from(error);

            assert!(
                matches!(error, ProductMcpContextError::Conflict(_)),
                "expected conflict for {message}"
            );
        }
    }
}
