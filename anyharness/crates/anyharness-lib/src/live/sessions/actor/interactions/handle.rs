use std::sync::Arc;

use anyharness_contract::v1::{
    InteractionKind, InteractionOutcome, ProposedPlanDecisionState,
    ProposedPlanNativeResolutionState,
};
use tokio::sync::Mutex;

use crate::acp::event_sink::SessionEventSink;
use crate::acp::mcp_elicitation::McpElicitationOutcome;
use crate::acp::permission_broker::{
    InteractionBroker, InteractionBrokerOutcome, InteractionCancelOutcome, PermissionOutcome,
    ResolveInteractionError, UserInputOutcome,
};
use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::{PlanDecisionError, PlanService};
use crate::live::sessions::actor::command::{
    InteractionResolution, ResolveInteractionCommandError,
};
use crate::live::sessions::actor::interactions::plan_links::link_plan_to_pending_permission;
use crate::live::sessions::handle::LiveSessionHandle;
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
    let (mut plan, mut native_resolution) = {
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

    if matches!(
        decision,
        ProposedPlanDecisionState::Approved | ProposedPlanDecisionState::Rejected
    ) {
        let relinked = link_plan_to_pending_permission(handle, plan_service, &plan).await;
        if relinked || native_resolution.is_none() {
            native_resolution = plan_decision_native_resolution(plan_service, &plan.id, &decision);
        }
    }

    if let Some(native_resolution) = native_resolution {
        let (next_native_state, error_message) = match native_resolution {
            PlanNativeResolution::Resolve {
                request_id,
                resolution,
            } => {
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
                (next_native_state, error_message)
            }
            PlanNativeResolution::Failed { error_message, .. } => (
                ProposedPlanNativeResolutionState::Failed,
                Some(error_message),
            ),
        };
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

#[derive(Debug, PartialEq)]
pub(in crate::live::sessions::actor) enum PlanNativeResolution {
    Resolve {
        request_id: String,
        resolution: InteractionResolution,
    },
    Failed {
        request_id: String,
        error_message: String,
    },
}

pub(in crate::live::sessions::actor) fn plan_decision_native_resolution(
    plan_service: &PlanService,
    plan_id: &str,
    decision: &ProposedPlanDecisionState,
) -> Option<PlanNativeResolution> {
    let link = plan_service
        .store()
        .find_link_by_plan(plan_id)
        .ok()
        .flatten()?;
    let mappings: Option<serde_json::Value> = serde_json::from_str(&link.option_mappings_json).ok();

    match decision {
        // For native plan-exit interactions, product approval means the user
        // accepted the plan and wants the same agent to leave plan mode.
        ProposedPlanDecisionState::Approved => {
            let option_id = mappings
                .as_ref()
                .and_then(|mappings| option_mapping(mappings, "approve"));
            match option_id {
                Some(option_id) => Some(PlanNativeResolution::Resolve {
                    request_id: link.request_id,
                    resolution: InteractionResolution::Selected {
                        option_id: option_id.to_string(),
                    },
                }),
                None => Some(PlanNativeResolution::Failed {
                    request_id: link.request_id,
                    error_message: "Approved plan could not map to a native approval option."
                        .to_string(),
                }),
            }
        }
        ProposedPlanDecisionState::Rejected => {
            let option_id = mappings
                .as_ref()
                .and_then(|mappings| option_mapping(mappings, "reject"));
            match option_id {
                Some(option_id) => Some(PlanNativeResolution::Resolve {
                    request_id: link.request_id,
                    resolution: InteractionResolution::Selected {
                        option_id: option_id.to_string(),
                    },
                }),
                None => Some(PlanNativeResolution::Resolve {
                    request_id: link.request_id,
                    resolution: InteractionResolution::Dismissed,
                }),
            }
        }
        _ => None,
    }
}

fn option_mapping<'a>(mappings: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    mappings
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|option_id| !option_id.is_empty())
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

#[cfg(test)]
mod tests {
    use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};
    use serde_json::json;

    use super::*;
    use crate::domains::plans::model::{NewPlan, PlanCreateOutcome};
    use crate::domains::plans::service::{PlanEventContext, PlanService};
    use crate::domains::plans::store::PlanStore;
    use crate::persistence::Db;

    fn plan_service_with_link(option_mappings: serde_json::Value) -> (PlanService, String) {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (
                    id, kind, path, source_repo_root_path, created_at, updated_at
                 ) VALUES ('workspace-1', 'local', '/tmp/workspace-1', '/tmp/workspace-1', 'now', 'now')",
                [],
            )?;
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at
                 ) VALUES ('session-1', 'workspace-1', 'claude', 'idle', 'now', 'now')",
                [],
            )?;
            Ok(())
        })
        .expect("seed db");
        let service = PlanService::new(PlanStore::new(db));
        let created = service
            .create_completed_plan(
                NewPlan {
                    workspace_id: "workspace-1".to_string(),
                    session_id: "session-1".to_string(),
                    title: "Plan".to_string(),
                    body_markdown: "Do it.".to_string(),
                    source_agent_kind: "claude".to_string(),
                    source_kind: "claude_exit_plan_mode".to_string(),
                    source_turn_id: Some("turn-1".to_string()),
                    source_item_id: Some("tool-1".to_string()),
                    source_tool_call_id: Some("tool-1".to_string()),
                },
                PlanEventContext {
                    session_id: "session-1".to_string(),
                    source_agent_kind: "claude".to_string(),
                    turn_id: Some("turn-1".to_string()),
                    next_seq: 1,
                },
            )
            .expect("create plan");
        assert_eq!(created.outcome, PlanCreateOutcome::Created);
        assert_eq!(
            created.plan.native_resolution_state,
            ProposedPlanNativeResolutionState::PendingLink,
        );
        service
            .register_interaction_link(&created.plan, "request-1", "tool-1", option_mappings)
            .expect("register link");
        (service, created.plan.id)
    }

    #[test]
    fn approved_native_plan_selects_approve_option() {
        let (service, plan_id) = plan_service_with_link(json!({
            "approve": "allow-once",
            "reject": "reject-once",
        }));

        assert_eq!(
            plan_decision_native_resolution(
                &service,
                &plan_id,
                &ProposedPlanDecisionState::Approved,
            ),
            Some(PlanNativeResolution::Resolve {
                request_id: "request-1".to_string(),
                resolution: InteractionResolution::Selected {
                    option_id: "allow-once".to_string(),
                },
            }),
        );
    }

    #[test]
    fn rejected_native_plan_selects_reject_option() {
        let (service, plan_id) = plan_service_with_link(json!({
            "approve": "allow-once",
            "reject": "reject-once",
        }));

        assert_eq!(
            plan_decision_native_resolution(
                &service,
                &plan_id,
                &ProposedPlanDecisionState::Rejected,
            ),
            Some(PlanNativeResolution::Resolve {
                request_id: "request-1".to_string(),
                resolution: InteractionResolution::Selected {
                    option_id: "reject-once".to_string(),
                },
            }),
        );
    }

    #[test]
    fn approved_native_plan_fails_when_no_approve_mapping_exists() {
        let (service, plan_id) = plan_service_with_link(json!({
            "reject": "reject-once",
        }));

        assert_eq!(
            plan_decision_native_resolution(
                &service,
                &plan_id,
                &ProposedPlanDecisionState::Approved,
            ),
            Some(PlanNativeResolution::Failed {
                request_id: "request-1".to_string(),
                error_message: "Approved plan could not map to a native approval option."
                    .to_string(),
            }),
        );
    }
}
