use super::error::{agent_operations_outcome_class, AgentOperationsError};
use crate::domains::agent_operations::model::{AgentCapability, CapabilityDenial};
use crate::domains::sessions::links::service::CreateSessionLinkError;
use crate::domains::sessions::mcp_bindings::workspace_attachment::{
    WorkspaceMcpAttachmentError, WORKSPACE_MCP_ATTACHMENT_CODE, WORKSPACE_MCP_ATTACHMENT_DETAIL,
};
use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, CreateOrdinaryAgentSessionError, CreateSubagentAgentSessionError,
};
use crate::domains::workspaces::access_gate::WorkspaceAccessError;

#[test]
fn workspace_create_agent_preserves_attachment_failure_code_and_fixed_message() {
    let error = AgentOperationsError::Create(CreateOrdinaryAgentSessionError::Create(
        CreateAndStartSessionError::WorkspaceMcpAttachmentFailed(
            WorkspaceMcpAttachmentError::summary_cleanup(anyhow::anyhow!("private token detail")),
        ),
    ));

    assert_eq!(error.code(), WORKSPACE_MCP_ATTACHMENT_CODE);
    assert_eq!(error.public_message(), WORKSPACE_MCP_ATTACHMENT_DETAIL);
    assert!(!error.public_message().contains("private token detail"));
}

#[test]
fn outcome_class_separates_denials_from_missing_targets_and_failures() {
    let denied = AgentOperationsError::CapabilityDenied {
        capability: AgentCapability::GetAgent,
        denial: CapabilityDenial::SubagentSameWorkspaceRequired,
    };
    assert_eq!(
        agent_operations_outcome_class(denied.code()),
        "denied",
        "same-workspace refusal is a denial, not a generic failure"
    );
    assert_eq!(
        agent_operations_outcome_class(AgentOperationsError::RuntimeBoundaryDenied.code()),
        "denied"
    );
    assert_eq!(
        agent_operations_outcome_class(AgentOperationsError::SubagentOpenRequired.code()),
        "denied"
    );
    let archived = AgentOperationsError::Create(CreateOrdinaryAgentSessionError::Access(
        WorkspaceAccessError::WorkspaceArchived("ws_1".into()),
    ));
    assert_eq!(
        agent_operations_outcome_class(archived.code()),
        "denied",
        "an archived workspace is a caller-caused refusal, not a generic failure"
    );
    let fanout_limit = AgentOperationsError::CreateSubagent(
        CreateSubagentAgentSessionError::Relationship(CreateSessionLinkError::FanoutLimit),
    );
    assert_eq!(
        agent_operations_outcome_class(fanout_limit.code()),
        "denied",
        "hitting the subagent fanout limit is a caller-caused refusal"
    );
    let single_session = AgentOperationsError::Create(CreateOrdinaryAgentSessionError::Create(
        CreateAndStartSessionError::WorkspaceSingleSession {
            session_id: "session_1".into(),
        },
    ));
    assert_eq!(
        agent_operations_outcome_class(single_session.code()),
        "denied",
        "a workspace already at its single-session limit is a caller-caused refusal"
    );
    assert_eq!(
        agent_operations_outcome_class(AgentOperationsError::AgentNotFound.code()),
        "not_found"
    );
    assert_eq!(
        agent_operations_outcome_class(AgentOperationsError::CallerNotFound.code()),
        "not_found"
    );
    assert_eq!(
        agent_operations_outcome_class(AgentOperationsError::InvalidCursor.code()),
        "error"
    );
    assert_eq!(
        agent_operations_outcome_class(
            AgentOperationsError::Internal(anyhow::anyhow!("boom")).code()
        ),
        "error"
    );
    // MCP-layer codes never reach AgentOperationsError::code().
    assert_eq!(
        agent_operations_outcome_class("WORKSPACE_MCP_TOOL_NOT_FOUND"),
        "not_found"
    );
    assert_eq!(
        agent_operations_outcome_class("WORKSPACE_MCP_ARGUMENTS_INVALID"),
        "error"
    );
}
