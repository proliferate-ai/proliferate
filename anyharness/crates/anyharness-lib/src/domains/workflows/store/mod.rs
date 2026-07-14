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
    WorkflowRunFailureCode, WorkflowRunRecord, WorkflowRunStepRecord, WorkflowTurnOutcome,
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
                Some(existing) if existing.invocation_json == run.invocation_json => {
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
            steps::begin_step(
                conn,
                run_id,
                stage_index,
                step_index,
                started_at,
                &Self::now(),
            )
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
            steps::record_turn(conn, run_id, stage_index, step_index, turn_id, &Self::now())
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
    /// transaction. Previously terminal rows are left unchanged.
    pub fn fence_nonterminal_after_restart(&self, finished_at: &str) -> anyhow::Result<()> {
        let updated_at = Self::now();
        let code = WorkflowRunFailureCode::RuntimeRestarted;
        self.db.with_tx(|conn| {
            runs::fence_runs(conn, code, finished_at, &updated_at)?;
            steps::fence_steps(conn, code, finished_at, &updated_at)?;
            Ok(())
        })
    }
}
