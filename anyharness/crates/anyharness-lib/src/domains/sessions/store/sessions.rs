use rusqlite::{params, OptionalExtension};

use super::attachments::insert_prompt_attachment_row;
use super::events::insert_event_row;
use super::live_config::{upsert_live_config_snapshot_row, upsert_pending_config_change_row};
use super::notifications::insert_raw_notification_row;
use super::pending_prompts::insert_pending_prompt_row;
use super::SessionStore;
use crate::domains::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, PromptAttachmentRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionMcpBindingPolicy, SessionRawNotificationRecord,
    SessionRecord,
};
use crate::origin::{decode_origin_json, encode_origin_json};

pub const SESSION_SEARCH_DEFAULT_LIMIT: usize = 20;
pub const SESSION_SEARCH_MAX_LIMIT: usize = 50;

/// One page position in `search_sessions`' recency ordering. Both halves are
/// needed: `updated_at` collides freely, and the id breaks the tie the same way
/// the ORDER BY does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionSearchCursor<'a> {
    pub updated_at: &'a str,
    pub id: &'a str,
}

impl SessionSearchCursor<'_> {
    /// Opaque page token handed back to agents. The separator is the one
    /// character an RFC 3339 timestamp cannot contain, so the split is exact
    /// even though ids are arbitrary.
    pub fn encode(&self) -> String {
        format!("{}|{}", self.updated_at, self.id)
    }

    pub fn decode(token: &str) -> Option<(String, String)> {
        let (updated_at, id) = token.split_once('|')?;
        (!updated_at.is_empty() && !id.is_empty())
            .then(|| (updated_at.to_string(), id.to_string()))
    }
}

/// Make a user-authored needle a literal for `LIKE ... ESCAPE '\'`. Without
/// this, an agent searching for `deploy_checker` also matches `deployXchecker`
/// and a bare `%` matches everything: the search string is a pattern the caller
/// never asked to write.
pub(crate) fn escape_like_pattern(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

#[derive(Debug, Clone, Default)]
pub struct SessionSearchQuery<'a> {
    /// Exact session-id lookup: how a bare id read out of a message envelope
    /// (or pasted by a human) resolves to a titled row.
    pub session_id: Option<&'a str>,
    /// Case-insensitive substring over the session title and any subagent link
    /// label pointing at it.
    pub text: Option<&'a str>,
    pub workspace_id: Option<&'a str>,
    pub include_closed: bool,
    pub cursor: Option<SessionSearchCursor<'a>>,
    pub limit: usize,
}

impl SessionStore {
    pub fn insert(&self, record: &SessionRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            insert_session_row(conn, record)?;
            Ok(())
        })
    }

    /// Deletes only session-store-owned rows. Use the session delete workflow
    /// when dependent product-state rows must be removed in the same
    /// transaction.
    pub fn delete_session(&self, id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| delete_session_rows_in_tx(conn, id))
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<SessionRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM sessions WHERE id = ?1", [id], |row| {
                map_session(row)
            })
            .optional()
        })
    }

    pub fn update_mcp_bindings(
        &self,
        id: &str,
        mcp_bindings_ciphertext: Option<String>,
        mcp_binding_summaries_json: Option<String>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions
                 SET mcp_bindings_ciphertext = ?1,
                     mcp_binding_summaries_json = ?2,
                     updated_at = ?3
                 WHERE id = ?4",
                params![mcp_bindings_ciphertext, mcp_binding_summaries_json, now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_mcp_binding_summaries(
        &self,
        id: &str,
        mcp_binding_summaries_json: Option<String>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions
                 SET mcp_binding_summaries_json = ?1,
                     updated_at = ?2
                 WHERE id = ?3",
                params![mcp_binding_summaries_json, now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_action_capabilities_json(
        &self,
        id: &str,
        action_capabilities_json: Option<String>,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions
                 SET action_capabilities_json = ?1,
                     updated_at = ?2
                 WHERE id = ?3",
                params![action_capabilities_json, now, id],
            )?;
            Ok(())
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

    pub fn estimate_workspace_storage_bytes(&self, workspace_id: &str) -> anyhow::Result<u64> {
        self.db
            .with_conn(|conn| estimate_workspace_storage_bytes_in_tx(conn, workspace_id))
    }

    pub(crate) fn list_workspace_session_activity(&self) -> anyhow::Result<Vec<(String, String)>> {
        self.db
            .with_conn(|conn| list_workspace_session_activity_in_tx(conn))
    }

    pub fn list_all(&self) -> anyhow::Result<Vec<SessionRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM sessions ORDER BY updated_at DESC")?;
            let rows = stmt.query_map([], |row| map_session(row))?;
            rows.collect()
        })
    }

    /// Runtime-wide session list/search: the read behind `list_agents`, and the
    /// one that turns a bare session id (pasted by a human or read out of a
    /// message envelope) into a titled row.
    ///
    /// Ordering is recency-first with the id as a tie-break, which is also the
    /// cursor: a page ends at its last row and the next page resumes strictly
    /// after it, so rows can never be skipped or repeated when `updated_at`
    /// collides.
    ///
    /// This is the peer-reachable set, so it excludes rows that are not agents
    /// the human is running: dismissed sessions (deleted from the sidebar, and
    /// refused by the boot path, so advertising them as messageable is a lie),
    /// closed sessions unless asked for, and `internal_only` sessions (workflow
    /// and review plumbing — see the module note on
    /// [`crate::domains::sessions::authorize`]).
    pub fn search_sessions(
        &self,
        query: &SessionSearchQuery<'_>,
    ) -> anyhow::Result<Vec<SessionRecord>> {
        let limit = query.limit.clamp(1, SESSION_SEARCH_MAX_LIMIT);
        // Matching is ASCII-case-insensitive: SQLite's LIKE already folds ASCII
        // on both sides, and folding in Rust instead would be worse than
        // useless — `str::to_lowercase` is full-Unicode, so a needle lowercased
        // here could never match a haystack SQLite folds only in ASCII (a
        // session titled "École" would be unreachable by every query).
        let text_pattern = query
            .text
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{}%", escape_like_pattern(value)));
        let session_id = query
            .session_id
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let (cursor_updated_at, cursor_id) = match query.cursor {
            Some(cursor) => (Some(cursor.updated_at), Some(cursor.id)),
            None => (None, None),
        };
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.*
                   FROM sessions s
                  WHERE (?1 IS NULL OR s.id = ?1)
                    AND (?2 IS NULL OR s.workspace_id = ?2)
                    AND (?3 = 1 OR (s.closed_at IS NULL AND s.status <> 'closed'))
                    AND s.dismissed_at IS NULL
                    AND s.mcp_binding_policy <> 'internal_only'
                    AND (
                      ?4 IS NULL
                      OR COALESCE(s.title, '') LIKE ?4 ESCAPE '\\'
                      OR EXISTS (
                        SELECT 1 FROM session_links l
                         WHERE l.child_session_id = s.id
                           AND COALESCE(l.label, '') LIKE ?4 ESCAPE '\\'
                      )
                    )
                    AND (
                      ?5 IS NULL
                      OR s.updated_at < ?5
                      OR (s.updated_at = ?5 AND s.id < ?6)
                    )
                  ORDER BY s.updated_at DESC, s.id DESC
                  LIMIT ?7",
            )?;
            let rows = stmt.query_map(
                params![
                    session_id,
                    query.workspace_id,
                    query.include_closed as i64,
                    text_pattern,
                    cursor_updated_at,
                    cursor_id,
                    limit as i64,
                ],
                map_session,
            )?;
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
                "UPDATE sessions
                 SET status = ?1, updated_at = ?2
                 WHERE id = ?3 AND closed_at IS NULL",
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
                "UPDATE sessions
                 SET native_session_id = ?1, updated_at = ?2
                 WHERE id = ?3 AND closed_at IS NULL",
                params![native_session_id, now, id],
            )?;
            Ok(())
        })
    }

    pub fn clear_native_session_id(&self, id: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET native_session_id = NULL, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            Ok(())
        })
    }

    pub fn update_model_selection(
        &self,
        id: &str,
        model_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET requested_model_id = ?1, current_model_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![model_id, now, id],
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
                "UPDATE sessions
                 SET status = 'closed',
                     closed_at = COALESCE(closed_at, ?1),
                     updated_at = CASE WHEN closed_at IS NULL THEN ?1 ELSE updated_at END
                 WHERE id = ?2",
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

    pub fn import_bundle(
        &self,
        session: &SessionRecord,
        live_config_snapshot: Option<&SessionLiveConfigSnapshotRecord>,
        pending_config_changes: &[PendingConfigChangeRecord],
        pending_prompts: &[PendingPromptRecord],
        prompt_attachments: &[PromptAttachmentRecord],
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
            for attachment in prompt_attachments {
                insert_prompt_attachment_row(conn, attachment)?;
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
}

pub(crate) fn list_session_ids_by_workspace_in_tx(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM sessions WHERE workspace_id = ?1")?;
    let rows = stmt.query_map([workspace_id], |row| row.get::<_, String>(0))?;
    rows.collect()
}

pub(crate) fn list_workspace_session_activity_in_tx(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT workspace_id,
                MAX(MAX(COALESCE(last_prompt_at, ''), COALESCE(updated_at, ''))) AS session_at
           FROM sessions
          GROUP BY workspace_id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

pub(crate) fn estimate_workspace_storage_bytes_in_tx(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> rusqlite::Result<u64> {
    let session_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sessions WHERE workspace_id = ?1",
        [workspace_id],
        |row| row.get(0),
    )?;
    let mut total = (session_count.max(0) as u64).saturating_mul(512);

    for sql in [
        "SELECT COALESCE(SUM(LENGTH(payload_json) + LENGTH(event_type) + LENGTH(timestamp) + 64), 0)
           FROM session_events
          WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
        "SELECT COALESCE(SUM(LENGTH(payload_json) + LENGTH(notification_kind) + LENGTH(timestamp) + 64), 0)
           FROM session_raw_notifications
          WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
        "SELECT COALESCE(SUM(LENGTH(COALESCE(text, '')) + LENGTH(COALESCE(blocks_json, '')) + LENGTH(COALESCE(provenance_json, '')) + 128), 0)
           FROM session_pending_prompts
          WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
        "SELECT COALESCE(SUM(LENGTH(COALESCE(raw_config_options_json, '')) + LENGTH(COALESCE(normalized_controls_json, '')) + 128), 0)
           FROM session_live_config_snapshots
          WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
        "SELECT COALESCE(SUM(LENGTH(config_id) + LENGTH(value) + 96), 0)
           FROM session_pending_config_changes
          WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
        "SELECT COALESCE(SUM(LENGTH(tool_call_id) + LENGTH(COALESCE(turn_id, '')) + LENGTH(tracker_kind) + LENGTH(source_agent_kind) + LENGTH(COALESCE(agent_id, '')) + LENGTH(COALESCE(output_file, '')) + 128), 0)
           FROM session_background_work
          WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
        "SELECT COALESCE(SUM(LENGTH(attachment_id) + LENGTH(kind) + LENGTH(source) + LENGTH(COALESCE(mime_type, '')) + LENGTH(COALESCE(display_name, '')) + LENGTH(COALESCE(source_uri, '')) + LENGTH(COALESCE(storage_path, '')) + LENGTH(content) + 128), 0)
           FROM session_prompt_attachments
          WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
    ] {
        let bytes: i64 = conn.query_row(sql, [workspace_id], |row| row.get(0))?;
        total = total.saturating_add(bytes.max(0) as u64);
    }

    Ok(total)
}

pub(crate) fn delete_session_rows_in_tx(
    conn: &rusqlite::Connection,
    id: &str,
) -> rusqlite::Result<()> {
    // These tables are owned by the session store and do not all cascade from
    // sessions today, so the store keeps their low-level SQL cleanup.
    conn.execute(
        "DELETE FROM session_background_work WHERE session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_pending_prompts WHERE session_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM session_prompt_attachments WHERE session_id = ?1",
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
    // Session-scoped wake schedules reference sessions from BOTH sides, so a
    // deleted session has to take the rows where it is the watcher and the rows
    // where it is the target with it.
    super::agent_wakes::delete_agent_wake_rows_for_session_in_tx(conn, id)?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    Ok(())
}

pub(super) fn map_session(row: &rusqlite::Row) -> rusqlite::Result<SessionRecord> {
    let id: String = row.get("id")?;
    let origin_json: Option<String> = row.get("origin_json")?;
    Ok(SessionRecord {
        id: id.clone(),
        workspace_id: row.get("workspace_id")?,
        agent_kind: row.get("agent_kind")?,
        native_session_id: row.get("native_session_id")?,
        agent_auth_contexts: row.get("agent_auth_contexts")?,
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
        mcp_binding_summaries_json: row.get("mcp_binding_summaries_json")?,
        mcp_binding_policy: SessionMcpBindingPolicy::parse(
            &row.get::<_, String>("mcp_binding_policy")?,
        ),
        system_prompt_append: row.get("system_prompt_append")?,
        subagents_enabled: row.get::<_, i64>("subagents_enabled")? != 0,
        action_capabilities_json: row.get("action_capabilities_json")?,
        origin: decode_origin_json("sessions", &id, origin_json),
    })
}

pub(super) fn insert_session_row(
    conn: &rusqlite::Connection,
    record: &SessionRecord,
) -> rusqlite::Result<()> {
    let origin_json = encode_origin_json(&record.origin)?;
    conn.execute(
        "INSERT INTO sessions (id, workspace_id, agent_kind, native_session_id,
         agent_auth_contexts,
         requested_model_id, current_model_id, requested_mode_id, current_mode_id,
         title, thinking_level_id, thinking_budget_tokens, status, created_at,
         updated_at, last_prompt_at, closed_at, dismissed_at, mcp_bindings_ciphertext,
         mcp_binding_summaries_json, mcp_binding_policy, system_prompt_append,
         subagents_enabled, action_capabilities_json, origin_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
        params![
            record.id,
            record.workspace_id,
            record.agent_kind,
            record.native_session_id,
            record.agent_auth_contexts,
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
            record.mcp_binding_summaries_json,
            record.mcp_binding_policy.as_str(),
            record.system_prompt_append,
            if record.subagents_enabled { 1 } else { 0 },
            record.action_capabilities_json,
            origin_json,
        ],
    )?;
    Ok(())
}
