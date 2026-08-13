use super::error::ApiError;
use crate::domains::agent_operations::runtime::AgentOperationsError;
use crate::domains::sessions::runtime::{EnsureLiveSessionError, SubagentLifecycleError};
use crate::domains::workspaces::options::WorkspaceOptionsError;

impl From<AgentOperationsError> for ApiError {
    fn from(error: AgentOperationsError) -> Self {
        let code = error.code();
        let detail = error.public_message();
        match error {
            AgentOperationsError::CallerNotFound
            | AgentOperationsError::AgentNotFound
            | AgentOperationsError::SubagentLifecycle(
                SubagentLifecycleError::RelationshipNotFound
                | SubagentLifecycleError::Resume(EnsureLiveSessionError::SessionNotFound(_)),
            ) => ApiError::not_found(detail, "AGENT_NOT_FOUND"),
            AgentOperationsError::Workspace(WorkspaceOptionsError::WorkspaceNotFound(_)) => {
                ApiError::not_found(detail, "WORKSPACE_NOT_FOUND")
            }
            AgentOperationsError::RuntimeBoundaryDenied
            | AgentOperationsError::CallerClosed
            | AgentOperationsError::CapabilityDenied { .. } => ApiError::forbidden(detail, code),
            AgentOperationsError::SubagentOpenRequired
            | AgentOperationsError::ControlledByWorkflow
            | AgentOperationsError::SubagentLifecycle(SubagentLifecycleError::OpenRequired) => {
                ApiError::conflict(detail, code)
            }
            AgentOperationsError::Internal(_)
            | AgentOperationsError::WorkspaceCatalogsUnavailable
            | AgentOperationsError::OrdinaryOperationsUnavailable
            | AgentOperationsError::MessagingUnavailable
            | AgentOperationsError::SubagentLifecycle(SubagentLifecycleError::Internal(_)) => {
                ApiError::internal(detail)
            }
            _ => ApiError::bad_request(detail, code),
        }
    }
}
