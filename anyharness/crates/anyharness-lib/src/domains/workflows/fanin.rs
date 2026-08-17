//! The pure fan-in decision (ruling F1) for a live chain leg's turn report.
//! Split from `transition.rs` to keep that table under its size ratchet; still
//! pure (no IO, no clocks). With one leg per node — every definition today —
//! `resolve_chain_turn` reduces to the pre-ledger single-turn mapping: the
//! finishing leg is the only leg, so it is always the last outstanding one and
//! the node resolves immediately on its stop reason.

use super::model::{
    WorkflowInterruptionCode, WorkflowLegStatus, WorkflowNodeFailureCode, WorkflowNodeType,
    WorkflowRunNodeRecord,
};
use super::transition::{
    advance_or_complete, Decision, RunState, Transition, TurnFinished, TurnStopReason,
};

/// Decide a live chain leg's turn: hold on a queued interjection, record and
/// hold while any sibling leg is still outstanding, else aggregate the node.
pub(super) fn resolve_chain_turn(
    state: &RunState,
    node: &WorkflowRunNodeRecord,
    turn: &TurnFinished,
) -> Decision {
    // A queued interjection holds the node open regardless of legs: the queued
    // turn runs and completion waits for a turn ending with an empty queue.
    if matches!(turn.stop_reason, TurnStopReason::CleanEndTurn) && !turn.queue_empty {
        return Decision::Hold;
    }

    let leg_status = leg_status_for(turn.stop_reason);
    let finishing = turn.session_id.as_deref().or(node.session_id.as_deref());
    let outstanding = state.legs_of(&node.id).iter().any(|leg| {
        leg.status == WorkflowLegStatus::Running && leg.session_id.as_deref() != finishing
    });
    if outstanding {
        return Decision::Transition(Transition::RecordLegThenHold {
            node_row_id: node.id.clone(),
            session_id: finishing.map(str::to_string).unwrap_or_default(),
            leg_status,
        });
    }
    aggregate_node(state, node, leg_status)
}

/// This finished leg's terminal fan-in status.
fn leg_status_for(reason: TurnStopReason) -> WorkflowLegStatus {
    match reason {
        TurnStopReason::CleanEndTurn => WorkflowLegStatus::Done,
        TurnStopReason::Cancelled => WorkflowLegStatus::Cancelled,
        TurnStopReason::ForcedUnload => WorkflowLegStatus::ForcedUnload,
        reason => WorkflowLegStatus::Failed(
            reason
                .failure_code()
                .unwrap_or(WorkflowNodeFailureCode::TurnError),
        ),
    }
}

/// Fold the finishing leg with every already-recorded leg (ruling F1). Priority
/// cancel > forced-unload > fail > clean; with one leg this is exactly today's
/// per-turn mapping.
fn aggregate_node(
    state: &RunState,
    node: &WorkflowRunNodeRecord,
    this_leg: WorkflowLegStatus,
) -> Decision {
    let mut cancelled = matches!(this_leg, WorkflowLegStatus::Cancelled);
    let mut forced = matches!(this_leg, WorkflowLegStatus::ForcedUnload);
    let mut failure = match this_leg {
        WorkflowLegStatus::Failed(code) => Some(code),
        _ => None,
    };
    for leg in state.legs_of(&node.id) {
        match leg.status {
            WorkflowLegStatus::Cancelled => cancelled = true,
            WorkflowLegStatus::ForcedUnload => forced = true,
            WorkflowLegStatus::Failed(code) => failure = failure.or(Some(code)),
            WorkflowLegStatus::Running | WorkflowLegStatus::Done => {}
        }
    }
    let node_row_id = node.id.clone();
    if cancelled {
        return Decision::Transition(Transition::InterruptNode {
            node_row_id,
            code: WorkflowInterruptionCode::UserCancel,
        });
    }
    if forced {
        return Decision::Transition(Transition::InterruptNode {
            node_row_id,
            code: WorkflowInterruptionCode::AppShutdown,
        });
    }
    if let Some(code) = failure {
        return Decision::Transition(Transition::FailNode { node_row_id, code });
    }
    match node.node_type {
        WorkflowNodeType::Agent => advance_or_complete(state, node, None),
        WorkflowNodeType::HumanInLoop => {
            Decision::Transition(Transition::GateNode { node_row_id })
        }
    }
}
