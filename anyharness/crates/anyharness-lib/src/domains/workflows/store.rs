use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::model::{
    run_status_from_db, run_status_to_db, step_status_from_db, step_status_to_db,
    WorkflowRunRecord, WorkflowStepRunRecord,
};
use crate::persistence::Db;

#[derive(Clone)]
pub struct WorkflowStore {
    db: Db,
}

impl WorkflowStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn with_tx_anyhow<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T>,
    {
        self.db.with_tx_anyhow(f)
    }

    pub fn find_run(&self, run_id: &str) -> anyhow::Result<Option<WorkflowRunRecord>> {
        self.db.with_conn(|conn| Self::find_run_tx(conn, run_id))
    }

    pub fn find_run_tx(
        tx: &Connection,
        run_id: &str,
    ) -> rusqlite::Result<Option<WorkflowRunRecord>> {
        tx.query_row(
            "SELECT * FROM workflow_runs WHERE run_id = ?1",
            [run_id],
            map_run,
        )
        .optional()
    }

    /// All runs, newest first. When `workspace_id` is set, scoped to it.
    pub fn list_runs(
        &self,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.db.with_conn(|conn| match workspace_id {
            Some(workspace_id) => {
                let mut stmt = conn.prepare(
                    "SELECT * FROM workflow_runs WHERE workspace_id = ?1
                     ORDER BY created_at DESC, rowid DESC",
                )?;
                let rows = stmt.query_map([workspace_id], map_run)?;
                rows.collect()
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT * FROM workflow_runs ORDER BY created_at DESC, rowid DESC",
                )?;
                let rows = stmt.query_map([], map_run)?;
                rows.collect()
            }
        })
    }

    /// Non-terminal runs, for crash-resume respawn on startup.
    pub fn list_non_terminal_runs(&self) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM workflow_runs
                 WHERE status IN ('running', 'waiting_approval')
                 ORDER BY created_at ASC, rowid ASC",
            )?;
            let rows = stmt.query_map([], map_run)?;
            rows.collect()
        })
    }

    pub fn insert_run(tx: &Connection, run: &WorkflowRunRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO workflow_runs (
                run_id, workflow_id, workflow_version_id, version_n, trigger_kind,
                target_mode, workspace_id, plan_json, status, step_cursor,
                session_ids_json, error_code, error_message, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                run.run_id,
                run.workflow_id,
                run.workflow_version_id,
                run.version_n,
                run.trigger_kind,
                run.target_mode,
                run.workspace_id,
                run.plan_json,
                run_status_to_db(run.status),
                run.step_cursor,
                encode_session_ids(&run.session_ids),
                run.error_code,
                run.error_message,
                run.created_at,
                run.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Persists the mutable run fields (status, cursor, sessions, error). The
    /// identity + plan columns are immutable after insert.
    pub fn update_run(tx: &Connection, run: &WorkflowRunRecord) -> rusqlite::Result<()> {
        tx.execute(
            "UPDATE workflow_runs
             SET status = ?2,
                 step_cursor = ?3,
                 session_ids_json = ?4,
                 error_code = ?5,
                 error_message = ?6,
                 updated_at = ?7
             WHERE run_id = ?1",
            params![
                run.run_id,
                run_status_to_db(run.status),
                run.step_cursor,
                encode_session_ids(&run.session_ids),
                run.error_code,
                run.error_message,
                run.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn find_step_runs(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Vec<WorkflowStepRunRecord>> {
        self.db.with_conn(|conn| Self::find_step_runs_tx(conn, run_id))
    }

    pub fn find_step_runs_tx(
        tx: &Connection,
        run_id: &str,
    ) -> rusqlite::Result<Vec<WorkflowStepRunRecord>> {
        let mut stmt = tx.prepare(
            "SELECT * FROM workflow_step_runs WHERE run_id = ?1 ORDER BY step_index ASC",
        )?;
        let rows = stmt.query_map([run_id], map_step_run)?;
        rows.collect()
    }

    pub fn find_step_run_tx(
        tx: &Connection,
        run_id: &str,
        step_index: i64,
    ) -> rusqlite::Result<Option<WorkflowStepRunRecord>> {
        tx.query_row(
            "SELECT * FROM workflow_step_runs WHERE run_id = ?1 AND step_index = ?2",
            params![run_id, step_index],
            map_step_run,
        )
        .optional()
    }

    pub fn insert_step_run(
        tx: &Connection,
        step: &WorkflowStepRunRecord,
    ) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO workflow_step_runs (
                run_id, step_index, step_key, kind, status, attempt, output_json, error_code,
                error_message, started_at, ended_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                step.run_id,
                step.step_index,
                step.step_key,
                step.kind,
                step_status_to_db(step.status),
                step.attempt,
                step.output_json,
                step.error_code,
                step.error_message,
                step.started_at,
                step.ended_at,
                step.created_at,
                step.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Record a workflow-injected turn (contract §5.2 / C10). Idempotent on the
    /// (session_id, turn_id) PK — a crash-resume re-send under the same turn is a
    /// no-op. Only prompt-bearing steps call this; shell steps write no row.
    pub fn insert_injection(
        &self,
        session_id: &str,
        turn_id: &str,
        run_id: &str,
        step_key: &str,
        kind: &str,
        label: &str,
        injected_text: &str,
        created_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO workflow_session_injections (
                    session_id, turn_id, run_id, step_key, kind, label, injected_text, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    session_id, turn_id, run_id, step_key, kind, label, injected_text, created_at
                ],
            )?;
            Ok(())
        })
    }

    /// The injection row for a session turn, if the turn was workflow-injected.
    /// Tier-1 tests + the steps checklist read through this.
    #[allow(clippy::type_complexity)]
    pub fn find_injection(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> anyhow::Result<Option<(String, String, String, String, String)>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT run_id, step_key, kind, label, injected_text
                 FROM workflow_session_injections WHERE session_id = ?1 AND turn_id = ?2",
                params![session_id, turn_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(Into::into)
        })
    }

    pub fn update_step_run(
        tx: &Connection,
        step: &WorkflowStepRunRecord,
    ) -> rusqlite::Result<()> {
        tx.execute(
            "UPDATE workflow_step_runs
             SET kind = ?3,
                 status = ?4,
                 attempt = ?5,
                 output_json = ?6,
                 error_code = ?7,
                 error_message = ?8,
                 started_at = ?9,
                 ended_at = ?10,
                 updated_at = ?11
             WHERE run_id = ?1 AND step_index = ?2",
            params![
                step.run_id,
                step.step_index,
                step.kind,
                step_status_to_db(step.status),
                step.attempt,
                step.output_json,
                step.error_code,
                step.error_message,
                step.started_at,
                step.ended_at,
                step.updated_at,
            ],
        )?;
        Ok(())
    }
}

fn encode_session_ids(session_ids: &std::collections::BTreeMap<String, String>) -> String {
    serde_json::to_string(session_ids).unwrap_or_else(|_| "{}".to_string())
}

/// Decode the slot-keyed session map. Tolerates a legacy JSON array (pre-B7
/// ordered list) by dropping it to an empty map — no run predates the hard cut
/// (E4), so this only guards against a hand-edited row.
fn decode_session_ids(raw: Option<String>) -> std::collections::BTreeMap<String, String> {
    raw.as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_default()
}

fn map_run(row: &Row<'_>) -> rusqlite::Result<WorkflowRunRecord> {
    let status_raw: String = row.get("status")?;
    let status = run_status_from_db(&status_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown workflow run status: {status_raw}").into(),
        )
    })?;
    Ok(WorkflowRunRecord {
        run_id: row.get("run_id")?,
        workflow_id: row.get("workflow_id")?,
        workflow_version_id: row.get("workflow_version_id")?,
        version_n: row.get("version_n")?,
        trigger_kind: row.get("trigger_kind")?,
        target_mode: row.get("target_mode")?,
        workspace_id: row.get("workspace_id")?,
        plan_json: row.get("plan_json")?,
        status,
        step_cursor: row.get("step_cursor")?,
        session_ids: decode_session_ids(row.get("session_ids_json")?),
        error_code: row.get("error_code")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_step_run(row: &Row<'_>) -> rusqlite::Result<WorkflowStepRunRecord> {
    let status_raw: String = row.get("status")?;
    let status = step_status_from_db(&status_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown workflow step status: {status_raw}").into(),
        )
    })?;
    Ok(WorkflowStepRunRecord {
        run_id: row.get("run_id")?,
        step_index: row.get("step_index")?,
        step_key: row.get("step_key")?,
        kind: row.get("kind")?,
        status,
        attempt: row.get("attempt")?,
        output_json: row.get("output_json")?,
        error_code: row.get("error_code")?,
        error_message: row.get("error_message")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
