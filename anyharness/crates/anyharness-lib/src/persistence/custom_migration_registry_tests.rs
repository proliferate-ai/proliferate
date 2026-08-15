use rusqlite::Connection;

use super::custom_migrations::{CUSTOM_FOREIGN_KEY_MIGRATIONS, CUSTOM_MIGRATIONS};

pub(super) fn mark_foreign_key_migrations_applied(conn: &Connection) {
    for (name, _) in CUSTOM_FOREIGN_KEY_MIGRATIONS {
        conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
            .expect("mark foreign-key migration applied");
    }
}

pub(super) fn table_column_names(conn: &Connection, table_name: &str) -> Vec<String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn.prepare(&pragma).expect("prepare pragma");
    stmt.query_map([], |row| row.get::<_, String>(1))
        .expect("query columns")
        .collect::<Result<_, _>>()
        .expect("collect columns")
}

#[test]
fn custom_migrations_register_review_auto_iterate_rename() {
    assert!(CUSTOM_MIGRATIONS
        .iter()
        .any(|(name, _)| *name == "0036_rename_review_auto_iterate"));
}

#[test]
fn custom_foreign_key_migrations_register_the_workspace_archived_lifecycle_rebuild() {
    assert!(CUSTOM_FOREIGN_KEY_MIGRATIONS
        .iter()
        .any(|(name, _)| *name == "0067_workspace_archived_lifecycle"));
}

#[test]
fn custom_foreign_key_migrations_register_the_workspace_drop_cleanup_columns_rebuild() {
    assert!(CUSTOM_FOREIGN_KEY_MIGRATIONS
        .iter()
        .any(|(name, _)| *name == "0068_workspace_drop_cleanup_columns"));
    // The rebuild must run after every earlier workspace rebuild has had its
    // turn at the table; only the workflow gen-2 rebuild (which never touches
    // the workspaces shape) may follow it.
    let position = CUSTOM_FOREIGN_KEY_MIGRATIONS
        .iter()
        .position(|(name, _)| *name == "0068_workspace_drop_cleanup_columns")
        .expect("registry contains the drop-cleanup rebuild");
    assert_eq!(
        CUSTOM_FOREIGN_KEY_MIGRATIONS[position + 1..]
            .iter()
            .map(|(name, _)| *name)
            .collect::<Vec<_>>(),
        vec!["0069_workflow_runs_gen2", "0070_workflow_run_cancel_status"]
    );
}

#[test]
fn custom_foreign_key_migrations_register_the_workflow_run_cancel_status_rebuild_after_gen2() {
    // The cancel-status rebuild widens the CHECK vocabularies 0069 first
    // creates, so it must run strictly after 0069 claims the table names.
    let gen2_position = CUSTOM_FOREIGN_KEY_MIGRATIONS
        .iter()
        .position(|(name, _)| *name == "0069_workflow_runs_gen2")
        .expect("registry contains the gen-2 rebuild");
    let cancel_position = CUSTOM_FOREIGN_KEY_MIGRATIONS
        .iter()
        .position(|(name, _)| *name == "0070_workflow_run_cancel_status")
        .expect("registry contains the cancel-status rebuild");
    assert!(cancel_position > gen2_position);
}
