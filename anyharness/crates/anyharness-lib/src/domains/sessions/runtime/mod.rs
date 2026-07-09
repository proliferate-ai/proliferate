use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyharness_contract::v1::{
    McpElicitationSubmittedField, SessionMcpBindingSummary, UserInputSubmittedAnswer,
};

use super::active_goals::ActiveGoalResolver;
use super::links::model::SessionLinkRecord;
use super::links::service::SessionLinkService;
use super::mcp_bindings::crypto::SessionDataCipher;
use super::mcp_bindings::model::SessionMcpServer;
use super::mcp_bindings::product_catalog::ProductMcpLaunchCatalog;
use super::model::SessionRecord;
use super::plan_references::{PlanInteractionLinkResolver, PlanReferenceResolver};
use super::service::SessionService;
use crate::domains::agents::route_auth::RouteAuthError;
use crate::domains::sessions::extensions::SessionExtension;
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::sessions::LiveSessionManager;
use crate::live::workflows::WorkflowOwnedSessions;

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
    active_goal_resolver: Arc<dyn ActiveGoalResolver>,
    /// L17 lockout (C13 / E8): a session held by a non-terminal workflow run
    /// rejects every mutating verb with 409 `SESSION_WORKFLOW_HELD`; take-over is
    /// the only door. This is the same in-memory registry the workflow executor
    /// marks its sessions in (the run row is the durable lock — this is its
    /// cache). The executor is exempt by construction: it drives sessions through
    /// the internal provenance path, never these public methods.
    workflow_owned_sessions: Arc<WorkflowOwnedSessions>,
}

impl SessionRuntime {
    pub(crate) fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }

    /// The lockout guard shared by every public mutating verb (C13 / E8). Returns
    /// the holding run id when the session is engine-locked, so the caller can
    /// surface a typed `WorkflowHeld` error that maps to 409
    /// `SESSION_WORKFLOW_HELD` and routes the UI to the take-over modal.
    fn workflow_held_run(&self, session_id: &str) -> Option<String> {
        self.workflow_owned_sessions.held_run(session_id)
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
    /// Workspace runtime state blocks mutation (threaded typed so it surfaces as
    /// 409 `WORKSPACE_MUTATION_BLOCKED`, not a 500 — the access-gate 500-collapse
    /// fix, C13).
    Access(WorkspaceAccessError),
    /// The session is held by a non-terminal workflow run (C13 / E8).
    WorkflowHeld { run_id: String },
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SendPromptError {
    SessionNotFound(String),
    SessionClosed,
    EmptyPrompt,
    InvalidPrompt(crate::domains::sessions::prompt::PromptValidationError),
    /// See [`SetSessionConfigOptionError::Access`].
    Access(WorkspaceAccessError),
    /// The session is held by a non-terminal workflow run (C13 / E8).
    WorkflowHeld { run_id: String },
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
    /// See [`SetSessionConfigOptionError::Access`].
    Access(WorkspaceAccessError),
    /// The session is held by a non-terminal workflow run (C13 / E8).
    WorkflowHeld { run_id: String },
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
    /// The session is held by a non-terminal workflow run (C13 / E8). Editing or
    /// deleting a queued prompt on a workflow-driven session is blocked —
    /// take-over is the only door (E8).
    WorkflowHeld { run_id: String },
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SessionLifecycleError {
    SessionNotFound(String),
    /// See [`SetSessionConfigOptionError::Access`].
    Access(WorkspaceAccessError),
    /// The session is held by a non-terminal workflow run (C13 / E8). Blocks
    /// user-initiated cancel/close on a workflow-driven session — take-over is
    /// the only door (E8).
    WorkflowHeld { run_id: String },
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
        active_goal_resolver: Arc<dyn ActiveGoalResolver>,
        workflow_owned_sessions: Arc<WorkflowOwnedSessions>,
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
            active_goal_resolver,
            workflow_owned_sessions,
        }
    }

    pub fn forget_live_session_for_mobility_blocking(&self, session_id: &str) {
        self.acp_manager.remove_session_blocking(session_id);
    }
}
