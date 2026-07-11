//! Pure helpers shared by the workflow service's persistence transitions.
//! Moved verbatim out of `service.rs` (WS5a) to keep that file inside its
//! max-lines budget while the observation-outbox appends land there.

use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::engine::{EngineProgress, StepOutcome};
use super::model::{WorkflowRunRecord, WorkflowStepRunRecord};
use super::store::WorkflowStore;
use super::templates::StepOutputs;

pub(super) fn finish_step(
    step: &mut WorkflowStepRunRecord,
    status: WorkflowStepStatus,
    output: Option<serde_json::Value>,
    error_code: Option<String>,
    error_message: Option<String>,
    now: &str,
) {
    step.status = status;
    if let Some(output) = output {
        step.output_json = Some(output.to_string());
    }
    step.error_code = error_code;
    step.error_message = error_message;
    step.ended_at = Some(now.to_string());
    step.updated_at = now.to_string();
}

/// Mark every step after `after_index` (up to `step_count`) that has not yet
/// reached a terminal state as `skipped` — the tail a branch `end` cut off.
pub(super) fn skip_tail(
    tx: &rusqlite::Connection,
    run_id: &str,
    after_index: i64,
    step_count: usize,
    now: &str,
) -> anyhow::Result<()> {
    for index in (after_index + 1)..(step_count as i64) {
        if let Some(mut step) = WorkflowStore::find_step_run_tx(tx, run_id, index)? {
            if matches!(
                step.status,
                WorkflowStepStatus::Pending | WorkflowStepStatus::Running | WorkflowStepStatus::Waiting
            ) {
                step.status = WorkflowStepStatus::Skipped;
                step.ended_at = Some(now.to_string());
                step.updated_at = now.to_string();
                WorkflowStore::update_step_run(tx, &step)?;
            }
        }
    }
    Ok(())
}

pub(super) fn advance_or_finish(
    run: &mut WorkflowRunRecord,
    step_index: i64,
    boundary: usize,
    step_count: usize,
    now: &str,
) -> EngineProgress {
    let next = step_index + 1;
    run.step_cursor = next;
    run.updated_at = now.to_string();
    if next as usize >= step_count {
        run.status = WorkflowRunStatus::Completed;
        EngineProgress::Finished(WorkflowRunStatus::Completed)
    } else if next as usize >= boundary {
        // Segment done, but the plan continues (a parallel group follows): the
        // cursor now sits at the group's first step; hand off to the actor.
        run.status = WorkflowRunStatus::Running;
        EngineProgress::SegmentComplete
    } else {
        run.status = WorkflowRunStatus::Running;
        EngineProgress::Advanced
    }
}

pub(super) fn failed_outcome(code: &str, message: &str) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: Some(message.to_string()),
        output: None,
    }
}

/// Build the `{{steps[N].output.*}}` late-binding map from every step run that
/// has recorded an output (completed steps, plus failed-but-continued steps).
pub(super) fn build_outputs(step_runs: &[WorkflowStepRunRecord]) -> StepOutputs {
    let mut outputs = StepOutputs::new();
    for step in step_runs {
        if let Some(value) = step.output_value() {
            outputs.insert(step.step_index as usize, value);
        }
    }
    outputs
}

pub(super) fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Narrow a run's step outputs to those a parallel lane may reference (minor m1):
/// every PRE-GROUP output (flat index `< group_start`) plus the lane's OWN steps.
/// A sibling lane's output (index `>= group_start`, not in this lane) is dropped,
/// so a mis-crafted plan that references one resolves to nothing (fail closed)
/// instead of leaking across lanes. Pure — unit-tested directly.
pub(super) fn lane_visible_outputs(
    outputs: StepOutputs,
    group_start: usize,
    lane_step_indices: &[usize],
) -> StepOutputs {
    let own: std::collections::HashSet<usize> = lane_step_indices.iter().copied().collect();
    outputs
        .into_iter()
        .filter(|(idx, _)| *idx < group_start || own.contains(idx))
        .collect()
}
