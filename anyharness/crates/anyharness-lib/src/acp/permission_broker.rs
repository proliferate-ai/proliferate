use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{
    McpElicitationSubmittedField, UserInputQuestion, UserInputSubmittedAnswer,
};
use tokio::sync::{oneshot, Mutex};
use validation::{map_mcp_validation_error, pick_option, validate_user_input_answers};

use super::mcp_elicitation::{McpElicitationOutcome, StoredMcpElicitation};

#[cfg(test)]
mod tests;
mod validation;

pub const USER_INPUT_OTHER_OPTION_LABEL: &str = "None of the above";

pub struct InteractionBroker {
    pending: Arc<Mutex<HashMap<PendingInteractionKey, PendingInteractionRequest>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionOutcome {
    Selected { option_id: String },
    Cancelled,
    Dismissed,
}

#[derive(Clone, PartialEq, Eq)]
pub enum UserInputOutcome {
    Submitted {
        answered_question_ids: Vec<String>,
        answers: Vec<UserInputSubmittedAnswer>,
    },
    Cancelled,
    Dismissed,
}

impl fmt::Debug for UserInputOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Submitted {
                answered_question_ids,
                answers,
            } => f
                .debug_struct("Submitted")
                .field("answered_question_ids", answered_question_ids)
                .field("answer_count", &answers.len())
                .finish(),
            Self::Cancelled => f.write_str("Cancelled"),
            Self::Dismissed => f.write_str("Dismissed"),
        }
    }
}

#[derive(Clone, PartialEq)]
pub enum InteractionBrokerOutcome {
    Permission(PermissionOutcome),
    UserInput(UserInputOutcome),
    McpElicitation(McpElicitationOutcome),
}

impl fmt::Debug for InteractionBrokerOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Permission(outcome) => f.debug_tuple("Permission").field(outcome).finish(),
            Self::UserInput(outcome) => f.debug_tuple("UserInput").field(outcome).finish(),
            Self::McpElicitation(outcome) => {
                f.debug_tuple("McpElicitation").field(outcome).finish()
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CancelledInteraction {
    pub request_id: String,
    pub outcome: InteractionBrokerOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteractionCancelOutcome {
    Cancelled,
    Dismissed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveInteractionError {
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
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct PendingInteractionKey {
    session_id: String,
    request_id: String,
}

impl PendingInteractionKey {
    fn new(session_id: &str, request_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            request_id: request_id.to_string(),
        }
    }
}

enum PendingInteractionRequest {
    Permission(PendingPermissionRequest),
    UserInput(PendingUserInputRequest),
    McpElicitation(PendingMcpElicitationRequest),
}

impl PendingInteractionRequest {
    fn cancel(self, outcome: InteractionCancelOutcome) -> InteractionBrokerOutcome {
        match self {
            Self::Permission(request) => {
                let outcome = match outcome {
                    InteractionCancelOutcome::Cancelled => PermissionOutcome::Cancelled,
                    InteractionCancelOutcome::Dismissed => PermissionOutcome::Dismissed,
                };
                let _ = request.respond_to.send(outcome.clone());
                InteractionBrokerOutcome::Permission(outcome)
            }
            Self::UserInput(request) => {
                let outcome = match outcome {
                    InteractionCancelOutcome::Cancelled => UserInputOutcome::Cancelled,
                    InteractionCancelOutcome::Dismissed => UserInputOutcome::Dismissed,
                };
                let _ = request.respond_to.send(outcome.clone());
                InteractionBrokerOutcome::UserInput(outcome)
            }
            Self::McpElicitation(request) => {
                let outcome = match outcome {
                    InteractionCancelOutcome::Cancelled => McpElicitationOutcome::Cancelled,
                    InteractionCancelOutcome::Dismissed => McpElicitationOutcome::Dismissed,
                };
                let _ = request.respond_to.send(outcome.clone());
                InteractionBrokerOutcome::McpElicitation(outcome)
            }
        }
    }
}

struct PendingPermissionRequest {
    respond_to: oneshot::Sender<PermissionOutcome>,
    options: Vec<StoredPermissionOption>,
}

struct PendingUserInputRequest {
    respond_to: oneshot::Sender<UserInputOutcome>,
    questions: Vec<StoredUserInputQuestion>,
}

struct PendingMcpElicitationRequest {
    respond_to: oneshot::Sender<McpElicitationOutcome>,
    request: StoredMcpElicitation,
}

pub struct PendingPermissionWait {
    rx: oneshot::Receiver<PermissionOutcome>,
}

impl PendingPermissionWait {
    pub async fn wait(self) -> PermissionOutcome {
        self.rx.await.unwrap_or(PermissionOutcome::Cancelled)
    }
}

pub struct PendingUserInputWait {
    rx: oneshot::Receiver<UserInputOutcome>,
}

impl PendingUserInputWait {
    pub async fn wait(self) -> UserInputOutcome {
        self.rx.await.unwrap_or(UserInputOutcome::Cancelled)
    }
}

pub struct PendingMcpElicitationWait {
    rx: oneshot::Receiver<McpElicitationOutcome>,
}

impl PendingMcpElicitationWait {
    pub async fn wait(self) -> McpElicitationOutcome {
        self.rx.await.unwrap_or(McpElicitationOutcome::Cancelled)
    }
}

#[derive(Debug, Clone)]
pub(super) struct StoredPermissionOption {
    pub(super) option_id: String,
    pub(super) kind: StoredPermissionOptionKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StoredPermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
    Unknown,
}

impl StoredPermissionOptionKind {
    fn from_acp(kind: acp::PermissionOptionKind) -> Self {
        match kind {
            acp::PermissionOptionKind::AllowOnce => Self::AllowOnce,
            acp::PermissionOptionKind::AllowAlways => Self::AllowAlways,
            acp::PermissionOptionKind::RejectOnce => Self::RejectOnce,
            acp::PermissionOptionKind::RejectAlways => Self::RejectAlways,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct StoredUserInputQuestion {
    pub(super) question_id: String,
    pub(super) is_other: bool,
    pub(super) option_labels: Vec<String>,
}

impl InteractionBroker {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register_permission(
        &self,
        session_id: &str,
        request_id: &str,
        options: &[acp::PermissionOption],
    ) -> PendingPermissionWait {
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().await;
            pending.insert(
                PendingInteractionKey::new(session_id, request_id),
                PendingInteractionRequest::Permission(PendingPermissionRequest {
                    respond_to: tx,
                    options: options
                        .iter()
                        .map(|option| StoredPermissionOption {
                            option_id: option.option_id.to_string(),
                            kind: StoredPermissionOptionKind::from_acp(option.kind),
                        })
                        .collect(),
                }),
            );
        }

        PendingPermissionWait { rx }
    }

    pub async fn register_user_input(
        &self,
        session_id: &str,
        request_id: &str,
        questions: &[UserInputQuestion],
    ) -> PendingUserInputWait {
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().await;
            pending.insert(
                PendingInteractionKey::new(session_id, request_id),
                PendingInteractionRequest::UserInput(PendingUserInputRequest {
                    respond_to: tx,
                    questions: questions
                        .iter()
                        .map(|question| StoredUserInputQuestion {
                            question_id: question.question_id.clone(),
                            is_other: question.is_other,
                            option_labels: question
                                .options
                                .iter()
                                .map(|option| option.label.clone())
                                .collect(),
                        })
                        .collect(),
                }),
            );
        }

        PendingUserInputWait { rx }
    }

    pub async fn register_mcp_elicitation(
        &self,
        session_id: &str,
        request_id: &str,
        request: StoredMcpElicitation,
    ) -> PendingMcpElicitationWait {
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().await;
            pending.insert(
                PendingInteractionKey::new(session_id, request_id),
                PendingInteractionRequest::McpElicitation(PendingMcpElicitationRequest {
                    respond_to: tx,
                    request,
                }),
            );
        }

        PendingMcpElicitationWait { rx }
    }

    pub async fn request_permission(
        &self,
        session_id: &str,
        request_id: &str,
        options: &[acp::PermissionOption],
    ) -> PermissionOutcome {
        self.register_permission(session_id, request_id, options)
            .await
            .wait()
            .await
    }

    pub async fn resolve_with_decision(
        &self,
        session_id: &str,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<PermissionOutcome, ResolveInteractionError> {
        let key = PendingInteractionKey::new(session_id, request_id);
        let mut pending = self.pending.lock().await;
        let options = match pending.get(&key).ok_or(ResolveInteractionError::NotFound)? {
            PendingInteractionRequest::Permission(request) => &request.options,
            PendingInteractionRequest::UserInput(_)
            | PendingInteractionRequest::McpElicitation(_) => {
                return Err(ResolveInteractionError::KindMismatch);
            }
        };

        let option_id = match decision {
            PermissionDecision::Allow => pick_option(
                options,
                &[
                    StoredPermissionOptionKind::AllowOnce,
                    StoredPermissionOptionKind::AllowAlways,
                ],
            ),
            PermissionDecision::Deny => pick_option(
                options,
                &[
                    StoredPermissionOptionKind::RejectOnce,
                    StoredPermissionOptionKind::RejectAlways,
                ],
            ),
        }
        .ok_or(ResolveInteractionError::InvalidOptionId)?;

        let request = pending
            .remove(&key)
            .ok_or(ResolveInteractionError::NotFound)?;
        let PendingInteractionRequest::Permission(request) = request else {
            return Err(ResolveInteractionError::KindMismatch);
        };

        let outcome = PermissionOutcome::Selected { option_id };
        let _ = request.respond_to.send(outcome.clone());
        Ok(outcome)
    }

    pub async fn resolve_with_option_id(
        &self,
        session_id: &str,
        request_id: &str,
        option_id: &str,
    ) -> Result<PermissionOutcome, ResolveInteractionError> {
        let key = PendingInteractionKey::new(session_id, request_id);
        let mut pending = self.pending.lock().await;
        let options = match pending.get(&key).ok_or(ResolveInteractionError::NotFound)? {
            PendingInteractionRequest::Permission(request) => &request.options,
            PendingInteractionRequest::UserInput(_)
            | PendingInteractionRequest::McpElicitation(_) => {
                return Err(ResolveInteractionError::KindMismatch);
            }
        };

        if !options.iter().any(|option| option.option_id == option_id) {
            return Err(ResolveInteractionError::InvalidOptionId);
        }

        let request = pending
            .remove(&key)
            .ok_or(ResolveInteractionError::NotFound)?;
        let PendingInteractionRequest::Permission(request) = request else {
            return Err(ResolveInteractionError::KindMismatch);
        };

        let outcome = PermissionOutcome::Selected {
            option_id: option_id.to_string(),
        };
        let _ = request.respond_to.send(outcome.clone());
        Ok(outcome)
    }

    pub async fn submit_user_input(
        &self,
        session_id: &str,
        request_id: &str,
        answers: Vec<UserInputSubmittedAnswer>,
    ) -> Result<UserInputOutcome, ResolveInteractionError> {
        let key = PendingInteractionKey::new(session_id, request_id);
        let mut pending = self.pending.lock().await;
        let questions = match pending.get(&key).ok_or(ResolveInteractionError::NotFound)? {
            PendingInteractionRequest::UserInput(request) => &request.questions,
            PendingInteractionRequest::Permission(_)
            | PendingInteractionRequest::McpElicitation(_) => {
                return Err(ResolveInteractionError::KindMismatch);
            }
        };

        let answered_question_ids = validate_user_input_answers(questions, &answers)?;
        let request = pending
            .remove(&key)
            .ok_or(ResolveInteractionError::NotFound)?;
        let PendingInteractionRequest::UserInput(request) = request else {
            return Err(ResolveInteractionError::KindMismatch);
        };

        let outcome = UserInputOutcome::Submitted {
            answered_question_ids,
            answers,
        };
        let _ = request.respond_to.send(outcome.clone());
        Ok(outcome)
    }

    pub async fn accept_mcp_elicitation(
        &self,
        session_id: &str,
        request_id: &str,
        fields: Vec<McpElicitationSubmittedField>,
    ) -> Result<McpElicitationOutcome, ResolveInteractionError> {
        let key = PendingInteractionKey::new(session_id, request_id);
        let mut pending = self.pending.lock().await;
        let stored = match pending.get(&key).ok_or(ResolveInteractionError::NotFound)? {
            PendingInteractionRequest::McpElicitation(request) => &request.request,
            PendingInteractionRequest::Permission(_) | PendingInteractionRequest::UserInput(_) => {
                return Err(ResolveInteractionError::KindMismatch);
            }
        };

        let outcome = stored.accept(fields).map_err(map_mcp_validation_error)?;
        let request = pending
            .remove(&key)
            .ok_or(ResolveInteractionError::NotFound)?;
        let PendingInteractionRequest::McpElicitation(request) = request else {
            return Err(ResolveInteractionError::KindMismatch);
        };
        let _ = request.respond_to.send(outcome.clone());
        Ok(outcome)
    }

    pub async fn decline_mcp_elicitation(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<McpElicitationOutcome, ResolveInteractionError> {
        let key = PendingInteractionKey::new(session_id, request_id);
        let request = {
            let mut pending = self.pending.lock().await;
            pending.remove(&key)
        }
        .ok_or(ResolveInteractionError::NotFound)?;

        let PendingInteractionRequest::McpElicitation(request) = request else {
            return Err(ResolveInteractionError::KindMismatch);
        };

        let outcome = McpElicitationOutcome::Declined;
        let _ = request.respond_to.send(outcome.clone());
        Ok(outcome)
    }

    pub async fn reveal_mcp_elicitation_url(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<String, ResolveInteractionError> {
        let key = PendingInteractionKey::new(session_id, request_id);
        let pending = self.pending.lock().await;
        let stored = match pending.get(&key).ok_or(ResolveInteractionError::NotFound)? {
            PendingInteractionRequest::McpElicitation(request) => &request.request,
            PendingInteractionRequest::Permission(_) | PendingInteractionRequest::UserInput(_) => {
                return Err(ResolveInteractionError::KindMismatch);
            }
        };

        stored.reveal_url().map_err(map_mcp_validation_error)
    }

    pub async fn cancel(
        &self,
        session_id: &str,
        request_id: &str,
        outcome: InteractionCancelOutcome,
    ) -> Result<InteractionBrokerOutcome, ResolveInteractionError> {
        let key = PendingInteractionKey::new(session_id, request_id);
        let request = {
            let mut pending = self.pending.lock().await;
            pending.remove(&key)
        }
        .ok_or(ResolveInteractionError::NotFound)?;

        Ok(request.cancel(outcome))
    }

    pub async fn cancel_session(
        &self,
        session_id: &str,
        outcome: InteractionCancelOutcome,
    ) -> Vec<CancelledInteraction> {
        let requests = {
            let mut pending = self.pending.lock().await;
            let keys = pending
                .keys()
                .filter(|key| key.session_id == session_id)
                .cloned()
                .collect::<Vec<_>>();

            keys.into_iter()
                .filter_map(|key| {
                    pending
                        .remove(&key)
                        .map(|request| (key.request_id, request))
                })
                .collect::<Vec<_>>()
        };

        requests
            .into_iter()
            .map(|(request_id, request)| CancelledInteraction {
                request_id,
                outcome: request.cancel(outcome),
            })
            .collect()
    }

    #[cfg(test)]
    pub(crate) async fn insert_pending_for_test(
        &self,
        session_id: &str,
        request_id: &str,
        options: Vec<acp::PermissionOption>,
    ) {
        let (tx, _rx) = oneshot::channel();
        self.pending.lock().await.insert(
            PendingInteractionKey::new(session_id, request_id),
            PendingInteractionRequest::Permission(PendingPermissionRequest {
                options: options
                    .into_iter()
                    .map(|option| StoredPermissionOption {
                        option_id: option.option_id.to_string(),
                        kind: StoredPermissionOptionKind::from_acp(option.kind),
                    })
                    .collect(),
                respond_to: tx,
            }),
        );
    }
}

impl Clone for InteractionBroker {
    fn clone(&self) -> Self {
        Self {
            pending: self.pending.clone(),
        }
    }
}
