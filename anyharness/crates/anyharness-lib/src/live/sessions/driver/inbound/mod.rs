use std::sync::Arc;

use agent_client_protocol as acp;
use serde::Serialize;
use serde_json::value::RawValue;
use tokio::sync::{mpsc, Mutex};

use crate::live::sessions::model::PermissionAdvisor;
use crate::live::sessions::sink::SessionEventSink;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::rendezvous::broker::InteractionRendezvous;

mod mcp_elicitation;
mod permission;
mod user_input;

const CODEX_REQUEST_USER_INPUT_METHOD: &str = "experimental/codex/requestUserInput";
const CLAUDE_REQUEST_USER_INPUT_METHOD: &str = "experimental/claude/requestUserInput";
const CLAUDE_MCP_ELICITATION_METHOD: &str = "experimental/claude/mcpElicitation";

pub struct RuntimeClient {
    pub session_id: String,
    pub notification_tx: mpsc::UnboundedSender<acp::schema::SessionNotification>,
    pub interaction_broker: Arc<InteractionRendezvous>,
    pub event_sink: Arc<Mutex<SessionEventSink>>,
    pub live_session_handle: Arc<LiveSessionHandle>,
    pub workspace_id: String,
    pub agent_kind: String,
    pub permission_advisor: Option<Arc<dyn PermissionAdvisor>>,
}

impl RuntimeClient {
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
