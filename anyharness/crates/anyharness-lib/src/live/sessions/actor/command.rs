use std::fmt;

use anyharness_contract::v1::{
    ConfigApplyState, McpElicitationSubmittedField,
    UserInputSubmittedAnswer,
};
use tokio::sync::oneshot;

use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::model::SessionDomainOp;
use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};
use crate::live::sessions::rendezvous::broker::PermissionDecision;
#[derive(Debug)]
pub enum PromptAcceptError {
    EnqueueFailed(String),
}

#[derive(Debug, Clone)]
pub enum PromptAcceptance {
    Started { turn_id: String },
    Queued { seq: i64 },
}

#[derive(Debug)]
pub enum QueueMutationError {
    NotFound,
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
    VerifyForkReady {
        respond_to: oneshot::Sender<Result<(), ForkSessionCommandError>>,
    },
    Fork {
        respond_to: oneshot::Sender<Result<ForkSessionCommandResult, ForkSessionCommandError>>,
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
    Dismiss {
        respond_to: oneshot::Sender<anyhow::Result<()>>,
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
            Self::VerifyForkReady { .. } | Self::Fork { .. } | Self::CloseNativeSession { .. }
        )
    }
}
