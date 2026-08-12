use rusqlite::{params, Connection};

use super::SessionStore;
use crate::domains::sessions::model::{
    SessionEventRecord, SessionMcpBindingPolicy, SessionRawNotificationRecord, SessionRecord,
};
use crate::origin::decode_origin_json;
use crate::persistence::sqlite::{CancelInterruptibleQueryOnDrop, InterruptibleQuery};

pub(crate) const SUPPORT_WINDOW_ITEM_BYTES: usize = 262_144;

pub(crate) enum SupportWindowCandidate<T> {
    Item(T),
    Oversized,
}

pub(crate) struct SupportWindowRows<T> {
    pub(crate) candidates: Vec<SupportWindowCandidate<T>>,
    pub(crate) has_more: bool,
}

pub(crate) enum SupportSessionWindowFilter {
    Exact {
        session_id: String,
        updated_at_to: String,
    },
    Recent {
        updated_at_from: String,
        updated_at_to: String,
    },
}

pub(crate) struct SupportEvidenceWindowFilter {
    pub(crate) timestamp_from: String,
    pub(crate) timestamp_to: String,
}

impl SessionStore {
    pub(crate) fn begin_support_window_query(
        &self,
    ) -> (InterruptibleQuery, CancelInterruptibleQueryOnDrop) {
        self.db.begin_interruptible_query()
    }

    pub(crate) fn list_support_session_window(
        &self,
        workspace_id: &str,
        filter: &SupportSessionWindowFilter,
        limit: usize,
        cancellation: &InterruptibleQuery,
    ) -> anyhow::Result<SupportWindowRows<SessionRecord>> {
        self.db.with_interruptible_conn(cancellation, |conn| {
            cancellation.check_cancelled()?;
            let metadata = match filter {
                SupportSessionWindowFilter::Exact {
                    session_id,
                    updated_at_to,
                } => select_session_metadata_exact(
                    conn,
                    workspace_id,
                    session_id,
                    updated_at_to,
                    limit,
                )?,
                SupportSessionWindowFilter::Recent {
                    updated_at_from,
                    updated_at_to,
                } => select_session_metadata_recent(
                    conn,
                    workspace_id,
                    updated_at_from,
                    updated_at_to,
                    limit,
                )?,
            };
            cancellation.check_cancelled()?;
            let has_more = metadata.len() > limit;
            let mut candidates = Vec::with_capacity(metadata.len());
            for (id, source_bytes) in metadata {
                cancellation.check_cancelled()?;
                if source_bytes > SUPPORT_WINDOW_ITEM_BYTES as i64 {
                    candidates.push(SupportWindowCandidate::Oversized);
                    continue;
                }
                candidates.push(SupportWindowCandidate::Item(load_support_session(
                    conn, &id,
                )?));
            }
            cancellation.check_cancelled()?;
            Ok(SupportWindowRows {
                candidates,
                has_more,
            })
        })
    }

    pub(crate) fn list_support_event_window(
        &self,
        session_id: &str,
        filter: &SupportEvidenceWindowFilter,
        limit: usize,
        cancellation: &InterruptibleQuery,
    ) -> anyhow::Result<Option<SupportWindowRows<SessionEventRecord>>> {
        self.db.with_interruptible_conn(cancellation, |conn| {
            cancellation.check_cancelled()?;
            if !session_exists(conn, session_id)? {
                return Ok(None);
            }
            let metadata = select_event_metadata(conn, session_id, filter, limit)?;
            cancellation.check_cancelled()?;
            let has_more = metadata.len() > limit;
            let mut candidates = Vec::with_capacity(metadata.len());
            for (id, source_bytes) in metadata {
                cancellation.check_cancelled()?;
                if source_bytes > SUPPORT_WINDOW_ITEM_BYTES as i64 {
                    candidates.push(SupportWindowCandidate::Oversized);
                    continue;
                }
                candidates.push(SupportWindowCandidate::Item(load_support_event(conn, id)?));
            }
            cancellation.check_cancelled()?;
            Ok(Some(SupportWindowRows {
                candidates,
                has_more,
            }))
        })
    }

    pub(crate) fn list_support_raw_notification_window(
        &self,
        session_id: &str,
        filter: &SupportEvidenceWindowFilter,
        limit: usize,
        cancellation: &InterruptibleQuery,
    ) -> anyhow::Result<Option<SupportWindowRows<SessionRawNotificationRecord>>> {
        self.db.with_interruptible_conn(cancellation, |conn| {
            cancellation.check_cancelled()?;
            if !session_exists(conn, session_id)? {
                return Ok(None);
            }
            let metadata = select_raw_notification_metadata(conn, session_id, filter, limit)?;
            cancellation.check_cancelled()?;
            let has_more = metadata.len() > limit;
            let mut candidates = Vec::with_capacity(metadata.len());
            for (id, source_bytes) in metadata {
                cancellation.check_cancelled()?;
                if source_bytes > SUPPORT_WINDOW_ITEM_BYTES as i64 {
                    candidates.push(SupportWindowCandidate::Oversized);
                    continue;
                }
                candidates.push(SupportWindowCandidate::Item(load_support_raw_notification(
                    conn, id,
                )?));
            }
            cancellation.check_cancelled()?;
            Ok(Some(SupportWindowRows {
                candidates,
                has_more,
            }))
        })
    }
}

const SESSION_SOURCE_BYTES: &str = "
    COALESCE(LENGTH(CAST(id AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(workspace_id AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(agent_kind AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(native_session_id AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(requested_model_id AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(current_model_id AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(requested_mode_id AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(current_mode_id AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(title AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(status AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(created_at AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(updated_at AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(last_prompt_at AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(closed_at AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(dismissed_at AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(mcp_binding_summaries_json AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(action_capabilities_json AS BLOB)), 0)
  + COALESCE(LENGTH(CAST(origin_json AS BLOB)), 0)";

fn select_session_metadata_exact(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
    updated_at_to: &str,
    limit: usize,
) -> anyhow::Result<Vec<(String, i64)>> {
    let sql = format!(
        "SELECT id, ({SESSION_SOURCE_BYTES}) AS source_bytes
           FROM sessions
          WHERE workspace_id = ?1
            AND id = ?2
            AND julianday(updated_at) <= julianday(?3)
          ORDER BY julianday(updated_at) DESC, id ASC
          LIMIT ?4"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![
            workspace_id,
            session_id,
            updated_at_to,
            hard_cap_plus_one(limit)
        ],
        |row| Ok((row.get("id")?, row.get("source_bytes")?)),
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn select_session_metadata_recent(
    conn: &Connection,
    workspace_id: &str,
    updated_at_from: &str,
    updated_at_to: &str,
    limit: usize,
) -> anyhow::Result<Vec<(String, i64)>> {
    let sql = format!(
        "SELECT id, ({SESSION_SOURCE_BYTES}) AS source_bytes
           FROM sessions
          WHERE workspace_id = ?1
            AND julianday(updated_at) >= julianday(?2)
            AND julianday(updated_at) <= julianday(?3)
          ORDER BY julianday(updated_at) DESC, id ASC
          LIMIT ?4"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![
            workspace_id,
            updated_at_from,
            updated_at_to,
            hard_cap_plus_one(limit)
        ],
        |row| Ok((row.get("id")?, row.get("source_bytes")?)),
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn select_event_metadata(
    conn: &Connection,
    session_id: &str,
    filter: &SupportEvidenceWindowFilter,
    limit: usize,
) -> anyhow::Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT id,
                COALESCE(LENGTH(CAST(session_id AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(timestamp AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(event_type AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(turn_id AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(item_id AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(payload_json AS BLOB)), 0) AS source_bytes
           FROM session_events
          WHERE session_id = ?1
            AND julianday(timestamp) >= julianday(?2)
            AND julianday(timestamp) <= julianday(?3)
          ORDER BY seq DESC
          LIMIT ?4",
    )?;
    let rows = stmt.query_map(
        params![
            session_id,
            filter.timestamp_from.as_str(),
            filter.timestamp_to.as_str(),
            hard_cap_plus_one(limit)
        ],
        |row| Ok((row.get("id")?, row.get("source_bytes")?)),
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn select_raw_notification_metadata(
    conn: &Connection,
    session_id: &str,
    filter: &SupportEvidenceWindowFilter,
    limit: usize,
) -> anyhow::Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT id,
                COALESCE(LENGTH(CAST(session_id AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(timestamp AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(notification_kind AS BLOB)), 0)
              + COALESCE(LENGTH(CAST(payload_json AS BLOB)), 0) AS source_bytes
           FROM session_raw_notifications
          WHERE session_id = ?1
            AND julianday(timestamp) >= julianday(?2)
            AND julianday(timestamp) <= julianday(?3)
          ORDER BY seq DESC
          LIMIT ?4",
    )?;
    let rows = stmt.query_map(
        params![
            session_id,
            filter.timestamp_from.as_str(),
            filter.timestamp_to.as_str(),
            hard_cap_plus_one(limit)
        ],
        |row| Ok((row.get("id")?, row.get("source_bytes")?)),
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn hard_cap_plus_one(limit: usize) -> i64 {
    i64::try_from(limit.saturating_add(1)).unwrap_or(i64::MAX)
}

fn session_exists(conn: &Connection, session_id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)",
        [session_id],
        |row| row.get(0),
    )
}

fn load_support_session(conn: &Connection, id: &str) -> anyhow::Result<SessionRecord> {
    Ok(conn.query_row(
        "SELECT id, workspace_id, agent_kind, native_session_id,
                requested_model_id, current_model_id, requested_mode_id, current_mode_id,
                title, status, created_at, updated_at, last_prompt_at, closed_at, dismissed_at,
                mcp_binding_summaries_json, action_capabilities_json, origin_json
           FROM sessions WHERE id = ?1",
        [id],
        |row| {
            let id: String = row.get("id")?;
            let origin_json: Option<String> = row.get("origin_json")?;
            Ok(SessionRecord {
                id: id.clone(),
                workspace_id: row.get("workspace_id")?,
                agent_kind: row.get("agent_kind")?,
                native_session_id: row.get("native_session_id")?,
                agent_auth_contexts: None,
                requested_model_id: row.get("requested_model_id")?,
                current_model_id: row.get("current_model_id")?,
                requested_mode_id: row.get("requested_mode_id")?,
                current_mode_id: row.get("current_mode_id")?,
                title: row.get("title")?,
                thinking_level_id: None,
                thinking_budget_tokens: None,
                status: row.get("status")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                last_prompt_at: row.get("last_prompt_at")?,
                closed_at: row.get("closed_at")?,
                dismissed_at: row.get("dismissed_at")?,
                mcp_bindings_ciphertext: None,
                mcp_binding_summaries_json: row.get("mcp_binding_summaries_json")?,
                mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
                system_prompt_append: None,
                subagents_enabled: true,
                action_capabilities_json: row.get("action_capabilities_json")?,
                origin: decode_origin_json("sessions", &id, origin_json),
            })
        },
    )?)
}

fn load_support_event(conn: &Connection, id: i64) -> rusqlite::Result<SessionEventRecord> {
    conn.query_row(
        "SELECT id, session_id, seq, timestamp, event_type, turn_id, item_id, payload_json
           FROM session_events WHERE id = ?1",
        [id],
        |row| {
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
        },
    )
}

fn load_support_raw_notification(
    conn: &Connection,
    id: i64,
) -> rusqlite::Result<SessionRawNotificationRecord> {
    conn.query_row(
        "SELECT id, session_id, seq, timestamp, notification_kind, payload_json
           FROM session_raw_notifications WHERE id = ?1",
        [id],
        |row| {
            Ok(SessionRawNotificationRecord {
                id: row.get("id")?,
                session_id: row.get("session_id")?,
                seq: row.get("seq")?,
                timestamp: row.get("timestamp")?,
                notification_kind: row.get("notification_kind")?,
                payload_json: row.get("payload_json")?,
            })
        },
    )
}
