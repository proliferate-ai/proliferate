//! Private row SQL and mapping for `workflow_runs`. Every fn takes a
//! `&Connection` so the store's tier-1 methods can compose several row writes
//! inside one transaction. Nothing here validates product input.

use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use crate::domains::workflows::model::{
    WorkflowInterruptionCode, WorkflowRunFailureCode, WorkflowRunRecord, WorkflowRunStatus,
};

pub(super) fn insert_run(conn: &Connection, run: &WorkflowRunRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO workflow_runs (
            id, schema_version, invocation_json, resolved_plan_json, status,
            workspace_id, session_id, failure_code, state_version,
            cancel_requested_at, interruption_code, created_at, updated_at,
            started_at, finished_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            run.id,
            run.schema_version,
            run.invocation_json,
            run.resolved_plan_json,
            run.status.as_str(),
            run.workspace_id,
            run.session_id,
            run.failure_code.map(WorkflowRunFailureCode::as_str),
            run.state_version,
            run.cancel_requested_at,
            run.interruption_code.map(WorkflowInterruptionCode::as_str),
            run.created_at,
            run.updated_at,
            run.started_at,
            run.finished_at,
        ],
    )?;
    Ok(())
}

pub(super) fn find_run(
    conn: &Connection,
    run_id: &str,
) -> rusqlite::Result<Option<WorkflowRunRecord>> {
    conn.query_row(
        "SELECT * FROM workflow_runs WHERE id = ?1",
        [run_id],
        map_run,
    )
    .optional()
}

pub(super) fn begin_run(
    conn: &Connection,
    run_id: &str,
    started_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET status = 'running', started_at = ?2, updated_at = ?3,
             state_version = state_version + 1
         WHERE id = ?1 AND status = 'accepted'",
        params![run_id, started_at, updated_at],
    )
}

pub(super) fn bind_session(
    conn: &Connection,
    run_id: &str,
    session_id: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET session_id = ?2, updated_at = ?3,
             state_version = state_version + 1
         WHERE id = ?1 AND status = 'running' AND session_id IS NULL",
        params![run_id, session_id, updated_at],
    )
}

pub(super) fn terminalize_run(
    conn: &Connection,
    run_id: &str,
    status: WorkflowRunStatus,
    failure_code: Option<WorkflowRunFailureCode>,
    finished_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET status = ?2, failure_code = ?3, finished_at = ?4, updated_at = ?5,
             state_version = state_version + 1
         WHERE id = ?1",
        params![
            run_id,
            status.as_str(),
            failure_code.map(WorkflowRunFailureCode::as_str),
            finished_at,
            updated_at,
        ],
    )
}

pub(super) fn fail_nonterminal_run(
    conn: &Connection,
    run_id: &str,
    failure_code: WorkflowRunFailureCode,
    finished_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET status = 'failed', failure_code = ?2, finished_at = ?3, updated_at = ?4,
             state_version = state_version + 1
         WHERE id = ?1 AND status IN ('accepted', 'running')",
        params![run_id, failure_code.as_str(), finished_at, updated_at],
    )
}

pub(super) fn fence_runs(
    conn: &Connection,
    interruption_code: WorkflowInterruptionCode,
    finished_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET status = 'interrupted', interruption_code = ?1, finished_at = ?2,
             updated_at = ?3, state_version = state_version + 1
         WHERE status IN ('accepted', 'running')",
        params![interruption_code.as_str(), finished_at, updated_at],
    )
}

/// Coupled-transaction helper: bump the run version and `updated_at` after a
/// step-only row change so a coupled run+step change increments exactly once.
pub(super) fn bump_run_version(
    conn: &Connection,
    run_id: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET state_version = state_version + 1, updated_at = ?2
         WHERE id = ?1",
        params![run_id, updated_at],
    )
}

/// Record the first durable cancellation intent on a nonterminal run (one
/// version increment); a repeated request matches nothing and changes nothing.
pub(super) fn record_cancel_intent(
    conn: &Connection,
    run_id: &str,
    cancel_requested_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET cancel_requested_at = ?2, updated_at = ?3,
             state_version = state_version + 1
         WHERE id = ?1 AND status IN ('accepted', 'running')
           AND cancel_requested_at IS NULL",
        params![run_id, cancel_requested_at, updated_at],
    )
}

/// Atomically terminalize a nonterminal run as `cancelled` (pre-dispatch
/// proof), stamping the first cancel intent when not already recorded. One
/// version increment.
pub(super) fn cancel_run_before_dispatch(
    conn: &Connection,
    run_id: &str,
    cancel_requested_at: &str,
    finished_at: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE workflow_runs
         SET status = 'cancelled',
             cancel_requested_at = COALESCE(cancel_requested_at, ?2),
             finished_at = ?3, updated_at = ?4,
             state_version = state_version + 1
         WHERE id = ?1 AND status IN ('accepted', 'running')",
        params![run_id, cancel_requested_at, finished_at, updated_at],
    )
}

pub(super) fn map_run(row: &Row<'_>) -> rusqlite::Result<WorkflowRunRecord> {
    Ok(WorkflowRunRecord {
        id: row.get("id")?,
        schema_version: row.get("schema_version")?,
        invocation_json: row.get("invocation_json")?,
        resolved_plan_json: row.get("resolved_plan_json")?,
        status: parse_status(row.get::<_, String>("status")?.as_str())?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        failure_code: parse_failure_code(row.get::<_, Option<String>>("failure_code")?)?,
        state_version: row.get("state_version")?,
        cancel_requested_at: row.get("cancel_requested_at")?,
        interruption_code: parse_interruption_code(
            row.get::<_, Option<String>>("interruption_code")?,
        )?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

fn parse_status(value: &str) -> rusqlite::Result<WorkflowRunStatus> {
    WorkflowRunStatus::parse(value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown workflow run status: {value}").into(),
        )
    })
}

pub(super) fn parse_failure_code(
    value: Option<String>,
) -> rusqlite::Result<Option<WorkflowRunFailureCode>> {
    match value {
        None => Ok(None),
        Some(raw) => WorkflowRunFailureCode::parse(&raw)
            .map(Some)
            .ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    Type::Text,
                    format!("unknown workflow failure code: {raw}").into(),
                )
            }),
    }
}

fn parse_interruption_code(
    value: Option<String>,
) -> rusqlite::Result<Option<WorkflowInterruptionCode>> {
    match value {
        None => Ok(None),
        Some(raw) => WorkflowInterruptionCode::parse(&raw)
            .map(Some)
            .ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    Type::Text,
                    format!("unknown workflow interruption code: {raw}").into(),
                )
            }),
    }
}
