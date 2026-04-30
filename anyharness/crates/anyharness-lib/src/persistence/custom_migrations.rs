use rusqlite::Transaction;
use serde_json::Value;

pub(super) const CUSTOM_MIGRATIONS: &[(&str, fn(&Transaction<'_>) -> rusqlite::Result<()>)] = &[
    (
        "0016_backfill_session_background_work_timestamps",
        migrate_session_background_work_timestamps,
    ),
    (
        "0036_rename_review_auto_iterate",
        migrate_review_auto_iterate_column,
    ),
];

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

fn migrate_review_auto_iterate_column(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let columns = table_columns(tx, "review_runs")?;
    let has_old = columns.iter().any(|column| column == "auto_send_feedback");
    let has_new = columns.iter().any(|column| column == "auto_iterate");

    if has_old && !has_new {
        tx.execute_batch(
            "ALTER TABLE review_runs
             RENAME COLUMN auto_send_feedback TO auto_iterate",
        )?;
    }

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

    use super::{table_columns, CUSTOM_MIGRATIONS};
    use crate::persistence::migrations::{run_migrations, MIGRATIONS};

    #[test]
    fn custom_migrations_register_review_auto_iterate_rename() {
        assert!(CUSTOM_MIGRATIONS
            .iter()
            .any(|(name, _)| *name == "0036_rename_review_auto_iterate"));
    }

    #[test]
    fn review_auto_iterate_migration_renames_old_0034_schema() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE review_runs (
                id TEXT PRIMARY KEY,
                auto_send_feedback INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO review_runs (id, auto_send_feedback) VALUES ('review-1', 0);",
        )
        .expect("seed old schema");
        for (name, _) in MIGRATIONS {
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark sql migration applied");
        }
        conn.execute(
            "INSERT INTO _migrations (name) VALUES ('0016_backfill_session_background_work_timestamps')",
            [],
        )
        .expect("mark 0016 custom migration applied");

        run_migrations(&mut conn).expect("run migrations");

        let columns = table_column_names(&conn, "review_runs");
        assert!(columns.contains(&"auto_iterate".to_string()));
        assert!(!columns.contains(&"auto_send_feedback".to_string()));
        let value: i64 = conn
            .query_row(
                "SELECT auto_iterate FROM review_runs WHERE id = 'review-1'",
                [],
                |row| row.get(0),
            )
            .expect("select renamed value");
        assert_eq!(value, 0);
    }

    #[test]
    fn review_auto_iterate_migration_handles_legacy_0033_alias_schema() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE _migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE review_runs (
                id TEXT PRIMARY KEY,
                auto_send_feedback INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO review_runs (id, auto_send_feedback) VALUES ('review-1', 1);
            INSERT INTO _migrations (name) VALUES ('0033_review_agent_loops');",
        )
        .expect("seed legacy schema");
        for (name, _) in MIGRATIONS {
            if *name == "0034_review_agent_loops" {
                continue;
            }
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .expect("mark sql migration applied");
        }
        conn.execute(
            "INSERT INTO _migrations (name) VALUES ('0016_backfill_session_background_work_timestamps')",
            [],
        )
        .expect("mark 0016 custom migration applied");

        run_migrations(&mut conn).expect("run migrations");

        let columns = table_column_names(&conn, "review_runs");
        assert!(columns.contains(&"auto_iterate".to_string()));
        assert!(!columns.contains(&"auto_send_feedback".to_string()));
        let marked: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = '0034_review_agent_loops')",
                [],
                |row| row.get(0),
            )
            .expect("query 0034 marker");
        assert!(marked);
    }

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

        let tx = conn.transaction().expect("open transaction");
        let columns = table_columns(&tx, "session_background_work").expect("list columns");
        tx.commit().expect("commit read transaction");
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

    fn table_column_names(conn: &Connection, table_name: &str) -> Vec<String> {
        let pragma = format!("PRAGMA table_info({table_name})");
        let mut stmt = conn.prepare(&pragma).expect("prepare pragma");
        stmt.query_map([], |row| row.get::<_, String>(1))
            .expect("query columns")
            .collect::<Result<_, _>>()
            .expect("collect columns")
    }
}
