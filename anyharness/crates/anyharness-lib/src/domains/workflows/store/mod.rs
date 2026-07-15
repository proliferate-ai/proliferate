//! Synchronous workflow SQL. The store owns atomic acceptance and every
//! guarded coupled transition; it never validates product input, calls
//! sessions, starts tasks, or awaits. Expected conditions (replay, terminal,
//! not-found, mismatch) are returned as `Ok` data. `updated_at` is store-owned
//! bookkeeping stamped on every write; domain-meaningful timestamps are passed
//! in.

mod runs;
mod steps;

use rusqlite::Connection;

use crate::domains::workflows::model::{
    WorkflowInterruptionCode, WorkflowRunFailureCode, WorkflowRunRecord, WorkflowRunStepRecord,
    WorkflowStepStatus, WorkflowTurnOutcome,
};
use crate::persistence::Db;

/// Result of an acceptance attempt against the run/step tables.
#[derive(Debug)]
pub enum StoreAcceptOutcome {
    /// The run did not exist; both rows were inserted in this transaction.
    Created,
    /// The run existed with an identical `invocation_json`; the current rows
    /// are returned unchanged.
    ExactReplay {
        run: WorkflowRunRecord,
        steps: Vec<WorkflowRunStepRecord>,
    },
    /// The run existed with a different `invocation_json`; nothing changed.
    Conflict,
}

/// Result of the atomic cancel-intent transaction (spec
/// workflow-run-control §5.1). Every variant except `Missing` carries the
/// post-transaction rows so the caller returns a truthful snapshot without a
/// second read.
#[derive(Debug)]
pub enum StoreCancelIntentOutcome {
    /// No run with this id exists.
    Missing,
    /// The run was already terminal; nothing changed.
    Terminal {
        run: WorkflowRunRecord,
        steps: Vec<WorkflowRunStepRecord>,
    },
    /// The materialized step was still pending: run and step terminalized as
    /// `cancelled` in this transaction — proof that no prompt was dispatched.
    CancelledBeforeDispatch {
        run: WorkflowRunRecord,
        steps: Vec<WorkflowRunStepRecord>,
    },
    /// The step is running: intent is durable (recorded now or previously);
    /// the run stays nonterminal awaiting correlated evidence or fencing.
    CancellationPending {
        run: WorkflowRunRecord,
        steps: Vec<WorkflowRunStepRecord>,
        session_id: Option<String>,
        turn_id: Option<String>,
    },
}

/// Result of a terminal completion attempt.
#[derive(Debug, PartialEq, Eq)]
pub enum FinishTurnStoreOutcome {
    /// Run and step were terminalized in this transaction.
    Terminalized,
    /// The same turn already terminalized the rows; idempotent no-op.
    Duplicate,
    /// No step matched the prompt ID.
    NotFound,
    /// Session or turn identity did not match; nothing changed.
    Mismatch,
}

#[derive(Clone)]
pub struct WorkflowRunStore {
    db: Db,
}

impl WorkflowRunStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    #[cfg(test)]
    pub(crate) fn db_for_tests(&self) -> &Db {
        &self.db
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    /// Accept run plus pending step atomically, or exactly replay, or conflict.
    /// The transaction contains no workspace, session, or live-runtime call.
    pub fn accept(
        &self,
        run: &WorkflowRunRecord,
        step: &WorkflowRunStepRecord,
    ) -> anyhow::Result<StoreAcceptOutcome> {
        self.db
            .with_tx(|conn| match runs::find_run(conn, &run.id)? {
                None => {
                    runs::insert_run(conn, run)?;
                    steps::insert_step(conn, step)?;
                    Ok(StoreAcceptOutcome::Created)
                }
                Some(existing)
                    if existing.schema_version == run.schema_version
                        && existing.invocation_json == run.invocation_json =>
                {
                    let steps = steps::find_steps_for_run(conn, &existing.id)?;
                    Ok(StoreAcceptOutcome::ExactReplay {
                        run: existing,
                        steps,
                    })
                }
                Some(_) => Ok(StoreAcceptOutcome::Conflict),
            })
    }

    /// The durable run and its steps, or `None` when the run is unknown.
    pub fn get(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Option<(WorkflowRunRecord, Vec<WorkflowRunStepRecord>)>> {
        self.db.with_conn(|conn| {
            let Some(run) = runs::find_run(conn, run_id)? else {
                return Ok(None);
            };
            let steps = steps::find_steps_for_run(conn, run_id)?;
            Ok(Some((run, steps)))
        })
    }

    /// CAS `accepted -> running`. `true` when the run moved.
    pub fn begin_run(&self, run_id: &str, started_at: &str) -> anyhow::Result<bool> {
        let updated = self
            .db
            .with_tx(|conn| runs::begin_run(conn, run_id, started_at, &Self::now()))?;
        Ok(updated > 0)
    }

    /// Persist the session id, only while running and still unbound.
    pub fn bind_session(&self, run_id: &str, session_id: &str) -> anyhow::Result<bool> {
        let updated = self
            .db
            .with_tx(|conn| runs::bind_session(conn, run_id, session_id, &Self::now()))?;
        Ok(updated > 0)
    }

    /// CAS the step `pending -> running`. `true` when the step moved.
    pub fn begin_step(
        &self,
        run_id: &str,
        stage_index: i64,
        step_index: i64,
        started_at: &str,
    ) -> anyhow::Result<bool> {
        let updated = self.db.with_tx(|conn| {
            let now = Self::now();
            let moved = steps::begin_step(conn, run_id, stage_index, step_index, started_at, &now)?;
            if moved > 0 {
                runs::bump_run_version(conn, run_id, &now)?;
            }
            Ok::<usize, rusqlite::Error>(moved)
        })?;
        Ok(updated > 0)
    }

    /// Record the turn id on a running step without overwriting terminal data.
    pub fn record_turn(
        &self,
        run_id: &str,
        stage_index: i64,
        step_index: i64,
        turn_id: &str,
    ) -> anyhow::Result<bool> {
        let updated = self.db.with_tx(|conn| {
            let now = Self::now();
            let moved = steps::record_turn(conn, run_id, stage_index, step_index, turn_id, &now)?;
            if moved > 0 {
                runs::bump_run_version(conn, run_id, &now)?;
            }
            Ok::<usize, rusqlite::Error>(moved)
        })?;
        Ok(updated > 0)
    }

    /// Terminalize run and step together for a completed/failed/cancelled turn,
    /// matched by exact session and prompt identity. All the terminal,
    /// duplicate, not-found, and mismatch decisions are structured `Ok` data.
    pub fn finish_turn(
        &self,
        session_id: &str,
        prompt_id: &str,
        turn_id: Option<&str>,
        outcome: WorkflowTurnOutcome,
        finished_at: &str,
    ) -> anyhow::Result<FinishTurnStoreOutcome> {
        let updated_at = Self::now();
        self.db.with_tx(|conn| {
            Ok(Self::finish_turn_tx(
                conn,
                session_id,
                prompt_id,
                turn_id,
                outcome,
                finished_at,
                &updated_at,
            )?)
        })
    }

    fn finish_turn_tx(
        conn: &Connection,
        session_id: &str,
        prompt_id: &str,
        turn_id: Option<&str>,
        outcome: WorkflowTurnOutcome,
        finished_at: &str,
        updated_at: &str,
    ) -> rusqlite::Result<FinishTurnStoreOutcome> {
        let Some(step) = steps::find_step_by_prompt_id(conn, prompt_id)? else {
            return Ok(FinishTurnStoreOutcome::NotFound);
        };
        let Some(run) = runs::find_run(conn, &step.run_id)? else {
            return Ok(FinishTurnStoreOutcome::NotFound);
        };

        // Exact session identity: a session-only match could terminalize a
        // workflow for an unrelated or queued turn.
        if run.session_id.as_deref() != Some(session_id) {
            return Ok(FinishTurnStoreOutcome::Mismatch);
        }

        let already_terminal = step.status.is_terminal() || run.status.is_terminal();
        if already_terminal {
            // A late/duplicate callback for the very same turn is idempotent;
            // anything else must not touch immutable terminal rows.
            if step.turn_id.as_deref() == turn_id {
                return Ok(FinishTurnStoreOutcome::Duplicate);
            }
            return Ok(FinishTurnStoreOutcome::Mismatch);
        }

        // Nonterminal: a conflicting, already-recorded, different turn id means
        // this completion is for a different turn.
        if let (Some(existing), Some(provided)) = (step.turn_id.as_deref(), turn_id) {
            if existing != provided {
                return Ok(FinishTurnStoreOutcome::Mismatch);
            }
        }

        let (run_status, step_status, failure_code) = outcome.terminal_states();
        // Fill a null turn id from the completion; a recorded id is preserved.
        let final_turn_id = step.turn_id.as_deref().or(turn_id);
        steps::terminalize_step(
            conn,
            &step.run_id,
            step.stage_index,
            step.step_index,
            step_status,
            failure_code,
            final_turn_id,
            finished_at,
            updated_at,
        )?;
        runs::terminalize_run(
            conn,
            &run.id,
            run_status,
            failure_code,
            finished_at,
            updated_at,
        )?;
        Ok(FinishTurnStoreOutcome::Terminalized)
    }

    /// Fail the run and its still-nonterminal step with the same code. Terminal
    /// rows are untouched by the guarded WHERE clauses.
    pub fn fail_nonterminal(
        &self,
        run_id: &str,
        failure_code: WorkflowRunFailureCode,
        finished_at: &str,
    ) -> anyhow::Result<()> {
        let updated_at = Self::now();
        self.db.with_tx(|conn| {
            runs::fail_nonterminal_run(conn, run_id, failure_code, finished_at, &updated_at)?;
            steps::fail_nonterminal_steps(conn, run_id, failure_code, finished_at, &updated_at)?;
            Ok(())
        })
    }

    /// Fence every nonterminal run and step after a restart, in one
    /// transaction: `interrupted` with run `interruption_code =
    /// runtime_restarted` and exactly one version increment per fenced run.
    /// Previously terminal rows are left unchanged.
    pub fn fence_nonterminal_after_restart(&self, finished_at: &str) -> anyhow::Result<()> {
        let updated_at = Self::now();
        self.db.with_tx(|conn| {
            runs::fence_runs(
                conn,
                WorkflowInterruptionCode::RuntimeRestarted,
                finished_at,
                &updated_at,
            )?;
            steps::fence_steps(conn, finished_at, &updated_at)?;
            Ok(())
        })
    }

    /// The atomic cancel-intent operation (spec workflow-run-control §5.1) in
    /// ONE transaction: record the first `cancel_requested_at` with one
    /// version increment; a still-pending step terminalizes run and step as
    /// `cancelled` atomically (still one increment); a running step leaves the
    /// last proven status. Repeated intent changes nothing. The transaction
    /// contains no session or live-runtime call.
    pub fn cancel_intent(
        &self,
        run_id: &str,
        cancel_requested_at: &str,
        finished_at: &str,
    ) -> anyhow::Result<StoreCancelIntentOutcome> {
        let updated_at = Self::now();
        self.db.with_tx(|conn| {
            let Some(run) = runs::find_run(conn, run_id)? else {
                return Ok(StoreCancelIntentOutcome::Missing);
            };
            if run.status.is_terminal() {
                let steps = steps::find_steps_for_run(conn, run_id)?;
                return Ok(StoreCancelIntentOutcome::Terminal { run, steps });
            }

            let steps_now = steps::find_steps_for_run(conn, run_id)?;
            let pending_step = steps_now
                .iter()
                .any(|step| step.status == WorkflowStepStatus::Pending);

            if pending_step {
                // Pre-dispatch proof: cancel run and step atomically. The one
                // run UPDATE both stamps the (first) intent and increments the
                // version exactly once for this coupled change.
                steps::cancel_pending_step(conn, run_id, finished_at, &updated_at)?;
                runs::cancel_run_before_dispatch(
                    conn,
                    run_id,
                    cancel_requested_at,
                    finished_at,
                    &updated_at,
                )?;
                let Some(run) = runs::find_run(conn, run_id)? else {
                    return Ok(StoreCancelIntentOutcome::Missing);
                };
                let steps = steps::find_steps_for_run(conn, run_id)?;
                return Ok(StoreCancelIntentOutcome::CancelledBeforeDispatch { run, steps });
            }

            // Running step: record the first intent only (repeat = no-op).
            runs::record_cancel_intent(conn, run_id, cancel_requested_at, &updated_at)?;
            let Some(run) = runs::find_run(conn, run_id)? else {
                return Ok(StoreCancelIntentOutcome::Missing);
            };
            let steps = steps::find_steps_for_run(conn, run_id)?;
            let session_id = run.session_id.clone();
            let turn_id = steps
                .iter()
                .find(|step| step.status == WorkflowStepStatus::Running)
                .and_then(|step| step.turn_id.clone());
            Ok(StoreCancelIntentOutcome::CancellationPending {
                run,
                steps,
                session_id,
                turn_id,
            })
        })
    }

    /// The opaque run key for a completion callback, looked up by exact
    /// session and prompt identity. The deterministic prompt ID is never
    /// parsed.
    pub fn find_run_id_by_session_and_prompt(
        &self,
        session_id: &str,
        prompt_id: &str,
    ) -> anyhow::Result<Option<String>> {
        self.db.with_conn(|conn| {
            let Some(step) = steps::find_step_by_prompt_id(conn, prompt_id)? else {
                return Ok(None);
            };
            let Some(run) = runs::find_run(conn, &step.run_id)? else {
                return Ok(None);
            };
            if run.session_id.as_deref() != Some(session_id) {
                return Ok(None);
            }
            Ok(Some(run.id))
        })
    }
}
