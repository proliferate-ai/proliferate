//! File-backed upgrade proof for `0067_workspace_archived_lifecycle`: the
//! FK-off full-table rebuild that turns the workspace lifecycle enum from
//! `{active, retired}` into `{active, archived}` and adds archiving's four
//! columns.
//!
//! Retired rows are ABSORBED, not kept, so these proofs pin the absorption
//! mapping (including crashed-purge tombstones), the two backfills, the
//! survival of the five cleanup columns purge still writes until R5, the index
//! set, restored foreign-key enforcement, the tolerant read of an unknown
//! lifecycle value, and the idempotence guard.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::custom_migration_registry_tests::table_column_names;
use super::migrations::run_migrations;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

const MIGRATION: &str = "0067_workspace_archived_lifecycle";

struct TempDatabase {
    dir: PathBuf,
}

impl TempDatabase {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "anyharness-workspace-archived-migration-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Self { dir }
    }

    fn dir(&self) -> &Path {
        &self.dir
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

/// The real pre-0067 schema: run the whole registry with 0067 pre-marked as
/// applied, then unmark it. That reproduces the exact post-0063 shape a field
/// database is in — including the old `('active', 'retired')` CHECK — instead
/// of a hand-copied approximation that can drift from the registry.
fn seed_pre_0067(conn: &mut Connection) {
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
    run_migrations(conn).expect("seed pre-0067 schema");
    conn.execute("DELETE FROM _migrations WHERE name = ?1", [MIGRATION])
        .expect("unmark the migration under test");

    // The rebuilt table keeps `repo_root_id TEXT NOT NULL REFERENCES
    // repo_roots(id)`, so every fixture row needs a parent.
    conn.execute(
        "INSERT INTO repo_roots (id, kind, path, created_at, updated_at)
         VALUES ('repo-root-1', 'external', '/tmp/repo-root-1',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .expect("seed repo root");
}

#[allow(clippy::too_many_arguments)]
fn insert_pre_0067_workspace(
    conn: &Connection,
    id: &str,
    lifecycle_state: &str,
    cleanup_state: &str,
    cleanup_operation: Option<&str>,
    cleanup_attempted_at: Option<&str>,
    current_branch: Option<&str>,
    original_branch: Option<&str>,
) {
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, original_branch, current_branch,
            display_name, origin_json, creator_context_json, lifecycle_state,
            cleanup_state, cleanup_operation, cleanup_error_message, cleanup_failed_at,
            cleanup_attempted_at, created_at, updated_at
         ) VALUES (
            ?1, 'worktree', 'repo-root-1', ?2, 'standard', ?3, ?4,
            NULL, NULL, NULL, ?5,
            ?6, ?7, NULL, NULL,
            ?8, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'
         )",
        rusqlite::params![
            id,
            format!("/tmp/{id}"),
            original_branch,
            current_branch,
            lifecycle_state,
            cleanup_state,
            cleanup_operation,
            cleanup_attempted_at,
        ],
    )
    .expect("insert pre-0067 workspace row");
}

fn lifecycle_of(conn: &Connection, id: &str) -> String {
    conn.query_row(
        "SELECT lifecycle_state FROM workspaces WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .expect("read lifecycle_state")
}

fn optional_text(conn: &Connection, column: &str, id: &str) -> Option<String> {
    conn.query_row(
        &format!("SELECT {column} FROM workspaces WHERE id = ?1"),
        [id],
        |row| row.get(0),
    )
    .expect("read column")
}

fn index_names(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'workspaces'")
        .expect("prepare index query");
    stmt.query_map([], |row| row.get::<_, String>(0))
        .expect("query indexes")
        .collect::<Result<_, _>>()
        .expect("collect indexes")
}

#[test]
fn retired_rows_are_absorbed_as_archived_with_a_null_head_sha() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);
    insert_pre_0067_workspace(
        &conn,
        "workspace-retired",
        "retired",
        "complete",
        Some("retire"),
        Some("2026-05-05T00:00:00Z"),
        Some("feature/retired"),
        Some("main"),
    );
    insert_pre_0067_workspace(
        &conn,
        "workspace-active",
        "active",
        "none",
        None,
        None,
        Some("main"),
        Some("main"),
    );

    run_migrations(&mut conn).expect("run 0067");

    assert_eq!(lifecycle_of(&conn, "workspace-retired"), "archived");
    assert_eq!(lifecycle_of(&conn, "workspace-active"), "active");
    // No pre-ADR row ever had a snapshot, so the anchor column is NULL for
    // every absorbed row.
    assert_eq!(
        optional_text(&conn, "archived_head_sha", "workspace-retired"),
        None
    );
    assert_eq!(
        optional_text(&conn, "archived_head_sha", "workspace-active"),
        None
    );
    // The new CHECK admits exactly two values.
    let error = conn
        .execute(
            "UPDATE workspaces SET lifecycle_state = 'retired' WHERE id = 'workspace-retired'",
            [],
        )
        .expect_err("the rebuilt CHECK must refuse the retired literal");
    assert!(
        error.to_string().to_lowercase().contains("constraint"),
        "unexpected error: {error}"
    );
}

#[test]
fn purge_tombstones_are_absorbed_with_their_cleanup_columns_intact() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, original_branch, current_branch,
            display_name, origin_json, creator_context_json, lifecycle_state,
            cleanup_state, cleanup_operation, cleanup_error_message, cleanup_failed_at,
            cleanup_attempted_at, created_at, updated_at
         ) VALUES (
            'workspace-tombstone', 'worktree', 'repo-root-1', '/tmp/tombstone', 'standard',
            'main', 'feature/crashed', NULL, NULL, NULL, 'retired',
            'failed', 'purge', 'permission denied', '2026-05-06T00:00:00Z',
            '2026-05-05T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'
         )",
        [],
    )
    .expect("insert crashed-purge tombstone");

    run_migrations(&mut conn).expect("run 0067");

    assert_eq!(lifecycle_of(&conn, "workspace-tombstone"), "archived");
    let (state, operation, message, failed_at, attempted_at): (
        String,
        String,
        String,
        String,
        String,
    ) = conn
        .query_row(
            "SELECT cleanup_state, cleanup_operation, cleanup_error_message,
                    cleanup_failed_at, cleanup_attempted_at
               FROM workspaces WHERE id = 'workspace-tombstone'",
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
        .expect("read tombstone cleanup columns");
    assert_eq!(state, "failed");
    assert_eq!(operation, "purge");
    assert_eq!(message, "permission denied");
    assert_eq!(failed_at, "2026-05-06T00:00:00Z");
    assert_eq!(attempted_at, "2026-05-05T00:00:00Z");
}

#[test]
fn archived_at_is_backfilled_only_for_absorbed_rows() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);
    insert_pre_0067_workspace(
        &conn,
        "workspace-attempted",
        "retired",
        "complete",
        Some("retire"),
        Some("2026-05-05T00:00:00Z"),
        Some("main"),
        Some("main"),
    );
    insert_pre_0067_workspace(
        &conn,
        "workspace-no-attempt",
        "retired",
        "none",
        None,
        None,
        Some("main"),
        Some("main"),
    );
    insert_pre_0067_workspace(
        &conn,
        "workspace-active",
        "active",
        "none",
        None,
        None,
        Some("main"),
        Some("main"),
    );

    run_migrations(&mut conn).expect("run 0067");

    assert_eq!(
        optional_text(&conn, "archived_at", "workspace-attempted"),
        Some("2026-05-05T00:00:00Z".to_string())
    );
    let fallback = optional_text(&conn, "archived_at", "workspace-no-attempt")
        .expect("a row with no cleanup_attempted_at falls back to the migration timestamp");
    assert!(
        chrono::DateTime::parse_from_rfc3339(&fallback).is_ok(),
        "migration timestamp must be RFC3339: {fallback}"
    );
    assert_eq!(optional_text(&conn, "archived_at", "workspace-active"), None);
}

#[test]
fn archived_branch_is_backfilled_from_current_then_original_branch() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);
    insert_pre_0067_workspace(
        &conn,
        "workspace-current",
        "retired",
        "complete",
        Some("retire"),
        None,
        Some("feature/current"),
        Some("main"),
    );
    insert_pre_0067_workspace(
        &conn,
        "workspace-original",
        "retired",
        "complete",
        Some("retire"),
        None,
        None,
        Some("feature/original"),
    );
    insert_pre_0067_workspace(
        &conn,
        "workspace-detached",
        "retired",
        "complete",
        Some("retire"),
        None,
        None,
        None,
    );
    insert_pre_0067_workspace(
        &conn,
        "workspace-active",
        "active",
        "none",
        None,
        None,
        Some("feature/active"),
        Some("main"),
    );

    run_migrations(&mut conn).expect("run 0067");

    assert_eq!(
        optional_text(&conn, "archived_branch", "workspace-current"),
        Some("feature/current".to_string())
    );
    assert_eq!(
        optional_text(&conn, "archived_branch", "workspace-original"),
        Some("feature/original".to_string())
    );
    assert_eq!(
        optional_text(&conn, "archived_branch", "workspace-detached"),
        None
    );
    // On an active row a NULL archived_branch is load-bearing: on a
    // sha-present row it is the detached-at-archive marker.
    assert_eq!(
        optional_text(&conn, "archived_branch", "workspace-active"),
        None
    );
}

#[test]
fn the_rebuild_keeps_the_five_cleanup_columns_and_adds_the_four_archive_columns() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);

    run_migrations(&mut conn).expect("run 0067");

    let columns = table_column_names(&conn, "workspaces");
    for column in [
        "cleanup_state",
        "cleanup_operation",
        "cleanup_error_message",
        "cleanup_failed_at",
        "cleanup_attempted_at",
    ] {
        assert!(
            columns.contains(&column.to_string()),
            "purge still writes {column} until R5: {columns:?}"
        );
    }
    for column in [
        "archived_head_sha",
        "archived_branch",
        "archived_at",
        "partial_capture_json",
    ] {
        assert!(
            columns.contains(&column.to_string()),
            "missing new column {column}: {columns:?}"
        );
    }
}

#[test]
fn the_rebuild_recreates_all_three_indexes_and_renames_the_retention_index() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);

    run_migrations(&mut conn).expect("run 0067");

    let indexes = index_names(&conn);
    for name in [
        "idx_workspaces_path",
        "idx_workspaces_repo_root_id",
        "idx_workspaces_lifecycle",
    ] {
        assert!(
            indexes.contains(&name.to_string()),
            "missing index {name}: {indexes:?}"
        );
    }
    assert!(
        !indexes.contains(&"idx_workspaces_retention".to_string()),
        "the retention index is renamed, not kept: {indexes:?}"
    );
    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_workspaces_lifecycle'",
            [],
            |row| row.get(0),
        )
        .expect("read lifecycle index DDL");
    assert!(
        sql.contains("repo_root_id")
            && sql.contains("kind")
            && sql.contains("lifecycle_state")
            && sql.contains("surface"),
        "lifecycle index must keep the retention index's column tuple: {sql}"
    );
}

#[test]
fn foreign_key_enforcement_is_restored_after_the_rebuild() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);
    insert_pre_0067_workspace(
        &conn,
        "workspace-active",
        "active",
        "none",
        None,
        None,
        Some("main"),
        Some("main"),
    );

    run_migrations(&mut conn).expect("run 0067");

    assert_eq!(
        conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .expect("read foreign key pragma"),
        1,
        "the runner must restore foreign key enforcement"
    );
    let violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .expect("run foreign_key_check");
    assert_eq!(violations, 0);
    // The rebuilt table is still a live FK parent.
    conn.execute(
        "INSERT INTO workspace_access_modes (workspace_id, mode, updated_at)
         VALUES ('workspace-active', 'normal', '2026-05-05T00:00:00Z')",
        [],
    )
    .expect("child row against a real workspace");
    let error = conn
        .execute(
            "INSERT INTO workspace_access_modes (workspace_id, mode, updated_at)
             VALUES ('workspace-missing', 'normal', '2026-05-05T00:00:00Z')",
            [],
        )
        .expect_err("child row against a bogus workspace must be refused");
    assert!(
        error.to_string().to_lowercase().contains("foreign key"),
        "unexpected error: {error}"
    );
}

#[test]
fn an_unknown_lifecycle_value_migrates_to_archived_and_does_not_brick_listings() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);
    conn.execute_batch("PRAGMA ignore_check_constraints = ON;")
        .expect("relax the old CHECK for the fixture");
    insert_pre_0067_workspace(
        &conn,
        "workspace-unknown",
        "future_state",
        "none",
        None,
        None,
        Some("feature/unknown"),
        Some("main"),
    );
    conn.execute_batch("PRAGMA ignore_check_constraints = OFF;")
        .expect("restore CHECK enforcement");
    insert_pre_0067_workspace(
        &conn,
        "workspace-active",
        "active",
        "none",
        None,
        None,
        Some("main"),
        Some("main"),
    );

    run_migrations(&mut conn).expect("run 0067");
    drop(conn);

    // Every non-active value maps to archived: the new CHECK admits exactly
    // two values, so any other literal would abort the rebuild.
    let db = Db::open(database.dir()).expect("open migrated database");
    let store = WorkspaceStore::new(db);
    let workspaces = store
        .list_all()
        .expect("an absorbed unknown value must not fail the whole collection");
    assert_eq!(workspaces.len(), 2);
    let unknown = workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-unknown")
        .expect("absorbed row is still listed");
    assert_eq!(unknown.lifecycle_state, WorkspaceLifecycleState::Archived);
    assert_eq!(unknown.kind, WorkspaceKind::Worktree);
    assert_eq!(
        unknown.archived_branch.as_deref(),
        Some("feature/unknown"),
        "an unknown value is absorbed exactly like retired, backfill included"
    );
    let active = workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-active")
        .expect("active row is still listed");
    assert_eq!(active.lifecycle_state, WorkspaceLifecycleState::Active);
}

#[test]
fn rerunning_the_migration_on_an_already_migrated_database_is_a_no_op() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0067(&mut conn);
    insert_pre_0067_workspace(
        &conn,
        "workspace-retired",
        "retired",
        "complete",
        Some("retire"),
        Some("2026-05-05T00:00:00Z"),
        Some("feature/retired"),
        Some("main"),
    );

    run_migrations(&mut conn).expect("run 0067");
    let archived_at_after_first = optional_text(&conn, "archived_at", "workspace-retired");

    // The ledger normally stops a second run; drop the marker so the body's
    // own idempotence guard is the thing under test.
    conn.execute("DELETE FROM _migrations WHERE name = ?1", [MIGRATION])
        .expect("unmark the migration");
    run_migrations(&mut conn).expect("rerun 0067");

    assert_eq!(lifecycle_of(&conn, "workspace-retired"), "archived");
    assert_eq!(
        optional_text(&conn, "archived_at", "workspace-retired"),
        archived_at_after_first,
        "the guard must return early instead of rebuilding a second time"
    );
    let indexes = index_names(&conn);
    assert!(indexes.contains(&"idx_workspaces_lifecycle".to_string()));
    let workspace_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM workspaces", [], |row| row.get(0))
        .expect("count workspaces");
    assert_eq!(workspace_count, 1);
}
