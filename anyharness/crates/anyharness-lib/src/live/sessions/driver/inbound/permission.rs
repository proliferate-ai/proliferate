use agent_client_protocol as acp;
use anyharness_contract::v1::{
    InteractionKind, InteractionPayload, InteractionRequestedEvent, InteractionSource,
    PendingInteractionPayloadSummary, PendingInteractionSource, PendingInteractionSummary,
    PermissionInteractionPayload,
};

use super::InboundDoor;
use crate::acp::permission_context::permission_context_from_meta;
use crate::acp::permission_payload::{bound_raw_json, permission_options};
use crate::live::sessions::model::{
    PermissionAdvice, PermissionQuestionView, SessionObserverContext,
};
use crate::live::sessions::rendezvous::broker::PermissionOutcome;

impl InboundDoor {
    pub async fn handle_request_permission(
        &self,
        args: acp::schema::RequestPermissionRequest,
    ) -> acp::Result<acp::schema::RequestPermissionResponse> {
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

        // Consult the permission advisor (a domain port) BEFORE parking,
        // under the sink lock: any event rows it commits (predecided plan
        // resolutions) allocate from the locked counter and are published
        // here under the same lock hold.
        let mut linked_plan_id: Option<String> = None;
        if let Some(advisor) = self.permission_advisor.as_ref() {
            let mut sink = self.event_sink.lock().await;
            let ctx = SessionObserverContext {
                session_id: self.session_id.clone(),
                workspace_id: self.workspace_id.clone(),
                agent_kind: self.agent_kind.clone(),
                turn_id: sink.current_turn_id(),
                next_seq: sink.next_seq(),
            };
            let question = PermissionQuestionView {
                session_id: &self.session_id,
                request_id: &request_id,
                tool_call_id: tool_call_id.as_deref(),
                options: &args.options,
            };
            match advisor.advise(&ctx, &question) {
                PermissionAdvice::Park {
                    pending_interaction,
                } => {
                    linked_plan_id = pending_interaction.and_then(|link| link.linked_plan_id);
                }
                PermissionAdvice::Predecided {
                    selected_option_id,
                    persisted_events,
                } => {
                    sink.publish_persisted_events(persisted_events);
                    let outcome = match selected_option_id {
                        Some(option_id) => acp::schema::RequestPermissionOutcome::Selected(
                            acp::schema::SelectedPermissionOutcome::new(option_id),
                        ),
                        None => acp::schema::RequestPermissionOutcome::Cancelled,
                    };
                    return Ok(acp::schema::RequestPermissionResponse::new(outcome));
                }
            }
        }
        let source = InteractionSource {
            tool_call_id: tool_call_id.clone(),
            tool_kind: tool_kind.clone(),
            tool_status: tool_status.clone(),
            linked_plan_id: linked_plan_id.clone(),
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
                        linked_plan_id: linked_plan_id.clone(),
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
            PermissionOutcome::Selected { option_id } => {
                acp::schema::RequestPermissionOutcome::Selected(
                    acp::schema::SelectedPermissionOutcome::new(option_id),
                )
            }
            PermissionOutcome::Cancelled | PermissionOutcome::Dismissed => {
                acp::schema::RequestPermissionOutcome::Cancelled
            }
        };

        Ok(acp::schema::RequestPermissionResponse::new(acp_outcome))
    }
}
