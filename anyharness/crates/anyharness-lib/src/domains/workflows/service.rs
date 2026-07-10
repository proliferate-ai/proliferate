use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::engine::{
    decide_after_step, CancelToken, EngineProgress, StepDecision, StepExecContext, StepOutcome,
    WorkflowStepExecutor,
};
use super::model::{
    LaneStatus, WorkflowLaneCursorRecord, WorkflowRunRecord, WorkflowStepRunRecord,
};
use super::plan::{self, PlanError, PlanLane, PlanSegment, ResolvedPlan, StepKind};
use super::store::WorkflowStore;
use super::templates::{self, StepOutputs};

#[derive(Debug, thiserror::Error)]
pub enum WorkflowServiceError {
    #[error("workflow run not found")]
    RunNotFound,
    #[error("workspace not found")]
    WorkspaceNotFound,
    #[error(transparent)]
    InvalidPlan(#[from] PlanError),
    #[error("no pending approval on this run")]
    NoPendingApproval,
    #[error("unexpected step kind for approval resolution")]
    UnexpectedApprovalStep,
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

/// The input that resolves a parked approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalInput {
    Approve,
    Deny,
    Timeout,
}

/// The result of resolving an approval: how far the run got, and whether the
/// actor should resume driving the step loop.
#[derive(Debug, Clone)]
pub struct ApprovalOutcome {
    pub progress: EngineProgress,
    pub resume: bool,
}

/// How one lane of a parallel group came to rest (L30).
#[derive(Debug, Clone, PartialEq, Eq)]
enum LaneResult {
    Completed,
    Failed { code: String, message: Option<String> },
    Cancelled,
}

/// Where a lane resumes from on (re-)entry.
#[derive(Debug, Clone, PartialEq, Eq)]
enum LaneResume {
    /// Continue the lane at this 0-based lane-cursor index.
    Resume(i64),
    /// The lane already completed (crash-resume): run nothing.
    Done,
    /// The lane already failed (crash-resume): surface it to the join.
    Failed { code: String, message: Option<String> },
}

/// What driving one lane step decided for the lane's cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
enum LaneStep {
    /// Move the lane cursor to this index and keep driving.
    Advance(i64),
    /// Re-run the same lane step (cursor unchanged).
    Retry,
    /// The lane is done (all steps ran, or a branch `end` ended the lane).
    Completed,
    /// The lane hit a run-fatal decision; the join will fail the run.
    Failed { code: String, message: Option<String> },
}

/// Durable rules over the workflow tables: idempotent run creation, cursor
/// transitions, and the async step driver that runs one step through an injected
/// [`WorkflowStepExecutor`]. The service owns no live state — the executor is the
/// only seam to live execution, which keeps the cursor/on-fail logic testable.
#[derive(Clone)]
pub struct WorkflowService {
    store: WorkflowStore,
}

impl WorkflowService {
    pub fn new(store: WorkflowStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &WorkflowStore {
        &self.store
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    pub fn get_run(&self, run_id: &str) -> anyhow::Result<Option<WorkflowRunRecord>> {
        self.store.find_run(run_id)
    }

    pub fn get_run_with_steps(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Option<(WorkflowRunRecord, Vec<WorkflowStepRunRecord>)>> {
        let Some(run) = self.store.find_run(run_id)? else {
            return Ok(None);
        };
        let steps = self.store.find_step_runs(run_id)?;
        Ok(Some((run, steps)))
    }

    pub fn list_runs(
        &self,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.store.list_runs(workspace_id)
    }

    pub fn list_non_terminal_runs(&self) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.store.list_non_terminal_runs()
    }

    // ---------------------------------------------------------------------
    // Creation (idempotent on run_id — the delivery idempotency contract)
    // ---------------------------------------------------------------------

    /// Create the run + its pending step rows from a resolved plan. Idempotent:
    /// a re-delivery of a known `run_id` returns the current record untouched
    /// (the second element is `false`).
    pub fn create_run_idempotent(
        &self,
        plan_json: &str,
        workspace_id: &str,
    ) -> Result<(WorkflowRunRecord, bool), WorkflowServiceError> {
        let plan = plan::parse(plan_json)?;
        let run_id = plan.run_id.clone();
        let plan_json = plan_json.to_string();
        let workspace_id = workspace_id.to_string();
        let created = self.store.with_tx_anyhow(|tx| {
            if let Some(existing) = WorkflowStore::find_run_tx(tx, &run_id)? {
                return Ok((existing, false));
            }
            let now = now();
            let run = WorkflowRunRecord {
                run_id: run_id.clone(),
                workflow_id: plan.workflow_id.clone(),
                workflow_version_id: plan.workflow_version_id.clone(),
                version_n: plan.version_n,
                trigger_kind: plan.trigger_kind.clone(),
                target_mode: plan.target_mode.clone(),
                workspace_id: workspace_id.clone(),
                plan_json: plan_json.clone(),
                status: WorkflowRunStatus::Running,
                step_cursor: 0,
                session_ids: std::collections::BTreeMap::new(),
                error_code: None,
                error_message: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            WorkflowStore::insert_run(tx, &run)?;
            for (index, step) in plan.steps.iter().enumerate() {
                // v2 plans stamp a structured key; be resilient to a keyless
                // plan by synthesizing a unique flat key (the SQLite unique index
                // on (run_id, step_key) would otherwise collide on empty keys).
                let step_key = if step.key.is_empty() {
                    format!("0.-.{index}")
                } else {
                    step.key.clone()
                };
                let step_run = WorkflowStepRunRecord {
                    run_id: run_id.clone(),
                    step_index: index as i64,
                    step_key,
                    kind: step.kind_slug().to_string(),
                    status: WorkflowStepStatus::Pending,
                    attempt: 0,
                    output_json: None,
                    error_code: None,
                    error_message: None,
                    started_at: None,
                    ended_at: None,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                WorkflowStore::insert_step_run(tx, &step_run)?;
            }
            Ok((run, true))
        })?;
        Ok(created)
    }

    /// Record the session a slot is bound to for this run (B7 slot-keyed session
    /// map). Idempotent on the (slot, session) pair; a slot only ever maps to one
    /// live session for the run's lifetime.
    pub fn set_session_for_slot(
        &self,
        run_id: &str,
        slot: &str,
        session_id: &str,
    ) -> anyhow::Result<()> {
        self.store.with_tx_anyhow(|tx| {
            let Some(mut run) = WorkflowStore::find_run_tx(tx, run_id)? else {
                return Ok(());
            };
            if run.session_ids.get(slot).map(String::as_str) == Some(session_id) {
                return Ok(());
            }
            run.session_ids.insert(slot.to_string(), session_id.to_string());
            run.updated_at = now();
            WorkflowStore::update_run(tx, &run)?;
            Ok(())
        })
    }

    /// Stamp a workflow-injected turn into the injections index (contract §5.2 /
    /// C10). Written by the executor at send time, in the same family as
    /// `begin_step` (the executor owns both the step identity and the send).
    #[allow(clippy::too_many_arguments)]
    pub fn record_injection(
        &self,
        session_id: &str,
        turn_id: &str,
        run_id: &str,
        step_key: &str,
        kind: &str,
        label: &str,
        injected_text: &str,
    ) -> anyhow::Result<()> {
        self.store.insert_injection(
            session_id,
            turn_id,
            run_id,
            step_key,
            kind,
            label,
            injected_text,
            &now(),
        )
    }

    /// Upsert a live progress snapshot onto a RUNNING step's `output_json`
    /// (spec 3.6 live goal progress). No-op unless the step is still `running`,
    /// so a terminal write from the step driver is never clobbered by a late
    /// snapshot. The executor throttles unchanged snapshots before calling in.
    pub fn record_step_goal_progress(
        &self,
        run_id: &str,
        step_index: i64,
        output: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.store.with_tx_anyhow(|tx| {
            let Some(mut step) = WorkflowStore::find_step_run_tx(tx, run_id, step_index)? else {
                return Ok(());
            };
            if step.status != WorkflowStepStatus::Running {
                return Ok(());
            }
            step.output_json = Some(output.to_string());
            step.updated_at = now();
            WorkflowStore::update_step_run(tx, &step)?;
            Ok(())
        })
    }

    // ---------------------------------------------------------------------
    // The step driver
    // ---------------------------------------------------------------------

    /// Drive exactly one step of the run through the executor, persisting the
    /// step-run before and after, and return how far the run got. Called in a
    /// loop by the actor until the run suspends or terminates. Unbounded: the
    /// only boundary is the plan end (flat single-cursor driving).
    pub async fn run_next_step(
        &self,
        run_id: &str,
        executor: &dyn WorkflowStepExecutor,
        cancel: &CancelToken,
    ) -> Result<EngineProgress, WorkflowServiceError> {
        self.run_next_step_bounded(run_id, executor, cancel, usize::MAX)
            .await
    }

    /// Drive one sequential step, but treat `boundary` (an exclusive flat index)
    /// as the segment end (L30): advancing onto `boundary` — when it is short of
    /// the plan end — yields [`EngineProgress::SegmentComplete`] instead of
    /// completing the run, so the actor can hand off to the next segment (a
    /// parallel group). A flat run passes `usize::MAX` → boundary resolves to the
    /// plan length → behavior is byte-identical to the single-cursor engine.
    pub async fn run_next_step_bounded(
        &self,
        run_id: &str,
        executor: &dyn WorkflowStepExecutor,
        cancel: &CancelToken,
        boundary: usize,
    ) -> Result<EngineProgress, WorkflowServiceError> {
        let run = self.store.find_run(run_id)?.ok_or(WorkflowServiceError::RunNotFound)?;
        if run.is_terminal() {
            return Ok(EngineProgress::Finished(run.status));
        }
        if cancel.is_cancelled() {
            self.mark_run_terminal(run_id, WorkflowRunStatus::Cancelled, None, None)?;
            return Ok(EngineProgress::Finished(WorkflowRunStatus::Cancelled));
        }
        let plan = plan::parse(&run.plan_json)?;
        let cursor = run.step_cursor;
        let Some(step_def) = plan.step(cursor as usize) else {
            self.mark_run_terminal(run_id, WorkflowRunStatus::Completed, None, None)?;
            return Ok(EngineProgress::Finished(WorkflowRunStatus::Completed));
        };
        let step_runs = self.store.find_step_runs(run_id)?;
        let outputs = build_outputs(&step_runs);
        let existing = step_runs.iter().find(|step| step.step_index == cursor);
        let resumed_after_approval =
            existing.map(|step| step.status == WorkflowStepStatus::Waiting).unwrap_or(false);
        let attempt = existing.map(|step| step.attempt).unwrap_or(0) + 1;

        let resolved = templates::resolve_step(step_def, &outputs);
        self.begin_step(run_id, cursor, resolved.kind_slug(), attempt)?;

        let ctx = StepExecContext {
            run_id: run_id.to_string(),
            workspace_id: run.workspace_id.clone(),
            step_index: cursor as usize,
            attempt,
            resumed_after_approval,
        };
        let outcome = executor.execute_step(&resolved, &ctx).await;
        let decision = decide_after_step(resolved.on_fail, attempt, outcome);
        let step_count = plan.step_count();
        let boundary = boundary.min(step_count);
        let progress = self.apply_decision(run_id, cursor, decision, boundary, step_count)?;
        Ok(progress)
    }

    // ---------------------------------------------------------------------
    // Parallel groups (L30): concurrent per-lane driving + join
    // ---------------------------------------------------------------------

    /// Drive the parallel group the run's cursor currently sits in (L30). Each
    /// lane advances its own steps concurrently against its own per-lane cursor,
    /// through the SAME pure [`decide_after_step`] matrix; the join waits for
    /// every lane before advancing (D-031b: a sibling never kills in-flight lane
    /// work). On lane failure the run fails and the cursor stays at the group
    /// start so post-group steps never execute; on all-complete the cursor jumps
    /// to the group end.
    ///
    /// Concurrency choice (reported honestly): lanes run as concurrent futures
    /// joined on the actor's single task (`futures::future::join_all`), not
    /// spawned tokio tasks. The parallelism that matters — overlapping agent
    /// turns — is realized because each lane awaits its `execute_step`
    /// independently; meanwhile the shared SQLite store is touched only through
    /// synchronous `with_tx` calls, so lane bookkeeping is serialized by
    /// construction with no lock contention or `Send`/`'static` constraints on
    /// the executor trait object.
    pub async fn run_parallel_group(
        &self,
        run_id: &str,
        executor: &dyn WorkflowStepExecutor,
        cancel: &CancelToken,
    ) -> Result<EngineProgress, WorkflowServiceError> {
        let run = self.store.find_run(run_id)?.ok_or(WorkflowServiceError::RunNotFound)?;
        if run.is_terminal() {
            return Ok(EngineProgress::Finished(run.status));
        }
        if cancel.is_cancelled() {
            self.mark_run_terminal(run_id, WorkflowRunStatus::Cancelled, None, None)?;
            return Ok(EngineProgress::Finished(WorkflowRunStatus::Cancelled));
        }
        let plan = plan::parse(&run.plan_json)?;
        let step_count = plan.step_count();
        let cursor = run.step_cursor.max(0) as usize;
        let Some(PlanSegment::Parallel { node, start, end, lanes }) =
            plan.segment_containing(cursor)
        else {
            return Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "run_parallel_group called at a non-parallel cursor {cursor}"
            )));
        };
        let workspace_id = run.workspace_id.clone();

        // Drive every lane concurrently; the join awaits all of them (siblings
        // run to completion even after one fails — D-031b).
        let lane_futures = lanes.iter().map(|lane| {
            self.drive_lane(run_id, executor, cancel, node, start, lane, &plan, &workspace_id)
        });
        let results = futures::future::join_all(lane_futures).await;

        let mut first_failure: Option<(String, Option<String>)> = None;
        let mut any_cancelled = false;
        for result in results {
            match result? {
                LaneResult::Completed => {}
                LaneResult::Cancelled => any_cancelled = true,
                LaneResult::Failed { code, message } => {
                    if first_failure.is_none() {
                        first_failure = Some((code, message));
                    }
                }
            }
        }

        if let Some((code, message)) = first_failure {
            // D-031b join: a lane landed a run-fatal decision. Siblings have
            // already run to completion (join awaited them); the group's join now
            // fails the run. The cursor stays at the group start, so post-group
            // steps never execute.
            self.mark_run_terminal(run_id, WorkflowRunStatus::Failed, Some(code), message)?;
            return Ok(EngineProgress::Finished(WorkflowRunStatus::Failed));
        }
        if any_cancelled {
            self.mark_run_terminal(run_id, WorkflowRunStatus::Cancelled, None, None)?;
            return Ok(EngineProgress::Finished(WorkflowRunStatus::Cancelled));
        }
        // Clean join (M2b): every lane completed → merge each lane's branch back
        // into the run-level worktree in lane order BEFORE advancing the cursor,
        // so post-group steps + scm.open_pr see all lane work. A merge CONFLICT is
        // a legitimate, honest run failure (conflicting parallel work is never
        // silently dropped); a FAILED join never reaches here (we returned above),
        // so failed lanes' partial work is left in place for inspection.
        let lane_names: Vec<String> = lanes.iter().map(|lane| lane.name.clone()).collect();
        if let Err(outcome) = executor.merge_lanes_into_run_worktree(&lane_names).await {
            let (code, message) = match outcome {
                StepOutcome::Failed { code, message, .. } => (code, message),
                _ => ("lane_merge_failed".to_string(), None),
            };
            self.mark_run_terminal(run_id, WorkflowRunStatus::Failed, Some(code), message)?;
            return Ok(EngineProgress::Finished(WorkflowRunStatus::Failed));
        }
        // Every lane merged → advance the run cursor past the group.
        Ok(self.finish_parallel_group(run_id, end, step_count)?)
    }

    /// Drive one lane of a parallel group to its own terminal state, resuming
    /// from its persisted per-lane cursor. Reuses `begin_step` + the pure
    /// decision matrix; lane-cursor + step-run writes land atomically per step.
    #[allow(clippy::too_many_arguments)]
    async fn drive_lane(
        &self,
        run_id: &str,
        executor: &dyn WorkflowStepExecutor,
        cancel: &CancelToken,
        node: usize,
        group_start: usize,
        lane: &PlanLane,
        plan: &ResolvedPlan,
        workspace_id: &str,
    ) -> Result<LaneResult, WorkflowServiceError> {
        let node = node as i64;
        let mut idx = match self.load_or_init_lane_cursor(run_id, node, &lane.name)? {
            LaneResume::Done => return Ok(LaneResult::Completed),
            LaneResume::Failed { code, message } => {
                return Ok(LaneResult::Failed { code, message })
            }
            LaneResume::Resume(cursor) => cursor.max(0) as usize,
        };
        loop {
            if cancel.is_cancelled() {
                return Ok(LaneResult::Cancelled);
            }
            if idx >= lane.step_indices.len() {
                self.mark_lane_terminal(
                    run_id,
                    node,
                    &lane.name,
                    LaneStatus::Completed,
                    None,
                    None,
                    idx as i64,
                )?;
                return Ok(LaneResult::Completed);
            }
            let flat = lane.step_indices[idx];
            let step_def = &plan.steps[flat];
            let step_runs = self.store.find_step_runs(run_id)?;
            // minor m1 (defense in depth): a lane's template resolution may only
            // see PRE-GROUP outputs (flat index < group start) + its OWN steps.
            // The validator already forbids referencing a sibling lane's emit; this
            // filter makes a mis-crafted plan fail CLOSED (a stray sibling ref
            // resolves to nothing) rather than leaking a sibling lane's output.
            let outputs =
                lane_visible_outputs(build_outputs(&step_runs), group_start, &lane.step_indices);
            let existing = step_runs.iter().find(|step| step.step_index == flat as i64);
            let resumed_after_approval = existing
                .map(|step| step.status == WorkflowStepStatus::Waiting)
                .unwrap_or(false);
            let attempt = existing.map(|step| step.attempt).unwrap_or(0) + 1;
            let resolved = templates::resolve_step(step_def, &outputs);
            self.begin_step(run_id, flat as i64, resolved.kind_slug(), attempt)?;
            let ctx = StepExecContext {
                run_id: run_id.to_string(),
                workspace_id: workspace_id.to_string(),
                step_index: flat,
                attempt,
                resumed_after_approval,
            };
            let outcome = executor.execute_step(&resolved, &ctx).await;
            let decision = decide_after_step(resolved.on_fail, attempt, outcome);
            let action = self.apply_lane_decision(
                run_id,
                node,
                &lane.name,
                flat as i64,
                idx as i64,
                &lane.step_indices,
                decision,
            )?;
            // §3.7/L16: nudge after each applied lane transition (fire-and-forget).
            executor.on_step_transition();
            match action {
                LaneStep::Advance(next) => idx = next.max(0) as usize,
                LaneStep::Retry => { /* cursor unchanged; re-run the same step */ }
                LaneStep::Completed => return Ok(LaneResult::Completed),
                LaneStep::Failed { code, message } => {
                    return Ok(LaneResult::Failed { code, message })
                }
            }
        }
    }

    /// Read a lane's persisted cursor, initializing a fresh `running` row at 0 on
    /// first entry. A `completed`/`failed` lane short-circuits (crash-resume of a
    /// finished lane re-runs nothing — D-031 deny-path c).
    fn load_or_init_lane_cursor(
        &self,
        run_id: &str,
        node: i64,
        lane: &str,
    ) -> anyhow::Result<LaneResume> {
        self.store.with_tx_anyhow(|tx| {
            if let Some(record) = WorkflowStore::find_lane_cursor_tx(tx, run_id, node, lane)? {
                return Ok(match record.status {
                    LaneStatus::Completed => LaneResume::Done,
                    LaneStatus::Failed => LaneResume::Failed {
                        code: record.error_code.unwrap_or_else(|| "lane_failed".to_string()),
                        message: record.error_message,
                    },
                    LaneStatus::Running => LaneResume::Resume(record.cursor),
                });
            }
            let now = now();
            let record = WorkflowLaneCursorRecord {
                run_id: run_id.to_string(),
                node_index: node,
                lane: lane.to_string(),
                cursor: 0,
                status: LaneStatus::Running,
                error_code: None,
                error_message: None,
                created_at: now.clone(),
                updated_at: now,
            };
            WorkflowStore::upsert_lane_cursor_tx(tx, &record)?;
            Ok(LaneResume::Resume(0))
        })
    }

    fn mark_lane_terminal(
        &self,
        run_id: &str,
        node: i64,
        lane: &str,
        status: LaneStatus,
        error_code: Option<String>,
        error_message: Option<String>,
        cursor: i64,
    ) -> anyhow::Result<()> {
        self.store.with_tx_anyhow(|tx| {
            let now = now();
            let record = WorkflowLaneCursorRecord {
                run_id: run_id.to_string(),
                node_index: node,
                lane: lane.to_string(),
                cursor,
                status,
                error_code,
                error_message,
                created_at: now.clone(),
                updated_at: now,
            };
            WorkflowStore::upsert_lane_cursor_tx(tx, &record)?;
            Ok(())
        })
    }

    /// Apply one lane step's decision: persist the step-run AND the lane cursor in
    /// one transaction (so a crash-resume reads the lane exactly where it was).
    #[allow(clippy::too_many_arguments)]
    fn apply_lane_decision(
        &self,
        run_id: &str,
        node: i64,
        lane: &str,
        flat_index: i64,
        lane_idx: i64,
        lane_step_indices: &[usize],
        decision: StepDecision,
    ) -> anyhow::Result<LaneStep> {
        self.store.with_tx_anyhow(|tx| {
            let now = now();
            let mut step = WorkflowStore::find_step_run_tx(tx, run_id, flat_index)?
                .ok_or_else(|| anyhow::anyhow!("lane step run vanished mid-decision"))?;
            let lane_len = lane_step_indices.len() as i64;

            let (action, lane_status, lane_cursor, err_code, err_msg) = match decision {
                StepDecision::Complete { output } => {
                    finish_step(&mut step, WorkflowStepStatus::Completed, Some(output), None, None, &now);
                    (LaneStep::Advance(lane_idx + 1), LaneStatus::Running, lane_idx + 1, None, None)
                }
                StepDecision::Continue { code, message, output } => {
                    finish_step(&mut step, WorkflowStepStatus::Failed, output, Some(code), message, &now);
                    (LaneStep::Advance(lane_idx + 1), LaneStatus::Running, lane_idx + 1, None, None)
                }
                StepDecision::FailRun { code, message, output } => {
                    finish_step(&mut step, WorkflowStepStatus::Failed, output, Some(code.clone()), message.clone(), &now);
                    (
                        LaneStep::Failed { code: code.clone(), message: message.clone() },
                        LaneStatus::Failed,
                        lane_idx,
                        Some(code),
                        message,
                    )
                }
                StepDecision::Retry => {
                    step.status = WorkflowStepStatus::Pending;
                    step.ended_at = None;
                    step.error_code = None;
                    step.error_message = None;
                    step.updated_at = now.clone();
                    (LaneStep::Retry, LaneStatus::Running, lane_idx, None, None)
                }
                StepDecision::Suspend { descriptor } => {
                    // Durable approval is not supported inside a parallel lane
                    // (there is no single-cursor park to hang the run on); fail the
                    // lane honestly so the group's join surfaces it.
                    let code = "approval_in_lane_unsupported".to_string();
                    let message =
                        Some("approval/suspend is not supported inside a parallel lane".to_string());
                    finish_step(
                        &mut step,
                        WorkflowStepStatus::Failed,
                        Some(descriptor),
                        Some(code.clone()),
                        message.clone(),
                        &now,
                    );
                    (
                        LaneStep::Failed { code: code.clone(), message: message.clone() },
                        LaneStatus::Failed,
                        lane_idx,
                        Some(code),
                        message,
                    )
                }
                StepDecision::EndRun { output } => {
                    // A branch `end` inside a lane ends THE LANE (not the whole
                    // run): the step completes, the lane's remaining steps are
                    // skipped, and the lane joins as completed.
                    finish_step(&mut step, WorkflowStepStatus::Completed, Some(output), None, None, &now);
                    for &tail_flat in &lane_step_indices[(lane_idx as usize + 1).min(lane_step_indices.len())..] {
                        if let Some(mut tail) = WorkflowStore::find_step_run_tx(tx, run_id, tail_flat as i64)? {
                            if matches!(
                                tail.status,
                                WorkflowStepStatus::Pending
                                    | WorkflowStepStatus::Running
                                    | WorkflowStepStatus::Waiting
                            ) {
                                tail.status = WorkflowStepStatus::Skipped;
                                tail.ended_at = Some(now.clone());
                                tail.updated_at = now.clone();
                                WorkflowStore::update_step_run(tx, &tail)?;
                            }
                        }
                    }
                    (LaneStep::Completed, LaneStatus::Completed, lane_len, None, None)
                }
            };

            WorkflowStore::update_step_run(tx, &step)?;
            let record = WorkflowLaneCursorRecord {
                run_id: run_id.to_string(),
                node_index: node,
                lane: lane.to_string(),
                cursor: lane_cursor,
                status: lane_status,
                error_code: err_code,
                error_message: err_msg,
                created_at: now.clone(),
                updated_at: now,
            };
            WorkflowStore::upsert_lane_cursor_tx(tx, &record)?;
            Ok(action)
        })
    }

    /// Advance the run cursor past a joined parallel group. Completes the run when
    /// the group is the last segment, else yields `SegmentComplete`.
    fn finish_parallel_group(
        &self,
        run_id: &str,
        end: usize,
        step_count: usize,
    ) -> anyhow::Result<EngineProgress> {
        self.store.with_tx_anyhow(|tx| {
            let mut run = WorkflowStore::find_run_tx(tx, run_id)?
                .ok_or_else(|| anyhow::anyhow!("run vanished after parallel join"))?;
            let now = now();
            run.step_cursor = end as i64;
            run.updated_at = now;
            let progress = if end >= step_count {
                run.status = WorkflowRunStatus::Completed;
                EngineProgress::Finished(WorkflowRunStatus::Completed)
            } else {
                run.status = WorkflowRunStatus::Running;
                EngineProgress::SegmentComplete
            };
            WorkflowStore::update_run(tx, &run)?;
            Ok(progress)
        })
    }

    // ---------------------------------------------------------------------
    // Approval resolution
    // ---------------------------------------------------------------------

    /// Resolve the run's parked approval (approve/deny/timeout). Errors when the
    /// run is not currently `waiting_approval`.
    pub fn resolve_pending_approval(
        &self,
        run_id: &str,
        input: ApprovalInput,
    ) -> Result<ApprovalOutcome, WorkflowServiceError> {
        let run = self.store.find_run(run_id)?.ok_or(WorkflowServiceError::RunNotFound)?;
        if run.status != WorkflowRunStatus::WaitingApproval {
            return Err(WorkflowServiceError::NoPendingApproval);
        }
        let plan = plan::parse(&run.plan_json)?;
        let cursor = run.step_cursor;
        let step = plan
            .step(cursor as usize)
            .ok_or(WorkflowServiceError::UnexpectedApprovalStep)?;
        let step_run = self
            .store
            .with_tx_anyhow(|tx| Ok(WorkflowStore::find_step_run_tx(tx, run_id, cursor)?))?
            .ok_or(WorkflowServiceError::UnexpectedApprovalStep)?;
        let attempt = step_run.attempt;

        let decision = match (&step.kind, input) {
            // human.approval is removed (E1); the only park path left is a goal
            // step blocked with on_blocked=pause_for_approval, which keeps the
            // waiting_approval status. An `agent.goal` step parked on a block:
            // approve re-runs the step
            // (re-arm + continue waiting), deny/timeout fails per on_fail.
            (StepKind::AgentPrompt(_), ApprovalInput::Approve) => StepDecision::Retry,
            (StepKind::AgentPrompt(_), _) => decide_after_step(
                step.on_fail,
                attempt,
                failed_outcome("goal_blocked", "goal blocked and approval was denied"),
            ),
            _ => return Err(WorkflowServiceError::UnexpectedApprovalStep),
        };

        let step_count = plan.step_count();
        let progress = self.apply_decision(run_id, cursor, decision, step_count, step_count)?;
        let resume = matches!(progress, EngineProgress::Advanced);
        Ok(ApprovalOutcome { progress, resume })
    }

    // ---------------------------------------------------------------------
    // Persistence transitions (each atomic in one transaction)
    // ---------------------------------------------------------------------

    fn begin_step(
        &self,
        run_id: &str,
        step_index: i64,
        kind_slug: &str,
        attempt: i64,
    ) -> anyhow::Result<()> {
        self.store.with_tx_anyhow(|tx| {
            let now = now();
            if let Some(mut step) = WorkflowStore::find_step_run_tx(tx, run_id, step_index)? {
                step.status = WorkflowStepStatus::Running;
                step.attempt = attempt;
                step.kind = kind_slug.to_string();
                step.started_at = Some(now.clone());
                step.error_code = None;
                step.error_message = None;
                step.updated_at = now.clone();
                WorkflowStore::update_step_run(tx, &step)?;
            }
            if let Some(mut run) = WorkflowStore::find_run_tx(tx, run_id)? {
                run.status = WorkflowRunStatus::Running;
                run.error_code = None;
                run.error_message = None;
                run.updated_at = now;
                WorkflowStore::update_run(tx, &run)?;
            }
            Ok(())
        })
    }

    fn apply_decision(
        &self,
        run_id: &str,
        step_index: i64,
        decision: StepDecision,
        boundary: usize,
        step_count: usize,
    ) -> anyhow::Result<EngineProgress> {
        self.store.with_tx_anyhow(|tx| {
            let now = now();
            let mut step = WorkflowStore::find_step_run_tx(tx, run_id, step_index)?
                .ok_or_else(|| anyhow::anyhow!("step run vanished mid-decision"))?;
            let mut run = WorkflowStore::find_run_tx(tx, run_id)?
                .ok_or_else(|| anyhow::anyhow!("run vanished mid-decision"))?;

            let mut end_run = false;
            let progress = match decision {
                StepDecision::Complete { output } => {
                    finish_step(&mut step, WorkflowStepStatus::Completed, Some(output), None, None, &now);
                    advance_or_finish(&mut run, step_index, boundary, step_count, &now)
                }
                StepDecision::Continue {
                    code,
                    message,
                    output,
                } => {
                    finish_step(
                        &mut step,
                        WorkflowStepStatus::Failed,
                        output,
                        Some(code),
                        message,
                        &now,
                    );
                    advance_or_finish(&mut run, step_index, boundary, step_count, &now)
                }
                StepDecision::FailRun {
                    code,
                    message,
                    output,
                } => {
                    finish_step(
                        &mut step,
                        WorkflowStepStatus::Failed,
                        output,
                        Some(code.clone()),
                        message.clone(),
                        &now,
                    );
                    run.status = WorkflowRunStatus::Failed;
                    run.error_code = Some(code);
                    run.error_message = message;
                    run.updated_at = now.clone();
                    EngineProgress::Finished(WorkflowRunStatus::Failed)
                }
                StepDecision::Retry => {
                    step.status = WorkflowStepStatus::Pending;
                    step.ended_at = None;
                    step.error_code = None;
                    step.error_message = None;
                    step.updated_at = now.clone();
                    run.status = WorkflowRunStatus::Running;
                    run.updated_at = now.clone();
                    EngineProgress::Advanced
                }
                StepDecision::Suspend { descriptor } => {
                    step.status = WorkflowStepStatus::Waiting;
                    step.output_json = Some(descriptor.to_string());
                    step.ended_at = None;
                    step.updated_at = now.clone();
                    run.status = WorkflowRunStatus::WaitingApproval;
                    run.updated_at = now.clone();
                    EngineProgress::SuspendedForApproval
                }
                // Branch `end` (C11/E5): the branch step completes with its
                // taken-case output; the cursor jumps to the end; the run goes
                // terminal `completed`; every later step is marked `skipped`.
                StepDecision::EndRun { output } => {
                    finish_step(&mut step, WorkflowStepStatus::Completed, Some(output), None, None, &now);
                    run.step_cursor = step_count as i64;
                    run.status = WorkflowRunStatus::Completed;
                    run.updated_at = now.clone();
                    end_run = true;
                    EngineProgress::Finished(WorkflowRunStatus::Completed)
                }
            };

            WorkflowStore::update_step_run(tx, &step)?;
            WorkflowStore::update_run(tx, &run)?;
            // Skip the tail on an early end: mark every still-pending later step
            // `skipped` so the checklist reflects the branch short-circuit (E5).
            if end_run {
                skip_tail(tx, run_id, step_index, step_count, &now)?;
            }
            Ok(progress)
        })
    }

    /// Force a run to a terminal state (used for cancel/complete and by the
    /// run-level backstop). Idempotent for already-terminal runs.
    pub fn mark_run_terminal(
        &self,
        run_id: &str,
        status: WorkflowRunStatus,
        error_code: Option<String>,
        error_message: Option<String>,
    ) -> anyhow::Result<()> {
        self.store.with_tx_anyhow(|tx| {
            let Some(mut run) = WorkflowStore::find_run_tx(tx, run_id)? else {
                return Ok(());
            };
            if run.is_terminal() {
                return Ok(());
            }
            run.status = status;
            run.error_code = error_code;
            run.error_message = error_message;
            run.updated_at = now();
            WorkflowStore::update_run(tx, &run)?;
            Ok(())
        })
    }
}

fn finish_step(
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
fn skip_tail(
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

fn advance_or_finish(
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

fn failed_outcome(code: &str, message: &str) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: Some(message.to_string()),
        output: None,
    }
}

/// Build the `{{steps[N].output.*}}` late-binding map from every step run that
/// has recorded an output (completed steps, plus failed-but-continued steps).
fn build_outputs(step_runs: &[WorkflowStepRunRecord]) -> StepOutputs {
    let mut outputs = StepOutputs::new();
    for step in step_runs {
        if let Some(value) = step.output_value() {
            outputs.insert(step.step_index as usize, value);
        }
    }
    outputs
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

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
