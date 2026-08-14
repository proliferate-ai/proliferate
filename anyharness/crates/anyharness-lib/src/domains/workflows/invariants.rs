//! The invariant sweep: structural laws every committed run state must hold.
//! The store's transactions are written to preserve these; the sweep is the
//! tripwire that catches a violated law early — loudly in debug builds and
//! tests (panic), observably in release (`workflow.invariant_violation`).

use super::model::{WorkflowNodeKind, WorkflowNodeStatus, WorkflowRunStatus};
use super::transition::RunState;
use crate::observability::WORKFLOW_INVARIANT_VIOLATION_TRACING_TARGET;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvariantViolation {
    pub run_id: String,
    pub invariant: &'static str,
    pub detail: String,
}

/// Check every law against one run state. Empty means healthy.
pub fn sweep(state: &RunState) -> Vec<InvariantViolation> {
    let mut violations = Vec::new();
    let mut violate = |invariant: &'static str, detail: String| {
        violations.push(InvariantViolation {
            run_id: state.run.id.clone(),
            invariant,
            detail,
        });
    };

    let chain = state.effective_chain();

    // At most one effective chain node is active at a time. Adhoc nodes run
    // alongside the chain and are exempt.
    let active_chain: Vec<&str> = chain
        .iter()
        .filter(|node| node.status.is_active())
        .map(|node| node.id.as_str())
        .collect();
    if active_chain.len() > 1 {
        violate(
            "single_active_chain_node",
            format!("active chain nodes: {}", active_chain.join(", ")),
        );
    }

    // current_node_row_id points at a real row, and any active chain node IS
    // the current node.
    match state.run.current_node_row_id.as_deref() {
        None => {
            if !active_chain.is_empty() {
                violate(
                    "current_node_consistency",
                    format!(
                        "no current node but chain node {} is active",
                        active_chain.join(", ")
                    ),
                );
            }
        }
        Some(current_id) => match state.node(current_id) {
            None => violate(
                "current_node_consistency",
                format!("current_node_row_id {current_id} has no row"),
            ),
            Some(current) => {
                if current.kind == WorkflowNodeKind::Adhoc {
                    violate(
                        "current_node_consistency",
                        format!("current node {current_id} is adhoc"),
                    );
                }
                for id in &active_chain {
                    if *id != current_id {
                        violate(
                            "current_node_consistency",
                            format!("chain node {id} is active but current is {current_id}"),
                        );
                    }
                }
                // The run's status agrees with its current node's status.
                let expected = match state.run.status {
                    WorkflowRunStatus::Running => Some(WorkflowNodeStatus::Running),
                    WorkflowRunStatus::AwaitingHuman => Some(WorkflowNodeStatus::AwaitingHuman),
                    WorkflowRunStatus::Interrupted => Some(WorkflowNodeStatus::NeedsAttention),
                    WorkflowRunStatus::Completed | WorkflowRunStatus::Failed => None,
                };
                if let Some(expected) = expected {
                    if current.status != expected {
                        violate(
                            "run_node_status_agreement",
                            format!(
                                "run is {} but current node {current_id} is {}",
                                state.run.status.as_str(),
                                current.status.as_str()
                            ),
                        );
                    }
                }
            }
        },
    }

    // A completed run has no active chain nodes left.
    if state.run.status == WorkflowRunStatus::Completed && !active_chain.is_empty() {
        violate(
            "terminal_run_quiesced",
            format!(
                "completed run still has active chain nodes: {}",
                active_chain.join(", ")
            ),
        );
    }

    for node in &state.nodes {
        // A superseded row stays failed forever.
        if state
            .nodes
            .iter()
            .any(|other| other.replaces_node_row_id.as_deref() == Some(node.id.as_str()))
            && node.status != WorkflowNodeStatus::Failed
        {
            violate(
                "superseded_rows_stay_failed",
                format!(
                    "node {} was replaced but is {}",
                    node.id,
                    node.status.as_str()
                ),
            );
        }
        // Replacements inherit the replaced row's chain position.
        if let Some(replaced_id) = node.replaces_node_row_id.as_deref() {
            if let Some(replaced) = state.node(replaced_id) {
                if replaced.chain_index != node.chain_index {
                    violate(
                        "replacement_inherits_chain_index",
                        format!(
                            "replacement {} has chain_index {:?}, replaced {} has {:?}",
                            node.id, node.chain_index, replaced_id, replaced.chain_index
                        ),
                    );
                }
            }
        }
        // A session link means the node launched at least once.
        if node.session_id.is_some() && node.status == WorkflowNodeStatus::Pending {
            violate(
                "pending_nodes_unlinked",
                format!("pending node {} still holds a session link", node.id),
            );
        }
    }

    violations
}

/// The at-rest sweep: `sweep` plus laws that only hold BETWEEN engine steps.
/// AdvanceToNext legitimately commits a running-but-unlinked successor before
/// the stamp step links its session, so the post-transition sweep cannot check
/// this; boot-time rebuilds and tests observing a settled state can.
pub fn sweep_at_rest(state: &RunState) -> Vec<InvariantViolation> {
    let mut violations = sweep(state);
    for node in &state.nodes {
        // No running node without a linked session once the engine is at rest
        // (Ruling K's invariant law).
        if node.status == WorkflowNodeStatus::Running && node.session_id.is_none() {
            violations.push(InvariantViolation {
                run_id: state.run.id.clone(),
                invariant: "running_nodes_linked_at_rest",
                detail: format!("running node {} has no linked session", node.id),
            });
        }
    }
    violations
}

/// Emit each violation as a named error event; panic in debug builds and
/// tests so a broken law fails loudly where it happens.
pub fn report(violations: &[InvariantViolation]) {
    for violation in violations {
        tracing::error!(
            target: WORKFLOW_INVARIANT_VIOLATION_TRACING_TARGET,
            run_id = %violation.run_id,
            invariant = violation.invariant,
            detail = %violation.detail,
            "workflow invariant violated",
        );
    }
    debug_assert!(
        violations.is_empty(),
        "workflow invariant violations: {violations:?}"
    );
}
