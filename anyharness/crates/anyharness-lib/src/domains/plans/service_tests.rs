use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};
use serde_json::json;

use super::model::{NewPlan, PlanCreateOutcome};
use super::service::{PlanCreateError, PlanDecisionError, PlanEventContext, PlanService};
use super::store::PlanStore;
use crate::app::test_support;
use crate::persistence::Db;

fn test_service() -> PlanService {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at
             ) VALUES ('session-1', 'workspace-1', 'codex', 'idle', 'now', 'now')",
            [],
        )?;
        Ok(())
    })
    .expect("seed db");
    PlanService::new(PlanStore::new(db))
}

fn context(turn_id: &str, next_seq: i64) -> PlanEventContext {
    PlanEventContext {
        session_id: "session-1".to_string(),
        source_agent_kind: "codex".to_string(),
        turn_id: Some(turn_id.to_string()),
        next_seq,
    }
}

fn plan(source_item_id: &str, body: &str) -> NewPlan {
    NewPlan {
        workspace_id: "workspace-1".to_string(),
        session_id: "session-1".to_string(),
        title: "Plan".to_string(),
        body_markdown: body.to_string(),
        source_agent_kind: "codex".to_string(),
        source_kind: "codex_turn_plan".to_string(),
        source_turn_id: None,
        source_item_id: Some(source_item_id.to_string()),
        source_tool_call_id: None,
    }
}

fn native_plan(source_item_id: &str, body: &str) -> NewPlan {
    NewPlan {
        source_agent_kind: "claude".to_string(),
        source_kind: "claude_exit_plan_mode".to_string(),
        source_tool_call_id: Some(source_item_id.to_string()),
        ..plan(source_item_id, body)
    }
}

#[test]
fn create_completed_plan_is_idempotent_for_same_source_and_body() {
    let service = test_service();
    let first = service
        .create_completed_plan(plan("item-1", "# Plan\n\nDo it."), context("turn-1", 1))
        .expect("create first plan");
    assert_eq!(first.outcome, PlanCreateOutcome::Created);

    let second = service
        .create_completed_plan(plan("item-1", "# Plan\n\nDo it."), context("turn-1", 3))
        .expect("reuse first plan");
    assert_eq!(second.outcome, PlanCreateOutcome::Existing);
    assert_eq!(second.plan.id, first.plan.id);
    assert!(second.envelopes.is_empty());
}

#[test]
fn create_completed_plan_rejects_changed_body_for_same_source() {
    let service = test_service();
    service
        .create_completed_plan(plan("item-1", "# Plan\n\nDo it."), context("turn-1", 1))
        .expect("create first plan");

    let error = service
        .create_completed_plan(
            plan("item-1", "# Plan\n\nDo something else."),
            context("turn-1", 3),
        )
        .expect_err("changed body should conflict");
    assert!(matches!(error, PlanCreateError::SourceConflict));
}

#[test]
fn creating_new_lineage_plan_supersedes_prior_pending_plan() {
    let service = test_service();
    let first = service
        .create_completed_plan(plan("item-1", "# Plan\n\nFirst."), context("turn-1", 1))
        .expect("create first plan")
        .plan;
    let second = service
        .create_completed_plan(plan("item-2", "# Plan\n\nSecond."), context("turn-2", 3))
        .expect("create second plan")
        .plan;

    let updated_first = service
        .get(&first.id)
        .expect("load first plan")
        .expect("first plan exists");
    assert_eq!(
        updated_first.decision_state,
        ProposedPlanDecisionState::Superseded
    );
    assert_eq!(
        updated_first.native_resolution_state,
        ProposedPlanNativeResolutionState::Finalized,
    );
    assert_eq!(updated_first.decision_version, 2);
    assert_eq!(
        updated_first.superseded_by_plan_id.as_deref(),
        Some(second.id.as_str())
    );
}

#[test]
fn update_decision_offline_enforces_expected_version_and_terminal_state() {
    let service = test_service();
    let created = service
        .create_completed_plan(plan("item-1", "# Plan\n\nDo it."), context("turn-1", 1))
        .expect("create plan")
        .plan;

    let stale = service
        .update_decision_offline(&created.id, 99, ProposedPlanDecisionState::Approved)
        .expect_err("wrong version should fail");
    assert!(matches!(stale, PlanDecisionError::StaleVersion));

    let (approved, events) = service
        .update_decision_offline(&created.id, 1, ProposedPlanDecisionState::Approved)
        .expect("approve plan");
    assert_eq!(approved.decision_state, ProposedPlanDecisionState::Approved);
    assert_eq!(approved.decision_version, 2);
    assert_eq!(events.len(), 1);

    let terminal = service
        .update_decision_offline(&created.id, 2, ProposedPlanDecisionState::Rejected)
        .expect_err("terminal plan should not update again");
    assert!(matches!(terminal, PlanDecisionError::TerminalState));
}

#[test]
fn approve_linked_native_plan_marks_pending_resolution_for_live_sessions() {
    let service = test_service();
    let created = service
        .create_completed_plan(
            native_plan("tool-1", "# Plan\n\nDo it."),
            context("turn-1", 1),
        )
        .expect("create native plan")
        .plan;
    service
        .register_interaction_link(
            &created,
            "request-1",
            "tool-1",
            json!({
                "approve": "allow-once",
                "reject": "reject-once",
            }),
        )
        .expect("register interaction link");

    let (approved, _events) = service
        .update_decision_with_context(
            &created.id,
            1,
            ProposedPlanDecisionState::Approved,
            context("turn-1", 3),
        )
        .expect("approve plan");

    assert_eq!(approved.decision_state, ProposedPlanDecisionState::Approved);
    assert_eq!(
        approved.native_resolution_state,
        ProposedPlanNativeResolutionState::PendingResolution,
    );
}

#[test]
fn approve_native_plan_can_retry_pending_link_after_product_approval() {
    let service = test_service();
    let created = service
        .create_completed_plan(
            native_plan("tool-1", "# Plan\n\nDo it."),
            context("turn-1", 1),
        )
        .expect("create native plan")
        .plan;

    let (approved, _events) = service
        .update_decision_with_context(
            &created.id,
            1,
            ProposedPlanDecisionState::Approved,
            context("turn-1", 3),
        )
        .expect("approve plan");

    assert_eq!(approved.decision_state, ProposedPlanDecisionState::Approved);
    assert_eq!(
        approved.native_resolution_state,
        ProposedPlanNativeResolutionState::PendingLink,
    );

    let (retry, retry_events) = service
        .update_decision_with_context(
            &created.id,
            approved.decision_version,
            ProposedPlanDecisionState::Approved,
            context("turn-1", 4),
        )
        .expect("retry approve");

    assert_eq!(retry.id, approved.id);
    assert_eq!(retry.decision_version, approved.decision_version);
    assert!(retry_events.is_empty());
}

#[test]
fn approve_linked_native_plan_marks_failed_without_live_session_resolution() {
    let service = test_service();
    let created = service
        .create_completed_plan(
            native_plan("tool-1", "# Plan\n\nDo it."),
            context("turn-1", 1),
        )
        .expect("create native plan")
        .plan;
    service
        .register_interaction_link(
            &created,
            "request-1",
            "tool-1",
            json!({
                "approve": "allow-once",
                "reject": "reject-once",
            }),
        )
        .expect("register interaction link");

    let (approved, _events) = service
        .update_decision_offline(&created.id, 1, ProposedPlanDecisionState::Approved)
        .expect("approve plan");

    assert_eq!(approved.decision_state, ProposedPlanDecisionState::Approved);
    assert_eq!(
        approved.native_resolution_state,
        ProposedPlanNativeResolutionState::Failed,
    );
}
