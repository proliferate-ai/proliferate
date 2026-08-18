//! Pure transition-table tests for the fan-in aggregation (ruling F1). The
//! definition grammar cannot yet express N > 1 legs, so these build the multi-
//! leg `RunState` directly (the ledger slice `node_legs`). One-leg regression
//! coverage lives in `transition_tests.rs`; here every state carries a node
//! with two legs so the outstanding-leg gate and the aggregation are exercised.

use super::model::{
    WorkflowInterruptionCode, WorkflowLegStatus, WorkflowNodeFailureCode, WorkflowNodeKind,
    WorkflowNodeStatus, WorkflowNodeType, WorkflowRunNodeRecord, WorkflowRunNodeSessionRecord,
    WorkflowRunRecord, WorkflowRunStatus,
};
use super::transition::{
    next, Decision, RunState, Transition, TurnFinished, TurnStopReason, WorkflowCommand,
    WorkflowEvent,
};

const T0: &str = "2026-08-14T00:00:00+00:00";

fn run() -> WorkflowRunRecord {
    WorkflowRunRecord {
        id: "run-1".into(),
        invocation_id: "inv-1".into(),
        definition_json: "{}".into(),
        arguments_json: "{}".into(),
        workspace_id: "ws-1".into(),
        status: WorkflowRunStatus::Running,
        current_node_row_id: Some("n1".into()),
        failure_code: None,
        interruption_code: None,
        created_at: T0.into(),
        updated_at: T0.into(),
        completed_at: None,
    }
}

fn node(id: &str, chain_index: i64, status: WorkflowNodeStatus) -> WorkflowRunNodeRecord {
    WorkflowRunNodeRecord {
        id: id.into(),
        run_id: "run-1".into(),
        definition_node_id: Some(format!("def-{id}")),
        kind: WorkflowNodeKind::Defined,
        node_type: WorkflowNodeType::Agent,
        replaces_node_row_id: None,
        anchor_node_row_id: None,
        chain_index: Some(chain_index),
        title: format!("Node {id}"),
        prompt: format!("prompt {id}"),
        status,
        // The representative session is leg 0's; the ledger carries the set.
        session_id: (status == WorkflowNodeStatus::Running).then(|| "sess-a".to_string()),
        prompt_id: None,
        model: None,
        rendered_envelope: None,
        failure_code: None,
        first_turn_finished_at: None,
        created_at: T0.into(),
        started_at: (status == WorkflowNodeStatus::Running).then(|| T0.into()),
        completed_at: (status == WorkflowNodeStatus::Completed).then(|| T0.into()),
    }
}

fn leg(session: &str, leg_index: i64, status: WorkflowLegStatus) -> WorkflowRunNodeSessionRecord {
    WorkflowRunNodeSessionRecord {
        node_row_id: "n1".into(),
        leg_index,
        session_id: Some(session.into()),
        status,
        completed_at: status.is_terminal().then(|| T0.into()),
    }
}

/// A two-leg current node `n1` (running) followed by a pending `n2`, with the
/// given ledger slice for n1's legs.
fn state(legs: Vec<WorkflowRunNodeSessionRecord>) -> RunState {
    RunState {
        run: run(),
        nodes: vec![
            node("n1", 0, WorkflowNodeStatus::Running),
            node("n2", 1, WorkflowNodeStatus::Pending),
        ],
        node_legs: legs,
    }
}

fn finish(session: &str, stop_reason: TurnStopReason) -> WorkflowEvent {
    WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: "n1".into(),
        session_id: Some(session.into()),
        stop_reason,
        queue_empty: true,
    })
}

fn decide(legs: Vec<WorkflowRunNodeSessionRecord>, event: WorkflowEvent) -> Decision {
    next(&state(legs), &event)
}

#[test]
fn first_leg_clean_holds_without_advancing() {
    // Two legs both running; leg a finishes clean while b is outstanding.
    let decision = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Running),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
        finish("sess-a", TurnStopReason::CleanEndTurn),
    );
    assert_eq!(
        decision,
        Decision::Transition(Transition::RecordLegThenHold {
            node_row_id: "n1".into(),
            session_id: "sess-a".into(),
            leg_status: WorkflowLegStatus::Done,
        })
    );
    // Negative control: if the outstanding-leg gate were dropped, this same
    // event would advance the node instead of holding.
    assert!(!matches!(
        decision,
        Decision::Transition(Transition::AdvanceToNext { .. })
            | Decision::Transition(Transition::CompleteRun { .. })
    ));
}

#[test]
fn last_leg_clean_with_no_failures_advances() {
    // leg a already recorded done; b finishing clean is the last outstanding.
    let decision = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Done),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
        finish("sess-b", TurnStopReason::CleanEndTurn),
    );
    assert_eq!(
        decision,
        Decision::Transition(Transition::AdvanceToNext {
            completed_node_row_id: "n1".into(),
            next_node_row_id: "n2".into(),
            completed_node_type: None,
        })
    );
}

#[test]
fn a_recorded_failure_fails_the_node_only_once_all_legs_are_terminal() {
    // First: b fails while a still runs — the node holds, does not fail yet.
    let held = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Running),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
        finish("sess-b", TurnStopReason::Error),
    );
    assert_eq!(
        held,
        Decision::Transition(Transition::RecordLegThenHold {
            node_row_id: "n1".into(),
            session_id: "sess-b".into(),
            leg_status: WorkflowLegStatus::Failed(WorkflowNodeFailureCode::TurnError),
        })
    );
    // Then: with b's failure recorded, a finishing clean is the last leg — the
    // node fails (fail iff any leg failed), carrying the failed leg's code.
    let failed = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Running),
            leg("sess-b", 1, WorkflowLegStatus::Failed(WorkflowNodeFailureCode::TurnError)),
        ],
        finish("sess-a", TurnStopReason::CleanEndTurn),
    );
    assert_eq!(
        failed,
        Decision::Transition(Transition::FailNode {
            node_row_id: "n1".into(),
            code: WorkflowNodeFailureCode::TurnError,
        })
    );
}

#[test]
fn a_failing_last_leg_fails_the_node() {
    // a done, b finishes with a refusal as the last leg → fail with its code.
    let decision = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Done),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
        finish("sess-b", TurnStopReason::Refusal),
    );
    assert_eq!(
        decision,
        Decision::Transition(Transition::FailNode {
            node_row_id: "n1".into(),
            code: WorkflowNodeFailureCode::Refusal,
        })
    );
}

#[test]
fn a_cancelled_leg_interrupts_the_node_when_all_terminal() {
    // a done, b cancelled as the last leg → interrupt (user cancel wins over a
    // clean sibling), matching one-leg cancellation.
    let decision = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Done),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
        finish("sess-b", TurnStopReason::Cancelled),
    );
    assert_eq!(
        decision,
        Decision::Transition(Transition::InterruptNode {
            node_row_id: "n1".into(),
            code: WorkflowInterruptionCode::UserCancel,
        })
    );
}

#[test]
fn arrival_order_does_not_change_the_outcome() {
    // Whichever of the two clean legs arrives last triggers the single advance.
    let a_last = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Running),
            leg("sess-b", 1, WorkflowLegStatus::Done),
        ],
        finish("sess-a", TurnStopReason::CleanEndTurn),
    );
    let b_last = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Done),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
        finish("sess-b", TurnStopReason::CleanEndTurn),
    );
    assert_eq!(a_last, b_last);
    assert!(matches!(
        a_last,
        Decision::Transition(Transition::AdvanceToNext { .. })
    ));
}

// ---- Per-leg redo (rung 6, ruling F2 reversed) -------------------------------

/// A run parked at a failed parallel node `n1` (two legs), with the given
/// ledger slice; `n2` stays pending. The whole-node redo legality wall accepts
/// a failed node, so this is the canonical per-leg redo entry state.
fn failed_parallel_state(legs: Vec<WorkflowRunNodeSessionRecord>) -> RunState {
    let mut run = run();
    run.status = WorkflowRunStatus::Failed;
    let mut n1 = node("n1", 0, WorkflowNodeStatus::Failed);
    n1.failure_code = Some(WorkflowNodeFailureCode::TurnError);
    RunState {
        run,
        nodes: vec![n1, node("n2", 1, WorkflowNodeStatus::Pending)],
        node_legs: legs,
    }
}

fn redo_leg(node_row_id: &str, leg_index: Option<i64>) -> WorkflowEvent {
    WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
        node_row_id: node_row_id.into(),
        prompt: None,
        leg_index,
    })
}

#[test]
fn per_leg_redo_of_a_failed_leg_produces_redo_leg_without_a_dispose() {
    let state = failed_parallel_state(vec![
        leg("sess-a", 0, WorkflowLegStatus::Done),
        leg("sess-b", 1, WorkflowLegStatus::Failed(WorkflowNodeFailureCode::TurnError)),
    ]);
    let decision = next(&state, &redo_leg("n1", Some(1)));
    assert_eq!(
        decision,
        Decision::Transition(Transition::RedoLeg {
            node_row_id: "n1".into(),
            leg_index: 1,
            // A leg that already failed holds no live turn to kill.
            disposed_session_id: None,
        })
    );
    // Negative control: the whole-node redo (no leg index) still mints a
    // replacement (Transition::Redo), never a RedoLeg.
    assert!(matches!(
        next(&state, &redo_leg("n1", None)),
        Decision::Transition(Transition::Redo { .. })
    ));
}

#[test]
fn per_leg_redo_of_a_running_leg_disposes_that_legs_session() {
    // A running parallel node (Ruling L's per-leg twin): leg b is wedged.
    let mut run = run();
    run.status = WorkflowRunStatus::Running;
    let state = RunState {
        run,
        nodes: vec![
            node("n1", 0, WorkflowNodeStatus::Running),
            node("n2", 1, WorkflowNodeStatus::Pending),
        ],
        node_legs: vec![
            leg("sess-a", 0, WorkflowLegStatus::Running),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
    };
    assert_eq!(
        next(&state, &redo_leg("n1", Some(1))),
        Decision::Transition(Transition::RedoLeg {
            node_row_id: "n1".into(),
            leg_index: 1,
            disposed_session_id: Some("sess-b".into()),
        })
    );
}

#[test]
fn per_leg_redo_rejects_an_out_of_range_or_negative_index() {
    let state = failed_parallel_state(vec![
        leg("sess-a", 0, WorkflowLegStatus::Done),
        leg("sess-b", 1, WorkflowLegStatus::Failed(WorkflowNodeFailureCode::TurnError)),
    ]);
    assert!(matches!(
        next(&state, &redo_leg("n1", Some(2))),
        Decision::Illegal(_)
    ));
    assert!(matches!(
        next(&state, &redo_leg("n1", Some(-1))),
        Decision::Illegal(_)
    ));
}

#[test]
fn per_leg_redo_on_a_one_leg_node_is_illegal() {
    // One ledger row: the degenerate node takes a whole-node redo only.
    let state = failed_parallel_state(vec![leg(
        "sess-a",
        0,
        WorkflowLegStatus::Failed(WorkflowNodeFailureCode::TurnError),
    )]);
    assert!(matches!(
        next(&state, &redo_leg("n1", Some(0))),
        Decision::Illegal(_)
    ));
    // The same node still accepts a whole-node redo.
    assert!(matches!(
        next(&state, &redo_leg("n1", None)),
        Decision::Transition(Transition::Redo { .. })
    ));
}

#[test]
fn a_queued_interjection_holds_regardless_of_legs() {
    // Clean turn with a non-empty queue holds the node open, same as one leg,
    // without recording any leg terminal.
    let event = WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: "n1".into(),
        session_id: Some("sess-b".into()),
        stop_reason: TurnStopReason::CleanEndTurn,
        queue_empty: false,
    });
    let decision = decide(
        vec![
            leg("sess-a", 0, WorkflowLegStatus::Done),
            leg("sess-b", 1, WorkflowLegStatus::Running),
        ],
        event,
    );
    assert_eq!(decision, Decision::Hold);
}
