use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyharness_contract::v1::{
    McpElicitationSubmittedField, SessionMcpBindingSummary, UserInputSubmittedAnswer,
};

use super::links::model::SessionLinkRecord;
use super::links::service::SessionLinkService;
use super::mcp_bindings::crypto::SessionDataCipher;
use super::mcp_bindings::model::SessionMcpServer;
use super::mcp_bindings::product_catalog::ProductMcpLaunchCatalog;
use super::model::SessionRecord;
use super::plan_references::{PlanInteractionLinkResolver, PlanReferenceResolver};
use super::service::SessionService;
use crate::domains::agents::auth::{AgentAuthSelectionRequired, AgentAuthService};
use crate::domains::runtime_config::service::RuntimeConfigService;
use crate::domains::sessions::extensions::SessionExtension;
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::sessions::LiveSessionManager;

mod config;
mod creation;
mod fork;
mod interactions;
mod launch_env;
mod launch_policy;
mod lifecycle;
mod pending_prompts;
mod prompt;
mod replay;
mod startup;
pub(crate) mod view;
#[cfg(test)]
mod tests;

pub struct SessionRuntime {
    session_service: Arc<SessionService>,
    session_link_service: SessionLinkService,
    workspace_runtime: Arc<WorkspaceRuntime>,
    acp_manager: LiveSessionManager,
    runtime_home: PathBuf,
    session_data_cipher: Option<SessionDataCipher>,
    session_extensions: Vec<Arc<dyn SessionExtension>>,
    product_mcp_launch_catalog: ProductMcpLaunchCatalog,
    runtime_config_service: Arc<RuntimeConfigService>,
    access_gate: Arc<WorkspaceAccessGate>,
    plan_reference_resolver: Arc<dyn PlanReferenceResolver + Send + Sync>,
    plan_interaction_link_resolver: Arc<dyn PlanInteractionLinkResolver>,
    agent_auth_service: Arc<AgentAuthService>,
}

impl SessionRuntime {
    pub(crate) fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }
}

#[derive(Debug)]
pub enum CreateAndStartSessionError {
    Invalid(String),
    ModelUnsupported {
        agent_kind: String,
        model_id: String,
    },
    ModeUnsupported {
        agent_kind: String,
        mode_id: String,
    },
    AgentAuthSelectionRequired(AgentAuthSelectionRequired),
    WorkspaceNotFound,
    WorkspaceSingleSession {
        session_id: String,
    },
    MissingDataKey,
    StartFailed(anyhow::Error),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum EnsureLiveSessionError {
    SessionNotFound(String),
    SessionClosed,
    RestartRequired(String),
    AgentAuthSelectionRequired(AgentAuthSelectionRequired),
    Invalid(String),
    MissingDataKey,
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub struct SessionMcpRefresh {
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
}

#[derive(Debug)]
pub enum SetSessionConfigOptionError {
    SessionNotFound(String),
    Rejected(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SendPromptError {
    SessionNotFound(String),
    SessionClosed,
    EmptyPrompt,
    InvalidPrompt(crate::domains::sessions::prompt::PromptValidationError),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SendPromptOutcome {
    Running {
        session: SessionRecord,
        turn_id: String,
    },
    Queued {
        session: SessionRecord,
        seq: i64,
    },
}

#[derive(Debug)]
pub enum ForkSessionError {
    SessionNotFound(String),
    Unsupported(String),
    Busy,
    Invalid(String),
    MissingNativeSessionId,
    MissingDataKey,
    StartFailed {
        session: SessionRecord,
        link: SessionLinkRecord,
        error: anyhow::Error,
    },
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub struct ForkSessionOutcome {
    pub session: SessionRecord,
    pub link: SessionLinkRecord,
    pub child_started: bool,
}

#[derive(Debug)]
pub enum PendingPromptMutationError {
    SessionNotFound(String),
    NotFound,
    InvalidPrompt(crate::domains::sessions::prompt::PromptValidationError),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SessionLifecycleError {
    SessionNotFound(String),
    Internal(anyhow::Error),
}

#[derive(Debug, Clone)]
pub enum InteractionPermissionDecision {
    Allow,
    Deny,
}

#[derive(Clone)]
pub enum ResolutionRequest {
    Decision(InteractionPermissionDecision),
    OptionId(String),
    Submitted {
        answers: Vec<UserInputSubmittedAnswer>,
    },
    Accepted {
        fields: Vec<McpElicitationSubmittedField>,
    },
    Declined,
    Cancelled,
    Dismissed,
}

impl fmt::Debug for ResolutionRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Decision(decision) => f.debug_tuple("Decision").field(decision).finish(),
            Self::OptionId(option_id) => f.debug_tuple("OptionId").field(option_id).finish(),
            Self::Submitted { answers } => f
                .debug_struct("Submitted")
                .field("answer_count", &answers.len())
                .field(
                    "question_ids",
                    &answers
                        .iter()
                        .map(|answer| answer.question_id.as_str())
                        .collect::<Vec<_>>(),
                )
                .finish(),
            Self::Accepted { fields } => f
                .debug_struct("Accepted")
                .field("field_count", &fields.len())
                .field(
                    "field_ids",
                    &fields
                        .iter()
                        .map(|field| field.field_id.as_str())
                        .collect::<Vec<_>>(),
                )
                .finish(),
            Self::Declined => f.write_str("Declined"),
            Self::Cancelled => f.write_str("Cancelled"),
            Self::Dismissed => f.write_str("Dismissed"),
        }
    }
}

#[derive(Debug)]
pub enum ResolveInteractionError {
    SessionNotLive(String),
    InteractionNotFound(String),
    InteractionKindMismatch(String),
    PlanLinkedInteraction(String),
    InvalidOptionId(String),
    InvalidQuestionId(String),
    DuplicateQuestionAnswer(String),
    MissingQuestionAnswer(String),
    InvalidSelectedOptionLabel(String),
    InvalidMcpFieldId(String),
    DuplicateMcpField(String),
    MissingMcpField(String),
    InvalidMcpFieldValue(String),
    NotMcpUrlElicitation(String),
    Access(WorkspaceAccessError),
    Internal(anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct McpElicitationUrlReveal {
    pub url: String,
}

#[derive(Debug)]
pub(super) enum StartSessionError {
    WorkspaceNotFound,
    AgentDescriptorNotFound(String),
    Closed,
    MissingDataKey,
    RestartRequired(String),
    AgentAuthSelectionRequired(AgentAuthSelectionRequired),
    Internal(anyhow::Error),
    AcpStart(anyhow::Error),
}

impl SessionRuntime {
    pub fn new(
        session_service: Arc<SessionService>,
        session_link_service: SessionLinkService,
        workspace_runtime: Arc<WorkspaceRuntime>,
        acp_manager: LiveSessionManager,
        runtime_home: PathBuf,
        session_data_cipher: Option<SessionDataCipher>,
        session_extensions: Vec<Arc<dyn SessionExtension>>,
        product_mcp_launch_catalog: ProductMcpLaunchCatalog,
        runtime_config_service: Arc<RuntimeConfigService>,
        access_gate: Arc<WorkspaceAccessGate>,
        plan_reference_resolver: Arc<dyn PlanReferenceResolver + Send + Sync>,
        plan_interaction_link_resolver: Arc<dyn PlanInteractionLinkResolver>,
        agent_auth_service: Arc<AgentAuthService>,
    ) -> Self {
        Self {
            session_service,
            session_link_service,
            workspace_runtime,
            acp_manager,
            runtime_home,
            session_data_cipher,
            session_extensions,
            product_mcp_launch_catalog,
            runtime_config_service,
            access_gate,
            plan_reference_resolver,
            plan_interaction_link_resolver,
            agent_auth_service,
        }
    }

    pub fn forget_live_session_for_mobility_blocking(&self, session_id: &str) {
        self.acp_manager.remove_session_blocking(session_id);
    }
}
