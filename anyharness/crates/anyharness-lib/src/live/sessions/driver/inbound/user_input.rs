use agent_client_protocol as acp;
use anyharness_contract::v1::{
    InteractionKind, InteractionPayload, InteractionRequestedEvent, InteractionSource,
    PendingInteractionPayloadSummary, PendingInteractionSource, PendingInteractionSummary,
    UserInputInteractionPayload, UserInputQuestion, UserInputSubmittedAnswer,
};
use serde::{Deserialize, Serialize};

use super::{raw_ext_response, InboundDoor};
use crate::live::sessions::rendezvous::broker::UserInputOutcome;

impl InboundDoor {
    pub(super) async fn codex_request_user_input(
        &self,
        args: acp::schema::ExtRequest,
    ) -> acp::Result<acp::schema::ExtResponse> {
        let request = serde_json::from_str::<CodexRequestUserInputParams>(args.params.get())
            .map_err(|error| acp::Error::invalid_params().data(error.to_string()))?;

        let request_id = uuid::Uuid::new_v4().to_string();
        let questions = request.questions;
        let title = questions
            .first()
            .map(|question| question.header.trim())
            .filter(|header| !header.is_empty())
            .unwrap_or("Input requested")
            .to_string();
        let description = (questions.len() == 1)
            .then(|| questions.first().map(|question| question.question.clone()))
            .flatten()
            .filter(|question| !question.trim().is_empty());

        let source = InteractionSource {
            tool_call_id: None,
            tool_kind: None,
            tool_status: None,
            linked_plan_id: None,
            source_metadata: None,
        };
        let payload = InteractionPayload::UserInput(UserInputInteractionPayload {
            questions: questions.clone(),
        });

        let pending_wait = {
            let mut sink = self.event_sink.lock().await;
            let pending_wait = self
                .interaction_broker
                .register_user_input(&self.session_id, &request_id, &questions)
                .await;

            self.live_session_handle
                .add_pending_interaction(PendingInteractionSummary {
                    request_id: request_id.clone(),
                    kind: InteractionKind::UserInput,
                    title: title.clone(),
                    description: description.clone(),
                    source: PendingInteractionSource {
                        tool_call_id: None,
                        tool_kind: None,
                        tool_status: None,
                        linked_plan_id: None,
                    },
                    payload: PendingInteractionPayloadSummary::UserInput { questions },
                })
                .await;

            sink.interaction_requested(InteractionRequestedEvent {
                request_id: request_id.clone(),
                kind: InteractionKind::UserInput,
                title,
                description,
                source,
                payload,
            });

            pending_wait
        };

        let response = match pending_wait.wait().await {
            UserInputOutcome::Submitted { answers, .. } => CodexRequestUserInputExtResponse {
                outcome: CodexRequestUserInputExtOutcome::Submitted,
                answers,
            },
            UserInputOutcome::Cancelled | UserInputOutcome::Dismissed => {
                CodexRequestUserInputExtResponse {
                    outcome: CodexRequestUserInputExtOutcome::Cancelled,
                    answers: Vec::new(),
                }
            }
        };

        raw_ext_response(response)
    }

    pub(super) async fn claude_request_user_input(
        &self,
        args: acp::schema::ExtRequest,
    ) -> acp::Result<acp::schema::ExtResponse> {
        let request = serde_json::from_str::<ClaudeRequestUserInputParams>(args.params.get())
            .map_err(|error| acp::Error::invalid_params().data(error.to_string()))?;

        let response = self
            .request_user_input(request.questions, "Input requested")
            .await?;

        raw_ext_response(response)
    }

    async fn request_user_input(
        &self,
        questions: Vec<UserInputQuestion>,
        fallback_title: &str,
    ) -> acp::Result<ClaudeRequestUserInputExtResponse> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let title = questions
            .first()
            .map(|question| question.header.trim())
            .filter(|header| !header.is_empty())
            .unwrap_or(fallback_title)
            .to_string();
        let description = (questions.len() == 1)
            .then(|| questions.first().map(|question| question.question.clone()))
            .flatten()
            .filter(|question| !question.trim().is_empty());

        let source = InteractionSource {
            tool_call_id: None,
            tool_kind: None,
            tool_status: None,
            linked_plan_id: None,
            source_metadata: None,
        };
        let payload = InteractionPayload::UserInput(UserInputInteractionPayload {
            questions: questions.clone(),
        });

        let pending_wait = {
            let mut sink = self.event_sink.lock().await;
            let pending_wait = self
                .interaction_broker
                .register_user_input(&self.session_id, &request_id, &questions)
                .await;

            self.live_session_handle
                .add_pending_interaction(PendingInteractionSummary {
                    request_id: request_id.clone(),
                    kind: InteractionKind::UserInput,
                    title: title.clone(),
                    description: description.clone(),
                    source: PendingInteractionSource {
                        tool_call_id: None,
                        tool_kind: None,
                        tool_status: None,
                        linked_plan_id: None,
                    },
                    payload: PendingInteractionPayloadSummary::UserInput { questions },
                })
                .await;

            sink.interaction_requested(InteractionRequestedEvent {
                request_id: request_id.clone(),
                kind: InteractionKind::UserInput,
                title,
                description,
                source,
                payload,
            });

            pending_wait
        };

        let response = match pending_wait.wait().await {
            UserInputOutcome::Submitted { answers, .. } => ClaudeRequestUserInputExtResponse {
                outcome: ClaudeRequestUserInputExtOutcome::Submitted,
                answers,
            },
            UserInputOutcome::Cancelled | UserInputOutcome::Dismissed => {
                ClaudeRequestUserInputExtResponse {
                    outcome: ClaudeRequestUserInputExtOutcome::Cancelled,
                    answers: Vec::new(),
                }
            }
        };

        Ok(response)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexRequestUserInputParams {
    #[allow(dead_code)]
    call_id: String,
    #[allow(dead_code)]
    turn_id: String,
    questions: Vec<UserInputQuestion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeRequestUserInputParams {
    questions: Vec<UserInputQuestion>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexRequestUserInputExtResponse {
    outcome: CodexRequestUserInputExtOutcome,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    answers: Vec<UserInputSubmittedAnswer>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum CodexRequestUserInputExtOutcome {
    Submitted,
    Cancelled,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeRequestUserInputExtResponse {
    outcome: ClaudeRequestUserInputExtOutcome,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    answers: Vec<UserInputSubmittedAnswer>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum ClaudeRequestUserInputExtOutcome {
    Submitted,
    Cancelled,
}
