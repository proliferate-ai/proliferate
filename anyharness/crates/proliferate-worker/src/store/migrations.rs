use rusqlite::Connection;

use super::WorkerStore;
use crate::error::WorkerError;

impl WorkerStore {
    pub(super) fn migrate(&self) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS identity (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                target_id TEXT NOT NULL,
                worker_id TEXT NOT NULL,
                worker_token TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sync_sessions (
                session_id TEXT PRIMARY KEY,
                workspace_id TEXT,
                last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sync_workspaces (
                workspace_id TEXT PRIMARY KEY,
                cloud_workspace_id TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS worker_projection_cursor (
                session_projection_id TEXT PRIMARY KEY,
                exposure_id TEXT NOT NULL,
                anyharness_workspace_id TEXT NOT NULL,
                anyharness_session_id TEXT NOT NULL,
                projection_level TEXT NOT NULL,
                commandable INTEGER NOT NULL CHECK (commandable IN (0, 1)),
                last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
                last_ack_seq INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                gap_state_json TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS ix_worker_projection_cursor_active_session
                ON worker_projection_cursor(status, anyharness_session_id);
            CREATE TABLE IF NOT EXISTS pending_command_results (
                command_id TEXT PRIMARY KEY,
                lease_id TEXT NOT NULL,
                cloud_workspace_id TEXT,
                anyharness_workspace_id TEXT,
                status TEXT NOT NULL,
                error_code TEXT,
                error_message TEXT,
                result_json TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS worker_workspace_discovery (
                exposure_id TEXT PRIMARY KEY,
                anyharness_workspace_id TEXT NOT NULL,
                last_checked_unix_ms INTEGER NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS worker_exposure_snapshot (
                snapshot_key TEXT PRIMARY KEY,
                exposure_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                cloud_workspace_id TEXT NOT NULL,
                session_projection_id TEXT,
                anyharness_workspace_id TEXT NOT NULL,
                anyharness_session_id TEXT,
                projection_level TEXT NOT NULL,
                commandable INTEGER NOT NULL CHECK (commandable IN (0, 1)),
                status TEXT NOT NULL,
                revision INTEGER,
                last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS ix_worker_exposure_snapshot_workspace
                ON worker_exposure_snapshot(status, anyharness_workspace_id);
            CREATE TABLE IF NOT EXISTS worker_control_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                control_cursor TEXT,
                exposure_cache_initialized INTEGER NOT NULL DEFAULT 0
                    CHECK (exposure_cache_initialized IN (0, 1)),
                legacy_exposure_polling_enabled INTEGER NOT NULL DEFAULT 0
                    CHECK (legacy_exposure_polling_enabled IN (0, 1)),
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS applied_revisions (
                domain TEXT PRIMARY KEY,
                applied_revision INTEGER NOT NULL DEFAULT 0,
                desired_revision INTEGER NOT NULL DEFAULT 0,
                failure_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_unix_ms INTEGER,
                status TEXT NOT NULL DEFAULT 'idle',
                error_code TEXT,
                error_message TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )?;
        add_column_if_missing(
            &conn,
            "pending_command_results",
            "cloud_workspace_id",
            "cloud_workspace_id TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "pending_command_results",
            "anyharness_workspace_id",
            "anyharness_workspace_id TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "worker_projection_cursor",
            "gap_state_json",
            "gap_state_json TEXT",
        )?;
        ensure_projection_cursor_keyed_by_projection(&conn)?;
        Ok(())
    }
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    column_definition: &str,
) -> Result<(), WorkerError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column_definition}"),
        [],
    )?;
    Ok(())
}

fn ensure_projection_cursor_keyed_by_projection(conn: &Connection) -> Result<(), WorkerError> {
    let mut stmt = conn.prepare("PRAGMA table_info(worker_projection_cursor)")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, i64>(5)?))
    })?;
    let mut primary_key_column = None;
    for row in rows {
        let (name, primary_key_order) = row?;
        if primary_key_order > 0 {
            primary_key_column = Some(name);
            break;
        }
    }
    if primary_key_column.as_deref() == Some("session_projection_id") {
        return Ok(());
    }
    conn.execute("DROP TABLE IF EXISTS worker_projection_cursor", [])?;
    conn.execute(
        r#"
        CREATE TABLE worker_projection_cursor (
            session_projection_id TEXT PRIMARY KEY,
            exposure_id TEXT NOT NULL,
            anyharness_workspace_id TEXT NOT NULL,
            anyharness_session_id TEXT NOT NULL,
            projection_level TEXT NOT NULL,
            commandable INTEGER NOT NULL CHECK (commandable IN (0, 1)),
            last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
            last_ack_seq INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            gap_state_json TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        [],
    )?;
    conn.execute(
        r#"
        CREATE INDEX IF NOT EXISTS ix_worker_projection_cursor_active_session
            ON worker_projection_cursor(status, anyharness_session_id)
        "#,
        [],
    )?;
    Ok(())
}
