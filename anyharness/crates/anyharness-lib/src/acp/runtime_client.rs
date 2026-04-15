use std::sync::Arc;

use agent_client_protocol as acp;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use tokio::sync::{mpsc, Mutex};

use super::event_sink::SessionEventSink;
use super::mcp_elicitation::{
    claude_ext_response_from_outcome, codex_ext_response_from_outcome,
    normalize_claude_mcp_elicitation, normalize_codex_mcp_elicitation,
    ClaudeMcpElicitationExtParams, CodexMcpElicitationExtParams,
};
use super::permission_broker::{InteractionBroker, PermissionOutcome, UserInputOutcome};
use super::permission_context::permission_context_from_meta;
use super::permission_payload::{bound_raw_json, permission_option_mappings, permission_options};
use super::session_actor::LiveSessionHandle;
use crate::plans::service::PlanService;
use anyharness_contract::v1::{
    InteractionKind, InteractionPayload, InteractionRequestedEvent, InteractionSource,
    PendingInteractionPayloadSummary, PendingInteractionSource, PendingInteractionSummary,
    PermissionInteractionPayload, UserInputInteractionPayload, UserInputQuestion,
    UserInputSubmittedAnswer,
};

const CODEX_REQUEST_USER_INPUT_METHOD: &str = "experimental/codex/requestUserInput";
const CODEX_MCP_ELICITATION_METHOD: &str = "experimental/codex/mcpElicitation";
const CLAUDE_REQUEST_USER_INPUT_METHOD: &str = "experimental/claude/requestUserInput";
const CLAUDE_MCP_ELICITATION_METHOD: &str = "experimental/claude/mcpElicitation";

pub struct RuntimeClient {
    pub session_id: String,
    pub notification_tx: mpsc::UnboundedSender<acp::SessionNotification>,
    pub interaction_broker: Arc<InteractionBroker>,
    pub event_sink: Arc<Mutex<SessionEventSink>>,
    pub live_session_handle: Arc<LiveSessionHandle>,
    pub plan_service: Arc<PlanService>,
}

impl RuntimeClient {
    pub fn new(
        session_id: String,
        notification_tx: mpsc::UnboundedSender<acp::SessionNotification>,
        interaction_broker: Arc<InteractionBroker>,
        event_sink: Arc<Mutex<SessionEventSink>>,
        live_session_handle: Arc<LiveSessionHandle>,
        plan_service: Arc<PlanService>,
    ) -> Self {
        Self {
            session_id,
            notification_tx,
            interaction_broker,
            event_sink,
            live_session_handle,
            plan_service,
        }
    }
}

#[async_trait::async_trait(?Send)]
impl acp::Client for RuntimeClient {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        let request_id = uuid::Uuid::new_v4().to_string();

        let title = args
            .tool_call
            .fields
            .title
            .clone()
            .unwrap_or_else(|| "Permission requested".to_string());

        let tool_call_id = Some(args.tool_call.tool_call_id.to_string());

        let tool_kind = args
            .tool_call
            .fields
            .kind
            .as_ref()
            .and_then(|k| serde_json::to_value(k).ok())
            .and_then(|v| v.as_str().map(String::from));

        let tool_status = args
            .tool_call
            .fields
            .status
            .as_ref()
            .and_then(|s| serde_json::to_value(s).ok())
            .and_then(|v| v.as_str().map(String::from));

        let raw_input = args
            .tool_call
            .fields
            .raw_input
            .as_ref()
            .and_then(|v| serde_json::to_value(v).ok())
            .map(bound_raw_json);

        let raw_output = args
            .tool_call
            .fields
            .raw_output
            .as_ref()
            .and_then(|v| serde_json::to_value(v).ok())
            .map(bound_raw_json);

        let options = permission_options(&args.options);
        let context = permission_context_from_meta(args.meta.as_ref());
        let linked_plan = match tool_call_id.as_deref() {
            Some(tool_call_id) => self
                .plan_service
                .find_by_session_tool_call(&self.session_id, tool_call_id)
                .ok()
                .flatten(),
            None => None,
        };
        if let (Some(plan), Some(tool_call_id)) = (linked_plan.as_ref(), tool_call_id.as_deref()) {
            let _ = self.plan_service.register_interaction_link(
                plan,
                &request_id,
                tool_call_id,
                permission_option_mappings(&options),
            );
        }
        let source = InteractionSource {
            tool_call_id: tool_call_id.clone(),
            tool_kind: tool_kind.clone(),
            tool_status: tool_status.clone(),
            linked_plan_id: linked_plan.as_ref().map(|plan| plan.id.clone()),
            source_metadata: None,
        };
        let payload = InteractionPayload::Permission(PermissionInteractionPayload {
            options: options.clone(),
            context: context.clone(),
            raw_input,
            raw_output,
        });

        let pending_wait = {
            let mut sink = self.event_sink.lock().await;
            let pending_wait = self
                .interaction_broker
                .register_permission(&self.session_id, &request_id, &args.options)
                .await;

            self.live_session_handle
                .add_pending_interaction(PendingInteractionSummary {
                    request_id: request_id.clone(),
                    kind: InteractionKind::Permission,
                    title: title.clone(),
                    description: None,
                    source: PendingInteractionSource {
                        tool_call_id,
                        tool_kind,
                        tool_status,
                        linked_plan_id: linked_plan.as_ref().map(|plan| plan.id.clone()),
                    },
                    payload: PendingInteractionPayloadSummary::Permission { options, context },
                })
                .await;

            sink.interaction_requested(InteractionRequestedEvent {
                request_id: request_id.clone(),
                kind: InteractionKind::Permission,
                title: title.clone(),
                description: None,
                source: source.clone(),
                payload,
            });

            pending_wait
        };

        let outcome = pending_wait.wait().await;

        let acp_outcome = match outcome {
            PermissionOutcome::Selected { option_id } => acp::RequestPermissionOutcome::Selected(
                acp::SelectedPermissionOutcome::new(option_id),
            ),
            PermissionOutcome::Cancelled | PermissionOutcome::Dismissed => {
                acp::RequestPermissionOutcome::Cancelled
            }
        };

        Ok(acp::RequestPermissionResponse::new(acp_outcome))
    }

    async fn session_notification(
        &self,
        notification: acp::SessionNotification,
    ) -> acp::Result<(), acp::Error> {
        tracing::trace!(
            session_id = %self.session_id,
            kind = session_update_kind(&notification.update),
            "ACP session_notification"
        );
        let _ = self.notification_tx.send(notification);
        Ok(())
    }

    async fn ext_method(&self, args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        match args.method.as_ref() {
            CODEX_REQUEST_USER_INPUT_METHOD => self.codex_request_user_input(args).await,
            CODEX_MCP_ELICITATION_METHOD => self.codex_mcp_elicitation(args).await,
            CLAUDE_REQUEST_USER_INPUT_METHOD => self.claude_request_user_input(args).await,
            CLAUDE_MCP_ELICITATION_METHOD => self.claude_mcp_elicitation(args).await,
            _ => Err(acp::Error::method_not_found()),
        }
    }
}

impl RuntimeClient {
    async fn codex_request_user_input(
        &self,
        args: acp::ExtRequest,
    ) -> acp::Result<acp::ExtResponse> {
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

    async fn claude_request_user_input(
        &self,
        args: acp::ExtRequest,
    ) -> acp::Result<acp::ExtResponse> {
        let request = serde_json::from_str::<ClaudeRequestUserInputParams>(args.params.get())
            .map_err(|error| acp::Error::invalid_params().data(error.to_string()))?;

        let response = self
            .request_user_input(request.questions, "Input requested")
            .await?;

        raw_ext_response(response)
    }

    async fn codex_mcp_elicitation(&self, args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        let request = serde_json::from_str::<CodexMcpElicitationExtParams>(args.params.get())
            .map_err(|error| acp::Error::invalid_params().data(error.to_string()))?;
        let normalized = normalize_codex_mcp_elicitation(request)
            .map_err(|error| acp::Error::invalid_params().data(format!("{error:?}")))?;

        let request_id = uuid::Uuid::new_v4().to_string();
        let title = normalized.title;
        let description = normalized.description;
        let payload = normalized.payload;
        let pending_payload = PendingInteractionPayloadSummary::McpElicitation {
            payload: payload.clone(),
        };
        let source = InteractionSource {
            tool_call_id: None,
            tool_kind: None,
            tool_status: None,
            linked_plan_id: None,
            source_metadata: None,
        };

        let pending_wait = {
            let mut sink = self.event_sink.lock().await;
            let pending_wait = self
                .interaction_broker
                .register_mcp_elicitation(&self.session_id, &request_id, normalized.pending)
                .await;

            self.live_session_handle
                .add_pending_interaction(PendingInteractionSummary {
                    request_id: request_id.clone(),
                    kind: InteractionKind::McpElicitation,
                    title: title.clone(),
                    description: description.clone(),
                    source: PendingInteractionSource {
                        tool_call_id: None,
                        tool_kind: None,
                        tool_status: None,
                        linked_plan_id: None,
                    },
                    payload: pending_payload,
                })
                .await;

            sink.interaction_requested(InteractionRequestedEvent {
                request_id: request_id.clone(),
                kind: InteractionKind::McpElicitation,
                title,
                description,
                source,
                payload: InteractionPayload::McpElicitation(payload),
            });

            pending_wait
        };

        raw_ext_response(codex_ext_response_from_outcome(pending_wait.wait().await))
    }

    async fn claude_mcp_elicitation(&self, args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        let request = serde_json::from_str::<ClaudeMcpElicitationExtParams>(args.params.get())
            .map_err(|error| acp::Error::invalid_params().data(error.to_string()))?;
        let normalized = normalize_claude_mcp_elicitation(request)
            .map_err(|error| acp::Error::invalid_params().data(format!("{error:?}")))?;

        let request_id = uuid::Uuid::new_v4().to_string();
        let title = normalized.title;
        let description = normalized.description;
        let payload = normalized.payload;
        let pending_payload = PendingInteractionPayloadSummary::McpElicitation {
            payload: payload.clone(),
        };
        let source = InteractionSource {
            tool_call_id: None,
            tool_kind: None,
            tool_status: None,
            linked_plan_id: None,
            source_metadata: None,
        };

        let pending_wait = {
            let mut sink = self.event_sink.lock().await;
            let pending_wait = self
                .interaction_broker
                .register_mcp_elicitation(&self.session_id, &request_id, normalized.pending)
                .await;

            self.live_session_handle
                .add_pending_interaction(PendingInteractionSummary {
                    request_id: request_id.clone(),
                    kind: InteractionKind::McpElicitation,
                    title: title.clone(),
                    description: description.clone(),
                    source: PendingInteractionSource {
                        tool_call_id: None,
                        tool_kind: None,
                        tool_status: None,
                        linked_plan_id: None,
                    },
                    payload: pending_payload,
                })
                .await;

            sink.interaction_requested(InteractionRequestedEvent {
                request_id: request_id.clone(),
                kind: InteractionKind::McpElicitation,
                title,
                description,
                source,
                payload: InteractionPayload::McpElicitation(payload),
            });

            pending_wait
        };

        raw_ext_response(claude_ext_response_from_outcome(pending_wait.wait().await))
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

fn raw_ext_response<T: Serialize>(value: T) -> acp::Result<acp::ExtResponse> {
    let serialized = serde_json::to_string(&value)
        .map_err(|error| acp::Error::internal_error().data(error.to_string()))?;
    let raw = RawValue::from_string(serialized)
        .map_err(|error| acp::Error::internal_error().data(error.to_string()))?;
    Ok(acp::ExtResponse::new(raw.into()))
}

pub(crate) fn session_update_kind(update: &acp::SessionUpdate) -> &'static str {
    use acp::SessionUpdate::*;
    match update {
        AgentMessageChunk(_) => "agent_message_chunk",
        AgentThoughtChunk(_) => "agent_thought_chunk",
        ToolCall(_) => "tool_call",
        ToolCallUpdate(_) => "tool_call_update",
        Plan(_) => "plan",
        AvailableCommandsUpdate(_) => "available_commands_update",
        CurrentModeUpdate(_) => "current_mode_update",
        ConfigOptionUpdate(_) => "config_option_update",
        SessionInfoUpdate(_) => "session_info_update",
        UsageUpdate(_) => "usage_update",
        UserMessageChunk(_) => "user_message_chunk",
        #[allow(unreachable_patterns)]
        _ => "other",
    }
}
