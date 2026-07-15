//! Custom foreign-key migration `0062_workflow_run_control` (spec
//! `workflow-run-control.md` §7): rebuild `workflow_runs` and
//! `workflow_run_steps` with run-control columns (`state_version`,
//! `cancel_requested_at`, `interruption_code`), the widened status
//! vocabularies, and direct-SQL cross-column checks; map known historical
//! cancellation/restart failures onto the truthful vocabulary; and abort on
//! any legacy run+step pair that does not match known product history.

use rusqlite::Transaction;

use super::custom_migration_schema::table_columns;

pub(super) fn migrate_workflow_run_control(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let columns = table_columns(tx, "workflow_runs")?;
    if columns.iter().any(|column| column == "state_version") {
        return Ok(());
    }

    validate_legacy_pairs(tx)?;

    tx.execute_batch(
        "
        PRAGMA legacy_alter_table = ON;
        ALTER TABLE workflow_run_steps RENAME TO workflow_run_steps_old;
        ALTER TABLE workflow_runs RENAME TO workflow_runs_old;

        CREATE TABLE workflow_runs (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
            invocation_json TEXT NOT NULL CHECK (json_valid(invocation_json)),
            resolved_plan_json TEXT CHECK (
                resolved_plan_json IS NULL OR json_valid(resolved_plan_json)
            ),
            status TEXT NOT NULL CHECK (
                status IN ('accepted','running','completed','failed','cancelled','interrupted')
            ),
            workspace_id TEXT NOT NULL,
            session_id TEXT,
            failure_code TEXT,
            state_version INTEGER NOT NULL CHECK (state_version >= 1),
            cancel_requested_at TEXT,
            interruption_code TEXT CHECK (
                interruption_code IS NULL OR interruption_code = 'runtime_restarted'
            ),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            CHECK (
                (schema_version = 1 AND resolved_plan_json IS NULL)
                OR (schema_version = 2 AND resolved_plan_json IS NOT NULL)
            ),
            CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
            CHECK ((status = 'interrupted') = (interruption_code IS NOT NULL))
        );

        INSERT INTO workflow_runs (
            id, schema_version, invocation_json, resolved_plan_json, status,
            workspace_id, session_id, failure_code, state_version,
            cancel_requested_at, interruption_code, created_at, updated_at,
            started_at, finished_at
        )
        SELECT
            id, schema_version, invocation_json, resolved_plan_json,
            CASE
                WHEN status = 'failed' AND failure_code = 'session_turn_cancelled'
                    THEN 'cancelled'
                WHEN status = 'failed' AND failure_code = 'runtime_restarted'
                    THEN 'interrupted'
                ELSE status
            END,
            workspace_id, session_id,
            CASE
                WHEN status = 'failed'
                     AND failure_code IN ('session_turn_cancelled', 'runtime_restarted')
                    THEN NULL
                ELSE failure_code
            END,
            1,
            NULL,
            CASE
                WHEN status = 'failed' AND failure_code = 'runtime_restarted'
                    THEN 'runtime_restarted'
                ELSE NULL
            END,
            created_at, updated_at, started_at, finished_at
        FROM workflow_runs_old;

        CREATE TABLE workflow_run_steps (
            run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
            stage_index INTEGER NOT NULL,
            step_index INTEGER NOT NULL,
            status TEXT NOT NULL CHECK (
                status IN ('pending','running','completed','failed','cancelled','interrupted')
            ),
            prompt_id TEXT NOT NULL UNIQUE,
            turn_id TEXT,
            failure_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            PRIMARY KEY (run_id, stage_index, step_index),
            CHECK ((status = 'failed') = (failure_code IS NOT NULL))
        );

        INSERT INTO workflow_run_steps (
            run_id, stage_index, step_index, status, prompt_id, turn_id,
            failure_code, created_at, updated_at, started_at, finished_at
        )
        SELECT
            run_id, stage_index, step_index,
            CASE
                WHEN status = 'failed' AND failure_code = 'session_turn_cancelled'
                    THEN 'cancelled'
                WHEN status = 'failed' AND failure_code = 'runtime_restarted'
                    THEN 'interrupted'
                ELSE status
            END,
            prompt_id, turn_id,
            CASE
                WHEN status = 'failed'
                     AND failure_code IN ('session_turn_cancelled', 'runtime_restarted')
                    THEN NULL
                ELSE failure_code
            END,
            created_at, updated_at, started_at, finished_at
        FROM workflow_run_steps_old;

        DROP TABLE workflow_run_steps_old;
        DROP TABLE workflow_runs_old;
        PRAGMA legacy_alter_table = OFF;
        ",
    )?;
    Ok(())
}

/// Strict legacy pair validation (spec §7): every legacy run and its
/// materialized step(s) must match known product history exactly; anything
/// else aborts the migration instead of guessing. Messages carry run IDs and
/// stable status/code strings only.
fn validate_legacy_pairs(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    struct LegacyRun {
        id: String,
        status: String,
        failure_code: Option<String>,
    }

    let mut run_stmt =
        tx.prepare("SELECT id, status, failure_code FROM workflow_runs ORDER BY id")?;
    let runs = run_stmt
        .query_map([], |row| {
            Ok(LegacyRun {
                id: row.get(0)?,
                status: row.get(1)?,
                failure_code: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut step_stmt = tx.prepare(
        "SELECT status, failure_code FROM workflow_run_steps WHERE run_id = ?1
         ORDER BY stage_index, step_index",
    )?;

    for run in runs {
        let steps = step_stmt
            .query_map([&run.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        if steps.is_empty() {
            return Err(abort(&run.id, "run has no materialized step"));
        }

        for (step_status, step_failure_code) in &steps {
            let pair_ok = match run.status.as_str() {
                "accepted" => step_status == "pending",
                "running" => step_status == "pending" || step_status == "running",
                "completed" => step_status == "completed",
                "failed" => {
                    step_status == "failed"
                        && run.failure_code.is_some()
                        && *step_failure_code == run.failure_code
                }
                _ => false,
            };
            if !pair_ok {
                return Err(abort(
                    &run.id,
                    &format!(
                        "unexpected legacy pair: run {}/{} step {}/{}",
                        run.status,
                        run.failure_code.as_deref().unwrap_or("-"),
                        step_status,
                        step_failure_code.as_deref().unwrap_or("-"),
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn abort(run_id: &str, detail: &str) -> rusqlite::Error {
    // A typed conversion failure carries the stable message without inventing
    // an error channel; the migration runner propagates it, leaves 0062
    // unapplied, and restores prior foreign-key enforcement.
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("0062_workflow_run_control aborted for run {run_id}: {detail}").into(),
    )
}
