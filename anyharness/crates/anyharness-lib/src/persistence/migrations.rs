use rusqlite::Connection;

const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_initial", include_str!("sql/0001_initial.sql")),
    ("0002_add_item_id", include_str!("sql/0002_add_item_id.sql")),
    (
        "0003_allow_duplicate_workspace_paths",
        include_str!("sql/0003_allow_duplicate_workspace_paths.sql"),
    ),
    (
        "0004_add_session_thinking_budget",
        include_str!("sql/0004_add_session_thinking_budget.sql"),
    ),
    (
        "0005_session_live_config",
        include_str!("sql/0005_session_live_config.sql"),
    ),
    (
        "0006_add_workspace_current_branch",
        include_str!("sql/0006_add_workspace_current_branch.sql"),
    ),
    (
        "0007_add_session_title",
        include_str!("sql/0007_add_session_title.sql"),
    ),
    (
        "0008_session_raw_notifications",
        include_str!("sql/0008_session_raw_notifications.sql"),
    ),
    (
        "0009_split_requested_current_session_config",
        include_str!("sql/0009_split_requested_current_session_config.sql"),
    ),
    (
        "0010_add_session_dismissed_at",
        include_str!("sql/0010_add_session_dismissed_at.sql"),
    ),
    (
        "0011_local_workspace_kind",
        include_str!("sql/0011_local_workspace_kind.sql"),
    ),
    (
        "0012_add_workspace_display_name",
        include_str!("sql/0012_add_workspace_display_name.sql"),
    ),
    (
        "0013_add_session_mcp_bindings_ciphertext",
        include_str!("sql/0013_add_session_mcp_bindings_ciphertext.sql"),
    ),
];

pub fn run_migrations(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )?;

    for (name, sql) in MIGRATIONS {
        let already_applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = ?1)",
            [name],
            |row| row.get(0),
        )?;

        if !already_applied {
            tracing::info!(migration = name, "applying migration");
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])?;
            tx.commit()?;
        }
    }

    Ok(())
}
