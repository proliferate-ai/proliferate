//! Store-side proofs for the fan-in ledger (`workflow_run_node_sessions`,
//! ruling F1) over the real migration ladder: the launch stamp inserts the
//! representative leg, a turn resolution marks it terminal in the same commit,
//! and a relaunch resets the row instead of colliding on the UNIQUE key. With
//! one leg per node (every definition today) these are the durable twin of the
//! scalar `session_id` the pre-ledger engine kept.

use crate::persistence::Db;

use super::definition::{
    DefinitionLeg, DefinitionNode, InvocationPlacement, InvocationSnapshot, PlacementMode,
    WorkflowDefinition, DEFINITION_SCHEMA_VERSION,
};
use super::model::{
    WorkflowLegStatus, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunStatus,
};
use super::store::{
    node_leg_count, start_side_effect, NewRunParams, ResolvedSideEffect, WorkflowStore,
};
use super::transition::{
    next, Decision, RunState, TurnFinished, TurnStopReason, WorkflowCommand, WorkflowEvent,
};

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
            legs: None,
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

#[test]
fn cancel_marks_the_leg_cancelled_in_the_same_commit() {
    let store = test_store();
    let created = store.create_run_with_first_node(params("run-1")).expect("create");
    let node_id = created.first_node_row_id.clone();
    store.stamp_session(&node_id, "sess-1", None, None).expect("stamp");
    let state = store.load_run_state("run-1").expect("load").expect("run");

    let cancelled = apply(
        &store,
        "run-1",
        &state,
        &WorkflowEvent::Command(WorkflowCommand::Cancel),
    );

    // Review finding on this rung: without a Cancel arm in finished_leg_of the
    // row stayed 'running' forever on a terminal run.
    let legs = cancelled.legs_of(&node_id);
    assert_eq!(legs.len(), 1);
    assert_eq!(legs[0].status, WorkflowLegStatus::Cancelled);
    assert!(legs[0].completed_at.is_some());
}

#[test]
fn cancel_marks_every_running_leg_in_the_run_cancelled() {
    let store = test_store();
    let created = store.create_run_with_first_node(params("run-1")).expect("create");
    let chain_id = created.first_node_row_id.clone();
    store.stamp_session(&chain_id, "sess-chain", None, None).expect("stamp chain");
    let state = store.load_run_state("run-1").expect("load").expect("run");

    let with_adhoc = apply(
        &store,
        "run-1",
        &state,
        &WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
            anchor_node_row_id: chain_id.clone(),
            prompt: "also check the error budget".into(),
            model: None,
        }),
    );
    let adhoc_id = with_adhoc
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .find(|id| *id != chain_id)
        .expect("adhoc row minted");
    store.stamp_session(&adhoc_id, "sess-adhoc", None, None).expect("stamp adhoc");
    let state = store.load_run_state("run-1").expect("load").expect("run");

    let cancelled = apply(
        &store,
        "run-1",
        &state,
        &WorkflowEvent::Command(WorkflowCommand::Cancel),
    );

    // Delta-review finding: stamping only the current chain node left a
    // disposed adhoc session's leg 'running' forever. Cancel is run-terminal,
    // so every still-running leg — chain or adhoc — lands cancelled.
    for node_id in [&chain_id, &adhoc_id] {
        let legs = cancelled.legs_of(node_id);
        assert_eq!(legs.len(), 1, "node {node_id}");
        assert_eq!(legs[0].status, WorkflowLegStatus::Cancelled, "node {node_id}");
        assert!(legs[0].completed_at.is_some(), "node {node_id}");
    }
}
// --- Ruling F5/F6: fan-out at the store seam ---

/// A single Agent node fanned out to `n` distinguishable leg prompts. Leg 0's
/// prompt mirrors the node prompt (the representative invariant).
fn parallel_params(run_id: &str, n: usize) -> NewRunParams {
    let prompts: Vec<String> = (0..n).map(|i| format!("leg {i} work")).collect();
    let definition = WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![DefinitionNode {
            id: "panel".into(),
            node_type: WorkflowNodeType::Agent,
            title: "Panel".into(),
            prompt: prompts[0].clone(),
            model: None,
            legs: Some(
                prompts
                    .iter()
                    .map(|p| DefinitionLeg { prompt: p.clone() })
                    .collect(),
            ),
        }],
        edges: vec![],
        inputs: vec![],
        doc_templates: vec![],
    };
    let snapshot = InvocationSnapshot {
        schema_version: DEFINITION_SCHEMA_VERSION,
        workflow_definition_id: "wd-p".into(),
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

#[test]
fn a_multi_leg_node_resolves_to_the_fan_out_start_effect() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(parallel_params("run-p", 3))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    let state = &created.state;
    assert_eq!(node_leg_count(state, &node_id), 3);
    assert_eq!(
        start_side_effect(state, &node_id),
        ResolvedSideEffect::StartNodeLegs {
            node_row_id: node_id.clone()
        }
    );
}

#[test]
fn a_one_leg_node_keeps_the_singular_start_effect() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(params("run-1"))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    assert_eq!(node_leg_count(&created.state, &node_id), 1);
    assert_eq!(
        start_side_effect(&created.state, &node_id),
        ResolvedSideEffect::StartNode {
            node_row_id: node_id
        }
    );
}

#[test]
fn stamp_fanout_writes_one_ledger_row_per_leg() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(parallel_params("run-p", 3))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    let legs = vec![
        (0i64, "sess-0".to_string()),
        (1, "sess-1".to_string()),
        (2, "sess-2".to_string()),
    ];
    store
        .stamp_fanout(&node_id, Some("wf2-panel"), Some("claude"), &legs)
        .expect("stamp fanout");
    let state = store.load_run_state("run-p").expect("load").expect("run");
    let mut rows = state.legs_of(&node_id);
    rows.sort_by_key(|leg| leg.leg_index);
    assert_eq!(rows.len(), 3);
    for (index, leg) in rows.iter().enumerate() {
        assert_eq!(leg.leg_index, index as i64);
        assert_eq!(leg.session_id.as_deref(), Some(format!("sess-{index}").as_str()));
        assert_eq!(leg.status, WorkflowLegStatus::Running);
    }
    // Leg 0 is the representative stamped onto the node's scalar column.
    assert_eq!(
        state.node(&node_id).unwrap().session_id.as_deref(),
        Some("sess-0")
    );
}

#[test]
fn resume_truncates_the_ledger_and_re_fans_out() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(parallel_params("run-p", 3))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    let legs = vec![
        (0i64, "sess-0".to_string()),
        (1, "sess-1".to_string()),
        (2, "sess-2".to_string()),
    ];
    store
        .stamp_fanout(&node_id, Some("wf2-panel"), Some("claude"), &legs)
        .expect("stamp fanout");

    // Park the run (boot fence) then resume it.
    let state = store.load_run_state("run-p").expect("load").expect("run");
    let fenced = apply(
        &store,
        "run-p",
        &state,
        &WorkflowEvent::BootFence {
            code: super::model::WorkflowInterruptionCode::RuntimeRestarted,
        },
    );
    let resume_event = WorkflowEvent::Command(WorkflowCommand::Resume);
    let transition = match next(&fenced, &resume_event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected resume transition, got {other:?}"),
    };
    let applied = store
        .apply_transition("run-p", &transition, &resume_event)
        .expect("apply resume");
    // Ruling F6: the ledger is truncated (a fresh generation) and the fan-out
    // start effect is emitted; the actor re-inserts leg 0..N on relaunch.
    assert!(applied.state.legs_of(&node_id).is_empty());
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::StartNodeLegs {
            node_row_id: node_id
        }
    );
}

#[test]
fn a_failed_fan_out_launch_terminalizes_every_leg_it_stamped() {
    let store = test_store();
    let created = store
        .create_run_with_first_node(parallel_params("run-p", 3))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    let legs = vec![
        (0i64, "sess-0".to_string()),
        (1, "sess-1".to_string()),
        (2, "sess-2".to_string()),
    ];
    store
        .stamp_fanout(&node_id, Some("wf2-panel"), Some("claude"), &legs)
        .expect("stamp fanout");
    let state = store.load_run_state("run-p").expect("load").expect("run");

    let failed = apply(
        &store,
        "run-p",
        &state,
        &WorkflowEvent::NodeLaunchFailed {
            node_row_id: node_id.clone(),
            leg_index: None,
        },
    );

    // Rung-5 review finding: the representative fallback stamped only leg 0,
    // stranding legs 1..N at 'running' against compensated sessions. The
    // launch-failure stamp covers every row the fan-out inserted.
    let mut rows = failed.legs_of(&node_id);
    rows.sort_by_key(|leg| leg.leg_index);
    assert_eq!(rows.len(), 3);
    for leg in rows {
        assert_eq!(
            leg.status,
            WorkflowLegStatus::Failed(super::model::WorkflowNodeFailureCode::NodeLaunchFailed),
            "leg {}",
            leg.leg_index
        );
        assert!(leg.completed_at.is_some(), "leg {}", leg.leg_index);
    }
}

/// Drive a 3-leg node to a Failed rest state (two legs done, one failed),
/// returning the store and the node row id at rest.
fn failed_three_leg_run(run_id: &str) -> (WorkflowStore, String) {
    let store = test_store();
    let created = store
        .create_run_with_first_node(parallel_params(run_id, 3))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    let legs = vec![
        (0i64, "sess-0".to_string()),
        (1, "sess-1".to_string()),
        (2, "sess-2".to_string()),
    ];
    store
        .stamp_fanout(&node_id, Some("wf2-panel"), Some("claude"), &legs)
        .expect("stamp fanout");

    let finish = |session: &str, reason: TurnStopReason| WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: node_id.clone(),
        session_id: Some(session.into()),
        stop_reason: reason,
        queue_empty: true,
    });
    let mut state = store.load_run_state(run_id).expect("load").expect("run");
    state = apply(&store, run_id, &state, &finish("sess-0", TurnStopReason::CleanEndTurn));
    state = apply(&store, run_id, &state, &finish("sess-1", TurnStopReason::CleanEndTurn));
    let state = apply(&store, run_id, &state, &finish("sess-2", TurnStopReason::Error));
    assert_eq!(state.run.status, WorkflowRunStatus::Failed);
    (store, node_id)
}

#[test]
fn per_leg_redo_resets_exactly_one_ledger_row_and_leaves_siblings() {
    let (store, node_id) = failed_three_leg_run("run-redo-leg");
    let state = store.load_run_state("run-redo-leg").expect("load").expect("run");

    let event = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: node_id.clone(),
        prompt: None,
        leg_index: Some(2),
    });
    let transition = match next(&state, &event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition, got {other:?}"),
    };
    let applied = store
        .apply_transition("run-redo-leg", &transition, &event)
        .expect("apply redo leg");

    // Leg 2 (the failed one) had no live session, so the effect just relaunches.
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::StartLeg {
            node_row_id: node_id.clone(),
            leg_index: 2,
        }
    );

    let mut rows = applied.state.legs_of(&node_id);
    rows.sort_by_key(|leg| leg.leg_index);
    assert_eq!(rows.len(), 3);
    // Siblings untouched: legs 0 and 1 stay Done with their completion times.
    assert_eq!(rows[0].status, WorkflowLegStatus::Done);
    assert!(rows[0].completed_at.is_some());
    assert_eq!(rows[1].status, WorkflowLegStatus::Done);
    assert!(rows[1].completed_at.is_some());
    // The redone leg alone resets to running.
    assert_eq!(rows[2].status, WorkflowLegStatus::Running);
    assert!(rows[2].completed_at.is_none());

    // The node revives and the run un-fails, waiting on the redone leg.
    assert_eq!(
        applied.state.node(&node_id).unwrap().status,
        WorkflowNodeStatus::Running
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Running);
}

#[test]
fn a_redone_leg_makes_the_node_wait_then_completes_when_it_finishes() {
    let (store, node_id) = failed_three_leg_run("run-redo-wait");
    let state = store.load_run_state("run-redo-wait").expect("load").expect("run");

    // Redo leg 2 in place.
    let event = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: node_id.clone(),
        prompt: None,
        leg_index: Some(2),
    });
    let redone = apply(&store, "run-redo-wait", &state, &event);
    // The node is running again, NOT complete — it waits for the redone leg.
    assert_eq!(redone.run.status, WorkflowRunStatus::Running);

    // The actor relaunches leg 2 with a fresh session.
    store
        .stamp_leg_relaunch(&node_id, 2, "sess-2b", Some("wf2-panel-l2"), Some("claude"))
        .expect("relaunch leg");
    let relaunched = store.load_run_state("run-redo-wait").expect("load").expect("run");

    // The redone leg finishing clean is the last outstanding one: the node
    // aggregates (all legs done) and the single-node run completes.
    let finish = WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: node_id.clone(),
        session_id: Some("sess-2b".into()),
        stop_reason: TurnStopReason::CleanEndTurn,
        queue_empty: true,
    });
    let completed = apply(&store, "run-redo-wait", &relaunched, &finish);
    assert_eq!(completed.run.status, WorkflowRunStatus::Completed);
}

#[test]
fn a_whole_node_redo_of_a_running_parallel_node_disposes_every_live_leg() {
    // Ruling F2's bulk case: the redo replaces the WHOLE node, so every live
    // leg session dies with it — representative-only disposal would leave the
    // N-1 sibling agents running against a replaced node.
    let store = test_store();
    let created = store
        .create_run_with_first_node(parallel_params("run-redo-all", 3))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    let legs = vec![
        (0i64, "sess-0".to_string()),
        (1, "sess-1".to_string()),
        (2, "sess-2".to_string()),
    ];
    store
        .stamp_fanout(&node_id, Some("wf2-panel"), Some("claude"), &legs)
        .expect("stamp fanout");
    let state = store.load_run_state("run-redo-all").expect("load").expect("run");

    // No leg index: Ruling L's redo-from-running, taken whole-node.
    let event = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: node_id.clone(),
        prompt: None,
        leg_index: None,
    });
    let transition = match next(&state, &event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition, got {other:?}"),
    };
    let applied = store
        .apply_transition("run-redo-all", &transition, &event)
        .expect("apply whole-node redo");

    let replacement_id = applied
        .created_node_row_id
        .clone()
        .expect("a whole-node redo mints a replacement row");
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::DisposeSessionsThenStartLegs {
            session_ids: vec!["sess-0".into(), "sess-1".into(), "sess-2".into()],
            node_row_id: replacement_id,
        }
    );
}

#[test]
fn a_failed_per_leg_relaunch_terminalizes_only_the_addressed_leg() {
    // Delta-review finding on this rung: a StartLeg relaunch that fails to
    // start must NOT take the whole-cohort keyless stamp — Done siblings keep
    // their receipts.
    let (store, node_id) = failed_three_leg_run("run-leg-launch-fail");
    let state = store.load_run_state("run-leg-launch-fail").expect("load").expect("run");
    let redo = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: node_id.clone(),
        prompt: None,
        leg_index: Some(2),
    });
    let redone = apply(&store, "run-leg-launch-fail", &state, &redo);

    let event = WorkflowEvent::NodeLaunchFailed {
        node_row_id: node_id.clone(),
        leg_index: Some(2),
    };
    let transition = match next(&redone, &event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition, got {other:?}"),
    };
    let applied = store
        .apply_transition("run-leg-launch-fail", &transition, &event)
        .expect("apply leg launch failure");

    // No sibling was running, so nothing needs disposing.
    assert_eq!(applied.side_effect, ResolvedSideEffect::None);
    let mut rows = applied.state.legs_of(&node_id);
    rows.sort_by_key(|leg| leg.leg_index);
    // Done siblings keep their receipts — status AND completion time.
    assert_eq!(rows[0].status, WorkflowLegStatus::Done);
    assert!(rows[0].completed_at.is_some());
    assert_eq!(rows[1].status, WorkflowLegStatus::Done);
    assert!(rows[1].completed_at.is_some());
    // Only the addressed leg takes the launch failure.
    assert_eq!(
        rows[2].status,
        WorkflowLegStatus::Failed(super::model::WorkflowNodeFailureCode::NodeLaunchFailed)
    );
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Failed);
}

#[test]
fn a_failed_per_leg_relaunch_cancels_and_disposes_running_siblings() {
    // The running-sibling half of the same finding: the node fails (F1), but
    // live sibling agents are disposed and their rows stamped cancelled —
    // never keyless-stamped 'failed', never left running under a failed run.
    let store = test_store();
    let created = store
        .create_run_with_first_node(parallel_params("run-leg-fail-live", 3))
        .expect("create");
    let node_id = created.first_node_row_id.clone();
    let legs = vec![
        (0i64, "sess-0".to_string()),
        (1, "sess-1".to_string()),
        (2, "sess-2".to_string()),
    ];
    store
        .stamp_fanout(&node_id, Some("wf2-panel"), Some("claude"), &legs)
        .expect("stamp fanout");
    let state = store.load_run_state("run-leg-fail-live").expect("load").expect("run");

    // Per-leg redo of running leg 1 (its own session disposed by that redo).
    let redo = WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: node_id.clone(),
        prompt: None,
        leg_index: Some(1),
    });
    let redone = apply(&store, "run-leg-fail-live", &state, &redo);

    let event = WorkflowEvent::NodeLaunchFailed {
        node_row_id: node_id.clone(),
        leg_index: Some(1),
    };
    let transition = match next(&redone, &event) {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition, got {other:?}"),
    };
    let applied = store
        .apply_transition("run-leg-fail-live", &transition, &event)
        .expect("apply leg launch failure");

    // Both live siblings are disposed; the addressed leg's session was already
    // disposed by the redo itself and must not be double-disposed here.
    assert_eq!(
        applied.side_effect,
        ResolvedSideEffect::DisposeSessions {
            session_ids: vec!["sess-0".into(), "sess-2".into()],
        }
    );
    let mut rows = applied.state.legs_of(&node_id);
    rows.sort_by_key(|leg| leg.leg_index);
    assert_eq!(rows[0].status, WorkflowLegStatus::Cancelled);
    assert_eq!(
        rows[1].status,
        WorkflowLegStatus::Failed(super::model::WorkflowNodeFailureCode::NodeLaunchFailed)
    );
    assert_eq!(rows[2].status, WorkflowLegStatus::Cancelled);
    assert_eq!(applied.state.run.status, WorkflowRunStatus::Failed);
}
