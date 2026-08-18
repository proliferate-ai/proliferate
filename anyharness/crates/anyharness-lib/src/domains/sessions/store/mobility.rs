use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, PromptAttachmentRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord, SessionRecord,
};
use crate::domains::sessions::store::link_completions::{
    LinkCompletionRecord, LinkWakeScheduleRecord,
};
use crate::domains::sessions::subagents::delivery::CompletionDeliveryRecord;
use crate::origin::encode_origin_json;

#[derive(Debug, Clone)]
pub(crate) struct WorkspaceMobilitySnapshot {
    pub sessions: Vec<SessionMobilitySnapshot>,
    pub session_links: Vec<SessionLinkRecord>,
    pub session_link_completions: Vec<LinkCompletionRecord>,
    pub session_link_completion_deliveries: Vec<CompletionDeliveryRecord>,
    pub session_link_wake_schedules: Vec<LinkWakeScheduleRecord>,
}

#[derive(Debug, Clone)]
pub(crate) struct SessionMobilitySnapshot {
    pub session: SessionRecord,
    pub live_config_snapshot: Option<SessionLiveConfigSnapshotRecord>,
    pub pending_config_changes: Vec<PendingConfigChangeRecord>,
    pub pending_prompts: Vec<PendingPromptRecord>,
    pub prompt_attachments: Vec<PromptAttachmentRecord>,
    pub events: Vec<SessionEventRecord>,
    pub raw_notifications: Vec<SessionRawNotificationRecord>,
}

impl SessionStore {
    /// Captures every relational row which can affect a mobility session
    /// archive in one SQLite snapshot. Completion-wake admission uses the same
    /// database and therefore linearizes wholly before or after this read.
    pub(crate) fn snapshot_workspace_for_mobility(
        &self,
        workspace_id: &str,
        include_raw_notifications: bool,
    ) -> anyhow::Result<WorkspaceMobilitySnapshot> {
        self.snapshot_workspace_for_mobility_inner(workspace_id, include_raw_notifications, || {})
    }

    #[cfg(test)]
    pub(crate) fn snapshot_workspace_for_mobility_with_hook(
        &self,
        workspace_id: &str,
        include_raw_notifications: bool,
        after_session_rows: impl FnOnce(),
    ) -> anyhow::Result<WorkspaceMobilitySnapshot> {
        self.snapshot_workspace_for_mobility_inner(
            workspace_id,
            include_raw_notifications,
            after_session_rows,
        )
    }

    fn snapshot_workspace_for_mobility_inner(
        &self,
        workspace_id: &str,
        include_raw_notifications: bool,
        after_session_rows: impl FnOnce(),
    ) -> anyhow::Result<WorkspaceMobilitySnapshot> {
        self.db.with_tx(|conn| {
            let mut session_stmt = conn.prepare(
                "SELECT * FROM sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC",
            )?;
            let sessions = session_stmt
                .query_map([workspace_id], super::sessions::map_session)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            drop(session_stmt);

            let session_ids = sessions
                .iter()
                .map(|session| session.id.clone())
                .collect::<Vec<_>>();
            let mut session_snapshots = Vec::with_capacity(sessions.len());
            for session in sessions {
                let session_id = session.id.as_str();
                let live_config_snapshot = conn
                    .query_row(
                        "SELECT * FROM session_live_config_snapshots WHERE session_id = ?1",
                        [session_id],
                        super::live_config::map_live_config_snapshot,
                    )
                    .optional()?;
                let pending_config_changes = query_session_rows(
                    conn,
                    "SELECT * FROM session_pending_config_changes
                     WHERE session_id = ?1 ORDER BY queued_at ASC, config_id ASC",
                    session_id,
                    super::live_config::map_pending_config_change,
                )?;
                let pending_prompts = query_session_rows(
                    conn,
                    "SELECT * FROM session_pending_prompts
                     WHERE session_id = ?1 ORDER BY queue_position ASC, seq ASC",
                    session_id,
                    super::pending_prompts::map_pending_prompt,
                )?;
                let prompt_attachments = query_session_rows(
                    conn,
                    "SELECT * FROM session_prompt_attachments
                     WHERE session_id = ?1 ORDER BY created_at ASC, attachment_id ASC",
                    session_id,
                    super::attachments::map_prompt_attachment,
                )?;
                let events = query_session_rows(
                    conn,
                    "SELECT * FROM session_events WHERE session_id = ?1 ORDER BY seq ASC",
                    session_id,
                    super::events::map_event,
                )?;
                let raw_notifications = if include_raw_notifications {
                    query_session_rows(
                        conn,
                        "SELECT * FROM session_raw_notifications
                         WHERE session_id = ?1 ORDER BY seq ASC",
                        session_id,
                        super::notifications::map_raw_notification,
                    )?
                } else {
                    Vec::new()
                };
                session_snapshots.push(SessionMobilitySnapshot {
                    session,
                    live_config_snapshot,
                    pending_config_changes,
                    pending_prompts,
                    prompt_attachments,
                    events,
                    raw_notifications,
                });
            }

            // Test-only callers can stop at the exact boundary which used to
            // separate parent prompt/event reads from completion-delivery
            // reads. The production caller supplies a no-op, and all reads
            // remain inside this one transaction.
            after_session_rows();

            if session_ids.is_empty() {
                return Ok(WorkspaceMobilitySnapshot {
                    sessions: session_snapshots,
                    session_links: Vec::new(),
                    session_link_completions: Vec::new(),
                    session_link_completion_deliveries: Vec::new(),
                    session_link_wake_schedules: Vec::new(),
                });
            }

            let placeholders = vec!["?"; session_ids.len()].join(", ");
            let mut link_stmt = conn.prepare(&format!(
                "SELECT * FROM session_links
                 WHERE parent_session_id IN ({placeholders})
                    OR child_session_id IN ({placeholders})
                 ORDER BY id ASC"
            ))?;
            let session_link_params = session_ids.iter().chain(session_ids.iter());
            let session_links = link_stmt
                .query_map(
                    rusqlite::params_from_iter(session_link_params),
                    crate::domains::sessions::links::store::map_session_link,
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            drop(link_stmt);

            let link_ids = session_links
                .iter()
                .map(|link| link.id.clone())
                .collect::<Vec<_>>();
            let (session_link_completions, session_link_wake_schedules) =
                query_link_completion_rows(conn, &link_ids)?;

            let mut delivery_stmt = conn.prepare(&format!(
                "SELECT * FROM session_link_completion_deliveries
                 WHERE parent_session_id IN ({placeholders})
                   AND (
                       state IN ('pending', 'enqueued')
                       OR (state = 'delivered'
                           AND retired_prompt_seq IS NOT NULL
                           AND removal_event_persisted_at IS NULL)
                   )
                 ORDER BY created_at ASC, delivery_id ASC"
            ))?;
            let session_link_completion_deliveries = delivery_stmt
                .query_map(
                    rusqlite::params_from_iter(session_ids.iter()),
                    super::completion_deliveries::map_delivery,
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(WorkspaceMobilitySnapshot {
                sessions: session_snapshots,
                session_links,
                session_link_completions,
                session_link_completion_deliveries,
                session_link_wake_schedules,
            })
        })
    }

    pub fn relocate_for_mobility(&self, record: &SessionRecord) -> anyhow::Result<()> {
        let origin_json = encode_origin_json(&record.origin)?;
        self.db.with_tx_anyhow(|conn| {
            let updated = conn.execute(
                "UPDATE sessions
                 SET workspace_id = ?2,
                     native_session_id = NULL,
                     requested_model_id = ?3,
                     current_model_id = ?4,
                     requested_mode_id = ?5,
                     current_mode_id = ?6,
                     title = ?7,
                     thinking_level_id = ?8,
                     thinking_budget_tokens = ?9,
                     status = ?10,
                     updated_at = ?11,
                     last_prompt_at = ?12,
                     closed_at = ?13,
                     dismissed_at = ?14,
                     mcp_bindings_ciphertext = NULL,
                     mcp_binding_summaries_json = NULL,
                     mcp_binding_policy = ?15,
                     system_prompt_append = ?16,
                     subagents_enabled = ?17,
                     action_capabilities_json = ?18,
                     origin_json = ?19
                 WHERE id = ?1",
                params![
                    record.id,
                    record.workspace_id,
                    record.requested_model_id,
                    record.current_model_id,
                    record.requested_mode_id,
                    record.current_mode_id,
                    record.title,
                    record.thinking_level_id,
                    record.thinking_budget_tokens,
                    record.status,
                    record.updated_at,
                    record.last_prompt_at,
                    record.closed_at,
                    record.dismissed_at,
                    record.mcp_binding_policy.as_str(),
                    record.system_prompt_append,
                    if record.subagents_enabled { 1 } else { 0 },
                    record.action_capabilities_json,
                    origin_json,
                ],
            )?;
            if updated == 0 {
                anyhow::bail!("session not found for mobility relocation: {}", record.id);
            }
            Ok::<(), anyhow::Error>(())
        })
    }
}

fn query_session_rows<T>(
    conn: &rusqlite::Connection,
    sql: &str,
    session_id: &str,
    map: fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> rusqlite::Result<Vec<T>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([session_id], map)?.collect();
    rows
}

fn query_link_completion_rows(
    conn: &rusqlite::Connection,
    link_ids: &[String],
) -> rusqlite::Result<(Vec<LinkCompletionRecord>, Vec<LinkWakeScheduleRecord>)> {
    if link_ids.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    let placeholders = vec!["?"; link_ids.len()].join(", ");
    let mut completion_stmt = conn.prepare(&format!(
        "SELECT * FROM session_link_completions
         WHERE session_link_id IN ({placeholders})
         ORDER BY created_at ASC, completion_id ASC"
    ))?;
    let completions = completion_stmt
        .query_map(
            rusqlite::params_from_iter(link_ids.iter()),
            super::link_completions::map_completion,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(completion_stmt);

    let mut schedule_stmt = conn.prepare(&format!(
        "SELECT session_link_id FROM session_link_wake_schedules
         WHERE session_link_id IN ({placeholders})
         ORDER BY session_link_id ASC"
    ))?;
    let schedules = schedule_stmt
        .query_map(rusqlite::params_from_iter(link_ids.iter()), |row| {
            Ok(LinkWakeScheduleRecord {
                session_link_id: row.get(0)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((completions, schedules))
}
