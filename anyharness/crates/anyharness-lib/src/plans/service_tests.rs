use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};

use super::model::{NewPlan, PlanCreateOutcome};
use super::service::{PlanCreateError, PlanDecisionError, PlanEventContext, PlanService};
use super::store::PlanStore;
use crate::persistence::Db;

fn test_service() -> PlanService {
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
