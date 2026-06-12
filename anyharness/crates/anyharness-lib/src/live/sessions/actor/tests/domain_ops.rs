//! Live-side integration tests for plan domain ops driven through the
//! actor's `run_domain_op` helper. Replacement coverage for the
//! harness-dependent tests that lived in the deleted
//! `actor/interactions/plan_decisions.rs`
//! (`approved_native_plan_failure_cancels_pending_permission`) and
//! `actor/interactions/plan_links.rs`
//! (`links_plan_to_existing_pending_permission_by_tool_call_id`); the pure
//! decision-mapping tests moved to `domains/plans/decision_op.rs`.

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
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio::time::timeout;

use crate::app::test_support;
use crate::domains::plans::decision_op::{
    PendingPermissionCandidate, PlanDecisionOp, PlanDecisionOpOutput,
};
use crate::domains::plans::model::{NewPlan, PlanCreateOutcome, PlanRecord};
use crate::domains::plans::service::{PlanEventContext, PlanService};
use crate::domains::plans::store::PlanStore;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::interactions::handle::run_domain_op;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::rendezvous::broker::{
    InteractionRendezvous, PendingPermissionWait, PermissionOutcome,
};
use crate::live::sessions::sink::SessionEventSink;
use crate::persistence::Db;

fn seed_plan_service(db: &Db) -> (Arc<PlanService>, PlanRecord) {
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
    let service = Arc::new(PlanService::new(PlanStore::new(db.clone())));
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
    (service, created.plan)
}

fn pending_permission_summary(
    options: Vec<PermissionInteractionOption>,
) -> PendingInteractionSummary {
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
            options,
            context: None,
        },
    }
}

/// Builds the live harness around an already-seeded plan service: a
/// `LiveSessionHandle` with a pending permission ("request-1" sourced from
/// "tool-1"), the matching parked permission in the rendezvous, and a sink
/// resumed from the seeded event seq — mirroring how the actor hosts a
/// `PlanDecisionOp` in production.
async fn live_plan_context(
    db: Db,
    pending_options: Vec<PermissionInteractionOption>,
    rendezvous_options: Vec<acp::schema::PermissionOption>,
) -> (
    Arc<Mutex<SessionEventSink>>,
    Arc<InteractionRendezvous>,
    Arc<LiveSessionHandle>,
    PendingPermissionWait,
) {
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
        .add_pending_interaction(pending_permission_summary(pending_options))
        .await;
    let broker = Arc::new(InteractionRendezvous::new());
    let wait = broker
        .register_permission("session-1", "request-1", &rendezvous_options)
        .await;
    let event_sink = Arc::new(Mutex::new(SessionEventSink::resume_from_seq(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace-1"),
        last_event_seq,
        event_tx,
        Arc::new(session_store),
    )));
    (event_sink, broker, handle, wait)
}

async fn run_plan_decision_op(
    plan_service: &Arc<PlanService>,
    plan: &PlanRecord,
    decision: ProposedPlanDecisionState,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    broker: &Arc<InteractionRendezvous>,
    handle: &Arc<LiveSessionHandle>,
) -> PlanDecisionOpOutput {
    let pending_permissions = PendingPermissionCandidate::from_pending_interactions(
        &handle.execution_snapshot().await.pending_interactions,
    );
    let op = Box::new(PlanDecisionOp {
        plan_service: plan_service.clone(),
        plan_id: plan.id.clone(),
        expected_version: plan.decision_version,
        decision,
        pending_permissions,
    });
    let reply = run_domain_op(
        handle,
        event_sink,
        broker,
        "session-1",
        "workspace-1",
        "claude",
        op,
    )
    .await;
    *reply
        .downcast::<PlanDecisionOpOutput>()
        .expect("plan decision op output")
}

/// Approving a plan whose native permission lacks an "approve" mapping must
/// mark the decision Approved, fail the native resolution, cancel the parked
/// native permission, and clear the pending interaction. (Moved from the
/// deleted `plan_decisions.rs`, rebuilt on `run_domain_op`.)
#[tokio::test]
async fn approved_native_plan_failure_cancels_pending_permission() {
    let db = Db::open_in_memory().expect("open db");
    let (service, plan) = seed_plan_service(&db);
    service
        .register_interaction_link(
            &plan,
            "request-1",
            "tool-1",
            serde_json::json!({ "reject": "reject-once" }),
        )
        .expect("register link");

    let reject_option = PermissionInteractionOption {
        option_id: "reject-once".to_string(),
        label: "Reject".to_string(),
        kind: PermissionInteractionOptionKind::RejectOnce,
    };
    let (event_sink, broker, handle, wait) = live_plan_context(
        db,
        vec![reject_option],
        vec![acp::schema::PermissionOption::new(
            acp::schema::PermissionOptionId::new("reject-once"),
            "Reject",
            acp::schema::PermissionOptionKind::RejectOnce,
        )],
    )
    .await;

    let output = run_plan_decision_op(
        &service,
        &plan,
        ProposedPlanDecisionState::Approved,
        &event_sink,
        &broker,
        &handle,
    )
    .await;

    let updated = output.result.expect("apply plan decision");
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

/// An approved plan with no interaction link yet must link itself to the
/// pending native permission that shares its source tool call, then resolve
/// that permission with the mapped approve option. (Moved from the deleted
/// `plan_links.rs`, rebuilt on the op's snapshotted relink candidates.)
#[tokio::test]
async fn links_plan_to_existing_pending_permission_by_tool_call_id() {
    let db = Db::open_in_memory().expect("open db");
    let (service, plan) = seed_plan_service(&db);
    // No pre-registered interaction link: the op must create it from the
    // pending permission candidate matched by tool_call_id.

    let allow_option = PermissionInteractionOption {
        option_id: "allow".to_string(),
        label: "Yes, continue".to_string(),
        kind: PermissionInteractionOptionKind::AllowOnce,
    };
    let (event_sink, broker, handle, wait) = live_plan_context(
        db,
        vec![allow_option],
        vec![acp::schema::PermissionOption::new(
            acp::schema::PermissionOptionId::new("allow"),
            "Yes, continue",
            acp::schema::PermissionOptionKind::AllowOnce,
        )],
    )
    .await;

    let output = run_plan_decision_op(
        &service,
        &plan,
        ProposedPlanDecisionState::Approved,
        &event_sink,
        &broker,
        &handle,
    )
    .await;

    assert_eq!(output.linked_request_id.as_deref(), Some("request-1"));
    let link = service
        .store()
        .find_link_by_plan(&plan.id)
        .expect("find link")
        .expect("link");
    assert_eq!(link.request_id, "request-1");
    assert_eq!(link.tool_call_id, "tool-1");

    let updated = output.result.expect("apply plan decision");
    assert_eq!(updated.decision_state, ProposedPlanDecisionState::Approved);
    assert_eq!(
        updated.native_resolution_state,
        ProposedPlanNativeResolutionState::Finalized,
    );
    assert_eq!(
        timeout(Duration::from_secs(1), wait.wait())
            .await
            .expect("permission wait should resolve"),
        PermissionOutcome::Selected {
            option_id: "allow".to_string(),
        },
    );

    // Mirroring the runtime: the linked request was resolved and removed, so
    // the snapshot relink is a safe no-op and no interaction stays pending.
    handle
        .link_pending_interaction_to_plan("request-1", &plan.id)
        .await;
    assert!(handle
        .execution_snapshot()
        .await
        .pending_interactions
        .is_empty());
}
