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
use super::mcp_bindings::workspace_attachment::WorkspaceMcpAttachmentError;
use super::model::SessionRecord;
use super::plan_references::{PlanInteractionLinkResolver, PlanReferenceResolver};
use super::service::SessionService;
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agent_auth::route_auth::{GatewayModelResolve, RouteAuthError};
use crate::domains::sessions::extensions::SessionExtension;
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::checkpoints::WorkspaceCheckpointService;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::sessions::LiveSessionManager;

mod agent_creation;
#[cfg(test)]
mod checkpoint_dispatch_tests;
mod checkpoint_hook;
#[cfg(test)]
mod checkpoint_linkage_tests;
#[cfg(test)]
mod checkpoint_queue_settlement_tests;
mod config;
mod creation;
#[cfg(test)]
mod dispatch_classification_tests;
mod fork;
pub(crate) mod fork_anchor;
#[cfg(test)]
mod fork_anchor_gate_tests;
pub(crate) mod fork_boundary;
#[cfg(test)]
mod fork_dispatch_and_restart_tests;
#[cfg(test)]
mod fork_process_local_lifecycle_tests;
#[cfg(test)]
mod fork_prompt_terminal_protection_tests;
pub(crate) mod fork_qualification;
#[cfg(test)]
mod fork_scenario_fixtures_tests;
#[cfg(test)]
mod idempotent_creation_tests;
mod interactions;
mod launch_env;
#[cfg(test)]
mod launch_env_tests;
mod launch_policy;
mod lifecycle;
#[cfg(test)]
mod lifecycle_tests;
pub(crate) mod opencode_sidedoor_client;
mod pending_prompts;
mod prompt;
mod prompt_dispatch;
mod prompt_lease;
#[cfg(test)]
pub(crate) mod prompt_message_actor_tests;
#[cfg(test)]
mod prompt_message_cold_start_tests;
#[cfg(test)]
mod prompt_message_tests;
mod prompt_queue;
mod replay;
mod startup;
mod startup_errors;
pub(crate) mod startup_facts;
mod startup_lifecycle;
mod subagent_lifecycle;
#[cfg(test)]
mod tests;
pub(crate) mod view;
mod workspace_mcp_attachment;

pub use agent_creation::{CreateOrdinaryAgentSessionError, CreateSubagentAgentSessionError};
pub(crate) use creation::{InternalSessionCreateError, InternalSessionCreateInput};
pub(crate) use lifecycle::LiveTurnCancelOutcome;
pub(crate) use prompt_dispatch::TextPromptDispatchError;

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
    workspace_operation_gate: Arc<WorkspaceOperationGate>,
    plan_reference_resolver: Arc<dyn PlanReferenceResolver + Send + Sync>,
    plan_interaction_link_resolver: Arc<dyn PlanInteractionLinkResolver>,
    /// Catalog-driven gateway model planner: supplies the render plane's
    /// [`GatewayModelPlan`]. Materialization input only.
    gateway_model_resolver: Arc<dyn GatewayModelResolve>,
    active_goal_resolver: Arc<dyn ActiveGoalResolver>,
    loops_resolver: Arc<dyn LoopsResolver>,
    activity_roster_resolver: Arc<dyn ActivityRosterResolver>,
    /// Checkpoints (Lane H): the turn-start capture hook lives at the prompt
    /// dispatch seam (`prompt.rs`), and fork linkage reads the boundary
    /// checkpoint through this handle. Behind `ANYHARNESS_CHECKPOINT_CAPTURE`.
    checkpoint_service: Arc<WorkspaceCheckpointService>,
}

impl SessionRuntime {
    pub(crate) fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }

    /// Merge-gated seam: the live-session manager, for registering scripted
    /// handles that drive the cancellation seams deterministically.
    #[cfg(test)]
    pub(crate) fn acp_manager_for_test(&self) -> &LiveSessionManager {
        &self.acp_manager
    }
}

#[derive(Debug)]
pub enum CreateAndStartSessionError {
    Invalid(String),
    LaunchOptionsUnavailable {
        agent_kind: String,
        state: Option<crate::domains::agents::launch_options::HarnessLaunchOptionsState>,
    },
    LaunchValueUnsupported {
        agent_kind: String,
        key: String,
        value: String,
        state: crate::domains::agents::launch_options::HarnessLaunchOptionsState,
    },
    AgentEnvOverrideUnsupported {
        agent_kind: String,
        env_var_name: String,
    },
    WorkspaceNotFound,
    /// The workspace's local checkout directory has been deleted from disk.
    /// Caught before creating a durable session so a deleted checkout never
    /// leaves behind an empty errored session row.
    WorkspaceDirectoryMissing {
        path: String,
    },
    WorkspaceSingleSession {
        session_id: String,
    },
    SessionIdConflict {
        session_id: String,
    },
    MissingDataKey,
    WorkspaceMcpAttachmentFailed(WorkspaceMcpAttachmentError),
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
    /// The session's workspace local checkout directory has been deleted from
    /// disk. Surfaced from the common live-start seam so resume/prompt converge
    /// on the same typed condition instead of a generic ACP-start failure.
    WorkspaceDirectoryMissing {
        path: String,
    },
    MissingDataKey,
    WorkspaceMcpAttachmentFailed(WorkspaceMcpAttachmentError),
    /// See [`CreateAndStartSessionError::RouteAuth`].
    RouteAuth(RouteAuthError),
    /// A9 Scope C: the common live-start seam (`start_live_session`) now
    /// checks `resolve_launch_agent`'s status like `create_session` always
    /// has, so resume/fork/prompt/config-lazy-start converge on the same
    /// gate. Previously this seam ignored the status entirely: a resumed
    /// session whose credentials were revoked after creation spawned anyway
    /// and failed as a generic ACP-start error instead of the typed
    /// condition create-time would have reported for the same agent.
    AgentNotReady {
        agent_kind: String,
        status: ResolvedAgentStatus,
        detail: Option<String>,
    },
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
    /// The session's workspace local checkout directory has been deleted from
    /// disk. Config mutations lazy-start the live actor and hit the same
    /// live-start seam; surfaced typed so it maps to the shared 409 code.
    WorkspaceDirectoryMissing {
        path: String,
    },
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SendPromptError {
    SessionNotFound(String),
    SessionClosed,
    EmptyPrompt,
    /// The session's workspace local checkout directory has been deleted from
    /// disk. Lazy-start on prompt hits the common live-start seam, which refuses
    /// with this typed condition instead of a generic ACP-start failure.
    WorkspaceDirectoryMissing {
        path: String,
    },
    InvalidPrompt(crate::domains::sessions::prompt::PromptValidationError),
    WorkspaceMcpAttachmentFailed(WorkspaceMcpAttachmentError),
    ProductContextUnavailable {
        incident_id: String,
        error: crate::live::sessions::product_context::AgentProductContextResolutionError,
    },
    /// Checkpoints (Lane H, Q-H1 abort policy): a turn-start checkpoint capture
    /// failed and [`TURN_START_CAPTURE_FAILURE_POLICY`](crate::domains::workspaces::checkpoints::flags::TURN_START_CAPTURE_FAILURE_POLICY)
    /// is `Abort`, so the prompt is refused rather than run uncheckpointed. The
    /// turn never started; the caller may retry.
    CheckpointCaptureFailed {
        failure: crate::domains::workspaces::checkpoints::capture::CheckpointCaptureFailure,
    },
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
    /// Forks ADR rung 2 (4.8): the fork target is malformed at the product
    /// boundary — e.g. `item_id` missing on a `before_user_message` target
    /// (ruling Q1). 400 `INVALID_FORK_TARGET`.
    InvalidForkTarget(String),
    /// The `(turn_id, item_id)` anchor resolves to no committed user message.
    /// 404 `TARGET_NOT_FOUND`. Never silently degrades to a tip fork.
    TargetNotFound,
    /// The anchor's turn has not committed. 409 `BOUNDARY_NOT_COMMITTED`.
    BoundaryNotCommitted,
    /// Same idempotency key, different canonical payload. 409
    /// `IDEMPOTENCY_CONFLICT`.
    IdempotencyConflict,
    /// A prior operation on this key lost its native outcome and blocks blind
    /// redispatch (orphan preserved). 409 `FORK_NATIVE_OUTCOME_UNKNOWN`.
    NativeOutcomeUnknown,
    /// The parent workspace's local checkout directory has been deleted from
    /// disk. Caught before inserting the fork child so a deleted checkout never
    /// leaves behind an empty errored fork session row.
    WorkspaceDirectoryMissing {
        path: String,
    },
    MissingNativeSessionId,
    MissingDataKey,
    /// See [`EnsureLiveSessionError::AgentNotReady`] (A9 Scope C) — the same
    /// common live-start seam backs the fork child's start.
    AgentNotReady {
        agent_kind: String,
        status: ResolvedAgentStatus,
        detail: Option<String>,
    },
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
    Protected,
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

#[derive(Debug)]
pub enum SubagentLifecycleError {
    RelationshipNotFound,
    OpenRequired,
    Resume(EnsureLiveSessionError),
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
    /// The workspace's local checkout directory has been deleted from disk.
    /// Caught at the common live-start seam so any runtime start against a
    /// missing checkout (create, resume, prompt, fork, config) converges on the
    /// same typed condition instead of a generic ACP-start failure.
    WorkspaceDirectoryMissing {
        path: String,
    },
    AgentDescriptorNotFound(String),
    LaunchOptionsUnavailable {
        agent_kind: String,
        state: Option<crate::domains::agents::launch_options::HarnessLaunchOptionsState>,
    },
    LaunchValueUnsupported {
        agent_kind: String,
        key: String,
        value: String,
        state: crate::domains::agents::launch_options::HarnessLaunchOptionsState,
    },
    AgentEnvOverrideUnsupported {
        agent_kind: String,
        env_var_name: String,
    },
    Closed,
    MissingDataKey,
    RestartRequired(String),
    WorkspaceMcpAttachmentFailed(WorkspaceMcpAttachmentError),
    /// Agent-auth route resolution refused the launch (fail-closed, spec §3).
    RouteAuth(RouteAuthError),
    /// A9 Scope C: `resolve_launch_agent`'s status was resolved at this seam
    /// but never checked, unlike `create_session`'s equivalent gate — so a
    /// resume/fork/prompt/config-lazy-start against an agent whose readiness
    /// regressed after creation (e.g. revoked credentials) fell through to a
    /// spawn attempt and a generic `AcpStart` failure instead of this typed
    /// condition.
    AgentNotReady {
        agent_kind: String,
        status: ResolvedAgentStatus,
        detail: Option<String>,
    },
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
        workspace_operation_gate: Arc<WorkspaceOperationGate>,
        plan_reference_resolver: Arc<dyn PlanReferenceResolver + Send + Sync>,
        plan_interaction_link_resolver: Arc<dyn PlanInteractionLinkResolver>,
        gateway_model_resolver: Arc<dyn GatewayModelResolve>,
        active_goal_resolver: Arc<dyn ActiveGoalResolver>,
        loops_resolver: Arc<dyn LoopsResolver>,
        activity_roster_resolver: Arc<dyn ActivityRosterResolver>,
        checkpoint_service: Arc<WorkspaceCheckpointService>,
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
            workspace_operation_gate,
            plan_reference_resolver,
            plan_interaction_link_resolver,
            gateway_model_resolver,
            active_goal_resolver,
            loops_resolver,
            activity_roster_resolver,
            checkpoint_service,
        }
    }

    pub fn forget_live_session_for_mobility_blocking(&self, session_id: &str) {
        self.acp_manager.remove_session_blocking(session_id);
    }

    #[cfg(test)]
    pub(crate) fn product_mcp_launch_ids(&self) -> Vec<&'static str> {
        self.product_mcp_launch_catalog.registered_product_ids()
    }
}
