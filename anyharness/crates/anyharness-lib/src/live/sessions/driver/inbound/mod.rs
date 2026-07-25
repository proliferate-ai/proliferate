use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::PendingInteractionSummary;
use serde::Serialize;
use serde_json::value::RawValue;
use tokio::sync::{mpsc, Mutex};

use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::PermissionAdvisor;
use crate::live::sessions::rendezvous::broker::{InteractionCancelOutcome, InteractionRendezvous};
use crate::live::sessions::sink::SessionEventSink;

mod mcp_elicitation;
mod permission;
mod user_input;

const CODEX_REQUEST_USER_INPUT_METHOD: &str = "experimental/codex/requestUserInput";
const CLAUDE_REQUEST_USER_INPUT_METHOD: &str = "experimental/claude/requestUserInput";
const CLAUDE_MCP_ELICITATION_METHOD: &str = "experimental/claude/mcpElicitation";

/// The inbound door: everything the agent-initiated direction of the ACP
/// connection may touch. Handlers registered in `driver/connection.rs` clone
/// an `Arc<InboundDoor>` and route notifications to the actor's channel and
/// requests (permission, user input, MCP elicitation) through the rendezvous
/// broker while rendering pending-interaction state via the shared sink.
pub(in crate::live::sessions) struct InboundDoor {
    pub session_id: String,
    pub notification_tx: mpsc::UnboundedSender<acp::schema::SessionNotification>,
    pub interaction_broker: Arc<InteractionRendezvous>,
    pub event_sink: Arc<Mutex<SessionEventSink>>,
    pub live_session_handle: Arc<LiveSessionHandle>,
    pub workspace_id: String,
    pub agent_kind: String,
    pub permission_advisor: Option<Arc<dyn PermissionAdvisor>>,
}

impl InboundDoor {
    pub fn new(
        session_id: String,
        notification_tx: mpsc::UnboundedSender<acp::schema::SessionNotification>,
        interaction_broker: Arc<InteractionRendezvous>,
        event_sink: Arc<Mutex<SessionEventSink>>,
        live_session_handle: Arc<LiveSessionHandle>,
        workspace_id: String,
        agent_kind: String,
        permission_advisor: Option<Arc<dyn PermissionAdvisor>>,
    ) -> Self {
        Self {
            session_id,
            notification_tx,
            interaction_broker,
            event_sink,
            live_session_handle,
            workspace_id,
            agent_kind,
            permission_advisor,
        }
    }

    pub async fn handle_session_notification(
        &self,
        notification: acp::schema::SessionNotification,
    ) -> acp::Result<()> {
        tracing::trace!(
            session_id = %self.session_id,
            kind = session_update_kind(&notification.update),
            "ACP session_notification"
        );
        let _ = self.notification_tx.send(notification);
        Ok(())
    }

    pub async fn handle_ext_request(
        &self,
        args: acp::schema::ExtRequest,
    ) -> acp::Result<acp::schema::ExtResponse> {
        match args.method.as_ref() {
            CODEX_REQUEST_USER_INPUT_METHOD => self.codex_request_user_input(args).await,
            CLAUDE_REQUEST_USER_INPUT_METHOD => self.claude_request_user_input(args).await,
            CLAUDE_MCP_ELICITATION_METHOD => self.claude_mcp_elicitation(args).await,
            _ => Err(acp::Error::method_not_found()),
        }
    }

    /// Commits a broker registration to the live execution snapshot. Close
    /// intent is the linearization fence: registrations that lose the race
    /// are immediately cancelled and must not publish an interaction event.
    async fn accept_registered_interaction(
        &self,
        pending_interaction: PendingInteractionSummary,
    ) -> bool {
        accept_registered_interaction(
            &self.interaction_broker,
            &self.live_session_handle,
            &self.session_id,
            pending_interaction,
        )
        .await
    }
}

async fn accept_registered_interaction(
    interaction_broker: &InteractionRendezvous,
    live_session_handle: &LiveSessionHandle,
    session_id: &str,
    pending_interaction: PendingInteractionSummary,
) -> bool {
    let request_id = pending_interaction.request_id.clone();
    if live_session_handle
        .try_add_pending_interaction(pending_interaction)
        .await
    {
        return true;
    }

    let _ = interaction_broker
        .cancel(session_id, &request_id, InteractionCancelOutcome::Cancelled)
        .await;
    false
}

pub(crate) fn raw_ext_response<T: Serialize>(value: T) -> acp::Result<acp::schema::ExtResponse> {
    let serialized = serde_json::to_string(&value)
        .map_err(|error| acp::Error::internal_error().data(error.to_string()))?;
    let raw = RawValue::from_string(serialized)
        .map_err(|error| acp::Error::internal_error().data(error.to_string()))?;
    Ok(acp::schema::ExtResponse::new(raw.into()))
}

pub(crate) fn session_update_kind(update: &acp::schema::SessionUpdate) -> &'static str {
    use acp::schema::SessionUpdate::*;
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

#[cfg(test)]
mod closing_tests {
    use std::sync::Arc;

    use agent_client_protocol::schema::{
        CreateElicitationRequest, ElicitationFormMode, ElicitationSchema, ElicitationSessionScope,
    };
    use anyharness_contract::v1::{
        InteractionKind, PendingInteractionPayloadSummary, PendingInteractionSource,
        PendingInteractionSummary, SessionEventEnvelope, SessionExecutionPhase, UserInputQuestion,
    };
    use tokio::sync::{broadcast, mpsc};

    use super::accept_registered_interaction;
    use crate::live::sessions::actor::command::SessionCommand;
    use crate::live::sessions::handle::LiveSessionHandle;
    use crate::live::sessions::rendezvous::broker::{
        InteractionRendezvous, PermissionOutcome, UserInputOutcome,
    };
    use crate::live::sessions::rendezvous::mcp_elicitation::{
        normalize_standard_mcp_elicitation, McpElicitationOutcome,
    };

    fn handle() -> Arc<LiveSessionHandle> {
        let (command_tx, _command_rx) = mpsc::channel::<SessionCommand>(4);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
        Arc::new(LiveSessionHandle::new_for_test(
            "session-1",
            command_tx,
            event_tx,
            Some("native-1".to_string()),
            SessionExecutionPhase::Running,
        ))
    }

    fn summary(
        request_id: &str,
        kind: InteractionKind,
        payload: PendingInteractionPayloadSummary,
    ) -> PendingInteractionSummary {
        PendingInteractionSummary {
            request_id: request_id.to_string(),
            kind,
            title: "Request".to_string(),
            description: None,
            source: PendingInteractionSource {
                tool_call_id: None,
                tool_kind: None,
                tool_status: None,
                linked_plan_id: None,
            },
            payload,
        }
    }

    #[tokio::test]
    async fn close_fence_cancels_permission_user_input_and_mcp_registrations() {
        let handle = handle();
        let broker = InteractionRendezvous::new();
        handle.begin_closing().await;

        let permission_wait = broker
            .register_permission(
                "session-1",
                "permission",
                &[agent_client_protocol::schema::PermissionOption::new(
                    "allow",
                    "Allow",
                    agent_client_protocol::schema::PermissionOptionKind::AllowOnce,
                )],
            )
            .await;
        assert!(
            !accept_registered_interaction(
                &broker,
                &handle,
                "session-1",
                summary(
                    "permission",
                    InteractionKind::Permission,
                    PendingInteractionPayloadSummary::Permission {
                        options: Vec::new(),
                        context: None,
                    },
                ),
            )
            .await
        );
        assert_eq!(permission_wait.wait().await, PermissionOutcome::Cancelled);

        let questions = vec![UserInputQuestion {
            question_id: "question-1".to_string(),
            header: "Header".to_string(),
            question: "Question?".to_string(),
            is_other: false,
            is_secret: false,
            options: Vec::new(),
        }];
        let user_input_wait = broker
            .register_user_input("session-1", "user-input", &questions)
            .await;
        assert!(
            !accept_registered_interaction(
                &broker,
                &handle,
                "session-1",
                summary(
                    "user-input",
                    InteractionKind::UserInput,
                    PendingInteractionPayloadSummary::UserInput { questions },
                ),
            )
            .await
        );
        assert_eq!(user_input_wait.wait().await, UserInputOutcome::Cancelled);

        let normalized = normalize_standard_mcp_elicitation(CreateElicitationRequest::new(
            ElicitationFormMode::new(
                ElicitationSessionScope::new("native-1"),
                ElicitationSchema::new().string("account", true),
            ),
            "Pick account",
        ))
        .expect("normalize MCP elicitation");
        let mcp_wait = broker
            .register_mcp_elicitation("session-1", "mcp", normalized.pending)
            .await;
        assert!(
            !accept_registered_interaction(
                &broker,
                &handle,
                "session-1",
                summary(
                    "mcp",
                    InteractionKind::McpElicitation,
                    PendingInteractionPayloadSummary::McpElicitation {
                        payload: normalized.payload,
                    },
                ),
            )
            .await
        );
        assert_eq!(mcp_wait.wait().await, McpElicitationOutcome::Cancelled);

        let snapshot = handle.execution_snapshot().await;
        assert_eq!(snapshot.phase, SessionExecutionPhase::Closing);
        assert!(snapshot.pending_interactions.is_empty());
    }
}
