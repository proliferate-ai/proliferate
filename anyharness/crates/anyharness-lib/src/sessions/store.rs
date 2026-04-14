use rusqlite::{params, OptionalExtension};

use super::model::{
    PendingConfigChangeRecord, PendingPromptRecord, SessionBackgroundWorkRecord,
    SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord, SessionRecord,
};
use crate::persistence::Db;

#[derive(Clone)]
pub struct SessionStore {
    db: Db,
}

impl SessionStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn insert(&self, record: &SessionRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (id, workspace_id, agent_kind, native_session_id,
                 requested_model_id, current_model_id, requested_mode_id, current_mode_id,
                 title, thinking_level_id, thinking_budget_tokens, status, created_at,
                 updated_at, last_prompt_at, closed_at, dismissed_at, mcp_bindings_ciphertext,
                 system_prompt_append)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    record.id,
                    record.workspace_id,
                    record.agent_kind,
                    record.native_session_id,
                    record.requested_model_id,
                    record.current_model_id,
                    record.requested_mode_id,
                    record.current_mode_id,
                    record.title,
                    record.thinking_level_id,
                    record.thinking_budget_tokens,
                    record.status,
                    record.created_at,
                    record.updated_at,
                    record.last_prompt_at,
                    record.closed_at,
                    record.dismissed_at,
                    record.mcp_bindings_ciphertext,
                    record.system_prompt_append,
                ],
            )?;
            Ok(())
        })
    }

    pub fn delete_session(&self, id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            // Several durable tables still reference sessions without
            // database-level cascade rules, so session deletion must clear
            // dependent rows explicitly.
            conn.execute("DELETE FROM cowork_threads WHERE session_id = ?1", [id])?;
            conn.execute(
                "DELETE FROM session_background_work WHERE session_id = ?1",
                [id],
            )?;
            conn.execute(
                "DELETE FROM session_pending_prompts WHERE session_id = ?1",
                [id],
            )?;
            conn.execute(
                "DELETE FROM session_pending_config_changes WHERE session_id = ?1",
                [id],
            )?;
            conn.execute(
                "DELETE FROM session_live_config_snapshots WHERE session_id = ?1",
                [id],
            )?;
            conn.execute(
                "DELETE FROM session_raw_notifications WHERE session_id = ?1",
                [id],
            )?;
            conn.execute("DELETE FROM session_events WHERE session_id = ?1", [id])?;
            conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
            Ok(())
        })
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<SessionRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM sessions WHERE id = ?1", [id], |row| {
                map_session(row)
            })
            .optional()
        })
    }

    pub fn list_by_workspace(&self, workspace_id: &str) -> anyhow::Result<Vec<SessionRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([workspace_id], |row| map_session(row))?;
            rows.collect()
        })
    }

    pub fn list_all(&self) -> anyhow::Result<Vec<SessionRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM sessions ORDER BY updated_at DESC")?;
            let rows = stmt.query_map([], |row| map_session(row))?;
            rows.collect()
        })
    }

    pub fn list_visible_by_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<SessionRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM sessions
                 WHERE workspace_id = ?1 AND dismissed_at IS NULL AND closed_at IS NULL
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([workspace_id], map_session)?;
            rows.collect()
        })
    }

    pub fn list_with_dismissed_by_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<SessionRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM sessions
                 WHERE workspace_id = ?1 AND closed_at IS NULL
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([workspace_id], map_session)?;
            rows.collect()
        })
    }

    pub fn list_visible_all(&self) -> anyhow::Result<Vec<SessionRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM sessions
                 WHERE dismissed_at IS NULL AND closed_at IS NULL
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], map_session)?;
            rows.collect()
        })
    }

    pub fn list_with_dismissed_all(&self) -> anyhow::Result<Vec<SessionRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM sessions
                 WHERE closed_at IS NULL
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], map_session)?;
            rows.collect()
        })
    }

    pub fn update_status(&self, id: &str, status: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![status, now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_native_session_id(
        &self,
        id: &str,
        native_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET native_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![native_session_id, now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_last_prompt_at(&self, id: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET last_prompt_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_requested_configuration(
        &self,
        id: &str,
        requested_model_id: Option<&str>,
        requested_mode_id: Option<&str>,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions
                 SET requested_model_id = ?1, requested_mode_id = ?2, updated_at = ?3
                 WHERE id = ?4",
                params![requested_model_id, requested_mode_id, now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_current_configuration(
        &self,
        id: &str,
        current_model_id: Option<&str>,
        current_mode_id: Option<&str>,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions
                 SET current_model_id = ?1, current_mode_id = ?2, updated_at = ?3
                 WHERE id = ?4",
                params![current_model_id, current_mode_id, now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_title(&self, id: &str, title: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, now, id],
            )?;
            Ok(())
        })
    }

    pub fn mark_closed(&self, id: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET status = 'closed', closed_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            Ok(())
        })
    }

    pub fn mark_dismissed(&self, id: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions
                 SET dismissed_at = COALESCE(dismissed_at, ?1),
                     updated_at = CASE WHEN dismissed_at IS NULL THEN ?1 ELSE updated_at END
                 WHERE id = ?2",
                params![now, id],
            )?;
            Ok(())
        })
    }

    pub fn clear_dismissed(&self, id: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET dismissed_at = NULL, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            Ok(())
        })
    }

    pub fn pop_last_dismissed_in_workspace(
        &self,
        workspace_id: &str,
        now: &str,
    ) -> anyhow::Result<Option<SessionRecord>> {
        self.db.with_tx(|conn| {
            let record = conn
                .query_row(
                    "SELECT * FROM sessions
                     WHERE workspace_id = ?1 AND dismissed_at IS NOT NULL AND closed_at IS NULL
                     ORDER BY dismissed_at DESC, updated_at DESC
                     LIMIT 1",
                    [workspace_id],
                    map_session,
                )
                .optional()?;

            let Some(record) = record else {
                return Ok(None);
            };

            conn.execute(
                "UPDATE sessions SET dismissed_at = NULL, updated_at = ?1 WHERE id = ?2",
                params![now, record.id],
            )?;

            let restored = conn
                .query_row(
                    "SELECT * FROM sessions WHERE id = ?1",
                    [&record.id],
                    map_session,
                )
                .optional()?;
            Ok(restored)
        })
    }

    pub fn find_last_dismissed_in_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<SessionRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM sessions
                 WHERE workspace_id = ?1 AND dismissed_at IS NOT NULL AND closed_at IS NULL
                 ORDER BY dismissed_at DESC, updated_at DESC
                 LIMIT 1",
                [workspace_id],
                map_session,
            )
            .optional()
        })
    }

    pub fn upsert_live_config_snapshot(
        &self,
        record: &SessionLiveConfigSnapshotRecord,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_live_config_snapshots (
                    session_id, source_seq, raw_config_options_json, normalized_controls_json, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(session_id) DO UPDATE SET
                    source_seq = excluded.source_seq,
                    raw_config_options_json = excluded.raw_config_options_json,
                    normalized_controls_json = excluded.normalized_controls_json,
                    updated_at = excluded.updated_at",
                params![
                    record.session_id,
                    record.source_seq,
                    record.raw_config_options_json,
                    record.normalized_controls_json,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn import_bundle(
        &self,
        session: &SessionRecord,
        live_config_snapshot: Option<&SessionLiveConfigSnapshotRecord>,
        pending_config_changes: &[PendingConfigChangeRecord],
        pending_prompts: &[PendingPromptRecord],
        events: &[SessionEventRecord],
        raw_notifications: &[SessionRawNotificationRecord],
    ) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            insert_session_row(conn, session)?;
            if let Some(snapshot) = live_config_snapshot {
                upsert_live_config_snapshot_row(conn, snapshot)?;
            }
            for change in pending_config_changes {
                upsert_pending_config_change_row(conn, change)?;
            }
            for prompt in pending_prompts {
                insert_pending_prompt_row(conn, prompt)?;
            }
            for event in events {
                insert_event_row(conn, event)?;
            }
            for notification in raw_notifications {
                insert_raw_notification_row(conn, notification)?;
            }
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

    pub fn insert_pending_prompt(
        &self,
        session_id: &str,
        text: &str,
        prompt_id: Option<&str>,
    ) -> anyhow::Result<PendingPromptRecord> {
        let queued_at = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let next_seq: i64 = tx.query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_pending_prompts WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            tx.execute(
                "INSERT INTO session_pending_prompts (session_id, seq, prompt_id, text, queued_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![session_id, next_seq, prompt_id, text, queued_at],
            )?;
            Ok(PendingPromptRecord {
                session_id: session_id.to_string(),
                seq: next_seq,
                prompt_id: prompt_id.map(|s| s.to_string()),
                text: text.to_string(),
                queued_at: queued_at.clone(),
            })
        })
    }

    pub fn list_pending_prompts(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<PendingPromptRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_pending_prompts
                 WHERE session_id = ?1
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map([session_id], map_pending_prompt)?;
            rows.collect()
        })
    }

    pub fn peek_head_pending_prompt(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_pending_prompts
                 WHERE session_id = ?1
                 ORDER BY seq ASC
                 LIMIT 1",
                [session_id],
                map_pending_prompt,
            )
            .optional()
        })
    }

    pub fn update_pending_prompt_text(
        &self,
        session_id: &str,
        seq: i64,
        text: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let rows = conn.execute(
                "UPDATE session_pending_prompts
                 SET text = ?3
                 WHERE session_id = ?1 AND seq = ?2",
                params![session_id, seq, text],
            )?;
            Ok(rows > 0)
        })
    }

    pub fn delete_pending_prompt(&self, session_id: &str, seq: i64) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let rows = conn.execute(
                "DELETE FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
                params![session_id, seq],
            )?;
            Ok(rows > 0)
        })
    }

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

    pub fn next_event_seq(&self, session_id: &str) -> anyhow::Result<i64> {
        self.db.with_conn(|conn| {
            let max: Option<i64> = conn.query_row(
                "SELECT MAX(seq) FROM session_events WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            Ok(max.unwrap_or(0) + 1)
        })
    }

    pub fn append_event(&self, event: &SessionEventRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_events (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    event.session_id,
                    event.seq,
                    event.timestamp,
                    event.event_type,
                    event.turn_id,
                    event.item_id,
                    event.payload_json,
                ],
            )?;
            Ok(())
        })
    }

    pub fn append_raw_notification(
        &self,
        session_id: &str,
        notification_kind: &str,
        timestamp: &str,
        payload_json: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_raw_notifications (session_id, seq, timestamp, notification_kind, payload_json)
                 SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3, ?4
                 FROM session_raw_notifications
                 WHERE session_id = ?1",
                params![session_id, timestamp, notification_kind, payload_json],
            )?;
            Ok(())
        })
    }

    pub fn list_events(&self, session_id: &str) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM session_events WHERE session_id = ?1 ORDER BY seq ASC")?;
            let rows = stmt.query_map([session_id], |row| map_event(row))?;
            rows.collect()
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

    pub fn list_events_after(
        &self,
        session_id: &str,
        after_seq: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_events
                 WHERE session_id = ?1 AND seq > ?2
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map(params![session_id, after_seq], |row| map_event(row))?;
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

    pub fn last_event_seq(&self, session_id: &str) -> anyhow::Result<i64> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COALESCE(MAX(seq), 0) FROM session_events WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
        })
    }

    pub fn has_turn_started_event(&self, session_id: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT EXISTS(
                     SELECT 1
                     FROM session_events
                     WHERE session_id = ?1 AND event_type = 'turn_started'
                     LIMIT 1
                 )",
                [session_id],
                |row| row.get(0),
            )
        })
    }

    /// Find turns that have a `turn_started` but no corresponding `turn_ended`
    /// (or `error` / `session_ended`) and close them with a synthetic
    /// `turn_ended` event carrying `stop_reason: cancelled`. Returns the number
    /// of turns repaired.
    pub fn repair_unclosed_turns(&self, session_id: &str) -> anyhow::Result<u32> {
        self.db.with_tx(|conn| {
            // Find turn_ids that were started but never ended.
            let mut stmt = conn.prepare(
                "SELECT DISTINCT e.turn_id
                 FROM session_events e
                 WHERE e.session_id = ?1
                   AND e.event_type = 'turn_started'
                   AND e.turn_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM session_events e2
                     WHERE e2.session_id = e.session_id
                       AND e2.turn_id = e.turn_id
                       AND e2.event_type IN ('turn_ended', 'error', 'session_ended')
                   )",
            )?;
            let unclosed_turn_ids: Vec<String> = stmt
                .query_map([session_id], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;

            if unclosed_turn_ids.is_empty() {
                return Ok(0);
            }

            let now = chrono::Utc::now().to_rfc3339();
            let payload_json = r#"{"type":"turn_ended","stopReason":"cancelled"}"#;
            let mut count = 0u32;

            for turn_id in &unclosed_turn_ids {
                let next_seq: i64 = conn.query_row(
                    "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_events WHERE session_id = ?1",
                    [session_id],
                    |row| row.get(0),
                )?;

                conn.execute(
                    "INSERT INTO session_events (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                    params![session_id, next_seq, now, "turn_ended", turn_id, payload_json],
                )?;

                tracing::info!(
                    session_id = %session_id,
                    turn_id = %turn_id,
                    seq = next_seq,
                    "repaired unclosed turn with synthetic turn_ended"
                );
                count += 1;
            }

            Ok(count)
        })
    }
}

fn map_session(row: &rusqlite::Row) -> rusqlite::Result<SessionRecord> {
    Ok(SessionRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        agent_kind: row.get("agent_kind")?,
        native_session_id: row.get("native_session_id")?,
        requested_model_id: row.get("requested_model_id")?,
        current_model_id: row.get("current_model_id")?,
        requested_mode_id: row.get("requested_mode_id")?,
        current_mode_id: row.get("current_mode_id")?,
        title: row.get("title")?,
        thinking_level_id: row.get("thinking_level_id")?,
        thinking_budget_tokens: row.get("thinking_budget_tokens")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_prompt_at: row.get("last_prompt_at")?,
        closed_at: row.get("closed_at")?,
        dismissed_at: row.get("dismissed_at")?,
        mcp_bindings_ciphertext: row.get("mcp_bindings_ciphertext")?,
        system_prompt_append: row.get("system_prompt_append")?,
    })
}

fn map_live_config_snapshot(
    row: &rusqlite::Row,
) -> rusqlite::Result<SessionLiveConfigSnapshotRecord> {
    Ok(SessionLiveConfigSnapshotRecord {
        session_id: row.get("session_id")?,
        source_seq: row.get("source_seq")?,
        raw_config_options_json: row.get("raw_config_options_json")?,
        normalized_controls_json: row.get("normalized_controls_json")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_event(row: &rusqlite::Row) -> rusqlite::Result<SessionEventRecord> {
    Ok(SessionEventRecord {
        id: row.get("id")?,
        session_id: row.get("session_id")?,
        seq: row.get("seq")?,
        timestamp: row.get("timestamp")?,
        event_type: row.get("event_type")?,
        turn_id: row.get("turn_id")?,
        item_id: row.get("item_id")?,
        payload_json: row.get("payload_json")?,
    })
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

fn map_pending_config_change(row: &rusqlite::Row) -> rusqlite::Result<PendingConfigChangeRecord> {
    Ok(PendingConfigChangeRecord {
        session_id: row.get("session_id")?,
        config_id: row.get("config_id")?,
        value: row.get("value")?,
        queued_at: row.get("queued_at")?,
    })
}

fn map_pending_prompt(row: &rusqlite::Row) -> rusqlite::Result<PendingPromptRecord> {
    Ok(PendingPromptRecord {
        session_id: row.get("session_id")?,
        seq: row.get("seq")?,
        prompt_id: row.get("prompt_id")?,
        text: row.get("text")?,
        queued_at: row.get("queued_at")?,
    })
}

fn insert_session_row(conn: &rusqlite::Connection, record: &SessionRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sessions (id, workspace_id, agent_kind, native_session_id,
         requested_model_id, current_model_id, requested_mode_id, current_mode_id,
         title, thinking_level_id, thinking_budget_tokens, status, created_at,
         updated_at, last_prompt_at, closed_at, dismissed_at, mcp_bindings_ciphertext,
         system_prompt_append)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            record.id,
            record.workspace_id,
            record.agent_kind,
            record.native_session_id,
            record.requested_model_id,
            record.current_model_id,
            record.requested_mode_id,
            record.current_mode_id,
            record.title,
            record.thinking_level_id,
            record.thinking_budget_tokens,
            record.status,
            record.created_at,
            record.updated_at,
            record.last_prompt_at,
            record.closed_at,
            record.dismissed_at,
            record.mcp_bindings_ciphertext,
            record.system_prompt_append,
        ],
    )?;
    Ok(())
}

fn upsert_live_config_snapshot_row(
    conn: &rusqlite::Connection,
    record: &SessionLiveConfigSnapshotRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_live_config_snapshots (
            session_id, source_seq, raw_config_options_json, normalized_controls_json, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(session_id) DO UPDATE SET
            source_seq = excluded.source_seq,
            raw_config_options_json = excluded.raw_config_options_json,
            normalized_controls_json = excluded.normalized_controls_json,
            updated_at = excluded.updated_at",
        params![
            record.session_id,
            record.source_seq,
            record.raw_config_options_json,
            record.normalized_controls_json,
            record.updated_at,
        ],
    )?;
    Ok(())
}

fn upsert_pending_config_change_row(
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

fn insert_pending_prompt_row(
    conn: &rusqlite::Connection,
    record: &PendingPromptRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_pending_prompts (session_id, seq, prompt_id, text, queued_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            record.session_id,
            record.seq,
            record.prompt_id,
            record.text,
            record.queued_at,
        ],
    )?;
    Ok(())
}

fn insert_event_row(
    conn: &rusqlite::Connection,
    record: &SessionEventRecord,
) -> rusqlite::Result<()> {
    conn.execute(
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

fn insert_raw_notification_row(
    conn: &rusqlite::Connection,
    record: &SessionRawNotificationRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_raw_notifications (session_id, seq, timestamp, notification_kind, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            record.session_id,
            record.seq,
            record.timestamp,
            record.notification_kind,
            record.payload_json,
        ],
    )?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    fn count_rows(db: &Db, table: &str, session_id: &str) -> i64 {
        let sql = format!("SELECT COUNT(*) FROM {table} WHERE session_id = ?1");
        db.with_conn(|conn| conn.query_row(&sql, [session_id], |row| row.get(0)))
            .expect("count rows")
    }

    fn seed_workspace(db: &Db) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");
    }

    fn session_record() -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
            requested_model_id: Some("default".to_string()),
            current_model_id: Some("default".to_string()),
            requested_mode_id: Some("default".to_string()),
            current_mode_id: Some("default".to_string()),
            title: Some("Fix auth refresh".to_string()),
            thinking_level_id: None,
            thinking_budget_tokens: Some(16_000),
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            system_prompt_append: None,
        }
    }

    #[test]
    fn stores_and_loads_thinking_budget_tokens() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let record = session_record();

        store.insert(&record).expect("insert session");
        let stored = store
            .find_by_id("session-1")
            .expect("find session")
            .expect("session record");

        assert_eq!(stored.thinking_budget_tokens, Some(16_000));
        assert_eq!(stored.title.as_deref(), Some("Fix auth refresh"));
    }

    #[test]
    fn detects_when_a_session_has_started_a_turn() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let record = session_record();
        store.insert(&record).expect("insert session");

        assert!(!store
            .has_turn_started_event("session-1")
            .expect("check empty turn history"));

        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: 1,
                timestamp: "2026-03-25T00:01:00Z".to_string(),
                event_type: "turn_started".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append turn_started");

        assert!(store
            .has_turn_started_event("session-1")
            .expect("check populated turn history"));
    }

    #[test]
    fn delete_session_removes_dependent_rows() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db.clone());
        let record = session_record();
        store.insert(&record).expect("insert session");

        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: 1,
                timestamp: "2026-03-25T00:01:00Z".to_string(),
                event_type: "turn_started".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append event");
        store
            .append_raw_notification(
                "session-1",
                "agent_message_chunk",
                "2026-03-25T00:01:01Z",
                r#"{"kind":"agent_message_chunk"}"#,
            )
            .expect("append raw notification");
        store
            .upsert_live_config_snapshot(&SessionLiveConfigSnapshotRecord {
                session_id: "session-1".to_string(),
                source_seq: 1,
                raw_config_options_json: "{}".to_string(),
                normalized_controls_json: "{}".to_string(),
                updated_at: "2026-03-25T00:01:02Z".to_string(),
            })
            .expect("upsert snapshot");
        store
            .upsert_pending_config_change(&PendingConfigChangeRecord {
                session_id: "session-1".to_string(),
                config_id: "model".to_string(),
                value: "\"opus\"".to_string(),
                queued_at: "2026-03-25T00:01:03Z".to_string(),
            })
            .expect("insert pending config change");
        store
            .insert_pending_prompt("session-1", "finish cleanup", Some("prompt-1"))
            .expect("insert pending prompt");
        store
            .upsert_or_refresh_pending_background_work(&SessionBackgroundWorkRecord {
                session_id: "session-1".to_string(),
                tool_call_id: "tool-1".to_string(),
                turn_id: "turn-1".to_string(),
                tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
                source_agent_kind: "claude".to_string(),
                agent_id: Some("agent-1".to_string()),
                output_file: "/tmp/agent.output".to_string(),
                state: SessionBackgroundWorkState::Pending,
                created_at: "2026-03-25T00:01:04Z".to_string(),
                updated_at: "2026-03-25T00:01:04Z".to_string(),
                launched_at: "2026-03-25T00:01:04Z".to_string(),
                last_activity_at: "2026-03-25T00:01:04Z".to_string(),
                completed_at: None,
            })
            .expect("insert background work");

        assert_eq!(count_rows(&db, "session_events", "session-1"), 1);
        assert_eq!(count_rows(&db, "session_raw_notifications", "session-1"), 1);
        assert_eq!(
            count_rows(&db, "session_live_config_snapshots", "session-1"),
            1
        );
        assert_eq!(
            count_rows(&db, "session_pending_config_changes", "session-1"),
            1
        );
        assert_eq!(count_rows(&db, "session_pending_prompts", "session-1"), 1);
        assert_eq!(count_rows(&db, "session_background_work", "session-1"), 1);

        store
            .delete_session("session-1")
            .expect("delete session with dependents");

        assert!(store
            .find_by_id("session-1")
            .expect("load deleted session")
            .is_none());
        assert_eq!(count_rows(&db, "session_events", "session-1"), 0);
        assert_eq!(count_rows(&db, "session_raw_notifications", "session-1"), 0);
        assert_eq!(
            count_rows(&db, "session_live_config_snapshots", "session-1"),
            0
        );
        assert_eq!(
            count_rows(&db, "session_pending_config_changes", "session-1"),
            0
        );
        assert_eq!(count_rows(&db, "session_pending_prompts", "session-1"), 0);
        assert_eq!(count_rows(&db, "session_background_work", "session-1"), 0);
    }

    #[test]
    fn update_title_persists_session_title() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let mut record = session_record();
        record.title = None;

        store.insert(&record).expect("insert session");
        store
            .update_title(
                "session-1",
                "Investigate flaky checkout",
                "2026-03-25T01:00:00Z",
            )
            .expect("update title");

        let stored = store
            .find_by_id("session-1")
            .expect("find session")
            .expect("session record");

        assert_eq!(stored.title.as_deref(), Some("Investigate flaky checkout"));
        assert_eq!(stored.updated_at, "2026-03-25T01:00:00Z");
    }

    #[test]
    fn raw_notifications_are_persisted_in_seq_order() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let record = session_record();
        store.insert(&record).expect("insert session");

        store
            .append_raw_notification(
                "session-1",
                "agent_message_chunk",
                "2026-03-25T00:00:01Z",
                r#"{"update":{"sessionUpdate":"agent_message_chunk"}}"#,
            )
            .expect("append first raw notification");
        store
            .append_raw_notification(
                "session-1",
                "tool_call",
                "2026-03-25T00:00:02Z",
                r#"{"update":{"sessionUpdate":"tool_call"}}"#,
            )
            .expect("append second raw notification");

        let all = store
            .list_raw_notifications("session-1")
            .expect("list raw notifications");
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].seq, 1);
        assert_eq!(all[0].notification_kind, "agent_message_chunk");
        assert_eq!(all[1].seq, 2);
        assert_eq!(all[1].notification_kind, "tool_call");

        let tail = store
            .list_raw_notifications_after("session-1", 1)
            .expect("list raw notifications after");
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].seq, 2);
    }

    #[test]
    fn visible_session_lists_exclude_dismissed_and_closed_sessions() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);

        let visible = session_record();
        store.insert(&visible).expect("insert visible session");

        let mut dismissed = session_record();
        dismissed.id = "session-2".to_string();
        dismissed.dismissed_at = Some("2026-03-25T02:00:00Z".to_string());
        dismissed.updated_at = "2026-03-25T02:00:00Z".to_string();
        store.insert(&dismissed).expect("insert dismissed session");

        let mut closed = session_record();
        closed.id = "session-3".to_string();
        closed.status = "closed".to_string();
        closed.closed_at = Some("2026-03-25T03:00:00Z".to_string());
        closed.updated_at = "2026-03-25T03:00:00Z".to_string();
        store.insert(&closed).expect("insert closed session");

        let visible_by_workspace = store
            .list_visible_by_workspace("workspace-1")
            .expect("list visible sessions by workspace");
        assert_eq!(visible_by_workspace.len(), 1);
        assert_eq!(visible_by_workspace[0].id, "session-1");

        let with_dismissed = store
            .list_with_dismissed_by_workspace("workspace-1")
            .expect("list sessions with dismissed by workspace");
        assert_eq!(with_dismissed.len(), 2);
        assert_eq!(with_dismissed[0].id, "session-2");
        assert_eq!(with_dismissed[1].id, "session-1");
    }

    #[test]
    fn mark_dismissed_is_idempotent_and_restore_uses_latest_timestamp() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);

        let first = session_record();
        store.insert(&first).expect("insert first session");

        let mut second = session_record();
        second.id = "session-2".to_string();
        store.insert(&second).expect("insert second session");

        store
            .mark_dismissed("session-1", "2026-03-25T01:00:00Z")
            .expect("dismiss first session");
        store
            .mark_dismissed("session-1", "2026-03-25T05:00:00Z")
            .expect("repeat dismiss first session");
        store
            .mark_dismissed("session-2", "2026-03-25T03:00:00Z")
            .expect("dismiss second session");

        let first_stored = store
            .find_by_id("session-1")
            .expect("find first session")
            .expect("first session exists");
        assert_eq!(
            first_stored.dismissed_at.as_deref(),
            Some("2026-03-25T01:00:00Z")
        );
        assert_eq!(first_stored.updated_at, "2026-03-25T01:00:00Z");

        let last_dismissed = store
            .find_last_dismissed_in_workspace("workspace-1")
            .expect("find last dismissed session")
            .expect("dismissed session exists");
        assert_eq!(last_dismissed.id, "session-2");

        store
            .clear_dismissed("session-2", "2026-03-25T04:00:00Z")
            .expect("restore second session");

        let restored = store
            .find_by_id("session-2")
            .expect("find restored session")
            .expect("restored session exists");
        assert_eq!(restored.dismissed_at, None);
        assert_eq!(restored.updated_at, "2026-03-25T04:00:00Z");

        let remaining = store
            .find_last_dismissed_in_workspace("workspace-1")
            .expect("find remaining dismissed session")
            .expect("remaining dismissed session exists");
        assert_eq!(remaining.id, "session-1");
    }

    #[test]
    fn pop_last_dismissed_restores_latest_session_atomically() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);

        let mut first = session_record();
        first.id = "session-1".to_string();
        store.insert(&first).expect("insert first session");

        let mut second = session_record();
        second.id = "session-2".to_string();
        store.insert(&second).expect("insert second session");

        store
            .mark_dismissed("session-1", "2026-03-25T01:00:00Z")
            .expect("dismiss first session");
        store
            .mark_dismissed("session-2", "2026-03-25T03:00:00Z")
            .expect("dismiss second session");

        let restored = store
            .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T04:00:00Z")
            .expect("pop dismissed session")
            .expect("restored session exists");
        assert_eq!(restored.id, "session-2");
        assert_eq!(restored.dismissed_at, None);
        assert_eq!(restored.updated_at, "2026-03-25T04:00:00Z");

        let next = store
            .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T05:00:00Z")
            .expect("pop next dismissed session")
            .expect("next restored session exists");
        assert_eq!(next.id, "session-1");
        assert_eq!(next.dismissed_at, None);

        let none = store
            .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T06:00:00Z")
            .expect("pop empty dismissed stack");
        assert!(none.is_none());
    }

    #[test]
    fn background_work_round_trips_and_marks_terminal() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        store.insert(&session_record()).expect("insert session");

        let pending = SessionBackgroundWorkRecord {
            session_id: "session-1".to_string(),
            tool_call_id: "tool-1".to_string(),
            turn_id: "turn-1".to_string(),
            tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
            source_agent_kind: "claude".to_string(),
            agent_id: Some("agent-1".to_string()),
            output_file: "/tmp/agent.output".to_string(),
            state: SessionBackgroundWorkState::Pending,
            created_at: "2026-03-25T01:00:00Z".to_string(),
            updated_at: "2026-03-25T01:00:00Z".to_string(),
            launched_at: "2026-03-25T01:00:00Z".to_string(),
            last_activity_at: "2026-03-25T01:00:00Z".to_string(),
            completed_at: None,
        };

        assert!(store
            .upsert_or_refresh_pending_background_work(&pending)
            .expect("upsert pending background work"));
        store
            .touch_background_work_activity("session-1", "tool-1", "2026-03-25T01:05:00Z")
            .expect("touch background work activity");

        let pending_rows = store
            .list_pending_background_work("session-1")
            .expect("list pending background work");
        assert_eq!(pending_rows.len(), 1);
        assert_eq!(pending_rows[0].last_activity_at, "2026-03-25T01:05:00Z");
        assert_eq!(pending_rows[0].updated_at, "2026-03-25T01:05:00Z");

        assert!(store
            .mark_background_work_terminal(
                "session-1",
                "tool-1",
                SessionBackgroundWorkState::Completed,
                "2026-03-25T01:06:00Z",
            )
            .expect("mark background work terminal"));

        assert!(store
            .list_pending_background_work("session-1")
            .expect("list pending background work")
            .is_empty());
    }
}
