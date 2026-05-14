use rusqlite::{params, OptionalExtension};

use super::attachments::insert_prompt_attachment_row;
use super::events::insert_event_row;
use super::live_config::{upsert_live_config_snapshot_row, upsert_pending_config_change_row};
use super::notifications::insert_raw_notification_row;
use super::pending_prompts::insert_pending_prompt_row;
use super::{delete_session_in_tx, SessionStore};
use crate::origin::{decode_origin_json, encode_origin_json};
use crate::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, PromptAttachmentRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionMcpBindingPolicy, SessionRawNotificationRecord,
    SessionRecord,
};

impl SessionStore {
    pub fn insert(&self, record: &SessionRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            insert_session_row(conn, record)?;
            Ok(())
        })
    }

    pub fn delete_session(&self, id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| delete_session_in_tx(conn, id))
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

    pub fn mark_cowork_managed_workspaces_closed_by_parent(
        &self,
        parent_session_id: &str,
        closed_at: &str,
    ) -> anyhow::Result<usize> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE cowork_managed_workspaces
                 SET closed_at = COALESCE(closed_at, ?1)
                 WHERE parent_session_id = ?2",
                params![closed_at, parent_session_id],
            )
            .map_err(Into::into)
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

pub(super) fn map_session(row: &rusqlite::Row) -> rusqlite::Result<SessionRecord> {
    let id: String = row.get("id")?;
    let origin_json: Option<String> = row.get("origin_json")?;
    Ok(SessionRecord {
        id: id.clone(),
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
         requested_model_id, current_model_id, requested_mode_id, current_mode_id,
         title, thinking_level_id, thinking_budget_tokens, status, created_at,
         updated_at, last_prompt_at, closed_at, dismissed_at, mcp_bindings_ciphertext,
         mcp_binding_summaries_json, mcp_binding_policy, system_prompt_append,
         subagents_enabled, action_capabilities_json, origin_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
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
