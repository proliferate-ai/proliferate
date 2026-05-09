use rusqlite::params;

use super::SessionStore;
use crate::acp::persistence_sanitizer::sanitize_raw_notification_json_for_sqlite;
use crate::sessions::model::SessionRawNotificationRecord;

impl SessionStore {
    pub fn append_raw_notification(
        &self,
        session_id: &str,
        notification_kind: &str,
        timestamp: &str,
        payload_json: &str,
    ) -> anyhow::Result<()> {
        let sanitized_payload_json = sanitize_raw_notification_json_for_sqlite(payload_json);
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_raw_notifications (session_id, seq, timestamp, notification_kind, payload_json)
                 SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3, ?4
                 FROM session_raw_notifications
                 WHERE session_id = ?1",
                params![session_id, timestamp, notification_kind, sanitized_payload_json],
            )?;
            Ok(())
        })
    }

    pub fn list_raw_notifications(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<SessionRawNotificationRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_raw_notifications WHERE session_id = ?1 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map([session_id], map_raw_notification)?;
            rows.collect()
        })
    }

    pub fn list_raw_notifications_after(
        &self,
        session_id: &str,
        after_seq: i64,
    ) -> anyhow::Result<Vec<SessionRawNotificationRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_raw_notifications
                 WHERE session_id = ?1 AND seq > ?2
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map(params![session_id, after_seq], map_raw_notification)?;
            rows.collect()
        })
    }
}

fn map_raw_notification(row: &rusqlite::Row) -> rusqlite::Result<SessionRawNotificationRecord> {
    Ok(SessionRawNotificationRecord {
        id: row.get("id")?,
        session_id: row.get("session_id")?,
        seq: row.get("seq")?,
        timestamp: row.get("timestamp")?,
        notification_kind: row.get("notification_kind")?,
        payload_json: row.get("payload_json")?,
    })
}

pub(super) fn insert_raw_notification_row(
    conn: &rusqlite::Connection,
    record: &SessionRawNotificationRecord,
) -> rusqlite::Result<()> {
    let payload_json = sanitize_raw_notification_json_for_sqlite(&record.payload_json);
    conn.execute(
        "INSERT INTO session_raw_notifications (session_id, seq, timestamp, notification_kind, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            record.session_id,
            record.seq,
            record.timestamp,
            record.notification_kind,
            payload_json,
        ],
    )?;
    Ok(())
}
