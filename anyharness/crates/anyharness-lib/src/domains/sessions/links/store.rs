use rusqlite::{params, OptionalExtension};

use super::model::{
    SessionLinkRecord, SessionLinkRelation, SubagentLinkCloseOutcome, SubagentLinkCloseResult,
    SubagentLinkOpenOutcome, SubagentLinkOpenResult,
};
use super::row::map_session_link;
use crate::domains::agents::launch_options::{
    HarnessLaunchOptionStateRow, LaunchSelection, LaunchSelectionUnsupported,
};
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::launch_intents::insert_launch_intent_row;
use crate::domains::sessions::store::sessions::insert_session_row;
use crate::domains::sessions::store::{with_launch_admission_tx, LaunchAdmissionTxError};
use crate::persistence::Db;

#[derive(Clone)]
pub struct SessionLinkStore {
    db: Db,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertSubagentLinkOutcome {
    Inserted,
    FanoutLimit,
}

#[derive(Debug)]
pub enum InsertSubagentSessionError {
    FanoutLimit,
    LaunchSelection(LaunchSelectionUnsupported),
}

#[derive(Debug, thiserror::Error)]
#[error("subagent fanout limit reached")]
struct AtomicSubagentFanoutLimit;

impl SessionLinkStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn insert(&self, record: &SessionLinkRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_links (
                    id, public_id, relation, parent_session_id, child_session_id,
                    workspace_relation, label, created_by_turn_id,
                    created_by_tool_call_id, created_at, subagent_closed_at, closed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    record.id,
                    record.public_id,
                    record.relation.as_str(),
                    record.parent_session_id,
                    record.child_session_id,
                    record.workspace_relation.as_str(),
                    record.label,
                    record.created_by_turn_id,
                    record.created_by_tool_call_id,
                    record.created_at,
                    record.subagent_closed_at,
                    record.closed_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn insert_subagent_with_child_limit(
        &self,
        record: &SessionLinkRecord,
        max_children: usize,
    ) -> anyhow::Result<InsertSubagentLinkOutcome> {
        self.db.with_conn(|conn| {
            let inserted = conn.execute(
                "INSERT INTO session_links (
                    id, public_id, relation, parent_session_id, child_session_id,
                    workspace_relation, label, created_by_turn_id,
                    created_by_tool_call_id, created_at, subagent_closed_at, closed_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
                 WHERE (
                    SELECT COUNT(*)
                    FROM session_links
                    WHERE relation = 'subagent' AND parent_session_id = ?4
                      AND closed_at IS NULL
                 ) < ?13",
                params![
                    record.id,
                    record.public_id,
                    record.relation.as_str(),
                    record.parent_session_id,
                    record.child_session_id,
                    record.workspace_relation.as_str(),
                    record.label,
                    record.created_by_turn_id,
                    record.created_by_tool_call_id,
                    record.created_at,
                    record.subagent_closed_at,
                    record.closed_at,
                    max_children as i64,
                ],
            )?;
            Ok(if inserted == 0 {
                InsertSubagentLinkOutcome::FanoutLimit
            } else {
                InsertSubagentLinkOutcome::Inserted
            })
        })
    }

    /// Inserts the new child session and its capped subagent relationship in
    /// one transaction. No product read can observe the child as an unlinked
    /// ordinary agent between these two writes.
    pub fn insert_subagent_session_with_child_limit(
        &self,
        session: &SessionRecord,
        intent: &ResolvedLaunchIntent,
        record: &SessionLinkRecord,
        max_children: usize,
        harness_kind: &str,
        basis_revision: &dyn Fn() -> String,
        selection: &LaunchSelection,
    ) -> Result<(InsertSubagentLinkOutcome, HarnessLaunchOptionStateRow), InsertSubagentSessionError>
    {
        let result =
            with_launch_admission_tx(&self.db, harness_kind, basis_revision, selection, |conn| {
                insert_session_row(conn, session)?;
                insert_launch_intent_row(conn, &session.id, intent)?;
                let inserted = conn.execute(
                    "INSERT INTO session_links (
                    id, public_id, relation, parent_session_id, child_session_id,
                    workspace_relation, label, created_by_turn_id,
                    created_by_tool_call_id, created_at, subagent_closed_at, closed_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
                 WHERE (
                    SELECT COUNT(*)
                    FROM session_links
                    WHERE relation = 'subagent' AND parent_session_id = ?4
                      AND closed_at IS NULL
                 ) < ?13",
                    params![
                        record.id,
                        record.public_id,
                        record.relation.as_str(),
                        record.parent_session_id,
                        record.child_session_id,
                        record.workspace_relation.as_str(),
                        record.label,
                        record.created_by_turn_id,
                        record.created_by_tool_call_id,
                        record.created_at,
                        record.subagent_closed_at,
                        record.closed_at,
                        max_children as i64,
                    ],
                )?;
                if inserted == 0 {
                    return Err(AtomicSubagentFanoutLimit.into());
                }
                Ok(())
            });
        match result {
            Ok(((), validated)) => Ok((InsertSubagentLinkOutcome::Inserted, validated)),
            Err(LaunchAdmissionTxError::Store(error))
                if error.downcast_ref::<AtomicSubagentFanoutLimit>().is_some() =>
            {
                Err(InsertSubagentSessionError::FanoutLimit)
            }
            Err(error) => Err(InsertSubagentSessionError::LaunchSelection(
                error.into_selection(),
            )),
        }
    }

    pub fn import_link(&self, record: &SessionLinkRecord) -> anyhow::Result<()> {
        self.insert(record)
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_links WHERE id = ?1",
                [id],
                map_session_link,
            )
            .optional()
        })
    }

    pub fn find_by_public_id(&self, public_id: &str) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_links WHERE public_id = ?1",
                [public_id],
                map_session_link,
            )
            .optional()
        })
    }

    pub fn mark_closed(&self, id: &str, closed_at: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let updated = conn.execute(
                "UPDATE session_links
                 SET closed_at = COALESCE(closed_at, ?1)
                 WHERE id = ?2",
                params![closed_at, id],
            )?;
            Ok(updated > 0)
        })
    }

    /// Terminally closes a link, idempotently. Returns whether *this* call
    /// performed the close: an already-closed link keeps its original
    /// `closed_at` and reports `false`, so a caller that observes the
    /// transition (a log line, a notification) fires exactly once per link
    /// even when teardown reaches the same link from both ends.
    ///
    /// The row-guard replaces an earlier `COALESCE(closed_at, ?1)` with no
    /// change in stored state — COALESCE already preserved the first
    /// timestamp — but the old form matched already-closed rows, so its
    /// `bool` meant "a link with this id exists" rather than "this call
    /// closed it".
    pub fn close_link(&self, id: &str, closed_at: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM session_link_wake_schedules WHERE session_link_id = ?1",
                [id],
            )?;
            let updated = conn.execute(
                "UPDATE session_links
                 SET closed_at = ?1
                 WHERE id = ?2 AND closed_at IS NULL",
                params![closed_at, id],
            )?;
            Ok(updated > 0)
        })
    }

    /// Reversibly closes a current subagent relationship and removes work
    /// which must not survive that gate. This is deliberately separate from
    /// terminal relationship closure (`closed_at`).
    pub fn close_subagent_operability(
        &self,
        id: &str,
        subagent_closed_at: &str,
    ) -> anyhow::Result<SubagentLinkCloseOutcome> {
        self.db.with_tx(|conn| {
            let Some(before) = conn
                .query_row(
                    "SELECT * FROM session_links
                     WHERE id = ?1 AND relation = 'subagent' AND closed_at IS NULL",
                    [id],
                    map_session_link,
                )
                .optional()?
            else {
                return Ok(SubagentLinkCloseOutcome::NotFound);
            };

            conn.execute(
                "UPDATE session_links
                 SET subagent_closed_at = COALESCE(subagent_closed_at, ?2)
                 WHERE id = ?1 AND relation = 'subagent' AND closed_at IS NULL",
                params![id, subagent_closed_at],
            )?;
            let purged_pending_prompt_count = conn.execute(
                "DELETE FROM session_pending_prompts WHERE session_id = ?1",
                [before.child_session_id.as_str()],
            )?;
            let removed_wake_schedule = conn.execute(
                "DELETE FROM session_link_wake_schedules WHERE session_link_id = ?1",
                [id],
            )? > 0;
            let link = conn.query_row(
                "SELECT * FROM session_links WHERE id = ?1",
                [id],
                map_session_link,
            )?;

            Ok(SubagentLinkCloseOutcome::Closed(SubagentLinkCloseResult {
                link,
                was_already_closed: before.subagent_closed_at.is_some(),
                purged_pending_prompt_count,
                removed_wake_schedule,
            }))
        })
    }

    /// Clears the reversible subagent operability gate without changing
    /// terminal relationship history.
    pub fn open_subagent_operability(&self, id: &str) -> anyhow::Result<SubagentLinkOpenOutcome> {
        self.db.with_tx(|conn| {
            let Some(before) = conn
                .query_row(
                    "SELECT * FROM session_links
                     WHERE id = ?1 AND relation = 'subagent' AND closed_at IS NULL",
                    [id],
                    map_session_link,
                )
                .optional()?
            else {
                return Ok(SubagentLinkOpenOutcome::NotFound);
            };

            conn.execute(
                "UPDATE session_links
                 SET subagent_closed_at = NULL
                 WHERE id = ?1 AND relation = 'subagent' AND closed_at IS NULL",
                [id],
            )?;
            let link = conn.query_row(
                "SELECT * FROM session_links WHERE id = ?1",
                [id],
                map_session_link,
            )?;

            Ok(SubagentLinkOpenOutcome::Opened(SubagentLinkOpenResult {
                link,
                was_already_open: before.subagent_closed_at.is_none(),
            }))
        })
    }

    pub fn delete_by_id(&self, id: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let deleted = conn.execute("DELETE FROM session_links WHERE id = ?1", [id])?;
            Ok(deleted > 0)
        })
    }

    pub fn find_subagent_link(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.find_link_by_relation(
            SessionLinkRelation::Subagent,
            parent_session_id,
            child_session_id,
        )
    }

    pub fn find_link_by_relation(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_links
                 WHERE relation = ?1
                   AND parent_session_id = ?2
                   AND child_session_id = ?3
                   AND closed_at IS NULL",
                params![relation.as_str(), parent_session_id, child_session_id],
                map_session_link,
            )
            .optional()
        })
    }

    pub fn find_link_by_relation_including_closed(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_links
                 WHERE relation = ?1 AND parent_session_id = ?2 AND child_session_id = ?3",
                params![relation.as_str(), parent_session_id, child_session_id],
                map_session_link,
            )
            .optional()
        })
    }

    pub fn list_children_by_relation(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_links
                 WHERE relation = ?1 AND parent_session_id = ?2
                   AND closed_at IS NULL
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map(
                params![relation.as_str(), parent_session_id],
                map_session_link,
            )?;
            rows.collect()
        })
    }

    pub fn find_parent_by_relation(
        &self,
        relation: SessionLinkRelation,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_links
                 WHERE relation = ?1 AND child_session_id = ?2
                   AND closed_at IS NULL
                 LIMIT 1",
                params![relation.as_str(), child_session_id],
                map_session_link,
            )
            .optional()
        })
    }

    pub fn list_by_parent(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_links
                 WHERE parent_session_id = ?1
                   AND closed_at IS NULL
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([parent_session_id], map_session_link)?;
            rows.collect()
        })
    }

    pub fn list_by_parent_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_links
                 WHERE parent_session_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([parent_session_id], map_session_link)?;
            rows.collect()
        })
    }

    pub fn list_by_child(&self, child_session_id: &str) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_links
                 WHERE child_session_id = ?1
                   AND closed_at IS NULL
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([child_session_id], map_session_link)?;
            rows.collect()
        })
    }

    pub fn list_by_child_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_links
                 WHERE child_session_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([child_session_id], map_session_link)?;
            rows.collect()
        })
    }

    pub fn list_current_subagent_children_with_unclosed_turns_page(
        &self,
        after_link_id: Option<&str>,
        limit: usize,
    ) -> anyhow::Result<Vec<(String, String)>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT l.id, l.child_session_id
                 FROM session_links l
                 WHERE l.relation = 'subagent'
                   AND l.closed_at IS NULL
                   AND (?1 IS NULL OR l.id > ?1)
                   AND EXISTS (
                     SELECT 1
                     FROM session_events e
                     WHERE e.session_id = l.child_session_id
                       AND e.event_type = 'turn_started'
                       AND e.turn_id IS NOT NULL
                       AND NOT EXISTS (
                         SELECT 1
                         FROM session_events e2
                         WHERE e2.session_id = e.session_id
                           AND e2.turn_id = e.turn_id
                           AND e2.event_type IN ('turn_ended', 'error', 'session_ended')
                       )
                   )
                 ORDER BY l.id ASC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![after_link_id, limit as i64], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })?;
            rows.collect()
        })
    }

    pub fn list_subagent_children(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.list_children_by_relation(SessionLinkRelation::Subagent, parent_session_id)
    }

    pub fn list_subagent_links_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT l.*
                 FROM session_links l
                 JOIN sessions parent ON parent.id = l.parent_session_id
                 WHERE l.relation = 'subagent'
                   AND l.closed_at IS NULL
                   AND parent.workspace_id = ?1
                 ORDER BY parent.created_at ASC, parent.id ASC,
                          l.created_at ASC, l.id ASC",
            )?;
            let rows = stmt.query_map([workspace_id], map_session_link)?;
            rows.collect()
        })
    }

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.find_parent_by_relation(SessionLinkRelation::Subagent, child_session_id)
    }
}

pub(crate) fn delete_session_link_rows_for_session_in_tx(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> rusqlite::Result<()> {
    crate::domains::sessions::store::completion_deliveries::queue::delete_parent_deliveries_in_tx(
        conn, session_id,
    )?;
    conn.execute(
        "DELETE FROM session_link_wake_schedules
         WHERE session_link_id IN (
            SELECT id FROM session_links
            WHERE parent_session_id = ?1 OR child_session_id = ?1
         )",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM session_link_completions
         WHERE session_link_id IN (
            SELECT id FROM session_links
            WHERE parent_session_id = ?1 OR child_session_id = ?1
         )",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM session_links WHERE parent_session_id = ?1 OR child_session_id = ?1",
        [session_id],
    )?;
    Ok(())
}
