use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::model::{PendingConfigChangeRecord, SessionLiveConfigSnapshotRecord};

impl SessionStore {
    pub fn upsert_live_config_snapshot(
        &self,
        record: &SessionLiveConfigSnapshotRecord,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_live_config_snapshots (
                    session_id, source_seq, raw_config_options_json, normalized_controls_json,
                    prompt_capabilities_json, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(session_id) DO UPDATE SET
                    source_seq = excluded.source_seq,
                    raw_config_options_json = excluded.raw_config_options_json,
                    normalized_controls_json = excluded.normalized_controls_json,
                    prompt_capabilities_json = excluded.prompt_capabilities_json,
                    updated_at = excluded.updated_at",
                params![
                    record.session_id,
                    record.source_seq,
                    record.raw_config_options_json,
                    record.normalized_controls_json,
                    record.prompt_capabilities_json,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn find_live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<SessionLiveConfigSnapshotRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_live_config_snapshots WHERE session_id = ?1",
                [session_id],
                map_live_config_snapshot,
            )
            .optional()
        })
    }

    /// Batched form of [`Self::find_live_config_snapshot`] for list
    /// endpoints: one query for the whole page, keyed by session id.
    pub fn find_live_config_snapshots(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<std::collections::HashMap<String, SessionLiveConfigSnapshotRecord>> {
        if session_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        self.db.with_conn(|conn| {
            let placeholders = vec!["?"; session_ids.len()].join(", ");
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM session_live_config_snapshots WHERE session_id IN ({placeholders})"
            ))?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(session_ids.iter()),
                map_live_config_snapshot,
            )?;
            let mut snapshots = std::collections::HashMap::new();
            for row in rows {
                let record = row?;
                snapshots.insert(record.session_id.clone(), record);
            }
            Ok(snapshots)
        })
    }

    pub fn upsert_pending_config_change(
        &self,
        record: &PendingConfigChangeRecord,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_pending_config_changes (session_id, config_id, value, queued_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(session_id, config_id) DO UPDATE SET
                    value = excluded.value,
                    queued_at = excluded.queued_at",
                params![record.session_id, record.config_id, record.value, record.queued_at],
            )?;
            Ok(())
        })
    }

    pub fn list_pending_config_changes(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<PendingConfigChangeRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_pending_config_changes
                 WHERE session_id = ?1
                 ORDER BY queued_at ASC, config_id ASC",
            )?;
            let rows = stmt.query_map([session_id], map_pending_config_change)?;
            rows.collect()
        })
    }

    pub fn delete_pending_config_change(
        &self,
        session_id: &str,
        config_id: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM session_pending_config_changes WHERE session_id = ?1 AND config_id = ?2",
                params![session_id, config_id],
            )?;
            Ok(())
        })
    }
}

fn map_live_config_snapshot(
    row: &rusqlite::Row,
) -> rusqlite::Result<SessionLiveConfigSnapshotRecord> {
    Ok(SessionLiveConfigSnapshotRecord {
        session_id: row.get("session_id")?,
        source_seq: row.get("source_seq")?,
        raw_config_options_json: row.get("raw_config_options_json")?,
        normalized_controls_json: row.get("normalized_controls_json")?,
        prompt_capabilities_json: row.get("prompt_capabilities_json")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_pending_config_change(row: &rusqlite::Row) -> rusqlite::Result<PendingConfigChangeRecord> {
    Ok(PendingConfigChangeRecord {
        session_id: row.get("session_id")?,
        config_id: row.get("config_id")?,
        value: row.get("value")?,
        queued_at: row.get("queued_at")?,
    })
}

pub(super) fn upsert_live_config_snapshot_row(
    conn: &rusqlite::Connection,
    record: &SessionLiveConfigSnapshotRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_live_config_snapshots (
            session_id, source_seq, raw_config_options_json, normalized_controls_json,
            prompt_capabilities_json, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(session_id) DO UPDATE SET
            source_seq = excluded.source_seq,
            raw_config_options_json = excluded.raw_config_options_json,
            normalized_controls_json = excluded.normalized_controls_json,
            prompt_capabilities_json = excluded.prompt_capabilities_json,
            updated_at = excluded.updated_at",
        params![
            record.session_id,
            record.source_seq,
            record.raw_config_options_json,
            record.normalized_controls_json,
            record.prompt_capabilities_json,
            record.updated_at,
        ],
    )?;
    Ok(())
}

pub(super) fn upsert_pending_config_change_row(
    conn: &rusqlite::Connection,
    record: &PendingConfigChangeRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_pending_config_changes (session_id, config_id, value, queued_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id, config_id) DO UPDATE SET
            value = excluded.value,
            queued_at = excluded.queued_at",
        params![
            record.session_id,
            record.config_id,
            record.value,
            record.queued_at
        ],
    )?;
    Ok(())
}
