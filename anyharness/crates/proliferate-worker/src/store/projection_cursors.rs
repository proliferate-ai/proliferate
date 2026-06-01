use rusqlite::params;
use serde::Serialize;

use super::WorkerStore;
use crate::error::WorkerError;

#[derive(Debug, Clone)]
pub struct ProjectionCursorUpsert {
    pub exposure_id: String,
    pub session_projection_id: String,
    pub anyharness_workspace_id: String,
    pub anyharness_session_id: String,
    pub projection_level: String,
    pub commandable: bool,
    pub last_uploaded_seq: i64,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct ProjectionCursor {
    pub exposure_id: String,
    pub session_projection_id: String,
    pub anyharness_workspace_id: String,
    pub anyharness_session_id: String,
    pub projection_level: String,
    pub commandable: bool,
    pub last_uploaded_seq: i64,
    pub last_ack_seq: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionCursorGap {
    expected_seq: i64,
    first_observed_seq: i64,
    reason: String,
}

impl WorkerStore {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn reconcile_projection_cursors(
        &self,
        cursors: &[ProjectionCursorUpsert],
    ) -> Result<(), WorkerError> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        tx.execute(
            r#"
            UPDATE worker_projection_cursor
            SET status = 'inactive',
                updated_at = CURRENT_TIMESTAMP
            "#,
            [],
        )?;
        for cursor in cursors {
            tx.execute(
                r#"
                INSERT INTO worker_projection_cursor (
                    session_projection_id,
                    exposure_id,
                    anyharness_workspace_id,
                    anyharness_session_id,
                    projection_level,
                    commandable,
                    last_uploaded_seq,
                    last_ack_seq,
                    status,
                    gap_state_json,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, NULL, CURRENT_TIMESTAMP)
                ON CONFLICT(session_projection_id) DO UPDATE SET
                    anyharness_workspace_id = excluded.anyharness_workspace_id,
                    anyharness_session_id = excluded.anyharness_session_id,
                    projection_level = excluded.projection_level,
                    commandable = excluded.commandable,
                    last_uploaded_seq = CASE
                        WHEN worker_projection_cursor.anyharness_session_id
                            IS NOT excluded.anyharness_session_id
                        THEN excluded.last_uploaded_seq
                        ELSE MAX(worker_projection_cursor.last_uploaded_seq, excluded.last_uploaded_seq)
                    END,
                    last_ack_seq = CASE
                        WHEN worker_projection_cursor.anyharness_session_id
                            IS NOT excluded.anyharness_session_id
                        THEN excluded.last_ack_seq
                        ELSE MAX(worker_projection_cursor.last_ack_seq, excluded.last_ack_seq)
                    END,
                    status = excluded.status,
                    gap_state_json = CASE
                        WHEN worker_projection_cursor.anyharness_session_id
                            IS NOT excluded.anyharness_session_id
                        THEN NULL
                        WHEN excluded.last_uploaded_seq > worker_projection_cursor.last_uploaded_seq
                        THEN NULL
                        ELSE worker_projection_cursor.gap_state_json
                    END,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                params![
                    cursor.session_projection_id,
                    cursor.exposure_id,
                    cursor.anyharness_workspace_id,
                    cursor.anyharness_session_id,
                    cursor.projection_level,
                    cursor.commandable,
                    cursor.last_uploaded_seq,
                    cursor.status,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_active_projection_cursors(&self) -> Result<Vec<ProjectionCursor>, WorkerError> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
                session_projection_id,
                exposure_id,
                anyharness_workspace_id,
                anyharness_session_id,
                projection_level,
                commandable,
                last_uploaded_seq,
                last_ack_seq
            FROM worker_projection_cursor
            WHERE status = 'active'
              AND gap_state_json IS NULL
            ORDER BY updated_at DESC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectionCursor {
                session_projection_id: row.get(0)?,
                exposure_id: row.get(1)?,
                anyharness_workspace_id: row.get(2)?,
                anyharness_session_id: row.get(3)?,
                projection_level: row.get(4)?,
                commandable: row.get(5)?,
                last_uploaded_seq: row.get(6)?,
                last_ack_seq: row.get(7)?,
            })
        })?;
        let mut cursors = Vec::new();
        for row in rows {
            cursors.push(row?);
        }
        Ok(cursors)
    }

    pub fn update_projection_cursor_ack(
        &self,
        session_id: &str,
        last_contiguous_seq: i64,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            UPDATE worker_projection_cursor
            SET last_uploaded_seq = MAX(last_uploaded_seq, ?2),
                last_ack_seq = MAX(last_ack_seq, ?2),
                updated_at = CURRENT_TIMESTAMP
            WHERE anyharness_session_id = ?1
              AND status = 'active'
            "#,
            params![session_id, last_contiguous_seq],
        )?;
        Ok(())
    }

    pub fn record_projection_cursor_gap(
        &self,
        session_projection_id: &str,
        expected_seq: i64,
        first_observed_seq: i64,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        let gap = ProjectionCursorGap {
            expected_seq,
            first_observed_seq,
            reason: "anyharness_event_sequence_gap".to_string(),
        };
        let gap_state_json = serde_json::to_string(&gap)?;
        conn.execute(
            r#"
            UPDATE worker_projection_cursor
            SET gap_state_json = ?2,
                updated_at = CURRENT_TIMESTAMP
            WHERE session_projection_id = ?1
            "#,
            params![session_projection_id, gap_state_json],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{ProjectionCursorUpsert, WorkerStore};

    static NEXT_DB_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn projection_cursor_reconcile_lists_only_active_sessions() {
        let store = test_store();
        store
            .reconcile_projection_cursors(&[
                cursor("exposure-active", "session-1", "active", 4),
                cursor("exposure-paused", "session-2", "paused", 0),
            ])
            .expect("reconcile");

        let cursors = store
            .list_active_projection_cursors()
            .expect("active cursors");
        assert_eq!(cursors.len(), 1);
        assert_eq!(cursors[0].exposure_id, "exposure-active");
        assert_eq!(cursors[0].anyharness_session_id, "session-1");
        assert_eq!(cursors[0].last_uploaded_seq, 4);

        store
            .reconcile_projection_cursors(&[])
            .expect("empty reconcile");
        assert!(store
            .list_active_projection_cursors()
            .expect("active cursors")
            .is_empty());
    }

    #[test]
    fn projection_cursor_ack_is_monotonic() {
        let store = test_store();
        store
            .reconcile_projection_cursors(&[cursor("exposure-1", "session-1", "active", 4)])
            .expect("reconcile");

        store
            .update_projection_cursor_ack("session-1", 6)
            .expect("ack");
        store
            .update_projection_cursor_ack("session-1", 5)
            .expect("stale ack");

        let cursors = store
            .list_active_projection_cursors()
            .expect("active cursors");
        assert_eq!(cursors[0].last_uploaded_seq, 6);
        assert_eq!(cursors[0].last_ack_seq, 6);
    }

    #[test]
    fn projection_cursor_gap_removes_cursor_from_active_tail_set_until_repaired() {
        let store = test_store();
        store
            .reconcile_projection_cursors(&[cursor("exposure-1", "session-1", "active", 4)])
            .expect("reconcile");
        store
            .record_projection_cursor_gap("projection-session-1", 5, 8)
            .expect("gap");
        assert!(store
            .list_active_projection_cursors()
            .expect("active cursors")
            .is_empty());

        store
            .reconcile_projection_cursors(&[cursor("exposure-1", "session-1", "active", 8)])
            .expect("repair reconcile");
        let cursors = store
            .list_active_projection_cursors()
            .expect("active cursors");
        assert_eq!(cursors.len(), 1);
        assert_eq!(cursors[0].last_uploaded_seq, 8);
    }

    #[test]
    fn projection_cursors_are_keyed_by_session_projection() {
        let store = test_store();
        store
            .reconcile_projection_cursors(&[
                cursor("exposure-1", "session-1", "active", 2),
                cursor("exposure-1", "session-2", "active", 5),
            ])
            .expect("reconcile");

        let mut cursors = store
            .list_active_projection_cursors()
            .expect("active cursors");
        cursors.sort_by(|left, right| left.anyharness_session_id.cmp(&right.anyharness_session_id));
        assert_eq!(cursors.len(), 2);
        assert_eq!(cursors[0].session_projection_id, "projection-session-1");
        assert_eq!(cursors[0].last_uploaded_seq, 2);
        assert_eq!(cursors[1].session_projection_id, "projection-session-2");
        assert_eq!(cursors[1].last_uploaded_seq, 5);
    }

    fn cursor(
        exposure_id: &str,
        session_id: &str,
        status: &str,
        last_uploaded_seq: i64,
    ) -> ProjectionCursorUpsert {
        ProjectionCursorUpsert {
            exposure_id: exposure_id.to_string(),
            session_projection_id: format!("projection-{session_id}"),
            anyharness_workspace_id: "workspace-1".to_string(),
            anyharness_session_id: session_id.to_string(),
            projection_level: "live".to_string(),
            commandable: true,
            last_uploaded_seq,
            status: status.to_string(),
        }
    }

    fn test_store() -> WorkerStore {
        let dir = temp_db_dir();
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("worker.sqlite");
        WorkerStore::open(path).expect("store")
    }

    fn temp_db_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "proliferate-worker-store-test-{}-{}",
            std::process::id(),
            NEXT_DB_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }
}
