//! [`WorkflowRunManager`] — the API-facing surface for workflow runs and the
//! owner of the live per-run actors. It is cheaply cloneable (all state behind
//! `Arc`, like [`LiveSessionManager`](crate::live::sessions::LiveSessionManager))
//! so it can be stored in `AppState`, cloned into spawned tasks, and shared by
//! every consumer.
//!
//! ## Crash-resume matrix (documented contract)
//!
//! On startup [`spawn_startup_pass`](WorkflowRunManager::spawn_startup_pass)
//! loads non-terminal runs and, per status:
//! - `running` → respawn an actor at the persisted cursor. The step at the
//!   cursor is re-entered: `run_next_step` bumps its attempt. Idempotency by
//!   kind — agent.prompt re-sends a NEW turn; agent.goal re-arms the goal and
//!   continues waiting; shell/scm re-execute; a step whose completion had
//!   already been persisted advanced the cursor in the same transaction, so a
//!   completed step is never re-run.
//! - `waiting_approval` → left parked (the durable approval survives as-is); the
//!   human.approval timeout timer is re-armed (fires immediately if its deadline
//!   already passed).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyharness_contract::v1::WorkflowRunStatus;

use super::actor::drive_run;
use super::executor::{WorkflowExecDeps, WorkflowStepExecutorImpl};
use crate::domains::workflows::engine::{CancelToken, EngineProgress};
use crate::domains::workflows::model::{WorkflowRunRecord, WorkflowStepRunRecord};
use crate::domains::workflows::plan;
use crate::domains::workflows::service::{ApprovalInput, WorkflowServiceError};

#[derive(Clone)]
pub struct WorkflowRunManager {
    deps: Arc<WorkflowExecDeps>,
    /// run_id -> cancel token for the live actor currently driving it.
    live: Arc<Mutex<HashMap<String, CancelToken>>>,
}

impl WorkflowRunManager {
    pub fn new(deps: Arc<WorkflowExecDeps>) -> Self {
        Self {
            deps,
            live: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    pub fn get_run(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Option<(WorkflowRunRecord, Vec<WorkflowStepRunRecord>)>> {
        self.deps.workflow_service.get_run_with_steps(run_id)
    }

    pub fn list_runs(
        &self,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.deps.workflow_service.list_runs(workspace_id)
    }

    // ---------------------------------------------------------------------
    // Delivery (idempotent on run_id)
    // ---------------------------------------------------------------------

    /// Deliver a resolved plan: create the run (idempotent on the plan's
    /// `run_id`) and, for a fresh non-terminal `running` run with no live actor,
    /// spawn one. A re-delivery returns the current record without double-driving.
    pub fn deliver(
        &self,
        plan_json: &str,
        workspace_id: &str,
    ) -> Result<WorkflowRunRecord, WorkflowServiceError> {
        if self
            .deps
            .workspace_runtime
            .get_workspace(workspace_id)?
            .is_none()
        {
            return Err(WorkflowServiceError::WorkspaceNotFound);
        }
        let (record, _created) = self
            .deps
            .workflow_service
            .create_run_idempotent(plan_json, workspace_id)?;

        if record.status == WorkflowRunStatus::Running && !self.is_live(&record.run_id) {
            self.spawn_actor(record.run_id.clone());
        }
        Ok(record)
    }

    // ---------------------------------------------------------------------
    // Control
    // ---------------------------------------------------------------------

    /// Cancel a run: signal the live actor (checked at the next step boundary),
    /// best-effort cancel the current session's in-flight turn, and mark the run
    /// cancelled directly when no actor is driving it (e.g. a parked approval).
    pub async fn cancel(&self, run_id: &str) -> Result<WorkflowRunRecord, WorkflowServiceError> {
        let run = self
            .deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        if run.is_terminal() {
            return Ok(run);
        }
        let live = {
            let guard = self.live.lock().unwrap();
            if let Some(token) = guard.get(run_id) {
                token.cancel();
                true
            } else {
                false
            }
        };
        if let Some(session_id) = run.current_session_id() {
            if let Some(handle) = self.deps.acp_manager.get_handle(session_id).await {
                handle.cancel().await;
            }
        }
        if !live {
            self.deps.workflow_service.mark_run_terminal(
                run_id,
                WorkflowRunStatus::Cancelled,
                None,
                None,
            )?;
        }
        self.deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)
    }

    /// Resolve a parked approval (approve/deny) and resume driving if that
    /// advanced the run.
    pub fn resolve_approval(
        &self,
        run_id: &str,
        approve: bool,
    ) -> Result<WorkflowRunRecord, WorkflowServiceError> {
        let input = if approve {
            ApprovalInput::Approve
        } else {
            ApprovalInput::Deny
        };
        self.resolve(run_id, input)?;
        self.deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)
    }

    fn resolve(&self, run_id: &str, input: ApprovalInput) -> Result<(), WorkflowServiceError> {
        let outcome = self
            .deps
            .workflow_service
            .resolve_pending_approval(run_id, input)?;
        if outcome.resume {
            self.spawn_actor(run_id.to_string());
        }
        Ok(())
    }

    // ---------------------------------------------------------------------
    // Startup resume
    // ---------------------------------------------------------------------

    pub fn spawn_startup_pass(self) {
        tokio::spawn(async move {
            let runs = match self.deps.workflow_service.list_non_terminal_runs() {
                Ok(runs) => runs,
                Err(error) => {
                    tracing::warn!(error = %error, "workflow resume: failed to load non-terminal runs");
                    return;
                }
            };
            for run in runs {
                match run.status {
                    WorkflowRunStatus::Running => self.spawn_actor(run.run_id.clone()),
                    WorkflowRunStatus::WaitingApproval => {
                        self.schedule_approval_timeout(&run.run_id)
                    }
                    _ => {}
                }
            }
        });
    }

    // ---------------------------------------------------------------------
    // Actor lifecycle
    // ---------------------------------------------------------------------

    fn is_live(&self, run_id: &str) -> bool {
        self.live.lock().unwrap().contains_key(run_id)
    }

    fn spawn_actor(&self, run_id: String) {
        let cancel = CancelToken::new();
        {
            let mut guard = self.live.lock().unwrap();
            if guard.contains_key(&run_id) {
                return;
            }
            guard.insert(run_id.clone(), cancel.clone());
        }
        let manager = self.clone();
        let deps = self.deps.clone();
        tokio::spawn(async move {
            let run = match deps.workflow_service.get_run(&run_id) {
                Ok(Some(run)) => run,
                _ => {
                    manager.forget(&run_id);
                    return;
                }
            };
            let plan = match plan::parse(&run.plan_json) {
                Ok(plan) => plan,
                Err(error) => {
                    let _ = deps.workflow_service.mark_run_terminal(
                        &run_id,
                        WorkflowRunStatus::Failed,
                        Some("bad_plan".to_string()),
                        Some(error.to_string()),
                    );
                    manager.forget(&run_id);
                    return;
                }
            };
            let executor = WorkflowStepExecutorImpl::new(
                deps.clone(),
                run_id.clone(),
                run.workspace_id.clone(),
                plan.setup.clone(),
            );
            executor.hydrate_from_run(&run);
            let progress =
                drive_run(&deps.workflow_service, &executor, &run_id, &cancel).await;
            manager.forget(&run_id);
            if matches!(progress, EngineProgress::SuspendedForApproval) {
                manager.schedule_approval_timeout(&run_id);
            }
        });
    }

    fn forget(&self, run_id: &str) {
        self.live.lock().unwrap().remove(run_id);
    }

    /// Arm (or re-arm) the human.approval timeout timer for a parked run, if the
    /// waiting step carries a deadline. Fires immediately when the deadline has
    /// already passed (crash-resume of an expired approval).
    fn schedule_approval_timeout(&self, run_id: &str) {
        let Ok(Some((run, steps))) = self.deps.workflow_service.get_run_with_steps(run_id) else {
            return;
        };
        if run.status != WorkflowRunStatus::WaitingApproval {
            return;
        }
        let Some(step) = steps.iter().find(|step| step.step_index == run.step_cursor) else {
            return;
        };
        let Some(output) = step.output_value() else {
            return;
        };
        if output.get("kind").and_then(|value| value.as_str()) != Some("human_approval") {
            return;
        }
        let Some(deadline_at) = output.get("deadline_at").and_then(|value| value.as_str()) else {
            return;
        };
        let Ok(deadline) = chrono::DateTime::parse_from_rfc3339(deadline_at) else {
            return;
        };
        let remaining = (deadline.with_timezone(&chrono::Utc) - chrono::Utc::now())
            .num_milliseconds()
            .max(0) as u64;
        let manager = self.clone();
        let run_id = run_id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(remaining)).await;
            if let Ok(Some(run)) = manager.deps.workflow_service.get_run(&run_id) {
                if run.status == WorkflowRunStatus::WaitingApproval {
                    if let Err(error) = manager.resolve(&run_id, ApprovalInput::Timeout) {
                        tracing::warn!(run_id, error = %error, "workflow approval timeout failed");
                    }
                }
            }
        });
    }
}
