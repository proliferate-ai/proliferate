use crate::domains::agent_operations::model::{
    AgentCapability, AgentConfigChoiceError, AgentLaunchSelectionError, CapabilityDenial,
    MAX_AGENT_PAGE_SIZE, MAX_WORKSPACE_PAGE_SIZE,
};
use crate::domains::sessions::links::service::CreateSessionLinkError;
use crate::domains::sessions::mcp_bindings::workspace_attachment::{
    WORKSPACE_MCP_ATTACHMENT_CODE, WORKSPACE_MCP_ATTACHMENT_DETAIL,
};
use crate::domains::sessions::prompt::{
    AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE, AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL,
};
use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, CreateOrdinaryAgentSessionError, CreateSubagentAgentSessionError,
    EnsureLiveSessionError, SendPromptError, SessionLifecycleError, SetSessionConfigOptionError,
    SubagentLifecycleError,
};
use crate::domains::sessions::task_output::TaskOutputError;
use crate::domains::workspaces::access_gate::WorkspaceAccessError;
use crate::domains::workspaces::options::WorkspaceOptionsError;

#[derive(Debug, thiserror::Error)]
pub enum AgentOperationsError {
    #[error("the caller is outside this runtime")]
    RuntimeBoundaryDenied,
    #[error("caller agent not found")]
    CallerNotFound,
    #[error("caller agent is closed")]
    CallerClosed,
    #[error("agent not found")]
    AgentNotFound,
    #[error("capability denied: {capability:?}")]
    CapabilityDenied {
        capability: AgentCapability,
        denial: CapabilityDenial,
    },
    #[error("subagent must be opened before this operation")]
    SubagentOpenRequired,
    #[error("invalid agent-list cursor")]
    InvalidCursor,
    #[error("agent-list limit must be between 1 and {MAX_AGENT_PAGE_SIZE}")]
    InvalidPageSize,
    #[error("invalid workspace-list cursor")]
    InvalidWorkspaceCursor,
    #[error("workspace-list limit must be between 1 and {MAX_WORKSPACE_PAGE_SIZE}")]
    InvalidWorkspacePageSize,
    #[error(transparent)]
    Workspace(#[from] WorkspaceOptionsError),
    #[error("workspace and catalog ports are not configured")]
    WorkspaceCatalogsUnavailable,
    #[error("agent operations failed")]
    Internal(#[source] anyhow::Error),
    #[error("the selected launch option is stale or unavailable")]
    LaunchSelection(#[source] AgentLaunchSelectionError),
    #[error("the selected configuration option is stale or unavailable")]
    ConfigChoice(#[source] AgentConfigChoiceError),
    #[error("ordinary agent creation failed")]
    Create(CreateOrdinaryAgentSessionError),
    #[error("subagent creation failed")]
    CreateSubagent(CreateSubagentAgentSessionError),
    #[error("subagent lifecycle mutation failed")]
    SubagentLifecycle(SubagentLifecycleError),
    #[error("agent configuration failed")]
    Configure(SetSessionConfigOptionError),
    #[error("agent resume failed")]
    Resume(EnsureLiveSessionError),
    #[error("agent interrupt failed")]
    Interrupt(SessionLifecycleError),
    #[error("agent message enqueue failed")]
    SendMessage(SendPromptError),
    #[error("the initial task must not be blank")]
    InvalidTask,
    #[error("the message must not be blank")]
    InvalidMessage,
    #[error("session execution is controlled by an active workflow")]
    ControlledByWorkflow,
    #[error("ordinary agent operations are not configured")]
    OrdinaryOperationsUnavailable,
    #[error("agent messaging is not configured")]
    MessagingUnavailable,
    #[error(transparent)]
    TaskOutput(#[from] TaskOutputError),
}

impl AgentOperationsError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::RuntimeBoundaryDenied => "AGENT_RUNTIME_FORBIDDEN",
            Self::CallerNotFound => "AGENT_CALLER_NOT_FOUND",
            Self::CallerClosed => "AGENT_CALLER_CLOSED",
            Self::AgentNotFound => "AGENT_NOT_FOUND",
            Self::CapabilityDenied { .. } => "AGENT_CAPABILITY_DENIED",
            Self::SubagentOpenRequired => "SUBAGENT_OPEN_REQUIRED",
            Self::InvalidCursor => "AGENT_CURSOR_INVALID",
            Self::InvalidPageSize => "AGENT_PAGE_SIZE_INVALID",
            Self::InvalidWorkspaceCursor => "WORKSPACE_CURSOR_INVALID",
            Self::InvalidWorkspacePageSize => "WORKSPACE_PAGE_SIZE_INVALID",
            Self::Workspace(error) => error.code(),
            Self::WorkspaceCatalogsUnavailable => "WORKSPACE_CATALOGS_UNAVAILABLE",
            Self::Internal(_) => "AGENT_OPERATIONS_INTERNAL",
            Self::LaunchSelection(AgentLaunchSelectionError::AgentUnknown) => {
                "AGENT_LAUNCH_AGENT_UNKNOWN"
            }
            Self::LaunchSelection(AgentLaunchSelectionError::AgentUnavailable) => {
                "AGENT_LAUNCH_AGENT_UNAVAILABLE"
            }
            Self::LaunchSelection(AgentLaunchSelectionError::ModelUnknown) => {
                "AGENT_LAUNCH_MODEL_UNKNOWN"
            }
            Self::LaunchSelection(AgentLaunchSelectionError::ModelUnavailable) => {
                "AGENT_LAUNCH_MODEL_UNAVAILABLE"
            }
            Self::LaunchSelection(AgentLaunchSelectionError::ModeUnknown) => {
                "AGENT_LAUNCH_MODE_UNKNOWN"
            }
            Self::ConfigChoice(AgentConfigChoiceError::ConfigUnknown) => {
                "AGENT_CONFIG_OPTION_UNKNOWN"
            }
            Self::ConfigChoice(AgentConfigChoiceError::ConfigUnavailable) => {
                "AGENT_CONFIG_OPTION_UNAVAILABLE"
            }
            Self::ConfigChoice(AgentConfigChoiceError::ValueUnknown) => {
                "AGENT_CONFIG_VALUE_UNKNOWN"
            }
            Self::ConfigChoice(AgentConfigChoiceError::ValueUnavailable) => {
                "AGENT_CONFIG_VALUE_UNAVAILABLE"
            }
            Self::Create(error) => create_code(error),
            Self::CreateSubagent(error) => create_subagent_code(error),
            Self::SubagentLifecycle(error) => subagent_lifecycle_code(error),
            Self::Configure(error) => config_code(error),
            Self::Resume(error) => resume_code(error),
            Self::Interrupt(SessionLifecycleError::SessionNotFound(_)) => "AGENT_NOT_FOUND",
            Self::Interrupt(SessionLifecycleError::Internal(_)) => "AGENT_OPERATIONS_INTERNAL",
            Self::SendMessage(error) => message_code(error),
            Self::InvalidTask => "AGENT_TASK_INVALID",
            Self::InvalidMessage => "AGENT_MESSAGE_INVALID",
            Self::ControlledByWorkflow => "SESSION_CONTROLLED_BY_WORKFLOW",
            Self::OrdinaryOperationsUnavailable => "AGENT_OPERATIONS_UNAVAILABLE",
            Self::MessagingUnavailable => "AGENT_OPERATIONS_UNAVAILABLE",
            Self::TaskOutput(TaskOutputError::InvalidLimit) => "TASK_OUTPUT_LIMIT_INVALID",
            Self::TaskOutput(TaskOutputError::InvalidCursor) => "TASK_OUTPUT_CURSOR_INVALID",
            Self::TaskOutput(TaskOutputError::Internal(_)) => "AGENT_OPERATIONS_INTERNAL",
        }
    }

    pub fn public_message(&self) -> String {
        match self {
            Self::RuntimeBoundaryDenied => {
                "The requested agent is not available in this runtime.".into()
            }
            Self::CallerNotFound => "The calling agent was not found.".into(),
            Self::CallerClosed => "The calling agent is closed.".into(),
            Self::AgentNotFound => "The requested agent was not found.".into(),
            Self::CapabilityDenied { .. } => {
                "The calling agent does not have this capability.".into()
            }
            Self::SubagentOpenRequired => {
                "Open the subagent before performing this operation.".into()
            }
            Self::InvalidCursor => "The agent-list cursor is invalid.".into(),
            Self::InvalidPageSize => "The requested agent-list page size is invalid.".into(),
            Self::InvalidWorkspaceCursor => "The workspace-list cursor is invalid.".into(),
            Self::InvalidWorkspacePageSize => {
                "The requested workspace-list page size is invalid.".into()
            }
            Self::Workspace(error) => error.public_message(),
            Self::WorkspaceCatalogsUnavailable => {
                "Workspace catalog operations are unavailable.".into()
            }
            Self::Internal(_) | Self::TaskOutput(TaskOutputError::Internal(_)) => {
                "Agent operations failed.".into()
            }
            Self::LaunchSelection(_) => "The selected launch option is no longer available.".into(),
            Self::ConfigChoice(_) => {
                "The selected configuration option is no longer available.".into()
            }
            Self::Create(error) => create_public_message(error),
            Self::CreateSubagent(error) => create_subagent_public_message(error),
            Self::SubagentLifecycle(error) => subagent_lifecycle_public_message(error),
            Self::Configure(error) => config_public_message(error),
            Self::Resume(error) => resume_public_message(error),
            Self::Interrupt(SessionLifecycleError::SessionNotFound(_)) => {
                "The requested agent was not found.".into()
            }
            Self::Interrupt(SessionLifecycleError::Internal(_)) => {
                "Agent operations failed.".into()
            }
            Self::SendMessage(error) => message_public_message(error),
            Self::InvalidTask => "The initial task must not be blank.".into(),
            Self::InvalidMessage => "The message must not be blank.".into(),
            Self::ControlledByWorkflow => {
                "Session execution is controlled by an active workflow.".into()
            }
            Self::OrdinaryOperationsUnavailable => {
                "Ordinary agent operations are unavailable.".into()
            }
            Self::MessagingUnavailable => "Agent messaging is unavailable.".into(),
            Self::TaskOutput(TaskOutputError::InvalidLimit) => {
                "The task-output limit must be between 1 and 50.".into()
            }
            Self::TaskOutput(TaskOutputError::InvalidCursor) => {
                "The task-output cursor is invalid.".into()
            }
        }
    }
}

fn create_subagent_code(error: &CreateSubagentAgentSessionError) -> &'static str {
    match error {
        CreateSubagentAgentSessionError::Access(error) => workspace_access_code(error),
        CreateSubagentAgentSessionError::Create(error) => create_session_code(error),
        CreateSubagentAgentSessionError::Relationship(CreateSessionLinkError::FanoutLimit) => {
            "SUBAGENT_FANOUT_LIMIT"
        }
        CreateSubagentAgentSessionError::Relationship(
            CreateSessionLinkError::ParentNotFound(_)
            | CreateSessionLinkError::ChildNotFound(_)
            | CreateSessionLinkError::Duplicate
            | CreateSessionLinkError::ChildAlreadyLinked,
        ) => "AGENT_NOT_FOUND",
        CreateSubagentAgentSessionError::Relationship(
            CreateSessionLinkError::SelfLink | CreateSessionLinkError::Store(_),
        )
        | CreateSubagentAgentSessionError::Cleanup(_) => "AGENT_OPERATIONS_INTERNAL",
        CreateSubagentAgentSessionError::InitialTask(error) => prompt_code(error),
    }
}

fn subagent_lifecycle_code(error: &SubagentLifecycleError) -> &'static str {
    match error {
        SubagentLifecycleError::RelationshipNotFound => "AGENT_NOT_FOUND",
        SubagentLifecycleError::OpenRequired => "SUBAGENT_OPEN_REQUIRED",
        SubagentLifecycleError::Resume(error) => resume_code(error),
        SubagentLifecycleError::Internal(_) => "AGENT_OPERATIONS_INTERNAL",
    }
}

fn create_subagent_public_message(error: &CreateSubagentAgentSessionError) -> String {
    match error {
        CreateSubagentAgentSessionError::Access(error) => workspace_access_message(error),
        CreateSubagentAgentSessionError::Create(error) => create_session_public_message(error),
        CreateSubagentAgentSessionError::Relationship(CreateSessionLinkError::FanoutLimit) => {
            "This agent already has the maximum of eight active subagents.".into()
        }
        CreateSubagentAgentSessionError::Relationship(
            CreateSessionLinkError::ParentNotFound(_)
            | CreateSessionLinkError::ChildNotFound(_)
            | CreateSessionLinkError::Duplicate
            | CreateSessionLinkError::ChildAlreadyLinked,
        ) => "The requested agent was not found.".into(),
        CreateSubagentAgentSessionError::Relationship(
            CreateSessionLinkError::SelfLink | CreateSessionLinkError::Store(_),
        )
        | CreateSubagentAgentSessionError::Cleanup(_) => "Agent operations failed.".into(),
        CreateSubagentAgentSessionError::InitialTask(error) => prompt_public_message(error),
    }
}

fn subagent_lifecycle_public_message(error: &SubagentLifecycleError) -> String {
    match error {
        SubagentLifecycleError::RelationshipNotFound => "The requested agent was not found.".into(),
        SubagentLifecycleError::OpenRequired => {
            "Open the subagent before performing this operation.".into()
        }
        SubagentLifecycleError::Resume(error) => resume_public_message(error),
        SubagentLifecycleError::Internal(_) => "Agent operations failed.".into(),
    }
}

fn create_code(error: &CreateOrdinaryAgentSessionError) -> &'static str {
    match error {
        CreateOrdinaryAgentSessionError::Access(error) => workspace_access_code(error),
        CreateOrdinaryAgentSessionError::Create(error) => create_session_code(error),
        CreateOrdinaryAgentSessionError::InitialTask(error) => prompt_code(error),
        CreateOrdinaryAgentSessionError::Cleanup(_) => "AGENT_OPERATIONS_INTERNAL",
    }
}

fn create_session_code(error: &CreateAndStartSessionError) -> &'static str {
    match error {
        CreateAndStartSessionError::Invalid(_) => "SESSION_CREATE_FAILED",
        CreateAndStartSessionError::ModelUnsupported { .. } => "SESSION_MODEL_UNSUPPORTED",
        CreateAndStartSessionError::ModeUnsupported { .. } => "SESSION_MODE_UNSUPPORTED",
        CreateAndStartSessionError::WorkspaceNotFound => "WORKSPACE_NOT_FOUND",
        CreateAndStartSessionError::WorkspaceDirectoryMissing { .. } => {
            "WORKSPACE_DIRECTORY_MISSING"
        }
        CreateAndStartSessionError::WorkspaceSingleSession { .. } => "WORKSPACE_SINGLE_SESSION",
        CreateAndStartSessionError::SessionIdConflict { .. } => "SESSION_ID_CONFLICT",
        CreateAndStartSessionError::WorkspaceMcpAttachmentFailed(_) => {
            WORKSPACE_MCP_ATTACHMENT_CODE
        }
        CreateAndStartSessionError::RouteAuth(error) => error.code(),
        CreateAndStartSessionError::MissingDataKey
        | CreateAndStartSessionError::StartFailed(_)
        | CreateAndStartSessionError::Internal(_) => "AGENT_OPERATIONS_INTERNAL",
    }
}

fn prompt_code(error: &SendPromptError) -> &'static str {
    match error {
        SendPromptError::SessionNotFound(_) => "AGENT_NOT_FOUND",
        SendPromptError::SessionClosed => "SESSION_CLOSED",
        SendPromptError::EmptyPrompt => "AGENT_TASK_INVALID",
        SendPromptError::WorkspaceDirectoryMissing { .. } => "WORKSPACE_DIRECTORY_MISSING",
        SendPromptError::InvalidPrompt(error) => error.code,
        SendPromptError::WorkspaceMcpAttachmentFailed(_) => WORKSPACE_MCP_ATTACHMENT_CODE,
        SendPromptError::ProductContextUnavailable { .. } => AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE,
        SendPromptError::Internal(_) => "AGENT_OPERATIONS_INTERNAL",
    }
}

fn message_code(error: &SendPromptError) -> &'static str {
    match error {
        SendPromptError::EmptyPrompt | SendPromptError::InvalidPrompt(_) => "AGENT_MESSAGE_INVALID",
        other => prompt_code(other),
    }
}

fn config_code(error: &SetSessionConfigOptionError) -> &'static str {
    match error {
        SetSessionConfigOptionError::SessionNotFound(_) => "AGENT_NOT_FOUND",
        SetSessionConfigOptionError::Rejected(_) => "SESSION_CONFIG_REJECTED",
        SetSessionConfigOptionError::WorkspaceDirectoryMissing { .. } => {
            "WORKSPACE_DIRECTORY_MISSING"
        }
        SetSessionConfigOptionError::Internal(_) => "AGENT_OPERATIONS_INTERNAL",
    }
}

fn resume_code(error: &EnsureLiveSessionError) -> &'static str {
    match error {
        EnsureLiveSessionError::SessionNotFound(_) => "AGENT_NOT_FOUND",
        EnsureLiveSessionError::SessionClosed => "SESSION_CLOSED",
        EnsureLiveSessionError::RestartRequired(_) => "SESSION_RESTART_REQUIRED",
        EnsureLiveSessionError::Invalid(_) => "SESSION_RESUME_FAILED",
        EnsureLiveSessionError::WorkspaceDirectoryMissing { .. } => "WORKSPACE_DIRECTORY_MISSING",
        EnsureLiveSessionError::RouteAuth(error) => error.code(),
        EnsureLiveSessionError::AgentNotReady { .. } => "AGENT_NOT_READY",
        EnsureLiveSessionError::WorkspaceMcpAttachmentFailed(_) => WORKSPACE_MCP_ATTACHMENT_CODE,
        EnsureLiveSessionError::MissingDataKey | EnsureLiveSessionError::Internal(_) => {
            "AGENT_OPERATIONS_INTERNAL"
        }
    }
}

fn workspace_access_code(error: &WorkspaceAccessError) -> &'static str {
    match error {
        WorkspaceAccessError::WorkspaceNotFound(_) => "WORKSPACE_NOT_FOUND",
        WorkspaceAccessError::SessionNotFound(_) => "SESSION_NOT_FOUND",
        WorkspaceAccessError::TerminalNotFound(_) => "TERMINAL_NOT_FOUND",
        WorkspaceAccessError::MutationBlocked { .. } => "WORKSPACE_MUTATION_BLOCKED",
        WorkspaceAccessError::LiveSessionStartBlocked { .. } => "WORKSPACE_LIVE_SESSION_BLOCKED",
        WorkspaceAccessError::WorkspaceRetired(_) => "WORKSPACE_RETIRED",
        WorkspaceAccessError::Unexpected(_) => "AGENT_OPERATIONS_INTERNAL",
    }
}

fn create_public_message(error: &CreateOrdinaryAgentSessionError) -> String {
    match error {
        CreateOrdinaryAgentSessionError::Access(error) => workspace_access_message(error),
        CreateOrdinaryAgentSessionError::Create(error) => create_session_public_message(error),
        CreateOrdinaryAgentSessionError::InitialTask(error) => prompt_public_message(error),
        CreateOrdinaryAgentSessionError::Cleanup(_) => "Agent operations failed.".into(),
    }
}

fn create_session_public_message(error: &CreateAndStartSessionError) -> String {
    match error {
        CreateAndStartSessionError::Invalid(_) => "The agent session could not be created.".into(),
        CreateAndStartSessionError::ModelUnsupported { .. } => {
            "The selected model is not supported for this agent.".into()
        }
        CreateAndStartSessionError::ModeUnsupported { .. } => {
            "The selected mode is not supported for this agent.".into()
        }
        CreateAndStartSessionError::WorkspaceNotFound => {
            "The requested workspace was not found.".into()
        }
        CreateAndStartSessionError::WorkspaceDirectoryMissing { .. } => {
            "The workspace checkout directory is missing.".into()
        }
        CreateAndStartSessionError::WorkspaceSingleSession { .. } => {
            "The workspace already has its allowed session.".into()
        }
        CreateAndStartSessionError::SessionIdConflict { .. } => {
            "The requested session identity is already in use.".into()
        }
        CreateAndStartSessionError::WorkspaceMcpAttachmentFailed(_) => {
            WORKSPACE_MCP_ATTACHMENT_DETAIL.into()
        }
        CreateAndStartSessionError::RouteAuth(_) => {
            "The selected agent route is not ready for launch.".into()
        }
        CreateAndStartSessionError::MissingDataKey
        | CreateAndStartSessionError::StartFailed(_)
        | CreateAndStartSessionError::Internal(_) => "Agent operations failed.".into(),
    }
}

fn prompt_public_message(error: &SendPromptError) -> String {
    match error {
        SendPromptError::SessionNotFound(_) => "The requested agent was not found.".into(),
        SendPromptError::SessionClosed => "The agent session is closed.".into(),
        SendPromptError::EmptyPrompt => "The initial task must not be blank.".into(),
        SendPromptError::WorkspaceDirectoryMissing { .. } => {
            "The workspace checkout directory is missing.".into()
        }
        SendPromptError::InvalidPrompt(_) => "The initial task is invalid.".into(),
        SendPromptError::WorkspaceMcpAttachmentFailed(_) => WORKSPACE_MCP_ATTACHMENT_DETAIL.into(),
        SendPromptError::ProductContextUnavailable { .. } => {
            AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL.into()
        }
        SendPromptError::Internal(_) => "Agent operations failed.".into(),
    }
}

fn message_public_message(error: &SendPromptError) -> String {
    match error {
        SendPromptError::SessionNotFound(_) => "The requested agent was not found.".into(),
        SendPromptError::SessionClosed => "The agent session is closed.".into(),
        SendPromptError::EmptyPrompt => "The message must not be blank.".into(),
        SendPromptError::WorkspaceDirectoryMissing { .. } => {
            "The workspace checkout directory is missing.".into()
        }
        SendPromptError::InvalidPrompt(_) => "The message is invalid.".into(),
        SendPromptError::WorkspaceMcpAttachmentFailed(_) => WORKSPACE_MCP_ATTACHMENT_DETAIL.into(),
        SendPromptError::ProductContextUnavailable { .. } => {
            AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL.into()
        }
        SendPromptError::Internal(_) => "Agent operations failed.".into(),
    }
}

fn config_public_message(error: &SetSessionConfigOptionError) -> String {
    match error {
        SetSessionConfigOptionError::SessionNotFound(_) => {
            "The requested agent was not found.".into()
        }
        SetSessionConfigOptionError::Rejected(_) => {
            "The agent rejected the configuration change.".into()
        }
        SetSessionConfigOptionError::WorkspaceDirectoryMissing { .. } => {
            "The workspace checkout directory is missing.".into()
        }
        SetSessionConfigOptionError::Internal(_) => "Agent operations failed.".into(),
    }
}

fn resume_public_message(error: &EnsureLiveSessionError) -> String {
    match error {
        EnsureLiveSessionError::SessionNotFound(_) => "The requested agent was not found.".into(),
        EnsureLiveSessionError::SessionClosed => "The agent session is closed.".into(),
        EnsureLiveSessionError::RestartRequired(_) => {
            "Restart the session before resuming it.".into()
        }
        EnsureLiveSessionError::Invalid(_) => "The agent session could not be resumed.".into(),
        EnsureLiveSessionError::WorkspaceDirectoryMissing { .. } => {
            "The workspace checkout directory is missing.".into()
        }
        EnsureLiveSessionError::RouteAuth(_) => {
            "The selected agent route is not ready for launch.".into()
        }
        EnsureLiveSessionError::AgentNotReady { .. } => {
            "The selected agent is not ready to launch.".into()
        }
        EnsureLiveSessionError::WorkspaceMcpAttachmentFailed(_) => {
            WORKSPACE_MCP_ATTACHMENT_DETAIL.into()
        }
        EnsureLiveSessionError::MissingDataKey | EnsureLiveSessionError::Internal(_) => {
            "Agent operations failed.".into()
        }
    }
}

fn workspace_access_message(error: &WorkspaceAccessError) -> String {
    match error {
        WorkspaceAccessError::WorkspaceNotFound(_) => {
            "The requested workspace was not found.".into()
        }
        WorkspaceAccessError::SessionNotFound(_) => "The requested session was not found.".into(),
        WorkspaceAccessError::TerminalNotFound(_) => "The requested terminal was not found.".into(),
        WorkspaceAccessError::MutationBlocked { .. } => {
            "Workspace mutation is currently blocked.".into()
        }
        WorkspaceAccessError::LiveSessionStartBlocked { .. } => {
            "The workspace cannot start live sessions right now.".into()
        }
        WorkspaceAccessError::WorkspaceRetired(_) => "The workspace is retired.".into(),
        WorkspaceAccessError::Unexpected(_) => "Agent operations failed.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::mcp_bindings::workspace_attachment::WorkspaceMcpAttachmentError;

    #[test]
    fn workspace_create_agent_preserves_attachment_failure_code_and_fixed_message() {
        let error = AgentOperationsError::Create(CreateOrdinaryAgentSessionError::Create(
            CreateAndStartSessionError::WorkspaceMcpAttachmentFailed(
                WorkspaceMcpAttachmentError::summary_cleanup(anyhow::anyhow!(
                    "private token detail"
                )),
            ),
        ));

        assert_eq!(error.code(), WORKSPACE_MCP_ATTACHMENT_CODE);
        assert_eq!(error.public_message(), WORKSPACE_MCP_ATTACHMENT_DETAIL);
        assert!(!error.public_message().contains("private token detail"));
    }
}
