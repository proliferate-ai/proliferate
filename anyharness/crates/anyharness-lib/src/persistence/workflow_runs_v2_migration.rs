//! Custom foreign-key migration for portable workflow runs.

use rusqlite::Transaction;

use super::custom_migration_schema::table_columns;

pub(super) fn migrate_workflow_runs_v2(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let columns = table_columns(tx, "workflow_runs")?;
    if columns.iter().any(|column| column == "resolved_plan_json") {
        return Ok(());
    }

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
            status TEXT NOT NULL CHECK (status IN ('accepted','running','completed','failed')),
            workspace_id TEXT NOT NULL,
            session_id TEXT,
            failure_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            CHECK (
                (schema_version = 1 AND resolved_plan_json IS NULL)
                OR (schema_version = 2 AND resolved_plan_json IS NOT NULL)
            )
        );

        INSERT INTO workflow_runs (
            id, schema_version, invocation_json, resolved_plan_json, status,
            workspace_id, session_id, failure_code, created_at, updated_at,
            started_at, finished_at
        )
        SELECT
            id, schema_version, invocation_json, NULL, status,
            workspace_id, session_id, failure_code, created_at, updated_at,
            started_at, finished_at
        FROM workflow_runs_old;

        CREATE TABLE workflow_run_steps (
            run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
            stage_index INTEGER NOT NULL,
            step_index INTEGER NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
            prompt_id TEXT NOT NULL UNIQUE,
            turn_id TEXT,
            failure_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            PRIMARY KEY (run_id, stage_index, step_index)
        );

        INSERT INTO workflow_run_steps (
            run_id, stage_index, step_index, status, prompt_id, turn_id,
            failure_code, created_at, updated_at, started_at, finished_at
        )
        SELECT
            run_id, stage_index, step_index, status, prompt_id, turn_id,
            failure_code, created_at, updated_at, started_at, finished_at
        FROM workflow_run_steps_old;

        DROP TABLE workflow_run_steps_old;
        DROP TABLE workflow_runs_old;
        PRAGMA legacy_alter_table = OFF;
        ",
    )?;
    Ok(())
}
