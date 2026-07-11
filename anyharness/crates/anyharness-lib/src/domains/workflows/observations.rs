//! Observation outbox snapshot builder (WS5a, feature spec §5.4).
//!
//! Every meaningful run/step state transition appends the NEXT revision to the
//! `workflow_observations` outbox as an immutable row holding a WHOLE
//! [`ObservedRun`] snapshot (the WS1 contract shape), serialized once and
//! stored verbatim — replay returns identical bytes. The append happens inside
//! the SAME transaction as the state change ([`append_in_tx`]), so a revision
//! can never observe state the ledger doesn't hold, and revisions are strictly
//! sequential with no skips.
//!
//! ## Field mapping (current run view -> ObservedRun v2)
//!
//! - `plan_hash` / `binding_hash` / `execution_generation`: the run row's
//!   delivery identity. A legacy run (delivered without identity, pre-WS2c)
//!   snapshots as `""` / `""` / `0` — the contract fields are required, and
//!   these sentinels are unambiguous because a real hash is `sha256:…` and a
//!   real generation is `>= 1`. WS5c's reporter only sends identity-bearing
//!   runs upstream.
//! - `observed_state`: the run status DB slug (`running`, `waiting_approval`,
//!   `completed`, `failed`, `cancelled`).
//! - `quiescence_state`: `quiescent` for a terminal run, `waiting` for a run
//!   parked on approval, else `active`.
//! - `global_cursor`: the STORED step key of the step at `step_cursor`
//!   (the plan-carried `"<node>.<lane>.<step>"` grammar — the same stable key
//!   the step-run rows and injections index use), or the sentinel `"end"` once
//!   the cursor is past the plan. We deliberately reuse the plan's step-key
//!   strings rather than inventing new ids: they are the run's only stable,
//!   durable step identity today, and WS2c/WS9a translate key grammars at the
//!   server boundary if the fixture's `root::…` grammar is required upstream.
//! - `lane_cursors`: lane name -> the stored step key at that lane's cursor
//!   (or `"end"` for a finished lane), derived from `workflow_lane_cursors`
//!   joined against the step-run keys (parsed with
//!   [`super::plan::parse_lane_key`]); empty for flat runs.
//! - `steps`: one [`ObservedStep`] per step-run row in step order — stable
//!   step key, attempt, status (`waiting` maps to `running`: a parked approval
//!   is in-progress, not terminal; the run-level `waiting_approval` state
//!   carries the park), output, typed error.
//! - `sessions`: the slot-keyed session map, verbatim (B7).
//! - `worktrees`: empty in WS5a — checkpoint identities are WS6's; the shape
//!   is carried so the snapshot schema is stable.
//! - `cost`: zeros in WS5a — runtime SQLite does not own cost summaries yet
//!   (late cost reconciliation is append-only server-side, spec §5.4).
//! - `timing`: run `created_at` / `updated_at`.

use std::collections::BTreeMap;

use anyharness_contract::v1::workflows_v2::{
    ObservedCost, ObservedRun, ObservedStep, ObservedStepStatus, ObservedTiming,
    ObservedWorktrees, SchemaVersion,
};
use anyharness_contract::v1::WorkflowStepStatus;
use rusqlite::Connection;

use super::model::{
    run_status_to_db, LaneStatus, WorkflowLaneCursorRecord, WorkflowRunRecord,
    WorkflowStepRunRecord,
};
use super::plan::parse_lane_key;
use super::store::WorkflowStore;

/// The cursor sentinel for "past the end" (run complete / lane complete).
const CURSOR_END: &str = "end";

/// Append the next observation revision for `run_id` inside the caller's
/// transaction, snapshotting the run exactly as the ledger now holds it.
/// Call AFTER the state writes of the transition, in the SAME transaction.
/// A missing run is a no-op (idempotent transitions on vanished runs stay
/// no-ops). Returns the appended revision, if any.
pub(super) fn append_in_tx(tx: &Connection, run_id: &str) -> anyhow::Result<Option<i64>> {
    let Some(run) = WorkflowStore::find_run_tx(tx, run_id)? else {
        return Ok(None);
    };
    let steps = WorkflowStore::find_step_runs_tx(tx, run_id)?;
    let lanes = WorkflowStore::list_lane_cursors_tx(tx, run_id)?;
    let revision = WorkflowStore::next_observation_revision_tx(tx, run_id)?;
    let snapshot = build_observed_run(&run, &steps, &lanes, revision);
    let canonical = serde_json::to_string(&snapshot)?;
    let record = super::model::WorkflowObservationRecord {
        run_id: run_id.to_string(),
        revision,
        canonical_snapshot_json: canonical,
        created_at: chrono::Utc::now().to_rfc3339(),
        acked: false,
    };
    WorkflowStore::insert_observation_at_revision_tx(tx, &record)?;
    Ok(Some(revision))
}

/// Build the whole [`ObservedRun`] snapshot from the persisted run view.
/// Pure — unit-tested directly.
pub(super) fn build_observed_run(
    run: &WorkflowRunRecord,
    steps: &[WorkflowStepRunRecord],
    lanes: &[WorkflowLaneCursorRecord],
    revision: i64,
) -> ObservedRun {
    ObservedRun {
        schema_version: SchemaVersion::<2>,
        run_id: run.run_id.clone(),
        plan_hash: run.plan_hash.clone().unwrap_or_default(),
        binding_hash: run.binding_hash.clone().unwrap_or_default(),
        execution_generation: run.execution_generation.unwrap_or(0),
        revision,
        observed_state: run_status_to_db(run.status).to_string(),
        quiescence_state: quiescence_state(run).to_string(),
        global_cursor: global_cursor(run, steps),
        lane_cursors: lane_cursors(steps, lanes),
        sessions: run.session_ids.clone(),
        steps: steps.iter().map(observed_step).collect(),
        worktrees: ObservedWorktrees {
            group_base_checkpoint_id: None,
            lane_checkpoints: None,
        },
        cost: ObservedCost {
            usd: "0".to_string(),
            tokens: 0,
        },
        timing: ObservedTiming {
            started_at: run.created_at.clone(),
            updated_at: run.updated_at.clone(),
        },
    }
}

fn quiescence_state(run: &WorkflowRunRecord) -> &'static str {
    if run.is_terminal() {
        "quiescent"
    } else if run.status == anyharness_contract::v1::WorkflowRunStatus::WaitingApproval {
        "waiting"
    } else {
        "active"
    }
}

fn global_cursor(run: &WorkflowRunRecord, steps: &[WorkflowStepRunRecord]) -> String {
    steps
        .iter()
        .find(|step| step.step_index == run.step_cursor)
        .map(|step| step.step_key.clone())
        .unwrap_or_else(|| CURSOR_END.to_string())
}

/// lane name -> the stable step key the lane's cursor sits at (its own
/// `cursor`-th step, resolved through the step keys' lane grammar), or `"end"`
/// once the lane finished. Empty map for flat runs.
fn lane_cursors(
    steps: &[WorkflowStepRunRecord],
    lanes: &[WorkflowLaneCursorRecord],
) -> BTreeMap<String, String> {
    lanes
        .iter()
        .map(|lane| {
            let key = if lane.status == LaneStatus::Running {
                lane_step_key(steps, lane.node_index, &lane.lane, lane.cursor)
            } else {
                None
            };
            (
                lane.lane.clone(),
                key.unwrap_or_else(|| CURSOR_END.to_string()),
            )
        })
        .collect()
}

/// The stored step key of a lane's `cursor`-th own step (0-based within the
/// lane), found by parsing each step's structured key.
fn lane_step_key(
    steps: &[WorkflowStepRunRecord],
    node: i64,
    lane: &str,
    cursor: i64,
) -> Option<String> {
    steps
        .iter()
        .filter(|step| {
            parse_lane_key(&step.step_key)
                .map(|key| key.node as i64 == node && key.lane == lane)
                .unwrap_or(false)
        })
        .nth(cursor.max(0) as usize)
        .map(|step| step.step_key.clone())
}

fn observed_step(step: &WorkflowStepRunRecord) -> ObservedStep {
    ObservedStep {
        step_key: step.step_key.clone(),
        attempt: step.attempt,
        status: observed_step_status(step.status),
        output: step.output_value(),
        error_code: step.error_code.clone(),
        error_message: step.error_message.clone(),
    }
}

/// Step status mapping. `waiting` (a parked approval) maps to `running`: the
/// step is in-progress, not terminal, and the observed run-level
/// `waiting_approval` state carries the park. `outcome_uncertain` arrives with
/// WS5b's effect policies (it is a typed FAILURE code today, and the error
/// code survives on the observed step).
fn observed_step_status(status: WorkflowStepStatus) -> ObservedStepStatus {
    match status {
        WorkflowStepStatus::Pending => ObservedStepStatus::Pending,
        WorkflowStepStatus::Running | WorkflowStepStatus::Waiting => ObservedStepStatus::Running,
        WorkflowStepStatus::Completed => ObservedStepStatus::Completed,
        WorkflowStepStatus::Failed => ObservedStepStatus::Failed,
        WorkflowStepStatus::Skipped => ObservedStepStatus::Skipped,
    }
}
