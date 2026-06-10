use agent_client_protocol as acp;
use anyharness_contract::v1::{
    InteractionKind, InteractionPayload, InteractionRequestedEvent, InteractionSource,
    PendingInteractionPayloadSummary, PendingInteractionSource, PendingInteractionSummary,
    PermissionInteractionPayload, ProposedPlanDecisionState, ProposedPlanNativeResolutionState,
};

use super::RuntimeClient;
use crate::acp::permission_context::permission_context_from_meta;
use crate::acp::permission_payload::{
    bound_raw_json, permission_option_mappings, permission_options,
};
use crate::domains::plans::model::PlanRecord;
use crate::live::sessions::interactions::broker::PermissionOutcome;

impl RuntimeClient {
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
        let option_mappings = permission_option_mappings(&options);
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
                option_mappings.clone(),
            );
            if let Some(predecided) = predecided_plan_permission(plan, &option_mappings) {
                self.publish_plan_native_resolution(
                    &plan.id,
                    predecided.native_state,
                    predecided.error_message,
                )
                .await;
                return Ok(acp::schema::RequestPermissionResponse::new(predecided.outcome));
            }
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
            PermissionOutcome::Selected { option_id } => acp::schema::RequestPermissionOutcome::Selected(
                acp::schema::SelectedPermissionOutcome::new(option_id),
            ),
            PermissionOutcome::Cancelled | PermissionOutcome::Dismissed => {
                acp::schema::RequestPermissionOutcome::Cancelled
            }
        };

        Ok(acp::schema::RequestPermissionResponse::new(acp_outcome))
    }

    async fn publish_plan_native_resolution(
        &self,
        plan_id: &str,
        native_state: ProposedPlanNativeResolutionState,
        error_message: Option<String>,
    ) {
        let mut sink = self.event_sink.lock().await;
        let context = sink.plan_event_context();
        match self.plan_service.update_native_resolution_with_context(
            plan_id,
            native_state,
            context,
            error_message,
        ) {
            Ok((_plan, envelopes)) => sink.publish_persisted_events(envelopes),
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    plan_id = %plan_id,
                    error = ?error,
                    "failed to update predecided native plan resolution"
                );
            }
        }
    }
}

struct PredecidedPlanPermission {
    outcome: acp::schema::RequestPermissionOutcome,
    native_state: ProposedPlanNativeResolutionState,
    error_message: Option<String>,
}

fn predecided_plan_permission(
    plan: &PlanRecord,
    option_mappings: &serde_json::Value,
) -> Option<PredecidedPlanPermission> {
    match &plan.decision_state {
        ProposedPlanDecisionState::Approved => Some(predecided_selected_or_failed(
            option_mappings,
            "approve",
            "Approved plan could not map to a native approval option.",
        )),
        ProposedPlanDecisionState::Rejected => {
            Some(predecided_selected_or_cancelled(option_mappings, "reject"))
        }
        ProposedPlanDecisionState::Pending | ProposedPlanDecisionState::Superseded => None,
    }
}

fn predecided_selected_or_failed(
    option_mappings: &serde_json::Value,
    key: &str,
    error_message: &str,
) -> PredecidedPlanPermission {
    match mapped_option_id(option_mappings, key) {
        Some(option_id) => PredecidedPlanPermission {
            outcome: selected_permission_outcome(option_id),
            native_state: ProposedPlanNativeResolutionState::Finalized,
            error_message: None,
        },
        None => PredecidedPlanPermission {
            outcome: acp::schema::RequestPermissionOutcome::Cancelled,
            native_state: ProposedPlanNativeResolutionState::Failed,
            error_message: Some(error_message.to_string()),
        },
    }
}

fn predecided_selected_or_cancelled(
    option_mappings: &serde_json::Value,
    key: &str,
) -> PredecidedPlanPermission {
    match mapped_option_id(option_mappings, key) {
        Some(option_id) => PredecidedPlanPermission {
            outcome: selected_permission_outcome(option_id),
            native_state: ProposedPlanNativeResolutionState::Finalized,
            error_message: None,
        },
        None => PredecidedPlanPermission {
            outcome: acp::schema::RequestPermissionOutcome::Cancelled,
            native_state: ProposedPlanNativeResolutionState::Finalized,
            error_message: None,
        },
    }
}

fn selected_permission_outcome(option_id: &str) -> acp::schema::RequestPermissionOutcome {
    acp::schema::RequestPermissionOutcome::Selected(acp::schema::SelectedPermissionOutcome::new(
        option_id.to_string(),
    ))
}

fn mapped_option_id<'a>(mappings: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    mappings
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|option_id| !option_id.is_empty())
}
