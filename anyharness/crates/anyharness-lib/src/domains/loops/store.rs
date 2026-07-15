use std::collections::HashMap;

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

    pub fn find_one(&self, session_id: &str, loop_id: &str) -> anyhow::Result<Option<LoopRecord>> {
        self.db
            .with_conn(|conn| Self::find_one_tx(conn, session_id, loop_id))
    }

    pub fn find_one_tx(
        tx: &Connection,
        session_id: &str,
        loop_id: &str,
    ) -> rusqlite::Result<Option<LoopRecord>> {
        tx.query_row(
            "SELECT * FROM loops WHERE session_id = ?1 AND loop_id = ?2",
            params![session_id, loop_id],
            map_loop,
        )
        .optional()
    }

    /// Active loops for one session, most-recently-updated first (the
    /// composer chip / loops panel read model).
    pub fn list_active(&self, session_id: &str) -> anyhow::Result<Vec<LoopRecord>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM loops
                 WHERE session_id = ?1 AND status = 'active'
                 ORDER BY updated_at_ms DESC",
            )?;
            let rows = statement
                .query_map([session_id], map_loop)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    pub fn list_active_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, Vec<LoopRecord>>> {
        let mut grouped: HashMap<String, Vec<LoopRecord>> = HashMap::new();
        if session_ids.is_empty() {
            return Ok(grouped);
        }
        self.db.with_conn(|conn| {
            for session_id in session_ids {
                let mut statement = conn.prepare(
                    "SELECT * FROM loops
                     WHERE session_id = ?1 AND status = 'active'
                     ORDER BY updated_at_ms DESC",
                )?;
                let rows = statement
                    .query_map([session_id], map_loop)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                if !rows.is_empty() {
                    grouped.insert(session_id.clone(), rows);
                }
            }
            Ok(())
        })?;
        Ok(grouped)
    }

    /// Active emulated (`native = 0`) loops for one session — the set the
    /// runtime [`super::scheduler::LoopScheduler`] re-arms on session attach.
    pub fn list_active_emulated(&self, session_id: &str) -> anyhow::Result<Vec<LoopRecord>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM loops
                 WHERE session_id = ?1 AND status = 'active' AND native = 0
                 ORDER BY updated_at_ms DESC",
            )?;
            let rows = statement
                .query_map([session_id], map_loop)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    pub fn upsert_loop(tx: &Connection, record: &LoopRecord) -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO loops (
                session_id, workspace_id, loop_id, prompt, schedule_kind, schedule_expr,
                recurring, status, native, last_fired_at_ms, fire_count, native_state_json,
                max_fires, next_fire_at_ms, created_at, updated_at_ms
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(session_id, loop_id) DO UPDATE SET
                prompt = excluded.prompt,
                schedule_kind = excluded.schedule_kind,
                schedule_expr = excluded.schedule_expr,
                recurring = excluded.recurring,
                status = excluded.status,
                native = excluded.native,
                last_fired_at_ms = excluded.last_fired_at_ms,
                fire_count = excluded.fire_count,
                native_state_json = excluded.native_state_json,
                max_fires = excluded.max_fires,
                next_fire_at_ms = excluded.next_fire_at_ms,
                updated_at_ms = excluded.updated_at_ms",
            params![
                record.session_id,
                record.workspace_id,
                record.loop_id,
                record.prompt,
                schedule_kind_to_db(record.schedule_kind),
                record.schedule_expr,
                record.recurring,
                status_to_db(record.status),
                record.native,
                record.last_fired_at_ms,
                record.fire_count,
                record.native_state_json,
                record.max_fires,
                record.next_fire_at_ms,
                record.created_at,
                record.updated_at_ms,
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
}

pub fn status_to_db(status: LoopStatus) -> &'static str {
    match status {
        LoopStatus::Active => "active",
        LoopStatus::Cleared => "cleared",
    }
}

fn status_from_db(value: &str) -> rusqlite::Result<LoopStatus> {
    match value {
        "active" => Ok(LoopStatus::Active),
        "cleared" => Ok(LoopStatus::Cleared),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown loop status: {other}").into(),
        )),
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

fn map_loop(row: &Row<'_>) -> rusqlite::Result<LoopRecord> {
    Ok(LoopRecord {
        session_id: row.get("session_id")?,
        workspace_id: row.get("workspace_id")?,
        loop_id: row.get("loop_id")?,
        prompt: row.get("prompt")?,
        schedule_kind: schedule_kind_from_db(row.get::<_, String>("schedule_kind")?.as_str())?,
        schedule_expr: row.get("schedule_expr")?,
        recurring: row.get("recurring")?,
        status: status_from_db(row.get::<_, String>("status")?.as_str())?,
        native: row.get("native")?,
        last_fired_at_ms: row.get("last_fired_at_ms")?,
        fire_count: row.get("fire_count")?,
        native_state_json: row.get("native_state_json")?,
        max_fires: row.get("max_fires")?,
        next_fire_at_ms: row.get("next_fire_at_ms")?,
        created_at: row.get("created_at")?,
        updated_at_ms: row.get("updated_at_ms")?,
    })
}
