use rusqlite::{Connection, Transaction};
use serde_json::Value;

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
];

const CUSTOM_MIGRATIONS: &[(&str, fn(&Transaction<'_>) -> rusqlite::Result<()>)] = &[(
    "0016_backfill_session_background_work_timestamps",
    migrate_session_background_work_timestamps,
)];

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
    let already_applied: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = ?1)",
        [name],
        |row| row.get(0),
    )?;

    if already_applied {
        return Ok(());
    }

    tracing::info!(migration = name, "applying migration");
    let tx = conn.transaction()?;
    apply(&tx)?;
    tx.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])?;
    tx.commit()?;
    Ok(())
}

fn migrate_session_background_work_timestamps(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let columns = table_columns(tx, "session_background_work")?;

    if !columns.iter().any(|column| column == "created_at") {
        tx.execute(
            "ALTER TABLE session_background_work ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    if !columns.iter().any(|column| column == "updated_at") {
        tx.execute(
            "ALTER TABLE session_background_work ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    tx.execute_batch(
        "UPDATE session_background_work
         SET created_at = CASE
                WHEN created_at = '' THEN launched_at
                ELSE created_at
             END,
             updated_at = CASE
                WHEN updated_at = '' THEN COALESCE(completed_at, last_activity_at, launched_at)
                ELSE updated_at
             END",
    )?;

    backfill_pending_background_work(tx)?;
    Ok(())
}

fn table_columns(tx: &Transaction<'_>, table_name: &str) -> rusqlite::Result<Vec<String>> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = tx.prepare(&pragma)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    rows.collect()
}

fn backfill_pending_background_work(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let mut stmt = tx.prepare(
        "SELECT session_id, turn_id, timestamp, payload_json
         FROM session_events
         WHERE event_type = 'item_completed'
           AND payload_json LIKE '%\"backgroundWork\"%'
         ORDER BY session_id ASC, seq ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    for row in rows {
        let (session_id, turn_id, timestamp, payload_json) = row?;
        let Some(record) = pending_background_work_from_completed_event(
            &session_id,
            turn_id.as_deref(),
            &timestamp,
            &payload_json,
        ) else {
            continue;
        };

        tx.execute(
            "INSERT OR IGNORE INTO session_background_work (
                session_id, tool_call_id, turn_id, tracker_kind, source_agent_kind, agent_id,
                output_file, state, created_at, updated_at, launched_at, last_activity_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                record.session_id,
                record.tool_call_id,
                record.turn_id,
                record.tracker_kind,
                record.source_agent_kind,
                record.agent_id,
                record.output_file,
                record.state,
                record.created_at,
                record.updated_at,
                record.launched_at,
                record.last_activity_at,
                record.completed_at,
            ],
        )?;
    }

    Ok(())
}

struct PendingBackgroundWorkBackfill {
    session_id: String,
    tool_call_id: String,
    turn_id: String,
    tracker_kind: String,
    source_agent_kind: String,
    agent_id: Option<String>,
    output_file: String,
    state: String,
    created_at: String,
    updated_at: String,
    launched_at: String,
    last_activity_at: String,
    completed_at: Option<String>,
}

fn pending_background_work_from_completed_event(
    session_id: &str,
    turn_id: Option<&str>,
    timestamp: &str,
    payload_json: &str,
) -> Option<PendingBackgroundWorkBackfill> {
    let payload: Value = serde_json::from_str(payload_json).ok()?;
    let item = payload.get("item")?;
    let tool_call_id = item.get("toolCallId")?.as_str()?.trim();
    let source_agent_kind = item.get("sourceAgentKind")?.as_str()?.trim();
    let raw_output = item.get("rawOutput")?;
    let background_work = raw_output.get("_anyharness")?.get("backgroundWork")?;
    let state = background_work.get("state")?.as_str()?.trim();
    if state != "pending" {
        return None;
    }

    let tracker_kind = background_work.get("trackerKind")?.as_str()?.trim();
    let output_file = raw_output.get("outputFile")?.as_str()?.trim();
    if tool_call_id.is_empty()
        || source_agent_kind.is_empty()
        || tracker_kind.is_empty()
        || output_file.is_empty()
    {
        return None;
    }

    Some(PendingBackgroundWorkBackfill {
        session_id: session_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        turn_id: turn_id.unwrap_or_default().to_string(),
        tracker_kind: tracker_kind.to_string(),
        source_agent_kind: source_agent_kind.to_string(),
        agent_id: raw_output
            .get("agentId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from),
        output_file: output_file.to_string(),
        state: state.to_string(),
        created_at: timestamp.to_string(),
        updated_at: timestamp.to_string(),
        launched_at: timestamp.to_string(),
        last_activity_at: timestamp.to_string(),
        completed_at: None,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{run_migrations, MIGRATIONS};

    #[test]
    fn background_work_timestamp_migration_upgrades_old_schema_and_backfills_rows() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                agent_kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE session_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                seq INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                turn_id TEXT,
                payload_json TEXT NOT NULL,
                item_id TEXT
            );
            CREATE TABLE session_background_work (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                tool_call_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                tracker_kind TEXT NOT NULL,
                source_agent_kind TEXT NOT NULL,
                agent_id TEXT,
                output_file TEXT NOT NULL,
                state TEXT NOT NULL,
                launched_at TEXT NOT NULL,
                last_activity_at TEXT NOT NULL,
                completed_at TEXT,
                PRIMARY KEY (session_id, tool_call_id)
            );
            INSERT INTO sessions (id, workspace_id, agent_kind, status, created_at, updated_at)
            VALUES ('session-1', 'workspace-1', 'claude', 'idle', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z');
            INSERT INTO session_background_work (
                session_id, tool_call_id, turn_id, tracker_kind, source_agent_kind, agent_id,
                output_file, state, launched_at, last_activity_at, completed_at
            ) VALUES (
                'session-1', 'tool-existing', 'turn-1', 'claude_async_agent', 'claude', 'agent-existing',
                '/tmp/existing.output', 'pending', '2026-04-11T00:00:10Z', '2026-04-11T00:00:20Z', NULL
            );
            INSERT INTO session_events (
                session_id, seq, timestamp, event_type, turn_id, item_id, payload_json
            ) VALUES (
                'session-1',
                1,
                '2026-04-11T00:01:00Z',
                'item_completed',
                'turn-1',
                'tool-backfill',
                '{\"item\":{\"kind\":\"tool_invocation\",\"status\":\"completed\",\"sourceAgentKind\":\"claude\",\"toolCallId\":\"tool-backfill\",\"rawOutput\":{\"isAsync\":true,\"agentId\":\"agent-backfill\",\"outputFile\":\"/tmp/backfill.output\",\"_anyharness\":{\"backgroundWork\":{\"trackerKind\":\"claude_async_agent\",\"state\":\"pending\"}}},\"contentParts\":[{\"type\":\"tool_result_text\",\"text\":\"Async agent launched successfully.\"}]}}'
            );",
        )
        .expect("seed old schema");

        for (name, _) in MIGRATIONS {
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark sql migration applied");
        }

        run_migrations(&mut conn).expect("run migrations");

        let mut columns = conn
            .prepare("PRAGMA table_info(session_background_work)")
            .expect("prepare pragma");
        let columns: Vec<String> = columns
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query columns")
            .collect::<Result<_, _>>()
            .expect("collect columns");
        assert!(columns.contains(&"created_at".to_string()));
        assert!(columns.contains(&"updated_at".to_string()));

        let existing: (String, String) = conn
            .query_row(
                "SELECT created_at, updated_at
                 FROM session_background_work
                 WHERE session_id = 'session-1' AND tool_call_id = 'tool-existing'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("select upgraded row");
        assert_eq!(existing.0, "2026-04-11T00:00:10Z");
        assert_eq!(existing.1, "2026-04-11T00:00:20Z");

        let backfilled: (String, String, String, String) = conn
            .query_row(
                "SELECT tracker_kind, source_agent_kind, output_file, created_at
                 FROM session_background_work
                 WHERE session_id = 'session-1' AND tool_call_id = 'tool-backfill'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("select backfilled row");
        assert_eq!(backfilled.0, "claude_async_agent");
        assert_eq!(backfilled.1, "claude");
        assert_eq!(backfilled.2, "/tmp/backfill.output");
        assert_eq!(backfilled.3, "2026-04-11T00:01:00Z");
    }
}
