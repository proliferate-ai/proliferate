//! File-backed upgrade proof for `0070_workflow_run_cancel_status`: the FK-off
//! full-table rebuild that widens `workflow_runs.status` and
//! `workflow_run_nodes.status` to admit `'cancelled'`, backing the new
//! `POST /v1/workflow-runs/{run_id}/cancel` command.
//!
//! Pins: existing rows on both tables survive the rebuild verbatim, both
//! CHECK constraints now accept `'cancelled'` while still rejecting an
//! unrecognized value, the two indexes survive, foreign-key enforcement is
//! restored and clean, and re-running the raw migration function is a no-op.

use std::path::PathBuf;

use rusqlite::Connection;

use super::migrations::run_migrations;
use super::workflow_run_cancel_status_migration::migrate_workflow_run_cancel_status;

const MIGRATION: &str = "0070_workflow_run_cancel_status";

struct TempDatabase {
    dir: PathBuf,
}

impl TempDatabase {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "anyharness-workflow-run-cancel-status-migration-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Self { dir }
    }

    fn path(&self) -> PathBuf {
        self.dir.join("db.sqlite")
    }
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The real pre-0070 schema: run the whole registry with 0070 pre-marked
/// applied (so 0069 runs for real and the gen-2 tables exist under the narrow
/// CHECK vocabulary), then unmark 0070. That reproduces the exact shape a
/// field database is in just before this migration, rather than a
/// hand-copied approximation that can drift from the registry.
fn seed_pre_0070(conn: &mut Connection) {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable foreign keys");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         )",
    )
    .expect("create migration ledger");
    conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [MIGRATION])
        .expect("pre-mark the migration under test");
    run_migrations(conn).expect("seed pre-0070 schema");
    conn.execute("DELETE FROM _migrations WHERE name = ?1", [MIGRATION])
        .expect("unmark the migration under test");

    conn.execute(
        "INSERT INTO repo_roots (id, kind, path, created_at, updated_at)
         VALUES ('repo-root-1', 'external', '/tmp/repo-root-1',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .expect("seed repo root");
    conn.execute(
        "INSERT INTO workspaces (id, kind, repo_root_id, path, created_at, updated_at)
         VALUES ('workspace-1', 'local', 'repo-root-1', '/tmp/workspace-1',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .expect("seed workspace");
    conn.execute(
        "INSERT INTO workflow_runs (
            id, invocation_id, definition_json, arguments_json, workspace_id, status,
            current_node_row_id, failure_code, created_at, updated_at, completed_at
         ) VALUES (
            'run-1', 'invocation-1', '{}', '{}', 'workspace-1', 'failed',
            'node-1', 'turn_error', '2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z',
            '2026-01-01T00:02:00Z'
         )",
        [],
    )
    .expect("seed pre-0070 run");
    conn.execute(
        "INSERT INTO workflow_run_nodes (
            id, run_id, kind, node_type, title, prompt, status, session_id,
            failure_code, created_at, started_at
         ) VALUES (
            'node-1', 'run-1', 'defined', 'agent', 'Plan', 'Write a plan.', 'failed',
            'session-1', 'turn_error', '2026-01-01T00:00:30Z', '2026-01-01T00:01:00Z'
         )",
        [],
    )
    .expect("seed pre-0070 node");

    // A dependent row on each side of the two rebuilt tables, so the FK-check
    // proof downstream actually proves something: `workflow_run_docs.run_id`
    // FK-references `workflow_runs(id)` directly, and this session carries
    // the loose `workflow_run_id`/`workflow_node_row_id` link 0069 added onto
    // the pre-existing `sessions` table.
    conn.execute(
        "INSERT INTO workflow_run_docs (
            id, run_id, slug, filename, producing_node_row_id, seeded_from_template,
            created_at, updated_at
         ) VALUES (
            'doc-1', 'run-1', 'plan', '00-plan.md', 'node-1', 0,
            '2026-01-01T00:01:30Z', '2026-01-01T00:01:30Z'
         )",
        [],
    )
    .expect("seed pre-0070 doc");
    conn.execute(
        "INSERT INTO sessions (
            id, workspace_id, agent_kind, status, created_at, updated_at,
            workflow_run_id, workflow_node_row_id
         ) VALUES (
            'session-1', 'workspace-1', 'claude', 'idle', '2026-01-01T00:00:45Z',
            '2026-01-01T00:00:45Z', 'run-1', 'node-1'
         )",
        [],
    )
    .expect("seed pre-0070 session");
}

fn index_names(conn: &Connection, table_name: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1")
        .expect("prepare index query");
    stmt.query_map([table_name], |row| row.get::<_, String>(0))
        .expect("query indexes")
        .collect::<Result<_, _>>()
        .expect("collect indexes")
}

#[test]
fn the_rebuild_admits_cancelled_status_and_preserves_existing_rows() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0070(&mut conn);

    run_migrations(&mut conn).expect("apply 0070");

    // The pre-existing failed run and node row survive the rebuild verbatim.
    let run: (String, String, Option<String>, String) = conn
        .query_row(
            "SELECT status, failure_code, current_node_row_id, completed_at
             FROM workflow_runs WHERE id = 'run-1'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get::<_, Option<String>>(1)?.expect("failure_code"),
                    row.get(2)?,
                    row.get::<_, Option<String>>(3)?.expect("completed_at"),
                ))
            },
        )
        .expect("read migrated run row");
    assert_eq!(run.0, "failed");
    assert_eq!(run.1, "turn_error");
    assert_eq!(run.2, Some("node-1".to_string()));
    assert_eq!(run.3, "2026-01-01T00:02:00Z");

    let node: (String, String, Option<String>) = conn
        .query_row(
            "SELECT status, prompt, session_id FROM workflow_run_nodes WHERE id = 'node-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("read migrated node row");
    assert_eq!(node.0, "failed");
    assert_eq!(node.1, "Write a plan.");
    assert_eq!(node.2, Some("session-1".to_string()));

    // The widened CHECK now admits 'cancelled' on both tables...
    conn.execute(
        "INSERT INTO workflow_runs (
            id, invocation_id, definition_json, arguments_json, workspace_id, status,
            created_at, updated_at, completed_at
         ) VALUES (
            'run-2', 'invocation-2', '{}', '{}', 'workspace-1', 'cancelled',
            '2026-01-01T00:03:00Z', '2026-01-01T00:04:00Z', '2026-01-01T00:04:00Z'
         )",
        [],
    )
    .expect("insert cancelled run");
    conn.execute(
        "INSERT INTO workflow_run_nodes (
            id, run_id, kind, node_type, title, prompt, status, created_at
         ) VALUES (
            'node-2', 'run-2', 'defined', 'agent', 'Plan', 'Write a plan.', 'cancelled',
            '2026-01-01T00:03:00Z'
         )",
        [],
    )
    .expect("insert cancelled node");

    // ...while still rejecting an unrecognized status.
    let rejected = conn.execute(
        "INSERT INTO workflow_runs (
            id, invocation_id, definition_json, arguments_json, workspace_id, status,
            created_at, updated_at
         ) VALUES (
            'run-bogus', 'invocation-3', '{}', '{}', 'workspace-1', 'bogus',
            '2026-01-01T00:05:00Z', '2026-01-01T00:05:00Z'
         )",
        [],
    );
    assert!(
        rejected.is_err(),
        "an unrecognized status must stay illegal"
    );
}

#[test]
fn the_rebuild_preserves_indexes_and_restores_clean_foreign_key_enforcement() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0070(&mut conn);

    run_migrations(&mut conn).expect("apply 0070");

    assert!(
        index_names(&conn, "workflow_runs").contains(&"idx_workflow_runs_workspace_id".to_string())
    );
    assert!(index_names(&conn, "workflow_run_nodes")
        .contains(&"idx_workflow_run_nodes_run_id".to_string()));

    let foreign_keys_enabled: bool = conn
        .query_row("PRAGMA foreign_keys", [], |row| {
            row.get::<_, i64>(0).map(|value| value != 0)
        })
        .expect("query foreign key state");
    assert!(
        foreign_keys_enabled,
        "foreign key enforcement must be restored"
    );

    let fk_violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .expect("foreign key check");
    assert_eq!(fk_violations, 0);
}

#[test]
fn reapplying_the_raw_migration_function_is_a_no_op() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0070(&mut conn);

    // Exercise the guard directly, independent of the `_migrations` ledger:
    // the substring check on the stored CHECK text must make the second
    // application a no-op rather than erroring on tables that no longer
    // exist under their `_pre_cancel` rename.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .expect("disable foreign keys for the manual rebuild");
    {
        let tx = conn.transaction().expect("open first transaction");
        migrate_workflow_run_cancel_status(&tx).expect("first application");
        tx.commit().expect("commit first application");
    }
    {
        let tx = conn.transaction().expect("open second transaction");
        migrate_workflow_run_cancel_status(&tx).expect("second application must be a no-op");
        tx.commit().expect("commit second application");
    }
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("restore foreign keys");

    let node_status: String = conn
        .query_row(
            "SELECT status FROM workflow_run_nodes WHERE id = 'node-1'",
            [],
            |row| row.get(0),
        )
        .expect("node row survives a repeated application");
    assert_eq!(node_status, "failed");
}
