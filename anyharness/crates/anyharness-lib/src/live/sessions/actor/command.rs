use std::fmt;

use anyharness_contract::v1::{
    ConfigApplyState, McpElicitationSubmittedField, UserInputSubmittedAnswer,
};
use tokio::sync::oneshot;

use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};
use crate::live::sessions::model::SessionDomainOp;
use crate::live::sessions::rendezvous::broker::PermissionDecision;
#[derive(Debug)]
pub enum PromptAcceptError {
    EnqueueFailed(String),
    /// Current durable role/relationship truth could not be resolved. The
    /// incident UUID becomes the RFC 7807 instance receipt at the API seam.
    ProductContextUnavailable {
        incident_id: String,
        error: crate::live::sessions::product_context::AgentProductContextResolutionError,
    },
}

/// Result of the crate-private conditional-cancel command (spec
/// workflow-run-control §5.2). `Requested` proves only that the matching-turn
/// cancel command was accepted, not provider cancellation; `NotActive` covers
/// idle or a different active turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConditionalCancelOutcome {
    Requested,
    NotActive,
}

#[derive(Debug, Clone)]
pub enum PromptAcceptance {
    Started { turn_id: String },
    Queued { seq: i64 },
}

#[derive(Debug)]
pub enum QueueMutationError {
    NotFound,
    Protected,
    StaleOrder { current_seqs: Vec<i64> },
    InvalidReorder(String),
    Internal(String),
}

#[derive(Debug)]
pub enum SetConfigOptionCommandError {
    Rejected(String),
}

#[derive(Debug)]
pub struct ForkSessionCommandResult {
    pub native_session_id: String,
    pub supports_close: bool,
}

#[derive(Debug)]
pub enum ForkSessionCommandError {
    Busy,
    Unsupported(String),
    Failed(String),
}

/// Result/errors for the OpenCode side-door targeted-fork actor
/// operation. The parent actor owns the side-door state, validates the vendor
/// message id (never dispatching unvalidated — the vendor silently full-copies
/// unknown ids), and POSTs the fork. The child native session id is the vendor
/// fork response `.id`.
#[derive(Debug)]
pub struct SidedoorForkCommandResult {
    pub native_session_id: String,
    pub supports_close: bool,
}

#[derive(Debug)]
pub enum SidedoorForkCommandError {
    /// The side-door was not `Ready` at dispatch time — a hard error, never a
    /// silent tip fork.
    NotReady(String),
    /// Pre-validation: the vendor message id is absent, unknown, or not a user
    /// message. Maps to the `TARGET_NOT_FOUND` family.
    TargetNotFound,
    /// Pre-validation: the id resolved but the listing/role contract did not
    /// hold. Maps to the `INVALID_FORK_TARGET` family.
    InvalidForkTarget(String),
    Busy,
    Failed(String),
}

#[derive(Clone, PartialEq)]
pub enum Resolution {
    Selected {
        option_id: String,
    },
    Decision(PermissionDecision),
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

impl fmt::Debug for Resolution {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Selected { option_id } => f
                .debug_struct("Selected")
                .field("option_id", option_id)
                .finish(),
            Self::Decision(decision) => f.debug_tuple("Decision").field(decision).finish(),
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveInteractionCommandError {
    NotFound,
    KindMismatch,
    InvalidOptionId,
    InvalidQuestionId,
    DuplicateQuestionAnswer,
    MissingQuestionAnswer,
    InvalidSelectedOptionLabel,
    InvalidMcpFieldId,
    DuplicateMcpField,
    MissingMcpField,
    InvalidMcpFieldValue,
    NotMcpUrlElicitation,
    ActorDead,
}

pub(in crate::live::sessions) enum SessionCommand {
    Prompt {
        payload: PromptPayload,
        prompt_id: Option<String>,
        /// Set by the actor's own startup-drain path when self-dispatching a
        /// queue head. External callers pass `None` unless they have already
        /// durably inserted a queue row and only need the actor to drain it.
        /// When `Some`, the first iteration of the drain loop will delete this
        /// row and emit `PendingPromptRemoved { Executed }` right after
        /// `begin_turn`.
        from_queue_seq: Option<i64>,
        respond_to: oneshot::Sender<Result<PromptAcceptance, PromptAcceptError>>,
    },
    EditPendingPrompt {
        seq: i64,
        payload: PromptPayload,
        respond_to: oneshot::Sender<Result<(), QueueMutationError>>,
    },
    DeletePendingPrompt {
        seq: i64,
        respond_to: oneshot::Sender<Result<(), QueueMutationError>>,
    },
    ReorderPendingPrompts {
        expected_seqs: Vec<i64>,
        desired_seqs: Vec<i64>,
        respond_to: oneshot::Sender<Result<(), QueueMutationError>>,
    },
    SteerPendingPrompt {
        seq: i64,
        respond_to: oneshot::Sender<Result<(), QueueMutationError>>,
    },
    SetConfigOption {
        config_id: String,
        value: String,
        /// The catalog validated this value as a model for the session's
        /// recorded auth contexts; model requests may then bypass the
        /// harness-advertised value list (post-set verification still
        /// decides the outcome).
        catalog_authorized_model: bool,
        respond_to: oneshot::Sender<Result<ConfigApplyState, SetConfigOptionCommandError>>,
    },
    ResolveInteraction {
        request_id: String,
        resolution: Resolution,
        respond_to: oneshot::Sender<Result<(), ResolveInteractionCommandError>>,
    },
    /// Run a [`SessionDomainOp`] serialized through the actor loop. The boxed
    /// `Any` reply is downcast by the submitting domain runtime to its own
    /// concrete output type.
    RunDomainOp {
        op: Box<dyn SessionDomainOp>,
        respond_to: oneshot::Sender<Box<dyn std::any::Any + Send>>,
    },
    /// Send an ACP extension-method request (`_`-prefixed wire name) to the
    /// agent and return its raw JSON result. The method string is serialized
    /// verbatim; the agent is the sole authority on acceptance.
    CallAgentExtMethod {
        method: String,
        params: serde_json::Value,
        respond_to: oneshot::Sender<anyhow::Result<serde_json::Value>>,
    },
    VerifyForkReady {
        requires_targeted_fork: bool,
        respond_to: oneshot::Sender<Result<(), ForkSessionCommandError>>,
    },
    Fork {
        provider_anchor: Option<crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor>,
        respond_to: oneshot::Sender<Result<ForkSessionCommandResult, ForkSessionCommandError>>,
    },
    /// OpenCode side-door targeted fork. Validated and dispatched
    /// on the parent actor because the side-door (port + password + readiness)
    /// is process-local actor state.
    SidedoorTargetedFork {
        vendor_message_id: String,
        respond_to:
            oneshot::Sender<Result<SidedoorForkCommandResult, SidedoorForkCommandError>>,
    },
    CloseNativeSession {
        native_session_id: String,
        respond_to: oneshot::Sender<anyhow::Result<()>>,
    },
    InjectRuntimeEvent {
        event: RuntimeInjectedSessionEvent,
        respond_to: oneshot::Sender<RuntimeEventInjectionResult>,
    },
    Cancel,
    /// Forward ACP cancellation ONLY when `expected_turn_id` equals the
    /// actor's current active turn, compared serially on the actor loop. A
    /// stale or foreign turn id never cancels newer work. Leaves the public
    /// `Cancel` behavior untouched.
    CancelTurnIfActive {
        expected_turn_id: String,
        respond_to: oneshot::Sender<ConditionalCancelOutcome>,
    },
    Dismiss {
        respond_to: oneshot::Sender<anyhow::Result<()>>,
    },
    /// Retire the live actor without changing the durable session lifecycle.
    /// Unlike `Dismiss`, this is an internal execution-lifecycle operation:
    /// it does not change user-facing visibility. Unlike `Close`, it emits no
    /// terminal session event and does not make the durable session terminal.
    Unload {
        respond_to: oneshot::Sender<anyhow::Result<()>>,
    },
    /// Workspace-wide stop (`stop_and_await`): unlike `Dismiss`, whose reply
    /// fires before the actor loop even finishes, this responder is stored
    /// on the actor and fires only after `run()`'s exit sequence has run the
    /// process-group kill escalation and reaped the agent child. Carries the
    /// `(total, git)` kill census.
    Stop {
        respond_to: oneshot::Sender<anyhow::Result<(usize, usize)>>,
    },
    Close {
        respond_to: oneshot::Sender<anyhow::Result<()>>,
    },
    ReplayAdvance {
        respond_to: oneshot::Sender<anyhow::Result<()>>,
    },
}

impl SessionCommand {
    pub(in crate::live::sessions::actor) fn is_fork_lifecycle_command(&self) -> bool {
        matches!(
            self,
            Self::VerifyForkReady { .. }
                | Self::Fork { .. }
                | Self::SidedoorTargetedFork { .. }
                | Self::CloseNativeSession { .. }
        )
    }
}
