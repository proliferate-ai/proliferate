//! File-backed upgrade proof for `0068_workspace_drop_cleanup_columns`: the
//! FK-off full-table rebuild that drops the five `cleanup_*` columns purge no
//! longer writes now that the row dies last (ADR §6, R5).
//!
//! Pins: the five columns are gone, every other column and its data survives
//! the rebuild untouched, the three indexes (including
//! `idx_workspaces_lifecycle` under its R1 name) survive, foreign-key
//! enforcement is restored, and the guard makes a second run a no-op.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::custom_migration_registry_tests::table_column_names;
use super::migrations::run_migrations;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

const MIGRATION: &str = "0068_workspace_drop_cleanup_columns";

struct TempDatabase {
    dir: PathBuf,
}

impl TempDatabase {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "anyharness-workspace-drop-cleanup-migration-{}",
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

/// The real pre-0068 schema: run the whole registry with 0068 pre-marked as
/// applied (so 0067 runs for real and the four archive columns exist), then
/// unmark 0068. That reproduces the exact post-0067 shape a field database is
/// in, including the five cleanup columns, instead of a hand-copied
/// approximation that can drift from the registry.
fn seed_pre_0068(conn: &mut Connection) {
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
    run_migrations(conn).expect("seed pre-0068 schema");
    conn.execute("DELETE FROM _migrations WHERE name = ?1", [MIGRATION])
        .expect("unmark the migration under test");

    conn.execute(
        "INSERT INTO repo_roots (id, kind, path, created_at, updated_at)
         VALUES ('repo-root-1', 'external', '/tmp/repo-root-1',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .expect("seed repo root");
}

#[allow(clippy::too_many_arguments)]
fn insert_pre_0068_workspace(
    conn: &Connection,
    id: &str,
    lifecycle_state: &str,
    current_branch: Option<&str>,
    archived_head_sha: Option<&str>,
    archived_branch: Option<&str>,
    archived_at: Option<&str>,
) {
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, original_branch, current_branch,
            display_name, origin_json, creator_context_json, lifecycle_state,
            cleanup_state, cleanup_operation, cleanup_error_message, cleanup_failed_at,
            cleanup_attempted_at, archived_head_sha, archived_branch, archived_at,
            partial_capture_json, created_at, updated_at
         ) VALUES (
            ?1, 'worktree', 'repo-root-1', ?2, 'standard', 'main', ?3,
            NULL, NULL, NULL, ?4,
            'none', NULL, NULL, NULL,
            NULL, ?5, ?6, ?7,
            NULL, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'
         )",
        rusqlite::params![
            id,
            format!("/tmp/{id}"),
            current_branch,
            lifecycle_state,
            archived_head_sha,
            archived_branch,
            archived_at,
        ],
    )
    .expect("insert pre-0068 workspace row");
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
fn the_rebuild_drops_all_five_cleanup_columns() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0068(&mut conn);
    insert_pre_0068_workspace(&conn, "workspace-1", "active", Some("main"), None, None, None);

    run_migrations(&mut conn).expect("run 0068");

    let columns = table_column_names(&conn, "workspaces");
    for column in [
        "cleanup_state",
        "cleanup_operation",
        "cleanup_error_message",
        "cleanup_failed_at",
        "cleanup_attempted_at",
    ] {
        assert!(
            !columns.contains(&column.to_string()),
            "{column} must be dropped by R5: {columns:?}"
        );
    }
}

#[test]
fn every_other_column_and_its_data_survives_the_rebuild() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0068(&mut conn);
    insert_pre_0068_workspace(
        &conn,
        "workspace-archived",
        "archived",
        Some("feature/archived"),
        Some("deadbeef"),
        Some("feature/archived"),
        Some("2026-05-05T00:00:00Z"),
    );
    insert_pre_0068_workspace(&conn, "workspace-active", "active", Some("main"), None, None, None);

    run_migrations(&mut conn).expect("run 0068");

    let columns = table_column_names(&conn, "workspaces");
    for column in [
        "id",
        "kind",
        "repo_root_id",
        "path",
        "surface",
        "original_branch",
        "current_branch",
        "display_name",
        "origin_json",
        "creator_context_json",
        "lifecycle_state",
        "archived_head_sha",
        "archived_branch",
        "archived_at",
        "partial_capture_json",
        "created_at",
        "updated_at",
    ] {
        assert!(
            columns.contains(&column.to_string()),
            "missing surviving column {column}: {columns:?}"
        );
    }
    assert_eq!(
        optional_text(&conn, "archived_head_sha", "workspace-archived"),
        Some("deadbeef".to_string())
    );
    assert_eq!(
        optional_text(&conn, "archived_branch", "workspace-archived"),
        Some("feature/archived".to_string())
    );
    assert_eq!(
        optional_text(&conn, "archived_at", "workspace-archived"),
        Some("2026-05-05T00:00:00Z".to_string())
    );
    assert_eq!(
        optional_text(&conn, "lifecycle_state", "workspace-active"),
        Some("active".to_string())
    );
}

#[test]
fn the_rebuild_recreates_all_three_indexes() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0068(&mut conn);

    run_migrations(&mut conn).expect("run 0068");

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
        "lifecycle index must keep its R1 column tuple: {sql}"
    );
}

#[test]
fn foreign_key_enforcement_is_restored_after_the_rebuild() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0068(&mut conn);
    insert_pre_0068_workspace(&conn, "workspace-active", "active", Some("main"), None, None, None);

    run_migrations(&mut conn).expect("run 0068");

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
fn the_workspace_store_reads_rows_fine_with_the_cleanup_columns_gone() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0068(&mut conn);
    insert_pre_0068_workspace(
        &conn,
        "workspace-archived",
        "archived",
        Some("feature/archived"),
        Some("deadbeef"),
        Some("feature/archived"),
        Some("2026-05-05T00:00:00Z"),
    );
    insert_pre_0068_workspace(&conn, "workspace-active", "active", Some("main"), None, None, None);

    run_migrations(&mut conn).expect("run 0068");
    drop(conn);

    let db = Db::open(database.dir()).expect("open migrated database");
    let store = WorkspaceStore::new(db);
    let workspaces = store.list_all().expect("list workspaces post-rebuild");
    assert_eq!(workspaces.len(), 2);
    let archived = workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-archived")
        .expect("archived row is still listed");
    assert_eq!(archived.lifecycle_state, WorkspaceLifecycleState::Archived);
    assert_eq!(archived.kind, WorkspaceKind::Worktree);
    let active = workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-active")
        .expect("active row is still listed");
    assert_eq!(active.lifecycle_state, WorkspaceLifecycleState::Active);
}

#[test]
fn an_unknown_lifecycle_value_does_not_brick_listings_after_the_cleanup_columns_drop() {
    // The one assertion the ADR marks as belonging to BOTH migration suites:
    // a row with an unknown lifecycle value must not break workspace
    // listings. R0's tolerant parse is what makes that true, and the column
    // drop must not quietly undo it — a strict read here would turn one
    // forward-written row into a whole-collection read failure, which is the
    // sidebar going blank rather than one row looking odd.
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0068(&mut conn);
    insert_pre_0068_workspace(&conn, "workspace-active", "active", Some("main"), None, None, None);
    insert_pre_0068_workspace(
        &conn,
        "workspace-archived",
        "archived",
        Some("feature/archived"),
        Some("deadbeef"),
        Some("feature/archived"),
        Some("2026-05-05T00:00:00Z"),
    );

    run_migrations(&mut conn).expect("run 0068");

    // A value only a FUTURE binary could have written: the rebuilt CHECK
    // admits exactly `active` and `archived`, so the fixture relaxes it for
    // this one insert the same way the 0067 suite does. Post-rebuild is the
    // realistic moment — the migration itself can only ever carry through
    // what 0067's CHECK already admitted.
    conn.execute_batch("PRAGMA ignore_check_constraints = ON;")
        .expect("relax the CHECK for the fixture");
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, original_branch, current_branch,
            display_name, origin_json, creator_context_json, lifecycle_state,
            archived_head_sha, archived_branch, archived_at, partial_capture_json,
            created_at, updated_at
         ) VALUES (
            'workspace-future', 'worktree', 'repo-root-1', '/tmp/workspace-future', 'standard',
            'main', 'feature/future', NULL, NULL, NULL, 'quarantined',
            NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'
         )",
        [],
    )
    .expect("insert a forward-written lifecycle value");
    conn.execute_batch("PRAGMA ignore_check_constraints = OFF;")
        .expect("restore CHECK enforcement");
    drop(conn);

    let db = Db::open(database.dir()).expect("open migrated database");
    let store = WorkspaceStore::new(db);
    let workspaces = store
        .list_all()
        .expect("an unknown lifecycle value must not fail the whole collection");
    assert_eq!(workspaces.len(), 3);
    let future = workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-future")
        .expect("the unknown-lifecycle row is still listed");
    assert_eq!(
        future.lifecycle_state,
        WorkspaceLifecycleState::Archived,
        "an unknown value reads as archived under the tolerant parse"
    );
    assert_eq!(future.kind, WorkspaceKind::Worktree);
    // Its neighbours are unaffected.
    let active = workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-active")
        .expect("active row is still listed");
    assert_eq!(active.lifecycle_state, WorkspaceLifecycleState::Active);
    let archived = workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-archived")
        .expect("archived row is still listed");
    assert_eq!(archived.lifecycle_state, WorkspaceLifecycleState::Archived);
}

#[test]
fn rerunning_the_migration_on_an_already_migrated_database_is_a_no_op() {
    let database = TempDatabase::new();
    let mut conn = Connection::open(database.path()).expect("open fixture");
    seed_pre_0068(&mut conn);
    insert_pre_0068_workspace(&conn, "workspace-1", "active", Some("main"), None, None, None);

    run_migrations(&mut conn).expect("run 0068");
    let columns_after_first = table_column_names(&conn, "workspaces");

    // The ledger normally stops a second run; drop the marker so the body's
    // own idempotence guard is the thing under test.
    conn.execute("DELETE FROM _migrations WHERE name = ?1", [MIGRATION])
        .expect("unmark the migration");
    run_migrations(&mut conn).expect("rerun 0068");

    assert_eq!(
        table_column_names(&conn, "workspaces"),
        columns_after_first,
        "the guard must return early instead of rebuilding a second time"
    );
    let workspace_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM workspaces", [], |row| row.get(0))
        .expect("count workspaces");
    assert_eq!(workspace_count, 1);
}
