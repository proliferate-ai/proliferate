use crate::domains::agent_operations::model::{
    AgentCapability, AgentConfigChoiceError, AgentLaunchSelectionError, CapabilityDenial,
    MAX_AGENT_PAGE_SIZE, MAX_WORKSPACE_PAGE_SIZE,
};
use crate::domains::sessions::task_output::TaskOutputError;
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
    #[error("the initial task must not be blank")]
    InvalidTask,
    #[error("session execution is controlled by an active workflow")]
    ControlledByWorkflow,
    #[error("ordinary agent operations are not configured")]
    OrdinaryOperationsUnavailable,
    #[error("subagent creation is declared for a later implementation slice")]
    SubagentCreationNotImplemented,
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
            Self::InvalidTask => "AGENT_TASK_INVALID",
            Self::ControlledByWorkflow => "SESSION_CONTROLLED_BY_WORKFLOW",
            Self::OrdinaryOperationsUnavailable => "AGENT_OPERATIONS_UNAVAILABLE",
            Self::SubagentCreationNotImplemented => "WORKSPACE_MCP_OPERATION_NOT_IMPLEMENTED",
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
            Self::InvalidTask => "The initial task must not be blank.".into(),
            Self::ControlledByWorkflow => {
                "Session execution is controlled by an active workflow.".into()
            }
            Self::OrdinaryOperationsUnavailable => {
                "Ordinary agent operations are unavailable.".into()
            }
            Self::SubagentCreationNotImplemented => {
                "Subagent creation is not implemented yet.".into()
            }
            Self::TaskOutput(TaskOutputError::InvalidLimit) => {
                "The task-output limit must be between 1 and 50.".into()
            }
            Self::TaskOutput(TaskOutputError::InvalidCursor) => {
                "The task-output cursor is invalid.".into()
            }
        }
    }
}
