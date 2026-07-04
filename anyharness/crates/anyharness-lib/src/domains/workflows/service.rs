use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::engine::{
    decide_after_step, CancelToken, EngineProgress, StepDecision, StepExecContext, StepOutcome,
    WorkflowStepExecutor,
};
use super::model::{WorkflowRunRecord, WorkflowStepRunRecord};
use super::plan::{self, OnTimeout, PlanError, StepKind};
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
                session_ids: Vec::new(),
                error_code: None,
                error_message: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            WorkflowStore::insert_run(tx, &run)?;
            for (index, step) in plan.steps.iter().enumerate() {
                let step_run = WorkflowStepRunRecord {
                    run_id: run_id.clone(),
                    step_index: index as i64,
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

    /// Record a session the run has opened (append-once, ordered).
    pub fn append_session_id(&self, run_id: &str, session_id: &str) -> anyhow::Result<()> {
        self.store.with_tx_anyhow(|tx| {
            let Some(mut run) = WorkflowStore::find_run_tx(tx, run_id)? else {
                return Ok(());
            };
            if run.session_ids.iter().any(|id| id == session_id) {
                return Ok(());
            }
            run.session_ids.push(session_id.to_string());
            run.updated_at = now();
            WorkflowStore::update_run(tx, &run)?;
            Ok(())
        })
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
    /// loop by the actor until the run suspends or terminates.
    pub async fn run_next_step(
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
        let progress = self.apply_decision(run_id, cursor, decision, plan.step_count())?;
        Ok(progress)
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
            (StepKind::HumanApproval(_), ApprovalInput::Approve) => StepDecision::Complete {
                output: serde_json::json!({ "approved": true }),
            },
            (StepKind::HumanApproval(human), ApprovalInput::Timeout) => match human.on_timeout {
                OnTimeout::Continue => StepDecision::Complete {
                    output: serde_json::json!({ "approved": false, "timedOut": true, "resolution": "continue" }),
                },
                OnTimeout::Fail => decide_after_step(
                    step.on_fail,
                    attempt,
                    failed_outcome("approval_timeout", "approval timed out"),
                ),
            },
            (StepKind::HumanApproval(_), ApprovalInput::Deny) => decide_after_step(
                step.on_fail,
                attempt,
                failed_outcome("approval_denied", "approval denied"),
            ),
            // An `agent.goal` step parked on a block: approve re-runs the step
            // (re-arm + continue waiting), deny/timeout fails per on_fail.
            (StepKind::AgentPrompt(_), ApprovalInput::Approve) => StepDecision::Retry,
            (StepKind::AgentPrompt(_), _) => decide_after_step(
                step.on_fail,
                attempt,
                failed_outcome("goal_blocked", "goal blocked and approval was denied"),
            ),
            _ => return Err(WorkflowServiceError::UnexpectedApprovalStep),
        };

        let progress = self.apply_decision(run_id, cursor, decision, plan.step_count())?;
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
        step_count: usize,
    ) -> anyhow::Result<EngineProgress> {
        self.store.with_tx_anyhow(|tx| {
            let now = now();
            let mut step = WorkflowStore::find_step_run_tx(tx, run_id, step_index)?
                .ok_or_else(|| anyhow::anyhow!("step run vanished mid-decision"))?;
            let mut run = WorkflowStore::find_run_tx(tx, run_id)?
                .ok_or_else(|| anyhow::anyhow!("run vanished mid-decision"))?;

            let progress = match decision {
                StepDecision::Complete { output } => {
                    finish_step(&mut step, WorkflowStepStatus::Completed, Some(output), None, None, &now);
                    advance_or_finish(&mut run, step_index, step_count, &now)
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
                    advance_or_finish(&mut run, step_index, step_count, &now)
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
            };

            WorkflowStore::update_step_run(tx, &step)?;
            WorkflowStore::update_run(tx, &run)?;
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

fn advance_or_finish(
    run: &mut WorkflowRunRecord,
    step_index: i64,
    step_count: usize,
    now: &str,
) -> EngineProgress {
    let next = step_index + 1;
    run.step_cursor = next;
    run.updated_at = now.to_string();
    if next as usize >= step_count {
        run.status = WorkflowRunStatus::Completed;
        EngineProgress::Finished(WorkflowRunStatus::Completed)
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

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
