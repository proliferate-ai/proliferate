//! Custom foreign-key migration `0070_workflow_run_cancel_status`: widens the
//! `workflow_runs.status` and `workflow_run_nodes.status` CHECK vocabularies
//! to admit `'cancelled'`, backing the new `POST
//! /v1/workflow-runs/{run_id}/cancel` command. Neither table gains a column,
//! so idempotency is a schema-text check rather than `table_columns`
//! (precedent 0061/0062): SQLite has no `PRAGMA check_info`, so the CHECK
//! vocabulary can only be read back as the stored `CREATE TABLE` text.

use rusqlite::Transaction;

pub(super) fn migrate_workflow_run_cancel_status(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    if status_check_admits_cancelled(tx, "workflow_runs")? {
        return Ok(());
    }

    tx.execute_batch(include_str!("sql/0070_workflow_run_cancel_status.sql"))
}

fn status_check_admits_cancelled(tx: &Transaction<'_>, table_name: &str) -> rusqlite::Result<bool> {
    let sql: String = tx.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table_name],
        |row| row.get(0),
    )?;
    Ok(sql.contains("'cancelled'"))
}
