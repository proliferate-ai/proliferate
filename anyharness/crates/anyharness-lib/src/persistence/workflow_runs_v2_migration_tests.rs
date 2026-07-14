//! File-backed upgrade proof for the portable workflow-run migration.

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
                "anyharness-workflow-v2-migration-{}.sqlite",
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

#[test]
fn workflow_v2_migration_upgrades_and_reopens_pre_0061_file() {
    let database = TempDatabase::new();
    {
        let mut conn = Connection::open(database.path()).expect("open migration fixture");
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE workflow_runs (
                id TEXT PRIMARY KEY,
                schema_version INTEGER NOT NULL CHECK (schema_version = 1),
                invocation_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('accepted','running','completed','failed')),
                workspace_id TEXT NOT NULL,
                session_id TEXT,
                failure_code TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT
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
             );
             INSERT INTO workflow_runs (
                id, schema_version, invocation_json, status, workspace_id,
                created_at, updated_at
             ) VALUES (
                'run-v1', 1, '{\"workspaceId\":\"ws\",\"definition\":{\"inputs\":[],\"stages\":[]},\"arguments\":{}}',
                'accepted', 'ws', '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z'
             );
             INSERT INTO workflow_run_steps (
                run_id, stage_index, step_index, status, prompt_id,
                created_at, updated_at
             ) VALUES (
                'run-v1', 0, 0, 'pending', 'workflow:run-v1:0:0',
                '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z'
             );",
        )
        .expect("seed pre-0061 schema");
        for (name, _) in MIGRATIONS {
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark SQL migration");
        }
        for (name, _) in CUSTOM_MIGRATIONS {
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark custom migration");
        }
        for (name, _) in CUSTOM_FOREIGN_KEY_MIGRATIONS {
            if *name != "0061_workflow_runs_v2" {
                conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                    .expect("mark FK migration");
            }
        }
        run_migrations(&mut conn).expect("upgrade through 0061");
    }

    let conn = Connection::open(database.path()).expect("reopen upgraded database");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable foreign keys after reopen");
    let parent: (i64, String, Option<String>) = conn
        .query_row(
            "SELECT schema_version, invocation_json, resolved_plan_json
             FROM workflow_runs WHERE id = 'run-v1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("copied v1 parent");
    assert_eq!(parent.0, 1);
    assert!(parent.1.contains("workspaceId"));
    assert!(parent.2.is_none());

    let child: (String, String) = conn
        .query_row(
            "SELECT prompt_id, status FROM workflow_run_steps
             WHERE run_id = 'run-v1' AND stage_index = 0 AND step_index = 0",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("copied v1 child");
    assert_eq!(child, ("workflow:run-v1:0:0".into(), "pending".into()));

    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .expect("prepare workflow columns")
        .query_map([], |row| row.get(1))
        .expect("query workflow columns")
        .collect::<Result<_, _>>()
        .expect("collect workflow columns");
    assert!(columns.contains(&"resolved_plan_json".to_string()));
    assert!(conn
        .execute(
            "INSERT INTO workflow_runs (
                id, schema_version, invocation_json, resolved_plan_json,
                status, workspace_id, created_at, updated_at
             ) VALUES ('bad-v2', 2, '{}', NULL, 'accepted', 'ws', 't', 't')",
            [],
        )
        .is_err());
    assert_eq!(
        conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .expect("foreign key state after reopen"),
        1
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("foreign key check after reopen"),
        0
    );
}
