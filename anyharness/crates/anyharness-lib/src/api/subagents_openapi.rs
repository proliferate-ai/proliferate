use anyharness_contract::v1::{
    AgentOperationsAgent, AgentOperationsCapability, AgentOperationsConfiguration,
    AgentOperationsExecutionStatus, AgentOperationsIdentity, AgentOperationsPresentationStatus,
    AgentOperationsRole, AgentOperationsStatus, AgentOperationsWorkspaceIdentity,
    SessionSubagentsResponse, SubagentLatestCompletion, SubagentLifecycleResponse,
    SubagentParentRoster, SubagentRelationship, SubagentRosterEntry, WorkspaceSubagentsResponse,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        super::http::subagents::get_session_subagents,
        super::http::subagents::get_workspace_subagents,
        super::http::subagents::close_subagent,
        super::http::subagents::open_subagent,
        super::http::subagents::promote_subagent,
    ),
    components(schemas(
        SessionSubagentsResponse,
        WorkspaceSubagentsResponse,
        SubagentLifecycleResponse,
        SubagentParentRoster,
        SubagentRosterEntry,
        SubagentRelationship,
        SubagentLatestCompletion,
        AgentOperationsAgent,
        AgentOperationsIdentity,
        AgentOperationsWorkspaceIdentity,
        AgentOperationsRole,
        AgentOperationsConfiguration,
        AgentOperationsStatus,
        AgentOperationsPresentationStatus,
        AgentOperationsExecutionStatus,
        AgentOperationsCapability,
    ))
)]
pub(super) struct SubagentApiDoc;
