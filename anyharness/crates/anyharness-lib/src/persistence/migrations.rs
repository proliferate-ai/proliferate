use rusqlite::{Connection, Transaction};

use super::custom_migrations::CUSTOM_MIGRATIONS;

pub(super) const MIGRATIONS: &[(&str, &str)] = &[
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
    (
        "0014_session_pending_prompts",
        include_str!("sql/0014_session_pending_prompts.sql"),
    ),
    (
        "0015_session_background_work",
        include_str!("sql/0015_session_background_work.sql"),
    ),
    (
        "0017_repo_roots_additive",
        include_str!("sql/0017_repo_roots_additive.sql"),
    ),
    (
        "0018_workspaces_repo_root_link",
        include_str!("sql/0018_workspaces_repo_root_link.sql"),
    ),
    (
        "0019_session_system_prompt_append",
        include_str!("sql/0019_session_system_prompt_append.sql"),
    ),
    (
        "0020_cowork_tables",
        include_str!("sql/0020_cowork_tables.sql"),
    ),
    (
        "0021_workspace_access_modes",
        include_str!("sql/0021_workspace_access_modes.sql"),
    ),
    (
        "0023_proposed_plans",
        include_str!("sql/0023_proposed_plans.sql"),
    ),
    (
        "0024_session_mcp_binding_summaries",
        include_str!("sql/0024_session_mcp_binding_summaries.sql"),
    ),
    (
        "0025_session_pending_prompt_blocks",
        include_str!("sql/0025_session_pending_prompt_blocks.sql"),
    ),
    (
        "0026_workspace_session_origin",
        include_str!("sql/0026_workspace_session_origin.sql"),
    ),
    (
        "0027_workspace_lifecycle_state",
        include_str!("sql/0027_workspace_lifecycle_state.sql"),
    ),
    (
        "0028_mobility_archive_installs",
        include_str!("sql/0028_mobility_archive_installs.sql"),
    ),
    (
        "0029_session_links_prompt_provenance",
        include_str!("sql/0029_session_links_prompt_provenance.sql"),
    ),
    (
        "0030_subagent_links_and_completions",
        include_str!("sql/0030_subagent_links_and_completions.sql"),
    ),
    (
        "0031_session_subagents_policy",
        include_str!("sql/0031_session_subagents_policy.sql"),
    ),
    (
        "0032_cowork_managed_workspaces",
        include_str!("sql/0032_cowork_managed_workspaces.sql"),
    ),
    (
        "0033_workspace_creator_context",
        include_str!("sql/0033_workspace_creator_context.sql"),
    ),
    (
        "0034_review_agent_loops",
        include_str!("sql/0034_review_agent_loops.sql"),
    ),
    (
        "0035_review_assignments_active_reviewer_index",
        include_str!("sql/0035_review_assignments_active_reviewer_index.sql"),
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
        run_named_migration(conn, name, |tx| tx.execute_batch(sql))?;
    }

    for (name, apply) in CUSTOM_MIGRATIONS {
        run_named_migration(conn, name, |tx| apply(tx))?;
    }

    Ok(())
}

fn run_named_migration<F>(conn: &mut Connection, name: &str, apply: F) -> rusqlite::Result<()>
where
    F: FnOnce(&Transaction<'_>) -> rusqlite::Result<()>,
{
    let already_applied = migration_applied(conn, name)?;

    if already_applied {
        return Ok(());
    }

    for alias in migration_aliases(name) {
        if migration_applied(conn, alias)? {
            tracing::info!(
                migration = name,
                alias,
                "marking migration applied through legacy alias"
            );
            conn.execute(
                "INSERT OR IGNORE INTO _migrations (name) VALUES (?1)",
                [name],
            )?;
            return Ok(());
        }
    }

    tracing::info!(migration = name, "applying migration");
    let tx = conn.transaction()?;
    apply(&tx)?;
    tx.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])?;
    tx.commit()?;
    Ok(())
}

fn migration_applied(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = ?1)",
        [name],
        |row| row.get(0),
    )
}

fn migration_aliases(name: &str) -> &'static [&'static str] {
    match name {
        // The review-loop migration was originally 0033 before main added
        // 0033_workspace_creator_context. Local dev profiles may have applied
        // that old name already; do not rerun the same schema changes as 0034.
        "0034_review_agent_loops" => &["0033_review_agent_loops"],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use rusqlite::Connection;

    use super::run_named_migration;

    #[test]
    fn review_loop_migration_accepts_legacy_0033_alias() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO _migrations (name) VALUES ('0033_review_agent_loops');",
        )
        .expect("seed legacy migration");
        let called = Cell::new(false);

        run_named_migration(&mut conn, "0034_review_agent_loops", |_tx| {
            called.set(true);
            Ok(())
        })
        .expect("run alias migration");

        assert!(!called.get());
        let marked: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = '0034_review_agent_loops')",
                [],
                |row| row.get(0),
            )
            .expect("query migration marker");
        assert!(marked);
    }
}
