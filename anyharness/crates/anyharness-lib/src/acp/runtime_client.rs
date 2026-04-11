use std::sync::Arc;

use agent_client_protocol as acp;
use tokio::sync::{mpsc, Mutex};

use super::event_sink::SessionEventSink;
use super::permission_broker::{PermissionBroker, PermissionOutcome};
use super::session_actor::LiveSessionHandle;
use crate::sessions::model::SessionPermissionPolicy;
use anyharness_contract::v1::{
    PendingApprovalSummary, PermissionOutcome as ContractPermissionOutcome,
    PermissionRequestedEvent, SessionExecutionPhase,
};

pub struct RuntimeClient {
    pub session_id: String,
    pub notification_tx: mpsc::UnboundedSender<acp::SessionNotification>,
    pub permission_broker: Arc<PermissionBroker>,
    pub event_sink: Arc<Mutex<SessionEventSink>>,
    pub live_session_handle: Arc<LiveSessionHandle>,
    pub permission_policy: SessionPermissionPolicy,
}

impl RuntimeClient {
    pub fn new(
        session_id: String,
        notification_tx: mpsc::UnboundedSender<acp::SessionNotification>,
        permission_broker: Arc<PermissionBroker>,
        event_sink: Arc<Mutex<SessionEventSink>>,
        live_session_handle: Arc<LiveSessionHandle>,
        permission_policy: SessionPermissionPolicy,
    ) -> Self {
        Self {
            session_id,
            notification_tx,
            permission_broker,
            event_sink,
            live_session_handle,
            permission_policy,
        }
    }
}

#[async_trait::async_trait(?Send)]
impl acp::Client for RuntimeClient {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        if self.permission_policy == SessionPermissionPolicy::FailOnRequest {
            let title = args
                .tool_call
                .fields
                .title
                .clone()
                .unwrap_or_else(|| "Permission requested".to_string());
            {
                let mut sink = self.event_sink.lock().await;
                sink.error(
                    format!(
                        "Cowork session rejected a permission request for '{title}'. This session must run approval-free."
                    ),
                    Some("COWORK_PERMISSION_REQUESTED".to_string()),
                );
            }
            self.live_session_handle
                .set_execution_phase(SessionExecutionPhase::Errored)
                .await;
            return Err(acp::Error::internal_error().data(serde_json::json!({
                "code": "cowork_permission_requested",
                "detail": "Cowork sessions do not allow interactive permission requests.",
            })));
        }

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
            .and_then(|v| serde_json::to_value(v).ok());

        let raw_output = args
            .tool_call
            .fields
            .raw_output
            .as_ref()
            .and_then(|v| serde_json::to_value(v).ok());

        let options = serde_json::to_value(&args.options).ok();

        {
            let mut sink = self.event_sink.lock().await;
            sink.permission_requested(PermissionRequestedEvent {
                request_id: request_id.clone(),
                title,
                description: None,
                tool_call_id,
                tool_kind,
                tool_status,
                raw_input,
                raw_output,
                options,
            });
        }
        self.live_session_handle
            .set_pending_approval(PendingApprovalSummary {
                request_id: request_id.clone(),
                title: args
                    .tool_call
                    .fields
                    .title
                    .clone()
                    .unwrap_or_else(|| "Permission requested".to_string()),
                tool_call_id: Some(args.tool_call.tool_call_id.to_string()),
                tool_kind: args
                    .tool_call
                    .fields
                    .kind
                    .as_ref()
                    .and_then(|k| serde_json::to_value(k).ok())
                    .and_then(|v| v.as_str().map(String::from)),
            })
            .await;

        let outcome = self
            .permission_broker
            .request_permission(&request_id, &args.options)
            .await;

        let (acp_outcome, contract_outcome) = match outcome {
            PermissionOutcome::Selected { option_id } => (
                acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                    option_id.clone(),
                )),
                ContractPermissionOutcome::Selected { option_id },
            ),
            PermissionOutcome::Cancelled => (
                acp::RequestPermissionOutcome::Cancelled,
                ContractPermissionOutcome::Cancelled,
            ),
        };

        {
            let mut sink = self.event_sink.lock().await;
            sink.permission_resolved(request_id, contract_outcome);
        }
        self.live_session_handle
            .set_execution_phase(anyharness_contract::v1::SessionExecutionPhase::Running)
            .await;

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
