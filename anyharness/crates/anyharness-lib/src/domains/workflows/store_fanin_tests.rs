//! Store-side proofs for the fan-in ledger (`workflow_run_node_sessions`,
//! ruling F1) over the real migration ladder: the launch stamp inserts the
//! representative leg, a turn resolution marks it terminal in the same commit,
//! and a relaunch resets the row instead of colliding on the UNIQUE key. With
//! one leg per node (every definition today) these are the durable twin of the
//! scalar `session_id` the pre-ledger engine kept.

use crate::persistence::Db;

use super::definition::{
    DefinitionNode, InvocationPlacement, InvocationSnapshot, PlacementMode, WorkflowDefinition,
    DEFINITION_SCHEMA_VERSION,
};
use super::model::{WorkflowLegStatus, WorkflowNodeType, WorkflowRunStatus};
use super::store::{NewRunParams, WorkflowStore};
use super::transition::{next, Decision, RunState, TurnFinished, TurnStopReason, WorkflowEvent};

fn test_store() -> WorkflowStore {
    let db = Db::open_in_memory().expect("in-memory db with full migrations");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO repo_roots (
                id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                remote_repo_name, remote_url, created_at, updated_at
             ) VALUES (
                'repo-root-1', 'external', '/tmp/repo-root-1', NULL, 'main', NULL, NULL,
                NULL, NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'
             )",
            [],
        )?;
        conn.execute(
            "INSERT INTO workspaces (
                id, kind, repo_root_id, path, surface, lifecycle_state, created_at, updated_at
             ) VALUES (
                'workspace-1', 'worktree', 'repo-root-1', '/tmp/workspace-1',
                'standard', 'active', ?1, ?1
             )",
            ["2026-08-14T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed repo root and workspace");
    WorkflowStore::new(db)
}

/// A minimal single-Agent-node definition: enough to launch and complete one
/// node, so the whole ledger lifecycle is exercised without a chain.
fn params(run_id: &str) -> NewRunParams {
    let definition = WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![DefinitionNode {
            id: "only".into(),
            node_type: WorkflowNodeType::Agent,
            title: "Only".into(),
            prompt: "do the thing".into(),
            model: None,
        }],
        edges: vec![],
        inputs: vec![],
        doc_templates: vec![],
    };
    let snapshot = InvocationSnapshot {
        schema_version: DEFINITION_SCHEMA_VERSION,
        workflow_definition_id: "wd-1".into(),
        definition,
        arguments: serde_json::Map::new(),
        placement: InvocationPlacement {
            repo_config_id: "rc-1".into(),
            mode: PlacementMode::Worktree,
            workspace_id: None,
        },
    };
    let definition_json = serde_json::to_string(&snapshot.definition).expect("serialize");
    NewRunParams {
        run_id: run_id.into(),
        invocation_id: format!("inv-{run_id}"),
        workspace_id: "workspace-1".into(),
        snapshot,
        definition_json,
    }
}

fn apply(store: &WorkflowStore, run_id: &str, state: &RunState, event: &WorkflowEvent) -> RunState {
    let transition = match next(state, event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition, got {other:?}"),
    };
    store
        .apply_transition(run_id, &transition, event)
        .expect("apply transition")
        .state
}

#[test]
fn stamp_session_inserts_the_representative_leg() {
    let store = test_store();
    let created = store.create_run_with_first_node(params("run-1")).expect("create");
    let node_id = created.first_node_row_id.clone();
    // No ledger row until the node launches and stamps its session.
    assert!(created.state.node_legs.is_empty());

    store
        .stamp_session(&node_id, "sess-1", Some("prompt-1"), Some("claude"))
        .expect("stamp");
    let state = store.load_run_state("run-1").expect("load").expect("run");
    let legs = state.legs_of(&node_id);
    assert_eq!(legs.len(), 1);
    assert_eq!(legs[0].leg_index, 0);
    assert_eq!(legs[0].session_id.as_deref(), Some("sess-1"));
    assert_eq!(legs[0].status, WorkflowLegStatus::Running);
    assert!(legs[0].completed_at.is_none());
}

#[test]
fn clean_turn_marks_the_leg_done_in_the_completing_commit() {
    let store = test_store();
    let created = store.create_run_with_first_node(params("run-1")).expect("create");
    let node_id = created.first_node_row_id.clone();
    store
        .stamp_session(&node_id, "sess-1", Some("prompt-1"), None)
        .expect("stamp");
    let state = store.load_run_state("run-1").expect("load").expect("run");

    let event = WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: node_id.clone(),
        session_id: Some("sess-1".into()),
        stop_reason: TurnStopReason::CleanEndTurn,
        queue_empty: true,
    });
    let after = apply(&store, "run-1", &state, &event);
    // The single node was last on the chain: the run completes.
    assert_eq!(after.run.status, WorkflowRunStatus::Completed);
    let legs = after.legs_of(&node_id);
    assert_eq!(legs.len(), 1);
    assert_eq!(legs[0].status, WorkflowLegStatus::Done);
    assert!(legs[0].completed_at.is_some());
}

#[test]
fn relaunch_resets_the_leg_instead_of_colliding() {
    let store = test_store();
    let created = store.create_run_with_first_node(params("run-1")).expect("create");
    let node_id = created.first_node_row_id.clone();

    store
        .stamp_session(&node_id, "sess-1", None, None)
        .expect("stamp one");
    // A resume/redo relaunches the same node row with a fresh session; the
    // upsert resets the leg rather than tripping UNIQUE(node_row_id, leg_index).
    store
        .stamp_session(&node_id, "sess-2", None, None)
        .expect("stamp two");
    let state = store.load_run_state("run-1").expect("load").expect("run");
    let legs = state.legs_of(&node_id);
    assert_eq!(legs.len(), 1);
    assert_eq!(legs[0].session_id.as_deref(), Some("sess-2"));
    assert_eq!(legs[0].status, WorkflowLegStatus::Running);
}
