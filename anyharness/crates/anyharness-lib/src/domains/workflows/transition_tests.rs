//! Exhaustive tests of the pure transition function: every row of the ADR
//! transition table, the ruled edge interpretations, and a negative control
//! per behavior (the same event against a state one step off, expecting Hold
//! or Illegal instead of a transition).

use super::model::{
    WorkflowInterruptionCode, WorkflowNodeFailureCode, WorkflowNodeKind, WorkflowNodeStatus,
    WorkflowNodeType, WorkflowRunNodeRecord, WorkflowRunRecord, WorkflowRunStatus,
};
use super::transition::{
    next, AdhocOutcome, Decision, RunState, Transition, TurnFinished, TurnStopReason,
    WorkflowCommand, WorkflowEvent,
};

const T0: &str = "2026-08-14T00:00:00+00:00";

fn run_record(status: WorkflowRunStatus, current_node_row_id: Option<&str>) -> WorkflowRunRecord {
    WorkflowRunRecord {
        id: "run-1".into(),
        invocation_id: "inv-1".into(),
        definition_json: "{}".into(),
        arguments_json: "{}".into(),
        workspace_id: "ws-1".into(),
        status,
        current_node_row_id: current_node_row_id.map(Into::into),
        failure_code: None,
        interruption_code: None,
        created_at: T0.into(),
        updated_at: T0.into(),
        completed_at: None,
    }
}

fn node_record(
    id: &str,
    chain_index: i64,
    node_type: WorkflowNodeType,
    status: WorkflowNodeStatus,
) -> WorkflowRunNodeRecord {
    let launched = matches!(
        status,
        WorkflowNodeStatus::Running
            | WorkflowNodeStatus::AwaitingHuman
            | WorkflowNodeStatus::NeedsAttention
            | WorkflowNodeStatus::Completed
            | WorkflowNodeStatus::Failed
    );
    WorkflowRunNodeRecord {
        id: id.into(),
        run_id: "run-1".into(),
        definition_node_id: Some(format!("def-{id}")),
        kind: WorkflowNodeKind::Defined,
        node_type,
        replaces_node_row_id: None,
        anchor_node_row_id: None,
        chain_index: Some(chain_index),
        title: format!("Node {id}"),
        prompt: format!("prompt for {id}"),
        status,
        session_id: launched.then(|| format!("sess-{id}")),
        prompt_id: launched.then(|| format!("prompt-{id}")),
        model: None,
        rendered_envelope: None,
        failure_code: None,
        first_turn_finished_at: None,
        created_at: T0.into(),
        started_at: launched.then(|| T0.into()),
        completed_at: (status == WorkflowNodeStatus::Completed).then(|| T0.into()),
    }
}

/// The standard fixture: n1 completed, n2 running (current), n3 pending.
fn mid_run() -> RunState {
    RunState {
        run: run_record(WorkflowRunStatus::Running, Some("n2")),
        nodes: vec![
            node_record(
                "n1",
                0,
                WorkflowNodeType::Agent,
                WorkflowNodeStatus::Completed,
            ),
            node_record(
                "n2",
                1,
                WorkflowNodeType::Agent,
                WorkflowNodeStatus::Running,
            ),
            node_record(
                "n3",
                2,
                WorkflowNodeType::Agent,
                WorkflowNodeStatus::Pending,
            ),
        ],
    }
}

fn turn(node_row_id: &str, stop_reason: TurnStopReason, queue_empty: bool) -> WorkflowEvent {
    WorkflowEvent::TurnFinished(TurnFinished {
        node_row_id: node_row_id.into(),
        stop_reason,
        queue_empty,
    })
}

fn expect_transition(decision: Decision) -> Transition {
    match decision {
        Decision::Transition(transition) => transition,
        other => panic!("expected a transition, got {other:?}"),
    }
}

// ---- turn reports: the agent rows of the table ----

#[test]
fn clean_empty_agent_turn_advances() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &turn("n2", TurnStopReason::CleanEndTurn, true),
    ));
    assert_eq!(
        transition,
        Transition::AdvanceToNext {
            completed_node_row_id: "n2".into(),
            next_node_row_id: "n3".into(),
            completed_node_type: None,
        }
    );
}

#[test]
fn clean_empty_turn_on_last_node_completes_run() {
    let mut state = mid_run();
    state.nodes[1].status = WorkflowNodeStatus::Completed;
    state.nodes[2].status = WorkflowNodeStatus::Running;
    state.run.current_node_row_id = Some("n3".into());
    let transition = expect_transition(next(
        &state,
        &turn("n3", TurnStopReason::CleanEndTurn, true),
    ));
    assert_eq!(
        transition,
        Transition::CompleteRun {
            completed_node_row_id: "n3".into(),
            completed_node_type: None,
        }
    );
}

#[test]
fn clean_turn_with_queued_interjection_holds() {
    let state = mid_run();
    assert_eq!(
        next(&state, &turn("n2", TurnStopReason::CleanEndTurn, false)),
        Decision::Hold
    );
}

#[test]
fn clean_empty_turn_on_human_in_loop_gates() {
    let mut state = mid_run();
    state.nodes[1].node_type = WorkflowNodeType::HumanInLoop;
    let transition = expect_transition(next(
        &state,
        &turn("n2", TurnStopReason::CleanEndTurn, true),
    ));
    assert_eq!(
        transition,
        Transition::GateNode {
            node_row_id: "n2".into(),
        }
    );
}

#[test]
fn failure_stop_reasons_fail_the_node() {
    let cases = [
        (TurnStopReason::Refusal, WorkflowNodeFailureCode::Refusal),
        (
            TurnStopReason::EmptyTurn,
            WorkflowNodeFailureCode::EmptyTurn,
        ),
        (TurnStopReason::Error, WorkflowNodeFailureCode::TurnError),
        (
            TurnStopReason::HarnessCap,
            WorkflowNodeFailureCode::HarnessCap,
        ),
    ];
    for (reason, code) in cases {
        let state = mid_run();
        let transition = expect_transition(next(&state, &turn("n2", reason, true)));
        assert_eq!(
            transition,
            Transition::FailNode {
                node_row_id: "n2".into(),
                code,
            },
            "stop reason {reason:?}"
        );
    }
}

#[test]
fn cancelled_turn_interrupts() {
    let state = mid_run();
    let transition = expect_transition(next(&state, &turn("n2", TurnStopReason::Cancelled, true)));
    assert_eq!(
        transition,
        Transition::InterruptNode {
            node_row_id: "n2".into(),
            code: WorkflowInterruptionCode::UserCancel,
        }
    );
}

// A platform unload (forced-unload cancel) parks the run app_shutdown, never
// user_cancel: the resume popover must not blame the user for an eviction.
#[test]
fn forced_unload_interrupts_with_app_shutdown() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &turn("n2", TurnStopReason::ForcedUnload, true),
    ));
    assert_eq!(
        transition,
        Transition::InterruptNode {
            node_row_id: "n2".into(),
            code: WorkflowInterruptionCode::AppShutdown,
        }
    );
}

// ---- staleness: reports that no longer apply are held, never applied ----

#[test]
fn report_from_completed_node_holds() {
    // Completed nodes stay chattable; their later turns never orchestrate.
    let state = mid_run();
    assert_eq!(
        next(&state, &turn("n1", TurnStopReason::CleanEndTurn, true)),
        Decision::Hold
    );
}

#[test]
fn report_from_unknown_node_holds() {
    let state = mid_run();
    assert_eq!(
        next(&state, &turn("ghost", TurnStopReason::CleanEndTurn, true)),
        Decision::Hold
    );
}

#[test]
fn report_while_run_not_running_holds() {
    let mut state = mid_run();
    state.run.status = WorkflowRunStatus::AwaitingHuman;
    state.nodes[1].status = WorkflowNodeStatus::AwaitingHuman;
    assert_eq!(
        next(&state, &turn("n2", TurnStopReason::CleanEndTurn, true)),
        Decision::Hold
    );
}

// ---- gates ----

fn gated_run() -> RunState {
    let mut state = mid_run();
    state.run.status = WorkflowRunStatus::AwaitingHuman;
    state.nodes[1].node_type = WorkflowNodeType::HumanInLoop;
    state.nodes[1].status = WorkflowNodeStatus::AwaitingHuman;
    state
}

#[test]
fn approve_gate_advances() {
    let state = gated_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::ApproveGate {
            node_row_id: "n2".into(),
        }),
    ));
    assert_eq!(
        transition,
        Transition::AdvanceToNext {
            completed_node_row_id: "n2".into(),
            next_node_row_id: "n3".into(),
            completed_node_type: None,
        }
    );
}

#[test]
fn approve_gate_on_last_node_completes_run() {
    let mut state = gated_run();
    state.nodes.truncate(2);
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::ApproveGate {
            node_row_id: "n2".into(),
        }),
    ));
    assert_eq!(
        transition,
        Transition::CompleteRun {
            completed_node_row_id: "n2".into(),
            completed_node_type: None,
        }
    );
}

#[test]
fn approve_on_running_node_is_illegal() {
    let state = mid_run();
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::ApproveGate {
                node_row_id: "n2".into(),
            })
        ),
        Decision::Illegal(_)
    ));
}

// ---- type flips ----

#[test]
fn flip_waiting_gate_to_agent_advances() {
    let state = gated_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::FlipType {
            node_row_id: "n2".into(),
            node_type: WorkflowNodeType::Agent,
        }),
    ));
    // The flip persists on the completed row (a later undo re-parks it as an
    // agent node), so the transition carries the new type.
    assert_eq!(
        transition,
        Transition::AdvanceToNext {
            completed_node_row_id: "n2".into(),
            next_node_row_id: "n3".into(),
            completed_node_type: Some(WorkflowNodeType::Agent),
        }
    );
}

#[test]
fn flip_running_agent_to_gate_is_row_only() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::FlipType {
            node_row_id: "n2".into(),
            node_type: WorkflowNodeType::HumanInLoop,
        }),
    ));
    assert_eq!(
        transition,
        Transition::FlipNodeType {
            node_row_id: "n2".into(),
            node_type: WorkflowNodeType::HumanInLoop,
        }
    );
}

#[test]
fn flip_pending_node_is_row_only_both_directions() {
    let mut state = mid_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::FlipType {
            node_row_id: "n3".into(),
            node_type: WorkflowNodeType::HumanInLoop,
        }),
    ));
    assert_eq!(
        transition,
        Transition::FlipNodeType {
            node_row_id: "n3".into(),
            node_type: WorkflowNodeType::HumanInLoop,
        }
    );
    state.nodes[2].node_type = WorkflowNodeType::HumanInLoop;
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::FlipType {
            node_row_id: "n3".into(),
            node_type: WorkflowNodeType::Agent,
        }),
    ));
    assert_eq!(
        transition,
        Transition::FlipNodeType {
            node_row_id: "n3".into(),
            node_type: WorkflowNodeType::Agent,
        }
    );
}

#[test]
fn flip_to_same_type_is_illegal() {
    let state = mid_run();
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::FlipType {
                node_row_id: "n2".into(),
                node_type: WorkflowNodeType::Agent,
            })
        ),
        Decision::Illegal(_)
    ));
}

#[test]
fn flip_completed_node_is_illegal() {
    let state = mid_run();
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::FlipType {
                node_row_id: "n1".into(),
                node_type: WorkflowNodeType::HumanInLoop,
            })
        ),
        Decision::Illegal(_)
    ));
}

// ---- fail-and-redo ----

fn failed_run() -> RunState {
    let mut state = mid_run();
    state.run.status = WorkflowRunStatus::Failed;
    state.run.failure_code = Some("turn_error".into());
    state.nodes[1].status = WorkflowNodeStatus::Failed;
    state.nodes[1].failure_code = Some(WorkflowNodeFailureCode::TurnError);
    state
}

#[test]
fn fail_and_redo_from_failed_creates_replacement() {
    let state = failed_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
            node_row_id: "n2".into(),
            prompt: None,
        }),
    ));
    let Transition::Redo {
        failed_node_row_id,
        replacement,
        disposed_session_id,
    } = transition
    else {
        panic!("expected Redo");
    };
    assert_eq!(failed_node_row_id, "n2");
    assert_eq!(replacement.kind, WorkflowNodeKind::Replacement);
    assert_eq!(replacement.replaces_node_row_id.as_deref(), Some("n2"));
    assert_eq!(replacement.chain_index, Some(1));
    assert_eq!(replacement.prompt, "prompt for n2");
    assert_eq!(replacement.definition_node_id.as_deref(), Some("def-n2"));
    // A pause-state redo has no live turn to kill.
    assert_eq!(disposed_session_id, None);
}

#[test]
fn fail_and_redo_with_edited_prompt_drops_stored_envelope() {
    let mut state = failed_run();
    state.nodes[1].rendered_envelope = Some(super::model::RenderedEnvelope {
        instruction_blocks: vec!["block".into()],
        first_message: "hello".into(),
        system_prompt_append: vec![],
    });
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
            node_row_id: "n2".into(),
            prompt: Some("try again differently".into()),
        }),
    ));
    let Transition::Redo { replacement, .. } = transition else {
        panic!("expected Redo");
    };
    assert_eq!(replacement.prompt, "try again differently");
    assert!(replacement.rendered_envelope.is_none());
}

#[test]
fn fail_and_redo_applies_at_every_pause_state() {
    for (run_status, node_status) in [
        (
            WorkflowRunStatus::Interrupted,
            WorkflowNodeStatus::NeedsAttention,
        ),
        (
            WorkflowRunStatus::AwaitingHuman,
            WorkflowNodeStatus::AwaitingHuman,
        ),
    ] {
        let mut state = mid_run();
        state.run.status = run_status;
        state.nodes[1].status = node_status;
        assert!(
            matches!(
                next(
                    &state,
                    &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
                        node_row_id: "n2".into(),
                        prompt: None,
                    })
                ),
                Decision::Transition(Transition::Redo { .. })
            ),
            "pause state {node_status:?}"
        );
    }
}

// Ruling L: fail-and-redo is legal on a RUNNING chain node — the liveness
// escape for a wedged node whose turn will never end — and the committed
// transition names the live session to dispose before the replacement starts.
#[test]
fn fail_and_redo_on_running_chain_node_disposes_the_live_session() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
            node_row_id: "n2".into(),
            prompt: None,
        }),
    ));
    let Transition::Redo {
        failed_node_row_id,
        replacement,
        disposed_session_id,
    } = transition
    else {
        panic!("expected Redo");
    };
    assert_eq!(failed_node_row_id, "n2");
    assert_eq!(replacement.kind, WorkflowNodeKind::Replacement);
    assert_eq!(disposed_session_id.as_deref(), Some("sess-n2"));
}

// Ruling L's negative control (K.1 scope): adhoc rows keep the pause-only
// rule — a RUNNING adhoc is not redoable.
#[test]
fn fail_and_redo_on_running_adhoc_is_illegal() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
                node_row_id: "a1".into(),
                prompt: None,
            })
        ),
        Decision::Illegal(_)
    ));
}

#[test]
fn fail_and_redo_on_superseded_node_is_illegal() {
    let mut state = failed_run();
    let mut replacement = node_record(
        "r2",
        1,
        WorkflowNodeType::Agent,
        WorkflowNodeStatus::Running,
    );
    replacement.kind = WorkflowNodeKind::Replacement;
    replacement.replaces_node_row_id = Some("n2".into());
    state.nodes.push(replacement);
    state.run.status = WorkflowRunStatus::Running;
    state.run.current_node_row_id = Some("r2".into());
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
                node_row_id: "n2".into(),
                prompt: None,
            })
        ),
        Decision::Illegal(_)
    ));
}

#[test]
fn replacement_node_takes_the_chain_position() {
    // With n2 superseded by r2, r2's clean turn advances to n3.
    let mut state = failed_run();
    let mut replacement = node_record(
        "r2",
        1,
        WorkflowNodeType::Agent,
        WorkflowNodeStatus::Running,
    );
    replacement.kind = WorkflowNodeKind::Replacement;
    replacement.replaces_node_row_id = Some("n2".into());
    state.nodes.push(replacement);
    state.run.status = WorkflowRunStatus::Running;
    state.run.current_node_row_id = Some("r2".into());
    let transition = expect_transition(next(
        &state,
        &turn("r2", TurnStopReason::CleanEndTurn, true),
    ));
    assert_eq!(
        transition,
        Transition::AdvanceToNext {
            completed_node_row_id: "r2".into(),
            next_node_row_id: "n3".into(),
            completed_node_type: None,
        }
    );
}

// ---- undo advance ----

#[test]
fn undo_advance_parks_previous_node_as_gate() {
    let mut state = mid_run();
    state.nodes[1].status = WorkflowNodeStatus::Completed;
    state.nodes[2].status = WorkflowNodeStatus::Running;
    state.run.current_node_row_id = Some("n3".into());
    state.nodes[2].session_id = Some("sess-n3".into());
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::UndoAdvance),
    ));
    assert_eq!(
        transition,
        Transition::UndoAdvance {
            undone_node_row_id: "n3".into(),
            gate_node_row_id: "n2".into(),
            disposed_session_id: Some("sess-n3".into()),
        }
    );
}

#[test]
fn undo_advance_on_first_node_is_illegal() {
    let mut state = mid_run();
    state.nodes[0].status = WorkflowNodeStatus::Running;
    state.nodes[1].status = WorkflowNodeStatus::Pending;
    state.run.current_node_row_id = Some("n1".into());
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::UndoAdvance)
        ),
        Decision::Illegal(_)
    ));
}

#[test]
fn undo_advance_while_gated_is_illegal() {
    let state = gated_run();
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::UndoAdvance)
        ),
        Decision::Illegal(_)
    ));
}

// Ruling J: the undo window closes the moment the started node's session
// finishes a turn — the identical state minus the stamp is legal (the
// negative control is `undo_advance_parks_previous_node_as_gate`).
#[test]
fn undo_advance_after_first_turn_finished_is_illegal() {
    let mut state = mid_run();
    state.nodes[1].status = WorkflowNodeStatus::Completed;
    state.nodes[2].status = WorkflowNodeStatus::Running;
    state.run.current_node_row_id = Some("n3".into());
    state.nodes[2].session_id = Some("sess-n3".into());
    state.nodes[2].first_turn_finished_at = Some(T0.into());
    match next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::UndoAdvance),
    ) {
        Decision::Illegal(illegal) => assert!(
            illegal.detail.contains("undo window is closed"),
            "unexpected detail: {}",
            illegal.detail
        ),
        other => panic!("expected Illegal, got {other:?}"),
    }
}

// ---- boot fence and resume ----

#[test]
fn boot_fence_interrupts_the_running_run() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::BootFence {
            code: WorkflowInterruptionCode::RuntimeRestarted,
        },
    ));
    assert_eq!(
        transition,
        Transition::Fence {
            node_row_ids: vec!["n2".into()],
            interrupt_run: true,
            code: WorkflowInterruptionCode::RuntimeRestarted,
        }
    );
}

// Ruling K: the fence sweeps EVERY running node row, chain and adhoc alike.
#[test]
fn boot_fence_fences_all_running_nodes_chain_and_adhoc() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::BootFence {
            code: WorkflowInterruptionCode::RuntimeRestarted,
        },
    ));
    let Transition::Fence {
        node_row_ids,
        interrupt_run,
        ..
    } = transition
    else {
        panic!("expected Fence");
    };
    assert!(interrupt_run);
    assert_eq!(node_row_ids.len(), 2);
    assert!(node_row_ids.contains(&"n2".to_string()));
    assert!(node_row_ids.contains(&"a1".to_string()));
}

// Ruling K: an awaiting_human run keeps its status — the gate's pending
// approval survives the restart — while its running adhoc still fences.
#[test]
fn boot_fence_on_gated_run_fences_the_adhoc_but_keeps_the_gate() {
    let state = with_adhoc(gated_run(), WorkflowNodeStatus::Running);
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::BootFence {
            code: WorkflowInterruptionCode::RuntimeRestarted,
        },
    ));
    assert_eq!(
        transition,
        Transition::Fence {
            node_row_ids: vec!["a1".into()],
            interrupt_run: false,
            code: WorkflowInterruptionCode::RuntimeRestarted,
        }
    );
}

// Ruling K: a terminal run with an orphaned running adhoc gets node-only
// fencing — the run's terminal status is never rewritten.
#[test]
fn boot_fence_on_terminal_run_fences_orphan_adhocs_node_only() {
    let mut state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    state.run.status = WorkflowRunStatus::Completed;
    state.nodes[1].status = WorkflowNodeStatus::Completed;
    state.run.current_node_row_id = None;
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::BootFence {
            code: WorkflowInterruptionCode::RuntimeRestarted,
        },
    ));
    assert_eq!(
        transition,
        Transition::Fence {
            node_row_ids: vec!["a1".into()],
            interrupt_run: false,
            code: WorkflowInterruptionCode::RuntimeRestarted,
        }
    );
}

#[test]
fn boot_fence_is_idempotent_on_interrupted_runs() {
    let mut state = mid_run();
    state.run.status = WorkflowRunStatus::Interrupted;
    state.nodes[1].status = WorkflowNodeStatus::NeedsAttention;
    assert_eq!(
        next(
            &state,
            &WorkflowEvent::BootFence {
                code: WorkflowInterruptionCode::RuntimeRestarted,
            }
        ),
        Decision::Hold
    );
}

#[test]
fn boot_fence_holds_on_quiesced_terminal_runs() {
    let mut state = mid_run();
    state.run.status = WorkflowRunStatus::Completed;
    state.nodes[1].status = WorkflowNodeStatus::Completed;
    state.run.current_node_row_id = None;
    assert_eq!(
        next(
            &state,
            &WorkflowEvent::BootFence {
                code: WorkflowInterruptionCode::RuntimeRestarted,
            }
        ),
        Decision::Hold
    );
}

#[test]
fn resume_restarts_the_fenced_node() {
    let mut state = mid_run();
    state.run.status = WorkflowRunStatus::Interrupted;
    state.run.interruption_code = Some(WorkflowInterruptionCode::UserCancel);
    state.nodes[1].status = WorkflowNodeStatus::NeedsAttention;
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::Resume),
    ));
    assert_eq!(
        transition,
        Transition::ResumeNode {
            node_row_id: "n2".into(),
        }
    );
}

#[test]
fn resume_on_running_run_is_illegal() {
    let state = mid_run();
    assert!(matches!(
        next(&state, &WorkflowEvent::Command(WorkflowCommand::Resume)),
        Decision::Illegal(_)
    ));
}

// ---- adhoc nodes ----

fn with_adhoc(mut state: RunState, status: WorkflowNodeStatus) -> RunState {
    let mut adhoc = node_record("a1", 1, WorkflowNodeType::Agent, status);
    adhoc.kind = WorkflowNodeKind::Adhoc;
    adhoc.definition_node_id = None;
    adhoc.anchor_node_row_id = Some("n2".into());
    state.nodes.push(adhoc);
    state
}

#[test]
fn add_adhoc_node_anchors_to_the_chain() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
            anchor_node_row_id: "n2".into(),
            prompt: "investigate the flaky login test".into(),
            model: None,
        }),
    ));
    let Transition::AddAdhoc { adhoc } = transition else {
        panic!("expected AddAdhoc");
    };
    assert_eq!(adhoc.kind, WorkflowNodeKind::Adhoc);
    assert_eq!(adhoc.anchor_node_row_id.as_deref(), Some("n2"));
    assert_eq!(adhoc.chain_index, Some(1));
    assert!(adhoc.definition_node_id.is_none());
    assert_eq!(adhoc.title, "investigate the flaky login test");
}

#[test]
fn add_adhoc_anchored_to_adhoc_is_illegal() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::AddAdhocNode {
                anchor_node_row_id: "a1".into(),
                prompt: "chained adhoc".into(),
                model: None,
            })
        ),
        Decision::Illegal(_)
    ));
}

#[test]
fn adhoc_turn_completes_only_its_own_row() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    let transition = expect_transition(next(
        &state,
        &turn("a1", TurnStopReason::CleanEndTurn, true),
    ));
    assert_eq!(
        transition,
        Transition::AdhocTurn {
            node_row_id: "a1".into(),
            outcome: AdhocOutcome::Completed,
        }
    );
}

#[test]
fn adhoc_failure_and_cancel_touch_only_the_adhoc_row() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    let transition = expect_transition(next(&state, &turn("a1", TurnStopReason::Error, true)));
    assert_eq!(
        transition,
        Transition::AdhocTurn {
            node_row_id: "a1".into(),
            outcome: AdhocOutcome::Failed(WorkflowNodeFailureCode::TurnError),
        }
    );
    let transition = expect_transition(next(&state, &turn("a1", TurnStopReason::Cancelled, true)));
    assert_eq!(
        transition,
        Transition::AdhocTurn {
            node_row_id: "a1".into(),
            outcome: AdhocOutcome::NeedsAttention,
        }
    );
    // A platform unload parks the adhoc the same way a user cancel does: it
    // needs attention, it did not fail.
    let transition = expect_transition(next(
        &state,
        &turn("a1", TurnStopReason::ForcedUnload, true),
    ));
    assert_eq!(
        transition,
        Transition::AdhocTurn {
            node_row_id: "a1".into(),
            outcome: AdhocOutcome::NeedsAttention,
        }
    );
}

#[test]
fn adhoc_report_after_completion_holds() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Completed);
    assert_eq!(
        next(&state, &turn("a1", TurnStopReason::CleanEndTurn, true)),
        Decision::Hold
    );
}

// Ruling K.1(a): fail-and-redo is legal on adhoc rows in failed or
// needs_attention, and the minted row stays kind ADHOC (the client's
// side-node predicate keys on kind), same anchor, replacing the old row.
#[test]
fn fail_and_redo_on_paused_adhoc_mints_an_adhoc_replacement() {
    for status in [
        WorkflowNodeStatus::Failed,
        WorkflowNodeStatus::NeedsAttention,
    ] {
        let mut state = with_adhoc(mid_run(), status);
        if status == WorkflowNodeStatus::Failed {
            state.nodes[3].failure_code = Some(WorkflowNodeFailureCode::TurnError);
        }
        // The adhoc's own launch pick must survive the redo (its replacement
        // has no definition node to resolve a model through).
        state.nodes[3].model = Some(super::definition::NodeModel {
            agent_kind: "codex".into(),
            model_id: Some("adhoc-pick".into()),
            control_values: Default::default(),
        });
        let transition = expect_transition(next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
                node_row_id: "a1".into(),
                prompt: None,
            }),
        ));
        let Transition::Redo {
            failed_node_row_id,
            replacement,
            disposed_session_id,
        } = transition
        else {
            panic!("expected Redo for adhoc in {status:?}");
        };
        assert_eq!(failed_node_row_id, "a1");
        assert_eq!(replacement.kind, WorkflowNodeKind::Adhoc);
        assert_eq!(replacement.anchor_node_row_id.as_deref(), Some("n2"));
        assert_eq!(replacement.replaces_node_row_id.as_deref(), Some("a1"));
        assert_eq!(
            replacement
                .model
                .as_ref()
                .and_then(|model| model.model_id.as_deref()),
            Some("adhoc-pick")
        );
        assert_eq!(disposed_session_id, None);
    }
}

// Ruling K.1(a): awaiting_human is NOT a legal adhoc pause — adhoc rows never
// gate — even though it is one for chain rows.
#[test]
fn fail_and_redo_on_awaiting_human_adhoc_is_illegal() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::AwaitingHuman);
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::FailAndRedo {
                node_row_id: "a1".into(),
                prompt: None,
            })
        ),
        Decision::Illegal(_)
    ));
}

// Ruling K.1(c): adhoc rows have no gate semantics to flip.
#[test]
fn flip_type_on_adhoc_is_illegal() {
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    assert!(matches!(
        next(
            &state,
            &WorkflowEvent::Command(WorkflowCommand::FlipType {
                node_row_id: "a1".into(),
                node_type: WorkflowNodeType::HumanInLoop,
            })
        ),
        Decision::Illegal(_)
    ));
}

// ---- launch failures ----

#[test]
fn node_launch_failure_fails_the_node_and_run() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::NodeLaunchFailed {
            node_row_id: "n2".into(),
        },
    ));
    assert_eq!(
        transition,
        Transition::FailNode {
            node_row_id: "n2".into(),
            code: WorkflowNodeFailureCode::NodeLaunchFailed,
        }
    );
}

#[test]
fn stale_launch_failure_holds() {
    let state = mid_run();
    assert_eq!(
        next(
            &state,
            &WorkflowEvent::NodeLaunchFailed {
                node_row_id: "n1".into(),
            }
        ),
        Decision::Hold
    );
}

// ---- terminal-run command wall ----

#[test]
fn commands_other_than_redo_are_illegal_on_terminal_runs() {
    // Parameterized over every terminal status: the matrix previously only
    // ever set Completed, so Failed and Cancelled read as covered when they
    // were not actually exercised.
    for terminal_status in [
        WorkflowRunStatus::Completed,
        WorkflowRunStatus::Failed,
        WorkflowRunStatus::Cancelled,
    ] {
        let mut state = mid_run();
        state.run.status = terminal_status;
        for command in [
            WorkflowCommand::ApproveGate {
                node_row_id: "n2".into(),
            },
            WorkflowCommand::FlipType {
                node_row_id: "n3".into(),
                node_type: WorkflowNodeType::HumanInLoop,
            },
            WorkflowCommand::UndoAdvance,
            WorkflowCommand::Resume,
            WorkflowCommand::AddAdhocNode {
                anchor_node_row_id: "n2".into(),
                prompt: "late addition".into(),
                model: None,
            },
            WorkflowCommand::Cancel,
        ] {
            assert!(
                matches!(
                    next(&state, &WorkflowEvent::Command(command.clone())),
                    Decision::Illegal(_)
                ),
                "command {} should be illegal on a {} run",
                command.as_str(),
                terminal_status.as_str()
            );
        }
    }
}

// ---- cancel ----

#[test]
fn cancel_from_running_disposes_the_live_session() {
    let state = mid_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::Cancel),
    ));
    assert_eq!(
        transition,
        Transition::Cancel {
            node_row_id: "n2".into(),
            disposed_session_ids: vec!["sess-n2".into()],
        }
    );
}

#[test]
fn cancel_from_awaiting_human_gate_disposes_nothing() {
    // Ruling L's reused disposal condition: a waiting gate holds no live turn.
    let state = gated_run();
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::Cancel),
    ));
    assert_eq!(
        transition,
        Transition::Cancel {
            node_row_id: "n2".into(),
            disposed_session_ids: vec![],
        }
    );
}

#[test]
fn cancel_from_interrupted_run_disposes_nothing() {
    // The fenced node already had its session disposed by the boot fence; a
    // needs_attention node holds no live turn either.
    let mut state = mid_run();
    state.run.status = WorkflowRunStatus::Interrupted;
    state.run.interruption_code = Some(WorkflowInterruptionCode::UserCancel);
    state.nodes[1].status = WorkflowNodeStatus::NeedsAttention;
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::Cancel),
    ));
    assert_eq!(
        transition,
        Transition::Cancel {
            node_row_id: "n2".into(),
            disposed_session_ids: vec![],
        }
    );
}

#[test]
fn cancel_with_a_running_adhoc_row_disposes_both_sessions() {
    // HIGH finding: a running adhoc row is never the current node
    // (invariants.rs forbids it), so it is invisible to a disposal scan that
    // only looks at `state.current_node()`. Cancel must scan every running
    // row, chain or adhoc, exactly like `on_boot_fence` does.
    let state = with_adhoc(mid_run(), WorkflowNodeStatus::Running);
    let transition = expect_transition(next(
        &state,
        &WorkflowEvent::Command(WorkflowCommand::Cancel),
    ));
    assert_eq!(
        transition,
        Transition::Cancel {
            node_row_id: "n2".into(),
            disposed_session_ids: vec!["sess-n2".into(), "sess-a1".into()],
        }
    );
}
