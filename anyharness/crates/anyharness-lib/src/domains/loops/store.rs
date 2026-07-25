use anyharness_contract::v1::{LoopScheduleKind, LoopStatus};
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::model::LoopRecord;
use crate::domains::sessions::model::SessionEventRecord;
use crate::persistence::Db;

#[derive(Clone)]
pub struct LoopStore {
    db: Db,
}

impl LoopStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn with_tx_anyhow<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T>,
    {
        self.db.with_tx_anyhow(f)
    }

    pub fn find_by_id(&self, loop_id: &str) -> anyhow::Result<Option<LoopRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM loops WHERE id = ?1", [loop_id], map_loop)
                .optional()
        })
    }

    pub fn list_active_by_session(&self, session_id: &str) -> anyhow::Result<Vec<LoopRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM loops
                 WHERE session_id = ?1 AND status = 'active'
                 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map([session_id], map_loop)?;
            rows.collect()
        })
    }

    pub fn list_by_workspace(
        &self,
        workspace_id: &str,
        limit: usize,
    ) -> anyhow::Result<Vec<LoopRecord>> {
        let limit = i64::try_from(limit.max(1)).unwrap_or(100);
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM loops
                 WHERE workspace_id = ?1
                 ORDER BY updated_at DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![workspace_id, limit], map_loop)?;
            rows.collect()
        })
    }

    pub fn find_by_id_tx(tx: &Connection, loop_id: &str) -> rusqlite::Result<Option<LoopRecord>> {
        tx.query_row("SELECT * FROM loops WHERE id = ?1", [loop_id], map_loop)
            .optional()
    }

    pub fn find_by_native_loop_id_tx(
        tx: &Connection,
        session_id: &str,
        native_loop_id: &str,
    ) -> rusqlite::Result<Option<LoopRecord>> {
        tx.query_row(
            "SELECT * FROM loops WHERE session_id = ?1 AND native_loop_id = ?2",
            params![session_id, native_loop_id],
            map_loop,
        )
        .optional()
    }

    pub fn list_active_by_session_tx(
        tx: &Connection,
        session_id: &str,
    ) -> rusqlite::Result<Vec<LoopRecord>> {
        let mut stmt = tx.prepare(
            "SELECT * FROM loops
             WHERE session_id = ?1 AND status = 'active'
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([session_id], map_loop)?;
        rows.collect()
    }

    pub fn insert_loop(tx: &Connection, record: &LoopRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO loops (
                id, workspace_id, session_id, prompt, schedule_kind, schedule_expr, recurring,
                status, native, native_loop_id, last_fired_at, next_fire_at, fire_count,
                max_fires, max_wall_secs, source_kind, cleared_reason, native_state_json,
                revision, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            params![
                record.id,
                record.workspace_id,
                record.session_id,
                record.prompt,
                schedule_kind_to_db(record.schedule_kind),
                record.schedule_expr,
                record.recurring,
                record.status.as_str(),
                record.native,
                record.native_loop_id,
                record.last_fired_at,
                record.next_fire_at,
                record.fire_count,
                record.max_fires,
                record.max_wall_secs,
                record.source_kind,
                record.cleared_reason,
                record.native_state_json,
                record.revision,
                record.created_at,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_loop(tx: &Connection, record: &LoopRecord) -> rusqlite::Result<()> {
        tx.execute(
            "UPDATE loops SET
                prompt = ?2, schedule_kind = ?3, schedule_expr = ?4, recurring = ?5,
                status = ?6, native_loop_id = ?7, last_fired_at = ?8, next_fire_at = ?9,
                fire_count = ?10, max_fires = ?11, max_wall_secs = ?12, source_kind = ?13,
                cleared_reason = ?14, native_state_json = ?15, revision = ?16, updated_at = ?17
             WHERE id = ?1",
            params![
                record.id,
                record.prompt,
                schedule_kind_to_db(record.schedule_kind),
                record.schedule_expr,
                record.recurring,
                record.status.as_str(),
                record.native_loop_id,
                record.last_fired_at,
                record.next_fire_at,
                record.fire_count,
                record.max_fires,
                record.max_wall_secs,
                record.source_kind,
                record.cleared_reason,
                record.native_state_json,
                record.revision,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn insert_event(tx: &Connection, record: &SessionEventRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO session_events (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.session_id,
                record.seq,
                record.timestamp,
                record.event_type,
                record.turn_id,
                record.item_id,
                record.payload_json,
            ],
        )?;
        Ok(())
    }

    pub fn next_event_seq(tx: &Connection, session_id: &str) -> rusqlite::Result<i64> {
        let max: Option<i64> = tx.query_row(
            "SELECT MAX(seq) FROM session_events WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(max.unwrap_or(0) + 1)
    }
}

fn schedule_kind_to_db(kind: LoopScheduleKind) -> &'static str {
    match kind {
        LoopScheduleKind::Interval => "interval",
        LoopScheduleKind::Cron => "cron",
    }
}

fn schedule_kind_from_db(value: &str) -> rusqlite::Result<LoopScheduleKind> {
    match value {
        "interval" => Ok(LoopScheduleKind::Interval),
        "cron" => Ok(LoopScheduleKind::Cron),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown loop schedule kind: {other}").into(),
        )),
    }
}

fn status_from_db(value: &str) -> rusqlite::Result<LoopStatus> {
    match value {
        "active" => Ok(LoopStatus::Active),
        "paused" => Ok(LoopStatus::Paused),
        "cleared" => Ok(LoopStatus::Cleared),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown loop status: {other}").into(),
        )),
    }
}

pub(crate) fn map_loop(row: &Row<'_>) -> rusqlite::Result<LoopRecord> {
    Ok(LoopRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        prompt: row.get("prompt")?,
        schedule_kind: schedule_kind_from_db(row.get::<_, String>("schedule_kind")?.as_str())?,
        schedule_expr: row.get("schedule_expr")?,
        recurring: row.get("recurring")?,
        status: status_from_db(row.get::<_, String>("status")?.as_str())?,
        native: row.get("native")?,
        native_loop_id: row.get("native_loop_id")?,
        last_fired_at: row.get("last_fired_at")?,
        next_fire_at: row.get("next_fire_at")?,
        fire_count: row.get("fire_count")?,
        max_fires: row.get("max_fires")?,
        max_wall_secs: row.get("max_wall_secs")?,
        source_kind: row.get("source_kind")?,
        cleared_reason: row.get("cleared_reason")?,
        native_state_json: row.get("native_state_json")?,
        revision: row.get("revision")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
