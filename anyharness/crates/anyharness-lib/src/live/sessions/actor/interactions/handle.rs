use crate::live::sessions::actor::*;
pub(in crate::live::sessions::actor) async fn handle_resolve_interaction(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionBroker>,
    session_id: &str,
    request_id: String,
    resolution: InteractionResolution,
) -> Result<(), ResolveInteractionCommandError> {
    let outcome = match resolution {
        InteractionResolution::Selected { option_id } => interaction_broker
            .resolve_with_option_id(session_id, &request_id, &option_id)
            .await
            .map(InteractionBrokerOutcome::Permission),
        InteractionResolution::Decision(decision) => interaction_broker
            .resolve_with_decision(session_id, &request_id, decision)
            .await
            .map(InteractionBrokerOutcome::Permission),
        InteractionResolution::Submitted { answers } => interaction_broker
            .submit_user_input(session_id, &request_id, answers)
            .await
            .map(InteractionBrokerOutcome::UserInput),
        InteractionResolution::Accepted { fields } => interaction_broker
            .accept_mcp_elicitation(session_id, &request_id, fields)
            .await
            .map(InteractionBrokerOutcome::McpElicitation),
        InteractionResolution::Declined => interaction_broker
            .decline_mcp_elicitation(session_id, &request_id)
            .await
            .map(InteractionBrokerOutcome::McpElicitation),
        InteractionResolution::Cancelled => {
            interaction_broker
                .cancel(session_id, &request_id, InteractionCancelOutcome::Cancelled)
                .await
        }
        InteractionResolution::Dismissed => {
            interaction_broker
                .cancel(session_id, &request_id, InteractionCancelOutcome::Dismissed)
                .await
        }
    }
    .map_err(map_resolve_interaction_error)?;

    let (kind, contract_outcome) = broker_outcome_to_interaction_event(outcome);

    {
        let mut sink = event_sink.lock().await;
        sink.interaction_resolved(request_id.clone(), kind, contract_outcome);
    }
    handle.remove_pending_interaction(&request_id).await;
    Ok(())
}

pub(in crate::live::sessions::actor) async fn handle_apply_plan_decision(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    interaction_broker: &Arc<InteractionBroker>,
    plan_service: &PlanService,
    session_id: &str,
    plan_id: &str,
    expected_version: i64,
    decision: ProposedPlanDecisionState,
) -> Result<PlanRecord, PlanDecisionError> {
    let (mut plan, native_resolution) = {
        let mut sink = event_sink.lock().await;
        let context = sink.plan_event_context();
        let (plan, envelopes) = plan_service.update_decision_with_context(
            plan_id,
            expected_version,
            decision.clone(),
            context,
        )?;
        sink.publish_persisted_events(envelopes);
        let native_resolution = plan_decision_native_resolution(plan_service, &plan.id, &decision);
        (plan, native_resolution)
    };

    if let Some((request_id, resolution)) = native_resolution {
        let resolution_result = handle_resolve_interaction(
            handle,
            event_sink,
            interaction_broker,
            session_id,
            request_id.clone(),
            resolution,
        )
        .await;
        let next_native_state = if resolution_result.is_ok() {
            ProposedPlanNativeResolutionState::Finalized
        } else {
            if let Err(error) = &resolution_result {
                tracing::warn!(
                    session_id = %session_id,
                    request_id = %request_id,
                    error = ?error,
                    "failed to resolve native interaction for proposed plan decision"
                );
            }
            ProposedPlanNativeResolutionState::Failed
        };
        let error_message = resolution_result
            .err()
            .map(|error| format!("Failed to resolve native interaction: {error:?}"));
        let mut sink = event_sink.lock().await;
        let context = sink.plan_event_context();
        let (updated, envelopes) = plan_service.update_native_resolution_with_context(
            &plan.id,
            next_native_state,
            context,
            error_message,
        )?;
        sink.publish_persisted_events(envelopes);
        plan = updated;
    }

    Ok(plan)
}

pub(in crate::live::sessions::actor) fn plan_decision_native_resolution(
    plan_service: &PlanService,
    plan_id: &str,
    decision: &ProposedPlanDecisionState,
) -> Option<(String, InteractionResolution)> {
    let link = plan_service
        .store()
        .find_link_by_plan(plan_id)
        .ok()
        .flatten()?;
    let mappings: serde_json::Value = serde_json::from_str(&link.option_mappings_json).ok()?;

    match decision {
        // Product approval means "accept this plan document", not "select the
        // agent's native implementation option." Dismiss the parked native
        // permission so the broker and pending-interaction state do not leak;
        // implementation remains a separate explicit action.
        ProposedPlanDecisionState::Approved => {
            Some((link.request_id, InteractionResolution::Dismissed))
        }
        ProposedPlanDecisionState::Rejected => {
            let option_id = mappings
                .get("reject")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|option_id| !option_id.is_empty());
            match option_id {
                Some(option_id) => Some((
                    link.request_id,
                    InteractionResolution::Selected {
                        option_id: option_id.to_string(),
                    },
                )),
                None => Some((link.request_id, InteractionResolution::Dismissed)),
            }
        }
        _ => None,
    }
}

pub(in crate::live::sessions::actor) fn broker_outcome_to_interaction_event(
    outcome: InteractionBrokerOutcome,
) -> (InteractionKind, InteractionOutcome) {
    match outcome {
        InteractionBrokerOutcome::Permission(outcome) => (
            InteractionKind::Permission,
            permission_outcome_to_interaction_outcome(outcome),
        ),
        InteractionBrokerOutcome::UserInput(outcome) => (
            InteractionKind::UserInput,
            user_input_outcome_to_interaction_outcome(outcome),
        ),
        InteractionBrokerOutcome::McpElicitation(outcome) => (
            InteractionKind::McpElicitation,
            mcp_elicitation_outcome_to_interaction_outcome(outcome),
        ),
    }
}

pub(in crate::live::sessions::actor) fn permission_outcome_to_interaction_outcome(
    outcome: PermissionOutcome,
) -> InteractionOutcome {
    match outcome {
        PermissionOutcome::Selected { option_id } => InteractionOutcome::Selected { option_id },
        PermissionOutcome::Cancelled => InteractionOutcome::Cancelled,
        PermissionOutcome::Dismissed => InteractionOutcome::Dismissed,
    }
}

pub(in crate::live::sessions::actor) fn user_input_outcome_to_interaction_outcome(
    outcome: UserInputOutcome,
) -> InteractionOutcome {
    match outcome {
        UserInputOutcome::Submitted {
            answered_question_ids,
            ..
        } => InteractionOutcome::Submitted {
            answered_question_ids,
        },
        UserInputOutcome::Cancelled => InteractionOutcome::Cancelled,
        UserInputOutcome::Dismissed => InteractionOutcome::Dismissed,
    }
}

pub(in crate::live::sessions::actor) fn mcp_elicitation_outcome_to_interaction_outcome(
    outcome: McpElicitationOutcome,
) -> InteractionOutcome {
    match outcome {
        McpElicitationOutcome::Accepted {
            accepted_field_ids, ..
        } => InteractionOutcome::Accepted { accepted_field_ids },
        McpElicitationOutcome::Declined => InteractionOutcome::Declined,
        McpElicitationOutcome::Cancelled => InteractionOutcome::Cancelled,
        McpElicitationOutcome::Dismissed => InteractionOutcome::Dismissed,
    }
}

pub(in crate::live::sessions::actor) fn map_resolve_interaction_error(
    error: ResolveInteractionError,
) -> ResolveInteractionCommandError {
    match error {
        ResolveInteractionError::NotFound => ResolveInteractionCommandError::NotFound,
        ResolveInteractionError::KindMismatch => ResolveInteractionCommandError::KindMismatch,
        ResolveInteractionError::InvalidOptionId => ResolveInteractionCommandError::InvalidOptionId,
        ResolveInteractionError::InvalidQuestionId => {
            ResolveInteractionCommandError::InvalidQuestionId
        }
        ResolveInteractionError::DuplicateQuestionAnswer => {
            ResolveInteractionCommandError::DuplicateQuestionAnswer
        }
        ResolveInteractionError::MissingQuestionAnswer => {
            ResolveInteractionCommandError::MissingQuestionAnswer
        }
        ResolveInteractionError::InvalidSelectedOptionLabel => {
            ResolveInteractionCommandError::InvalidSelectedOptionLabel
        }
        ResolveInteractionError::InvalidMcpFieldId => {
            ResolveInteractionCommandError::InvalidMcpFieldId
        }
        ResolveInteractionError::DuplicateMcpField => {
            ResolveInteractionCommandError::DuplicateMcpField
        }
        ResolveInteractionError::MissingMcpField => ResolveInteractionCommandError::MissingMcpField,
        ResolveInteractionError::InvalidMcpFieldValue => {
            ResolveInteractionCommandError::InvalidMcpFieldValue
        }
        ResolveInteractionError::NotMcpUrlElicitation => {
            ResolveInteractionCommandError::NotMcpUrlElicitation
        }
    }
}
