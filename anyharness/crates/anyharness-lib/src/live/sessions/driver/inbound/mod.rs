use std::sync::Arc;

use agent_client_protocol as acp;
use serde::Serialize;
use serde_json::value::RawValue;
use tokio::sync::{mpsc, Mutex, OwnedMutexGuard};

use crate::live::sessions::driver::frame_observer::{ForkWireResponse, FrameObserver};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::PermissionAdvisor;
use crate::live::sessions::rendezvous::broker::InteractionRendezvous;
use crate::live::sessions::sink::SessionEventSink;

mod fork_epoch;
mod mcp_elicitation;
mod permission;
mod user_input;

use fork_epoch::{ForkInboundEpoch, NotificationRoute, RequestRoute};
pub(super) use permission::cancelled_permission_response;

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
    fork_epoch: ForkInboundEpoch,
    frame_observer: Arc<FrameObserver>,
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
            fork_epoch: ForkInboundEpoch::default(),
            frame_observer: Arc::new(FrameObserver::default()),
        }
    }

    pub(in crate::live::sessions) fn frame_observer(&self) -> Arc<FrameObserver> {
        self.frame_observer.clone()
    }

    pub(in crate::live::sessions) fn fork_wire_response(&self) -> ForkWireResponse {
        self.frame_observer.fork_wire_response()
    }

    pub(in crate::live::sessions) fn protects_provider_payloads(&self) -> bool {
        self.frame_observer.payloads_protected()
    }

    pub(in crate::live::sessions) fn prepare_process_local_fork_epoch(
        &self,
        parent_native_session_id: &str,
    ) -> anyhow::Result<()> {
        // Protection is intentionally one-way for this process. Delayed parent
        // frames remain possible after child adoption.
        self.frame_observer.protect_process_local_fork();
        self.fork_epoch.prepare_hydration(parent_native_session_id)
    }

    pub(in crate::live::sessions) fn begin_process_local_fork_pending(&self) -> anyhow::Result<()> {
        self.fork_epoch.begin_fork_pending()
    }

    pub(in crate::live::sessions) fn adopt_process_local_fork_child(
        &self,
        child_native_session_id: &str,
    ) -> anyhow::Result<()> {
        let buffered = self.fork_epoch.adopt_child(child_native_session_id)?;
        for notification in buffered {
            self.notification_tx.send(notification).map_err(|_| {
                anyhow::anyhow!("process-local fork notification channel is closed")
            })?;
        }
        Ok(())
    }

    pub(in crate::live::sessions) fn finalize_process_local_fork_ready(
        &self,
        finalize: impl FnOnce() -> anyhow::Result<()>,
    ) -> anyhow::Result<()> {
        self.fork_epoch.finalize_ready(finalize)
    }

    pub(in crate::live::sessions) fn close_process_local_fork_epoch(&self) {
        self.fork_epoch.close();
    }

    pub(in crate::live::sessions) fn ensure_process_local_fork_startup_clean(
        &self,
    ) -> anyhow::Result<()> {
        self.fork_epoch.ensure_startup_clean()
    }

    pub(super) fn route_session_request(&self, native_session_id: Option<&str>) -> bool {
        matches!(
            self.fork_epoch.route_request(native_session_id),
            RequestRoute::Admit
        )
    }

    pub(in crate::live::sessions) fn quarantine_unscoped_request(&self) {
        let _ = self.fork_epoch.route_request(None);
    }

    pub async fn handle_session_notification(
        &self,
        notification: acp::schema::SessionNotification,
    ) -> acp::Result<()> {
        let notification = match self.fork_epoch.route_notification(notification) {
            NotificationRoute::Admit(notification) => notification,
            NotificationRoute::Buffered | NotificationRoute::Quarantine => return Ok(()),
            NotificationRoute::RejectStartup => {
                return Err(acp::Error::internal_error()
                    .data("process-local fork startup rejected a session frame"));
            }
        };
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
        // Legacy extension requests carry provider-specific payloads and do
        // not have a protocol-level session scope. Fork connections reject
        // them before payload parsing. The closed method family selects only
        // a fixed cancellation-success shape; raw extension method text and
        // params never reach a parser or an error response on this path.
        if !self.route_session_request(None) {
            return cancelled_ext_response(args.method.as_ref());
        }
        match args.method.as_ref() {
            CODEX_REQUEST_USER_INPUT_METHOD => self.codex_request_user_input(args).await,
            CLAUDE_REQUEST_USER_INPUT_METHOD => self.claude_request_user_input(args).await,
            CLAUDE_MCP_ELICITATION_METHOD => self.claude_mcp_elicitation(args).await,
            _ => {
                self.quarantine_unscoped_request();
                Err(acp::Error::method_not_found())
            }
        }
    }

    async fn lock_for_inbound_mutation(&self) -> acp::Result<OwnedMutexGuard<SessionEventSink>> {
        let sink = self.event_sink.clone().lock_owned().await;
        if !sink.inbound_event_mutations_admitted() {
            return Err(inbound_mutation_rejected());
        }
        Ok(sink)
    }
}

fn cancelled_ext_response(method: &str) -> acp::Result<acp::schema::ExtResponse> {
    match method {
        CODEX_REQUEST_USER_INPUT_METHOD | CLAUDE_REQUEST_USER_INPUT_METHOD => {
            raw_ext_response(serde_json::json!({"outcome": "cancelled"}))
        }
        CLAUDE_MCP_ELICITATION_METHOD => raw_ext_response(serde_json::json!({"action": "cancel"})),
        _ => raw_ext_response(serde_json::json!({})),
    }
}

pub(crate) fn raw_ext_response<T: Serialize>(value: T) -> acp::Result<acp::schema::ExtResponse> {
    let serialized = serde_json::to_string(&value)
        .map_err(|error| acp::Error::internal_error().data(error.to_string()))?;
    let raw = RawValue::from_string(serialized)
        .map_err(|error| acp::Error::internal_error().data(error.to_string()))?;
    Ok(acp::schema::ExtResponse::new(raw.into()))
}

fn inbound_mutation_rejected() -> acp::Error {
    acp::Error::internal_error().data("session is no longer accepting agent-initiated requests")
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
mod tests {
    use super::{
        cancelled_ext_response, CLAUDE_MCP_ELICITATION_METHOD, CLAUDE_REQUEST_USER_INPUT_METHOD,
        CODEX_REQUEST_USER_INPUT_METHOD,
    };

    fn response_json(method: &str) -> serde_json::Value {
        let response = cancelled_ext_response(method).expect("fixed cancellation response");
        serde_json::from_str(response.0.get()).expect("response JSON")
    }

    #[test]
    fn protected_ext_rejections_use_closed_success_shapes_without_method_echo() {
        assert_eq!(
            response_json(CODEX_REQUEST_USER_INPUT_METHOD),
            serde_json::json!({"outcome": "cancelled"})
        );
        assert_eq!(
            response_json(CLAUDE_REQUEST_USER_INPUT_METHOD),
            serde_json::json!({"outcome": "cancelled"})
        );
        assert_eq!(
            response_json(CLAUDE_MCP_ELICITATION_METHOD),
            serde_json::json!({"action": "cancel"})
        );

        let sentinel = "experimental/provider/private-method-sentinel";
        let response = response_json(sentinel).to_string();
        assert_eq!(response, "{}");
        assert!(!response.contains(sentinel));
    }
}
