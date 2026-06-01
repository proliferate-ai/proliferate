use std::sync::Arc;

use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};
use tokio::sync::Mutex;

use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::{PlanDecisionError, PlanService};
use crate::live::sessions::actor::command::InteractionResolution;
use crate::live::sessions::actor::interactions::handle::handle_resolve_interaction;
use crate::live::sessions::actor::interactions::plan_links::link_plan_to_pending_permission;
use crate::live::sessions::event_sink::SessionEventSink;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::interactions::broker::InteractionBroker;

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
            PlanNativeResolution::FailAfterResolve {
                request_id,
                resolution,
                error_message,
            } => {
                if let Err(error) = handle_resolve_interaction(
                    handle,
                    event_sink,
                    interaction_broker,
                    session_id,
                    request_id.clone(),
                    resolution,
                )
                .await
                {
                    tracing::warn!(
                        session_id = %session_id,
                        request_id = %request_id,
                        error = ?error,
                        "failed to clear native interaction after proposed plan decision failed"
                    );
                }
                (
                    ProposedPlanNativeResolutionState::Failed,
                    Some(error_message),
                )
            }
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
    FailAfterResolve {
        request_id: String,
        resolution: InteractionResolution,
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
                None => Some(PlanNativeResolution::FailAfterResolve {
                    request_id: link.request_id,
                    resolution: InteractionResolution::Cancelled,
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use agent_client_protocol as acp;
    use anyharness_contract::v1::{
        InteractionKind, PendingInteractionPayloadSummary, PendingInteractionSource,
        PendingInteractionSummary, PermissionInteractionOption, PermissionInteractionOptionKind,
        ProposedPlanDecisionState, ProposedPlanNativeResolutionState, SessionEventEnvelope,
        SessionExecutionPhase,
    };
    use serde_json::json;
    use tokio::sync::{broadcast, mpsc, Mutex};
    use tokio::time::timeout;

    use super::*;
    use crate::domains::plans::model::PlanRecord;
    use crate::domains::plans::model::{NewPlan, PlanCreateOutcome};
    use crate::domains::plans::service::{PlanEventContext, PlanService};
    use crate::domains::plans::store::PlanStore;
    use crate::live::sessions::actor::command::SessionCommand;
    use crate::live::sessions::event_sink::SessionEventSink;
    use crate::live::sessions::handle::LiveSessionHandle;
    use crate::live::sessions::interactions::broker::{InteractionBroker, PermissionOutcome};
    use crate::persistence::Db;
    use crate::sessions::store::SessionStore;

    fn seed_plan_service_with_link(
        option_mappings: serde_json::Value,
    ) -> (Db, PlanService, PlanRecord) {
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
        let service = PlanService::new(PlanStore::new(db.clone()));
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
        (db, service, created.plan)
    }

    fn plan_service_with_link(option_mappings: serde_json::Value) -> (PlanService, String) {
        let (_db, service, plan) = seed_plan_service_with_link(option_mappings);
        (service, plan.id)
    }

    fn pending_permission_summary() -> PendingInteractionSummary {
        PendingInteractionSummary {
            request_id: "request-1".to_string(),
            kind: InteractionKind::Permission,
            title: "Exit plan mode".to_string(),
            description: None,
            source: PendingInteractionSource {
                tool_call_id: Some("tool-1".to_string()),
                tool_kind: Some("exit_plan_mode".to_string()),
                tool_status: None,
                linked_plan_id: None,
            },
            payload: PendingInteractionPayloadSummary::Permission {
                options: vec![PermissionInteractionOption {
                    option_id: "reject-once".to_string(),
                    label: "Reject".to_string(),
                    kind: PermissionInteractionOptionKind::RejectOnce,
                }],
                context: None,
            },
        }
    }

    async fn live_plan_context(
        option_mappings: serde_json::Value,
    ) -> (
        PlanService,
        PlanRecord,
        Arc<Mutex<SessionEventSink>>,
        Arc<InteractionBroker>,
        Arc<LiveSessionHandle>,
        crate::live::sessions::interactions::broker::PendingPermissionWait,
    ) {
        let (db, service, plan) = seed_plan_service_with_link(option_mappings);
        let session_store = SessionStore::new(db);
        let last_event_seq = session_store
            .next_event_seq("session-1")
            .expect("next event seq")
            - 1;
        let (command_tx, _command_rx) = mpsc::channel::<SessionCommand>(4);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(16);
        let handle = Arc::new(LiveSessionHandle::new(
            "session-1",
            command_tx,
            event_tx.clone(),
            Some("native-1".to_string()),
            SessionExecutionPhase::Running,
        ));
        handle
            .add_pending_interaction(pending_permission_summary())
            .await;
        let broker = Arc::new(InteractionBroker::new());
        let wait = broker
            .register_permission(
                "session-1",
                "request-1",
                &[acp::PermissionOption::new(
                    acp::PermissionOptionId::new("reject-once"),
                    "Reject",
                    acp::PermissionOptionKind::RejectOnce,
                )],
            )
            .await;
        let event_sink = Arc::new(Mutex::new(SessionEventSink::resume_from_seq(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace-1"),
            last_event_seq,
            event_tx,
            session_store,
        )));
        (service, plan, event_sink, broker, handle, wait)
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
            Some(PlanNativeResolution::FailAfterResolve {
                request_id: "request-1".to_string(),
                resolution: InteractionResolution::Cancelled,
                error_message: "Approved plan could not map to a native approval option."
                    .to_string(),
            }),
        );
    }

    #[tokio::test]
    async fn approved_native_plan_failure_cancels_pending_permission() {
        let (service, plan, event_sink, broker, handle, wait) = live_plan_context(json!({
            "reject": "reject-once",
        }))
        .await;

        let updated = handle_apply_plan_decision(
            &handle,
            &event_sink,
            &broker,
            &service,
            "session-1",
            &plan.id,
            plan.decision_version,
            ProposedPlanDecisionState::Approved,
        )
        .await
        .expect("apply plan decision");

        assert_eq!(updated.decision_state, ProposedPlanDecisionState::Approved);
        assert_eq!(
            updated.native_resolution_state,
            ProposedPlanNativeResolutionState::Failed,
        );
        assert_eq!(
            timeout(Duration::from_secs(1), wait.wait())
                .await
                .expect("permission wait should resolve"),
            PermissionOutcome::Cancelled,
        );
        assert!(handle
            .execution_snapshot()
            .await
            .pending_interactions
            .is_empty());
    }
}
