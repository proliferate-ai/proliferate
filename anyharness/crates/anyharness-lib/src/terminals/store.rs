use chrono::Utc;
use rusqlite::{params, OptionalExtension};

use crate::persistence::Db;

use super::model::{
    TerminalCommandOutputMode, TerminalCommandRunRecord, TerminalCommandRunStatus, TerminalPurpose,
};

#[derive(Clone)]
pub struct TerminalStore {
    db: Db,
}

impl TerminalStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn insert_command_run(&self, record: &TerminalCommandRunRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO terminal_command_runs (
                    id, workspace_id, terminal_id, purpose, command, status, exit_code,
                    output_mode, stdout, stderr, combined_output, output_truncated,
                    started_at, completed_at, duration_ms, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    record.id,
                    record.workspace_id,
                    record.terminal_id,
                    purpose_to_db(record.purpose),
                    record.command,
                    status_to_db(record.status),
                    record.exit_code,
                    output_mode_to_db(record.output_mode),
                    record.stdout,
                    record.stderr,
                    record.combined_output,
                    if record.output_truncated { 1 } else { 0 },
                    record.started_at,
                    record.completed_at,
                    record.duration_ms.map(|value| value as i64),
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn update_command_run(&self, record: &TerminalCommandRunRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE terminal_command_runs
                 SET terminal_id = ?2,
                     status = ?3,
                     exit_code = ?4,
                     output_mode = ?5,
                     stdout = ?6,
                     stderr = ?7,
                     combined_output = ?8,
                     output_truncated = ?9,
                     started_at = ?10,
                     completed_at = ?11,
                     duration_ms = ?12,
                     updated_at = ?13
                 WHERE id = ?1",
                params![
                    record.id,
                    record.terminal_id,
                    status_to_db(record.status),
                    record.exit_code,
                    output_mode_to_db(record.output_mode),
                    record.stdout,
                    record.stderr,
                    record.combined_output,
                    if record.output_truncated { 1 } else { 0 },
                    record.started_at,
                    record.completed_at,
                    record.duration_ms.map(|value| value as i64),
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_command_run(&self, id: &str) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM terminal_command_runs WHERE id = ?1",
                [id],
                map_command_run_row,
            )
            .optional()
        })
    }

    pub fn latest_command_run_for_terminal(
        &self,
        terminal_id: &str,
    ) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM terminal_command_runs
                 WHERE terminal_id = ?1
                 ORDER BY created_at DESC
                 LIMIT 1",
                [terminal_id],
                map_command_run_row,
            )
            .optional()
        })
    }

    pub fn latest_setup_run(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT tcr.*
                 FROM workspace_setup_state wss
                 JOIN terminal_command_runs tcr ON tcr.id = wss.latest_command_run_id
                 WHERE wss.workspace_id = ?1",
                [workspace_id],
                map_command_run_row,
            )
            .optional()
        })
    }

    pub fn set_latest_setup_run(
        &self,
        workspace_id: &str,
        command_run_id: &str,
    ) -> anyhow::Result<()> {
        let now = Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspace_setup_state (workspace_id, latest_command_run_id, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    latest_command_run_id = excluded.latest_command_run_id,
                    updated_at = excluded.updated_at",
                params![workspace_id, command_run_id, now],
            )?;
            Ok(())
        })
    }

    pub fn mark_active_runs_failed_on_startup(&self) -> anyhow::Result<()> {
        let now = Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE terminal_command_runs
                 SET status = 'failed',
                     exit_code = -1,
                     stderr = CASE
                        WHEN output_mode = 'separate' THEN 'Runtime restarted before command completed'
                        ELSE stderr
                     END,
                     combined_output = CASE
                        WHEN output_mode = 'combined' THEN COALESCE(combined_output, '') || char(10) || 'Runtime restarted before command completed'
                        ELSE combined_output
                     END,
                     completed_at = ?1,
                     updated_at = ?1
                 WHERE status IN ('queued', 'running')",
                [now],
            )?;
            Ok(())
        })
    }

    pub fn prune_completed_non_setup_runs(&self, max_per_workspace: usize) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM terminal_command_runs
                 WHERE purpose != 'setup'
                   AND status NOT IN ('queued', 'running')
                   AND datetime(completed_at) < datetime('now', '-7 days')",
                [],
            )?;
            conn.execute(
                "DELETE FROM terminal_command_runs
                 WHERE purpose != 'setup'
                   AND status NOT IN ('queued', 'running')
                   AND id IN (
                       SELECT id FROM (
                           SELECT id,
                                  ROW_NUMBER() OVER (
                                      PARTITION BY workspace_id
                                      ORDER BY COALESCE(completed_at, updated_at) DESC
                                  ) AS rn
                           FROM terminal_command_runs
                           WHERE purpose != 'setup'
                             AND status NOT IN ('queued', 'running')
                       )
                       WHERE rn > ?1
                   )",
                [max_per_workspace as i64],
            )?;
            Ok(())
        })
    }
}

fn map_command_run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TerminalCommandRunRecord> {
    let duration_ms: Option<i64> = row.get("duration_ms")?;
    let output_truncated: i64 = row.get("output_truncated")?;
    Ok(TerminalCommandRunRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        terminal_id: row.get("terminal_id")?,
        purpose: purpose_from_db(row.get::<_, String>("purpose")?.as_str()),
        command: row.get("command")?,
        status: status_from_db(row.get::<_, String>("status")?.as_str()),
        exit_code: row.get("exit_code")?,
        output_mode: output_mode_from_db(row.get::<_, String>("output_mode")?.as_str()),
        stdout: row.get("stdout")?,
        stderr: row.get("stderr")?,
        combined_output: row.get("combined_output")?,
        output_truncated: output_truncated != 0,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        duration_ms: duration_ms.map(|value| value as u64),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn purpose_to_db(purpose: TerminalPurpose) -> &'static str {
    match purpose {
        TerminalPurpose::General => "general",
        TerminalPurpose::Run => "run",
        TerminalPurpose::Setup => "setup",
    }
}

fn purpose_from_db(value: &str) -> TerminalPurpose {
    match value {
        "run" => TerminalPurpose::Run,
        "setup" => TerminalPurpose::Setup,
        _ => TerminalPurpose::General,
    }
}

pub(super) fn status_to_db(status: TerminalCommandRunStatus) -> &'static str {
    match status {
        TerminalCommandRunStatus::Queued => "queued",
        TerminalCommandRunStatus::Running => "running",
        TerminalCommandRunStatus::Succeeded => "succeeded",
        TerminalCommandRunStatus::Failed => "failed",
        TerminalCommandRunStatus::Interrupted => "interrupted",
        TerminalCommandRunStatus::TimedOut => "timed_out",
    }
}

fn status_from_db(value: &str) -> TerminalCommandRunStatus {
    match value {
        "queued" => TerminalCommandRunStatus::Queued,
        "running" => TerminalCommandRunStatus::Running,
        "succeeded" => TerminalCommandRunStatus::Succeeded,
        "interrupted" => TerminalCommandRunStatus::Interrupted,
        "timed_out" => TerminalCommandRunStatus::TimedOut,
        _ => TerminalCommandRunStatus::Failed,
    }
}

fn output_mode_to_db(mode: TerminalCommandOutputMode) -> &'static str {
    match mode {
        TerminalCommandOutputMode::Separate => "separate",
        TerminalCommandOutputMode::Combined => "combined",
    }
}

fn output_mode_from_db(value: &str) -> TerminalCommandOutputMode {
    match value {
        "separate" => TerminalCommandOutputMode::Separate,
        _ => TerminalCommandOutputMode::Combined,
    }
}
