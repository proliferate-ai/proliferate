//! File-backed upgrade proof for `0062_workflow_run_control` (spec
//! workflow-run-control §7 / §11.1): exact historical mappings for v1 AND v2
//! rows, preservation of correlation/plan/failure data, strict legacy pair
//! validation aborting the migration, cross-column checks, restored FK
//! enforcement, and a clean reopen.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::custom_migrations::{CUSTOM_FOREIGN_KEY_MIGRATIONS, CUSTOM_MIGRATIONS};
use super::migrations::{run_migrations, MIGRATIONS};

struct TempDatabase {
    path: PathBuf,
}

impl TempDatabase {
    fn new() -> Self {
        Self {
            path: std::env::temp_dir().join(format!(
                "anyharness-workflow-control-migration-{}.sqlite",
                uuid::Uuid::new_v4()
            )),
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_file(self.path.with_extension("sqlite-shm"));
        let _ = std::fs::remove_file(self.path.with_extension("sqlite-wal"));
    }
}

/// The post-0061 / pre-0062 schema plus `_migrations` marks for everything
/// except 0062 itself.
fn seed_pre_0062(conn: &mut Connection) {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
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
         );",
    )
    .expect("seed pre-0062 schema");
    for (name, _) in MIGRATIONS {
        conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
            .expect("mark SQL migration");
    }
    for (name, _) in CUSTOM_MIGRATIONS {
        conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
            .expect("mark custom migration");
    }
    for (name, _) in CUSTOM_FOREIGN_KEY_MIGRATIONS {
        if *name != "0062_workflow_run_control" {
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark FK migration");
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn insert_pair(
    conn: &Connection,
    run_id: &str,
    schema_version: i64,
    plan_json: Option<&str>,
    run_status: &str,
    run_failure: Option<&str>,
    step_status: &str,
    step_failure: Option<&str>,
    turn_id: Option<&str>,
) {
    conn.execute(
        "INSERT INTO workflow_runs (
            id, schema_version, invocation_json, resolved_plan_json, status,
            workspace_id, session_id, failure_code, created_at, updated_at,
            started_at, finished_at
         ) VALUES (?1, ?2, '{\"k\":1}', ?3, ?4, 'ws-1', 'sess-1', ?5,
                   '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z',
                   '2026-07-01T01:00:00Z', '2026-07-01T02:00:00Z')",
        rusqlite::params![run_id, schema_version, plan_json, run_status, run_failure],
    )
    .expect("insert legacy run");
    conn.execute(
        "INSERT INTO workflow_run_steps (
            run_id, stage_index, step_index, status, prompt_id, turn_id,
            failure_code, created_at, updated_at, started_at, finished_at
         ) VALUES (?1, 0, 0, ?2, ?3, ?4, ?5,
                   '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z',
                   '2026-07-01T01:00:00Z', '2026-07-01T02:00:00Z')",
        rusqlite::params![
            run_id,
            step_status,
            format!("workflow:{run_id}:0:0"),
            turn_id,
            step_failure
        ],
    )
    .expect("insert legacy step");
}

type RunSnapshot = (String, Option<String>, i64, Option<String>, Option<String>);

fn run_snapshot(conn: &Connection, run_id: &str) -> RunSnapshot {
    conn.query_row(
        "SELECT status, failure_code, state_version, cancel_requested_at, interruption_code
         FROM workflow_runs WHERE id = ?1",
        [run_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )
    .expect("migrated run row")
}

#[test]
fn migration_0062_maps_history_and_preserves_v1_and_v2_rows() {
    let database = TempDatabase::new();
    {
        let mut conn = Connection::open(database.path()).expect("open fixture");
        seed_pre_0062(&mut conn);
        // v1 cancelled-history pair.
        insert_pair(
            &conn,
            "run-cancelled",
            1,
            None,
            "failed",
            Some("session_turn_cancelled"),
            "failed",
            Some("session_turn_cancelled"),
            Some("turn-1"),
        );
        // v2 restart-history pair with a resolved plan that must survive.
        insert_pair(
            &conn,
            "run-restarted",
            2,
            Some("{\"plan\":true}"),
            "failed",
            Some("runtime_restarted"),
            "failed",
            Some("runtime_restarted"),
            None,
        );
        // Ordinary failed history stays failed (v2-only code preserved).
        insert_pair(
            &conn,
            "run-config-failed",
            2,
            Some("{\"plan\":2}"),
            "failed",
            Some("session_config_apply_failed"),
            "failed",
            Some("session_config_apply_failed"),
            None,
        );
        // Completed and in-flight history unchanged.
        insert_pair(
            &conn,
            "run-done",
            1,
            None,
            "completed",
            None,
            "completed",
            None,
            Some("turn-2"),
        );
        insert_pair(
            &conn,
            "run-live",
            1,
            None,
            "running",
            None,
            "running",
            None,
            Some("turn-3"),
        );
        run_migrations(&mut conn).expect("upgrade through 0062");
    }

    let conn = Connection::open(database.path()).expect("reopen upgraded database");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable foreign keys");

    // Known mappings.
    let cancelled = run_snapshot(&conn, "run-cancelled");
    assert_eq!(cancelled.0, "cancelled");
    assert!(cancelled.1.is_none(), "failure code cleared");
    assert_eq!(cancelled.2, 1, "historical stateVersion is 1");
    assert!(cancelled.3.is_none(), "migrated cancelRequestedAt is null");
    assert!(cancelled.4.is_none());

    let restarted = run_snapshot(&conn, "run-restarted");
    assert_eq!(restarted.0, "interrupted");
    assert!(restarted.1.is_none());
    assert_eq!(restarted.4.as_deref(), Some("runtime_restarted"));

    // Preservation: correlation, plan, v2-only failure code, timestamps.
    let preserved: (i64, String, Option<String>, Option<String>, String) = conn
        .query_row(
            "SELECT schema_version, invocation_json, resolved_plan_json, session_id, created_at
             FROM workflow_runs WHERE id = 'run-restarted'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .expect("preserved v2 row");
    assert_eq!(preserved.0, 2);
    assert_eq!(preserved.1, "{\"k\":1}");
    assert_eq!(preserved.2.as_deref(), Some("{\"plan\":true}"));
    assert_eq!(preserved.3.as_deref(), Some("sess-1"));
    assert_eq!(preserved.4, "2026-07-01T00:00:00Z");

    let config_failed = run_snapshot(&conn, "run-config-failed");
    assert_eq!(config_failed.0, "failed");
    assert_eq!(
        config_failed.1.as_deref(),
        Some("session_config_apply_failed")
    );

    let done = run_snapshot(&conn, "run-done");
    assert_eq!(done.0, "completed");
    let live = run_snapshot(&conn, "run-live");
    assert_eq!(live.0, "running");

    // Step mappings + turn correlation preserved.
    let step: (String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT status, failure_code, turn_id FROM workflow_run_steps
             WHERE run_id = 'run-cancelled'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("cancelled step");
    assert_eq!(step.0, "cancelled");
    assert!(step.1.is_none());
    assert_eq!(step.2.as_deref(), Some("turn-1"));
    let restarted_step: (String, Option<String>) = conn
        .query_row(
            "SELECT status, failure_code FROM workflow_run_steps WHERE run_id = 'run-restarted'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("interrupted step");
    assert_eq!(restarted_step.0, "interrupted");
    assert!(restarted_step.1.is_none());

    // Cross-column checks are live on the rebuilt tables.
    assert!(
        conn.execute(
            "INSERT INTO workflow_runs (
                id, schema_version, invocation_json, status, workspace_id,
                failure_code, state_version, created_at, updated_at
             ) VALUES ('bad-failed', 1, '{}', 'failed', 'ws', NULL, 1, 't', 't')",
            [],
        )
        .is_err(),
        "failed run requires a failure code"
    );
    assert!(
        conn.execute(
            "INSERT INTO workflow_runs (
                id, schema_version, invocation_json, status, workspace_id,
                state_version, interruption_code, created_at, updated_at
             ) VALUES ('bad-interrupted', 1, '{}', 'interrupted', 'ws', 1, NULL, 't', 't')",
            [],
        )
        .is_err(),
        "interrupted run requires runtime_restarted"
    );
    assert!(
        conn.execute(
            "INSERT INTO workflow_runs (
                id, schema_version, invocation_json, status, workspace_id,
                state_version, created_at, updated_at
             ) VALUES ('bad-version', 1, '{}', 'accepted', 'ws', 0, 't', 't')",
            [],
        )
        .is_err(),
        "state_version must be >= 1"
    );

    // FK enforcement restored + clean check.
    assert_eq!(
        conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .expect("foreign key state"),
        1
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("foreign key check"),
        0
    );
}

#[test]
fn migration_0062_aborts_on_an_unknown_legacy_pair() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0062(&mut conn);
    // An impossible pair for known product history: failed run, completed step.
    insert_pair(
        &conn,
        "run-weird",
        1,
        None,
        "failed",
        Some("session_turn_failed"),
        "completed",
        None,
        Some("turn-x"),
    );

    let error = run_migrations(&mut conn).expect_err("invalid pair must abort");
    let message = error.to_string();
    assert!(
        message.contains("0062_workflow_run_control aborted"),
        "unexpected abort message: {message}"
    );

    // 0062 unapplied, legacy tables untouched, FK enforcement restored.
    let applied: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM _migrations WHERE name = '0062_workflow_run_control'",
            [],
            |row| row.get(0),
        )
        .expect("migration marker");
    assert_eq!(applied, 0);
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .expect("prepare columns")
        .query_map([], |row| row.get(1))
        .expect("query columns")
        .collect::<Result<_, _>>()
        .expect("collect columns");
    assert!(!columns.contains(&"state_version".to_string()));
    let status: String = conn
        .query_row(
            "SELECT status FROM workflow_runs WHERE id = 'run-weird'",
            [],
            |row| row.get(0),
        )
        .expect("legacy row untouched");
    assert_eq!(status, "failed");
    assert_eq!(
        conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .expect("foreign key state restored"),
        1
    );
}
