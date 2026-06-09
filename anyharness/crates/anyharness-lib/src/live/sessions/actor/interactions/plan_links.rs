use std::sync::Arc;

use anyharness_contract::v1::PendingInteractionPayloadSummary;

use crate::acp::permission_payload::permission_option_mappings;
use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::PlanService;
use crate::live::sessions::handle::LiveSessionHandle;

pub(in crate::live::sessions::actor) async fn link_plan_to_pending_permission(
    handle: &Arc<LiveSessionHandle>,
    plan_service: &PlanService,
    plan: &PlanRecord,
) -> bool {
    let Some(tool_call_id) = plan.source_tool_call_id.as_deref() else {
        return false;
    };

    let snapshot = handle.execution_snapshot().await;
    let Some(pending) = snapshot
        .pending_interactions
        .iter()
        .rev()
        .find(|pending| pending.source.tool_call_id.as_deref() == Some(tool_call_id))
    else {
        return false;
    };
    let PendingInteractionPayloadSummary::Permission { options, .. } = &pending.payload else {
        return false;
    };

    match plan_service.register_interaction_link(
        plan,
        &pending.request_id,
        tool_call_id,
        permission_option_mappings(options),
    ) {
        Ok(()) => {
            handle
                .link_pending_interaction_to_plan(&pending.request_id, &plan.id)
                .await;
            true
        }
        Err(error) => {
            tracing::warn!(
                plan_id = %plan.id,
                session_id = %plan.session_id,
                request_id = %pending.request_id,
                tool_call_id = %tool_call_id,
                error = %error,
                "failed to link proposed plan to pending native permission"
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use anyharness_contract::v1::{
        InteractionKind, PendingInteractionPayloadSummary, PendingInteractionSource,
        PendingInteractionSummary, PermissionInteractionOption, PermissionInteractionOptionKind,
        ProposedPlanNativeResolutionState, SessionExecutionPhase,
    };
    use tokio::sync::{broadcast, mpsc};

    use super::*;
    use crate::app::test_support;
    use crate::domains::plans::model::{NewPlan, PlanCreateOutcome};
    use crate::domains::plans::service::{PlanEventContext, PlanService};
    use crate::domains::plans::store::PlanStore;
    use crate::live::sessions::handle::LiveSessionHandle;
    use crate::persistence::Db;

    #[tokio::test]
    async fn links_plan_to_existing_pending_permission_by_tool_call_id() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace_and_session(&db);
        let plan_service = PlanService::new(PlanStore::new(db));
        let created = plan_service
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

        let (command_tx, _command_rx) = mpsc::channel(1);
        let (event_tx, _event_rx) = broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            "session-1",
            command_tx,
            event_tx,
            None,
            SessionExecutionPhase::Running,
        ));
        handle
            .add_pending_interaction(PendingInteractionSummary {
                request_id: "request-1".to_string(),
                kind: InteractionKind::Permission,
                title: "Permission".to_string(),
                description: None,
                source: PendingInteractionSource {
                    tool_call_id: Some("tool-1".to_string()),
                    tool_kind: None,
                    tool_status: None,
                    linked_plan_id: None,
                },
                payload: PendingInteractionPayloadSummary::Permission {
                    options: vec![PermissionInteractionOption {
                        option_id: "allow".to_string(),
                        label: "Yes, continue".to_string(),
                        kind: PermissionInteractionOptionKind::AllowOnce,
                    }],
                    context: None,
                },
            })
            .await;

        assert!(link_plan_to_pending_permission(&handle, &plan_service, &created.plan).await);

        let link = plan_service
            .store()
            .find_link_by_plan(&created.plan.id)
            .expect("find link")
            .expect("link");
        assert_eq!(link.request_id, "request-1");
        assert_eq!(link.tool_call_id, "tool-1");
        let snapshot = handle.execution_snapshot().await;
        assert_eq!(
            snapshot.pending_interactions[0]
                .source
                .linked_plan_id
                .as_deref(),
            Some(created.plan.id.as_str()),
        );
    }

    fn seed_workspace_and_session(db: &Db) {
        test_support::seed_workspace_with_repo_root(db, "workspace-1", "local", "/tmp/workspace-1");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at
                 ) VALUES ('session-1', 'workspace-1', 'claude', 'idle', 'now', 'now')",
                [],
            )?;
            Ok(())
        })
        .expect("seed db");
    }
}
