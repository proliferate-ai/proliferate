//! Fan-in ledger CRUD (`workflow_run_node_sessions`, ruling F1), split out of
//! `store.rs` to keep that seam under its size ratchet. Every function is a
//! transaction-scoped helper the store calls inside its own commit, so a leg's
//! terminal stamp lands in the SAME transaction that flips its node.
//!
//! Until the definition grammar can express N > 1 legs, exactly one row exists
//! per node (leg_index 0): the representative session. These helpers therefore
//! reduce to no-ops-or-single-row updates for every real definition today.

use rusqlite::{params, Connection, Row};

use super::super::model::{WorkflowInterruptionCode, WorkflowLegStatus, WorkflowRunNodeSessionRecord};
use super::super::transition::Transition;

/// The fan-in ledger slice for one run's nodes, ordered by (node, leg).
pub(super) fn load_legs_tx(
    tx: &Connection,
    run_id: &str,
) -> anyhow::Result<Vec<WorkflowRunNodeSessionRecord>> {
    let mut statement = tx.prepare(
        "SELECT node_row_id, leg_index, session_id, status, completed_at
         FROM workflow_run_node_sessions
         WHERE node_row_id IN (SELECT id FROM workflow_run_nodes WHERE run_id = ?1)
         ORDER BY node_row_id, leg_index",
    )?;
    let legs = statement
        .query_map(params![run_id], map_leg)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(legs)
}

/// Insert (or reset, on relaunch of the same node row) the representative leg
/// at launch, in the transaction that stamps the node's scalar session. Resume
/// re-runs the same node_row_id with a fresh session, so the upsert resets the
/// leg to running rather than colliding on UNIQUE(node_row_id, leg_index).
pub(super) fn upsert_leg_tx(
    tx: &Connection,
    node_row_id: &str,
    session_id: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO workflow_run_node_sessions
            (node_row_id, leg_index, session_id, status, completed_at)
         VALUES (?1, 0, ?2, 'running', NULL)
         ON CONFLICT(node_row_id, leg_index) DO UPDATE SET
            session_id = excluded.session_id, status = 'running', completed_at = NULL",
        params![node_row_id, session_id],
    )?;
    Ok(())
}

/// Stamp one leg terminal, keyed by (node_row_id, session_id); a `None` session
/// marks every leg of the node (the one-leg path, where the finishing session
/// is the only leg and may not be carried on the event).
pub(super) fn mark_leg_terminal_tx(
    tx: &Connection,
    node_row_id: &str,
    session_id: Option<&str>,
    status: WorkflowLegStatus,
    timestamp: &str,
) -> rusqlite::Result<()> {
    match session_id {
        Some(session_id) => tx.execute(
            "UPDATE workflow_run_node_sessions SET status = ?3, completed_at = ?4
             WHERE node_row_id = ?1 AND session_id = ?2",
            params![node_row_id, session_id, status.as_str(), timestamp],
        ),
        None => tx.execute(
            "UPDATE workflow_run_node_sessions SET status = ?2, completed_at = ?3
             WHERE node_row_id = ?1",
            params![node_row_id, status.as_str(), timestamp],
        ),
    }?;
    Ok(())
}

/// A cancel is run-terminal: every leg still running anywhere in the run —
/// current chain node or adhoc row — is stamped cancelled in the same commit.
/// Cancel disposes every Running row's session (chain and adhoc alike), so
/// stamping only the current node would leave a disposed adhoc session's leg
/// 'running' forever (delta-review finding on this rung). Already-terminal
/// legs keep their status and completion time.
pub(super) fn cancel_all_run_legs_tx(
    tx: &Connection,
    run_id: &str,
    timestamp: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_node_sessions SET status = ?2, completed_at = ?3
         WHERE status = ?4
           AND node_row_id IN (SELECT id FROM workflow_run_nodes WHERE run_id = ?1)",
        params![
            run_id,
            WorkflowLegStatus::Cancelled.as_str(),
            timestamp,
            WorkflowLegStatus::Running.as_str()
        ],
    )?;
    Ok(())
}

/// The undo-window stamp for a PARALLEL node only (ruling F3): the stamp lands
/// in the completing commit, not per report. A one-leg node keeps the per-report
/// stamp (`store::note_first_turn_finished`), so this is a no-op there (first ==
/// last), keeping observable behavior byte-identical.
pub(super) fn stamp_first_turn_if_parallel_tx(
    tx: &Connection,
    node_row_id: &str,
    timestamp: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_nodes SET first_turn_finished_at = ?2
         WHERE id = ?1 AND first_turn_finished_at IS NULL
           AND (SELECT COUNT(*) FROM workflow_run_node_sessions WHERE node_row_id = ?1) > 1",
        params![node_row_id, timestamp],
    )?;
    Ok(())
}

/// The (node, terminal leg status) a transition stamps into the ledger, or
/// `None` for transitions that touch no leg. Turn-finish transitions and their
/// command-driven twins (approve/flip advance) resolve exactly one leg.
pub(super) fn finished_leg_of(transition: &Transition) -> Option<(&str, WorkflowLegStatus)> {
    match transition {
        Transition::RecordLegThenHold {
            node_row_id,
            leg_status,
            ..
        } => Some((node_row_id, *leg_status)),
        Transition::AdvanceToNext {
            completed_node_row_id,
            ..
        }
        | Transition::CompleteRun {
            completed_node_row_id,
            ..
        } => Some((completed_node_row_id, WorkflowLegStatus::Done)),
        Transition::GateNode { node_row_id } => Some((node_row_id, WorkflowLegStatus::Done)),
        Transition::FailNode { node_row_id, code } => {
            Some((node_row_id, WorkflowLegStatus::Failed(*code)))
        }
        Transition::InterruptNode { node_row_id, code } => Some((
            node_row_id,
            match code {
                WorkflowInterruptionCode::UserCancel => WorkflowLegStatus::Cancelled,
                _ => WorkflowLegStatus::ForcedUnload,
            },
        )),
        // Cancel is absent here on purpose: it is run-terminal, not
        // node-terminal, and the store stamps it via `cancel_all_run_legs_tx`.
        _ => None,
    }
}

fn map_leg(row: &Row<'_>) -> rusqlite::Result<WorkflowRunNodeSessionRecord> {
    let status: String = row.get("status")?;
    Ok(WorkflowRunNodeSessionRecord {
        node_row_id: row.get("node_row_id")?,
        leg_index: row.get("leg_index")?,
        session_id: row.get("session_id")?,
        status: WorkflowLegStatus::parse(&status).unwrap_or(WorkflowLegStatus::Running),
        completed_at: row.get("completed_at")?,
    })
}
