use rusqlite::params;

use super::SessionStore;
use crate::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
};

impl SessionStore {
    pub fn upsert_or_refresh_pending_background_work(
        &self,
        record: &SessionBackgroundWorkRecord,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let rows = conn.execute(
                "INSERT INTO session_background_work (
                    session_id, tool_call_id, turn_id, tracker_kind, source_agent_kind, agent_id,
                    output_file, state, created_at, updated_at, launched_at, last_activity_at, completed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(session_id, tool_call_id) DO UPDATE SET
                    turn_id = excluded.turn_id,
                    tracker_kind = excluded.tracker_kind,
                    source_agent_kind = excluded.source_agent_kind,
                    agent_id = excluded.agent_id,
                    output_file = excluded.output_file,
                    updated_at = excluded.updated_at,
                    launched_at = excluded.launched_at,
                    last_activity_at = excluded.last_activity_at,
                    completed_at = excluded.completed_at
                 WHERE session_background_work.state = 'pending'",
                params![
                    record.session_id,
                    record.tool_call_id,
                    record.turn_id,
                    record.tracker_kind.as_str(),
                    record.source_agent_kind,
                    record.agent_id,
                    record.output_file,
                    record.state.as_str(),
                    record.created_at,
                    record.updated_at,
                    record.launched_at,
                    record.last_activity_at,
                    record.completed_at,
                ],
            )?;
            Ok(rows > 0)
        })
    }

    pub fn list_pending_background_work(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<SessionBackgroundWorkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_background_work
                 WHERE session_id = ?1 AND state = 'pending'
                 ORDER BY launched_at ASC, tool_call_id ASC",
            )?;
            let rows = stmt.query_map([session_id], map_background_work)?;
            rows.collect()
        })
    }

    pub fn touch_background_work_activity(
        &self,
        session_id: &str,
        tool_call_id: &str,
        last_activity_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE session_background_work
                 SET last_activity_at = ?3,
                     updated_at = ?3
                 WHERE session_id = ?1 AND tool_call_id = ?2 AND state = 'pending'",
                params![session_id, tool_call_id, last_activity_at],
            )?;
            Ok(())
        })
    }

    pub fn mark_background_work_terminal(
        &self,
        session_id: &str,
        tool_call_id: &str,
        state: SessionBackgroundWorkState,
        completed_at: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let rows = conn.execute(
                "UPDATE session_background_work
                 SET state = ?3,
                     updated_at = ?4,
                     completed_at = ?4
                 WHERE session_id = ?1 AND tool_call_id = ?2 AND state = 'pending'",
                params![session_id, tool_call_id, state.as_str(), completed_at],
            )?;
            Ok(rows > 0)
        })
    }
}

fn map_background_work(row: &rusqlite::Row) -> rusqlite::Result<SessionBackgroundWorkRecord> {
    let tracker_kind: String = row.get("tracker_kind")?;
    let state: String = row.get("state")?;

    Ok(SessionBackgroundWorkRecord {
        session_id: row.get("session_id")?,
        tool_call_id: row.get("tool_call_id")?,
        turn_id: row.get("turn_id")?,
        tracker_kind: SessionBackgroundWorkTrackerKind::parse(&tracker_kind),
        source_agent_kind: row.get("source_agent_kind")?,
        agent_id: row.get("agent_id")?,
        output_file: row.get("output_file")?,
        state: SessionBackgroundWorkState::parse(&state),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        launched_at: row.get("launched_at")?,
        last_activity_at: row.get("last_activity_at")?,
        completed_at: row.get("completed_at")?,
    })
}
