use rusqlite::{Connection, Transaction};

use super::custom_migrations::{CUSTOM_FOREIGN_KEY_MIGRATIONS, CUSTOM_MIGRATIONS};

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
    (
        "0036_review_assignments_retryable_failed",
        include_str!("sql/0036_review_assignments_retryable_failed.sql"),
    ),
    (
        "0037_terminal_command_runs",
        include_str!("sql/0037_terminal_command_runs.sql"),
    ),
    (
        "0038_workspace_cleanup_details",
        include_str!("sql/0038_workspace_cleanup_details.sql"),
    ),
    (
        "0039_workspace_cleanup_operation",
        include_str!("sql/0039_workspace_cleanup_operation.sql"),
    ),
    (
        "0040_worktree_retention_policy",
        include_str!("sql/0040_worktree_retention_policy.sql"),
    ),
    (
        "0041_session_action_capabilities",
        include_str!("sql/0041_session_action_capabilities.sql"),
    ),
    (
        "0042_fork_link_child_unique",
        include_str!("sql/0042_fork_link_child_unique.sql"),
    ),
    (
        "0043_prompt_attachment_file_storage",
        include_str!("sql/0043_prompt_attachment_file_storage.sql"),
    ),
    (
        "0044_agent_model_registry_snapshots",
        include_str!("sql/0044_agent_model_registry_snapshots.sql"),
    ),
    (
        "0045_delegated_work_handles_and_closure",
        include_str!("sql/0045_delegated_work_handles_and_closure.sql"),
    ),
    (
        "0046_agent_auth_config",
        include_str!("sql/0046_agent_auth_config.sql"),
    ),
    (
        "0047_session_agent_auth_scope",
        include_str!("sql/0047_session_agent_auth_scope.sql"),
    ),
    (
        "0048_runtime_config",
        include_str!("sql/0048_runtime_config.sql"),
    ),
    (
        "0049_session_agent_auth_contexts",
        include_str!("sql/0049_session_agent_auth_contexts.sql"),
    ),
    (
        "0050_drop_agent_auth_config",
        include_str!("sql/0050_drop_agent_auth_config.sql"),
    ),
    ("0051_goals", include_str!("sql/0051_goals.sql")),
    (
        "0052_goal_caps_provenance",
        include_str!("sql/0052_goal_caps_provenance.sql"),
    ),
    (
        "0053_workflow_runs",
        include_str!("sql/0053_workflow_runs.sql"),
    ),
    (
        "0054_workflow_injections",
        include_str!("sql/0054_workflow_injections.sql"),
    ),
    (
        "0055_workflow_lane_cursors",
        include_str!("sql/0055_workflow_lane_cursors.sql"),
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

    for (name, apply) in CUSTOM_FOREIGN_KEY_MIGRATIONS {
        run_named_foreign_key_migration(conn, name, |tx| apply(tx))?;
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

fn run_named_foreign_key_migration<F>(
    conn: &mut Connection,
    name: &str,
    apply: F,
) -> rusqlite::Result<()>
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

    let foreign_keys_enabled = conn.query_row("PRAGMA foreign_keys", [], |row| {
        row.get::<_, i64>(0).map(|value| value != 0)
    })?;

    tracing::info!(
        migration = name,
        "applying migration with foreign keys disabled"
    );
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let migration_result = (|| {
        let tx = conn.transaction()?;
        apply(&tx)?;
        ensure_foreign_key_check_clean(&tx)?;
        tx.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])?;
        tx.commit()
    })();
    let restore_result = restore_foreign_key_enforcement(conn, foreign_keys_enabled, name);

    migration_result?;
    restore_result?;
    Ok(())
}

fn restore_foreign_key_enforcement(
    conn: &Connection,
    was_enabled: bool,
    migration: &str,
) -> rusqlite::Result<()> {
    if !was_enabled {
        return Ok(());
    }

    if let Err(error) = conn.execute_batch("PRAGMA foreign_keys = ON;") {
        tracing::error!(
            migration,
            %error,
            "failed to restore SQLite foreign key enforcement after custom migration; connection must not be reused"
        );
        return Err(error);
    }

    let restored = conn.query_row("PRAGMA foreign_keys", [], |row| {
        row.get::<_, i64>(0).map(|value| value != 0)
    })?;

    if !restored {
        tracing::error!(
            migration,
            "SQLite foreign key enforcement remained disabled after custom migration; connection must not be reused"
        );
        return Err(rusqlite::Error::InvalidQuery);
    }

    Ok(())
}

fn ensure_foreign_key_check_clean(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let mut stmt = tx.prepare("PRAGMA foreign_key_check")?;
    let mut rows = stmt.query([])?;
    if rows.next()?.is_some() {
        return Err(rusqlite::Error::InvalidQuery);
    }
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

    use super::{restore_foreign_key_enforcement, run_migrations, run_named_migration};

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

    #[test]
    fn review_assignments_accept_retryable_failed_status() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&mut conn).expect("run migrations");
        conn.execute_batch("PRAGMA foreign_keys = OFF;")
            .expect("disable foreign keys for constraint probe");

        conn.execute(
            "INSERT INTO review_assignments (
                id, review_run_id, review_round_id, persona_id, persona_label,
                persona_prompt, agent_kind, mode_verification_status, status,
                deadline_at, reminder_count, created_at, updated_at
             ) VALUES (
                'assignment-1', 'run-1', 'round-1', 'persona-1', 'Reviewer',
                'Review the work.', 'claude', 'pending', 'retryable_failed',
                '2026-04-28T00:00:00Z', 0, '2026-04-28T00:00:00Z', '2026-04-28T00:00:00Z'
             )",
            [],
        )
        .expect("insert retryable failed assignment");
    }

    #[test]
    fn restore_foreign_key_enforcement_restores_original_on_state() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = OFF;")
            .expect("disable foreign keys");

        restore_foreign_key_enforcement(&conn, true, "test_restore").expect("restore foreign keys");

        let enabled: bool = conn
            .query_row("PRAGMA foreign_keys", [], |row| {
                row.get::<_, i64>(0).map(|value| value != 0)
            })
            .expect("query foreign key state");
        assert!(enabled);
    }

    #[test]
    fn restore_foreign_key_enforcement_preserves_original_off_state() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = OFF;")
            .expect("disable foreign keys");

        restore_foreign_key_enforcement(&conn, false, "test_restore")
            .expect("preserve foreign keys off");

        let enabled: bool = conn
            .query_row("PRAGMA foreign_keys", [], |row| {
                row.get::<_, i64>(0).map(|value| value != 0)
            })
            .expect("query foreign key state");
        assert!(!enabled);
    }
}
