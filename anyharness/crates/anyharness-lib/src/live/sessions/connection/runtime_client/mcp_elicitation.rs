use agent_client_protocol as acp;
use anyharness_contract::v1::{
    InteractionKind, InteractionPayload, InteractionRequestedEvent, InteractionSource,
    PendingInteractionPayloadSummary, PendingInteractionSource, PendingInteractionSummary,
};

use super::{raw_ext_response, RuntimeClient};
use crate::live::sessions::interactions::mcp_elicitation::{
    claude_ext_response_from_outcome, codex_ext_response_from_outcome,
    normalize_claude_mcp_elicitation, normalize_codex_mcp_elicitation,
    ClaudeMcpElicitationExtParams, CodexMcpElicitationExtParams,
};

impl RuntimeClient {
    pub(super) async fn codex_mcp_elicitation(
        &self,
        args: acp::ExtRequest,
    ) -> acp::Result<acp::ExtResponse> {
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

    pub(super) async fn claude_mcp_elicitation(
        &self,
        args: acp::ExtRequest,
    ) -> acp::Result<acp::ExtResponse> {
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
}
