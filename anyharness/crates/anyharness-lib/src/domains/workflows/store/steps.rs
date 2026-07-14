//! Private row SQL and mapping for `workflow_run_steps`. Row fns take a
//! `&Connection` so several compose inside one transaction with the run rows.

use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use crate::domains::workflows::model::{
    WorkflowRunFailureCode, WorkflowRunStepRecord, WorkflowStepStatus,
};

use super::runs::parse_failure_code;

pub(super) fn insert_step(conn: &Connection, step: &WorkflowRunStepRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO workflow_run_steps (
            run_id, stage_index, step_index, status, prompt_id, turn_id, failure_code,
            created_at, updated_at, started_at, finished_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            step.run_id,
            step.stage_index,
            step.step_index,
            step.status.as_str(),
            step.prompt_id,
            step.turn_id,
            step.failure_code.map(WorkflowRunFailureCode::as_str),
            step.created_at,
            step.updated_at,
            step.started_at,
            step.finished_at,
        ],
    )?;
    Ok(())
}

pub(super) fn find_steps_for_run(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<Vec<WorkflowRunStepRecord>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM workflow_run_steps
         WHERE run_id = ?1
         ORDER BY stage_index ASC, step_index ASC",
    )?;
    let rows = stmt.query_map([run_id], map_step)?;
    rows.collect()
}

pub(super) fn find_step_by_prompt_id(
    conn: &Connection,
    prompt_id: &str,
) -> rusqlite::Result<Option<WorkflowRunStepRecord>> {
    conn.query_row(
        "SELECT * FROM workflow_run_steps WHERE prompt_id = ?1",
        [prompt_id],
        map_step,
    )
    .optional()
}

pub(super) fn begin_step(
    conn: &Connection,
    run_id: &str,
    stage_index: i64,
    step_index: i64,
    started_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_run_steps
         SET status = 'running', started_at = ?4, updated_at = ?5
         WHERE run_id = ?1 AND stage_index = ?2 AND step_index = ?3 AND status = 'pending'",
        params![run_id, stage_index, step_index, started_at, updated_at],
    )
}

pub(super) fn record_turn(
    conn: &Connection,
    run_id: &str,
    stage_index: i64,
    step_index: i64,
    turn_id: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    // Only a running row with a null or identical turn_id is touched; terminal
    // rows never change, so a completion's turn ID always wins over a late
    // post-send record.
    conn.execute(
        "UPDATE workflow_run_steps
         SET turn_id = ?4, updated_at = ?5
         WHERE run_id = ?1 AND stage_index = ?2 AND step_index = ?3
           AND status = 'running' AND (turn_id IS NULL OR turn_id = ?4)",
        params![run_id, stage_index, step_index, turn_id, updated_at],
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn terminalize_step(
    conn: &Connection,
    run_id: &str,
    stage_index: i64,
    step_index: i64,
    status: WorkflowStepStatus,
    failure_code: Option<WorkflowRunFailureCode>,
    turn_id: Option<&str>,
    finished_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_run_steps
         SET status = ?4, failure_code = ?5, turn_id = ?6, finished_at = ?7, updated_at = ?8
         WHERE run_id = ?1 AND stage_index = ?2 AND step_index = ?3",
        params![
            run_id,
            stage_index,
            step_index,
            status.as_str(),
            failure_code.map(WorkflowRunFailureCode::as_str),
            turn_id,
            finished_at,
            updated_at,
        ],
    )
}

pub(super) fn fail_nonterminal_steps(
    conn: &Connection,
    run_id: &str,
    failure_code: WorkflowRunFailureCode,
    finished_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_run_steps
         SET status = 'failed', failure_code = ?2, finished_at = ?3, updated_at = ?4
         WHERE run_id = ?1 AND status IN ('pending', 'running')",
        params![run_id, failure_code.as_str(), finished_at, updated_at],
    )
}

pub(super) fn fence_steps(
    conn: &Connection,
    failure_code: WorkflowRunFailureCode,
    finished_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_run_steps
         SET status = 'failed', failure_code = ?1, finished_at = ?2, updated_at = ?3
         WHERE status IN ('pending', 'running')",
        params![failure_code.as_str(), finished_at, updated_at],
    )
}

fn map_step(row: &Row<'_>) -> rusqlite::Result<WorkflowRunStepRecord> {
    Ok(WorkflowRunStepRecord {
        run_id: row.get("run_id")?,
        stage_index: row.get("stage_index")?,
        step_index: row.get("step_index")?,
        status: parse_status(row.get::<_, String>("status")?.as_str())?,
        prompt_id: row.get("prompt_id")?,
        turn_id: row.get("turn_id")?,
        failure_code: parse_failure_code(row.get::<_, Option<String>>("failure_code")?)?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

fn parse_status(value: &str) -> rusqlite::Result<WorkflowStepStatus> {
    WorkflowStepStatus::parse(value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown workflow step status: {value}").into(),
        )
    })
}
