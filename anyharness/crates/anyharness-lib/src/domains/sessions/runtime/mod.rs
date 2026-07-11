use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyharness_contract::v1::{
    McpElicitationSubmittedField, SessionMcpBindingSummary, UserInputSubmittedAnswer,
};

use super::active_activity_roster::ActivityRosterResolver;
use super::active_goals::ActiveGoalResolver;
use super::active_loops::LoopsResolver;
use super::links::model::SessionLinkRecord;
use super::links::service::SessionLinkService;
use super::mcp_bindings::crypto::SessionDataCipher;
use super::mcp_bindings::model::SessionMcpServer;
use super::mcp_bindings::product_catalog::ProductMcpLaunchCatalog;
use super::model::SessionRecord;
use super::plan_references::{PlanInteractionLinkResolver, PlanReferenceResolver};
use super::service::SessionService;
use crate::domains::agents::route_auth::{GatewayModelResolve, RouteAuthError};
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
#[cfg(test)]
mod tests;
pub(crate) mod view;

pub struct SessionRuntime {
    session_service: Arc<SessionService>,
    session_link_service: SessionLinkService,
    workspace_runtime: Arc<WorkspaceRuntime>,
    acp_manager: LiveSessionManager,
    runtime_home: PathBuf,
    session_data_cipher: Option<SessionDataCipher>,
    session_extensions: Vec<Arc<dyn SessionExtension>>,
    product_mcp_launch_catalog: ProductMcpLaunchCatalog,
    access_gate: Arc<WorkspaceAccessGate>,
    plan_reference_resolver: Arc<dyn PlanReferenceResolver + Send + Sync>,
    plan_interaction_link_resolver: Arc<dyn PlanInteractionLinkResolver>,
    /// Catalog-driven gateway model resolver (spec §3): supplies the render
    /// plane's [`GatewayModelPlan`] and schedules launch-time lazy probes.
    gateway_model_resolver: Arc<dyn GatewayModelResolve>,
    active_goal_resolver: Arc<dyn ActiveGoalResolver>,
    loops_resolver: Arc<dyn LoopsResolver>,
    activity_roster_resolver: Arc<dyn ActivityRosterResolver>,
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
    /// The model is gated behind inactive auth contexts (decisions ledger 16).
    /// Carries the unlock condition (`required_contexts`) for the API layer.
    ModelGated {
        agent_kind: String,
        model_id: String,
        required_contexts: Vec<String>,
    },
    ModeUnsupported {
        agent_kind: String,
        mode_id: String,
    },
    WorkspaceNotFound,
    WorkspaceSingleSession {
        session_id: String,
    },
    MissingDataKey,
    /// Agent-auth route resolution refused the launch (fail-closed selection
    /// missing, malformed state file, unsupported route, ...). Typed so the
    /// API layer surfaces the stable machine code (`AGENT_ROUTE_*`).
    RouteAuth(RouteAuthError),
    StartFailed(anyhow::Error),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum EnsureLiveSessionError {
    SessionNotFound(String),
    SessionClosed,
    RestartRequired(String),
    Invalid(String),
    MissingDataKey,
    /// See [`CreateAndStartSessionError::RouteAuth`].
    RouteAuth(RouteAuthError),
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
pub enum PendingPromptQueueError {
    SessionNotFound(String),
    NotFound,
    StaleOrder { current_seqs: Vec<i64> },
    InvalidReorder(String),
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
    /// Agent-auth route resolution refused the launch (fail-closed, spec §3).
    RouteAuth(RouteAuthError),
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
        access_gate: Arc<WorkspaceAccessGate>,
        plan_reference_resolver: Arc<dyn PlanReferenceResolver + Send + Sync>,
        plan_interaction_link_resolver: Arc<dyn PlanInteractionLinkResolver>,
        gateway_model_resolver: Arc<dyn GatewayModelResolve>,
        active_goal_resolver: Arc<dyn ActiveGoalResolver>,
        loops_resolver: Arc<dyn LoopsResolver>,
        activity_roster_resolver: Arc<dyn ActivityRosterResolver>,
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
            access_gate,
            plan_reference_resolver,
            plan_interaction_link_resolver,
            gateway_model_resolver,
            active_goal_resolver,
            loops_resolver,
            activity_roster_resolver,
        }
    }

    pub fn forget_live_session_for_mobility_blocking(&self, session_id: &str) {
        self.acp_manager.remove_session_blocking(session_id);
    }
}
