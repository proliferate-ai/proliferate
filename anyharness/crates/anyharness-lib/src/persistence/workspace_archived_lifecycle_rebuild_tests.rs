//! The 0067 rebuild's SCHEMA-shape proofs, split out of
//! `workspace_archived_lifecycle_migration_tests.rs` (which owns the row-data
//! half: absorption, the two backfills, and the tolerant read) so both files
//! stay under the 600-line cap without a net-new `max_lines` exception.
//!
//! Pins here: the column set the rebuild produces (the five cleanup columns
//! survive until R5's 0068 drops them, the four archive columns arrive), all
//! three indexes including the renamed lifecycle index and its column tuple,
//! restored foreign-key enforcement, and the body's own idempotence guard.
//!
//! The fixture (`TempDatabase`, `seed_pre_0067`, `insert_pre_0067_workspace`,
//! and the small readers) lives in the sibling module and is shared from
//! there, exactly as `custom_migration_registry_tests::table_column_names` is.

use rusqlite::Connection;

use super::custom_migration_registry_tests::table_column_names;
use super::migrations::run_migrations;
use super::workspace_archived_lifecycle_migration_tests::{
    index_names, insert_pre_0067_workspace, lifecycle_of, optional_text, seed_pre_0067,
    TempDatabase, MIGRATION,
};

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
