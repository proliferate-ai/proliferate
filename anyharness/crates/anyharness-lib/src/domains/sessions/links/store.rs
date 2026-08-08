use rusqlite::{params, OptionalExtension};

use super::model::{
    SessionLinkParseError, SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
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
                    created_by_tool_call_id, created_at, closed_at,
                    promoted_at, closed_by_session_id, close_reason
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
                    record.closed_at,
                    record.promoted_at,
                    record.closed_by_session_id,
                    record.close_reason,
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
                // The cap counts LINKED children only. A promoted child is a
                // peer that keeps its ownership row, not one of the eight
                // delegation slots its former parent may fill.
                "INSERT INTO session_links (
                    id, public_id, relation, parent_session_id, child_session_id,
                    workspace_relation, label, created_by_turn_id,
                    created_by_tool_call_id, created_at, closed_at,
                    promoted_at, closed_by_session_id, close_reason
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
                 WHERE (
                    SELECT COUNT(*)
                    FROM session_links
                    WHERE relation = 'subagent' AND parent_session_id = ?4
                      AND closed_at IS NULL
                      AND promoted_at IS NULL
                 ) < ?15",
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
                    record.closed_at,
                    record.promoted_at,
                    record.closed_by_session_id,
                    record.close_reason,
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

    pub fn close_link(&self, id: &str, closed_at: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM session_link_wake_schedules WHERE session_link_id = ?1",
                [id],
            )?;
            let updated = conn.execute(
                "UPDATE session_links
                 SET closed_at = COALESCE(closed_at, ?1)
                 WHERE id = ?2",
                params![closed_at, id],
            )?;
            Ok(updated > 0)
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

    /// The one parent row of `child_session_id` for this relation.
    ///
    /// `UNIQUE(relation, parent, child)` permits two open rows naming the same
    /// child from different parents, which `link_child` never creates today.
    /// The order is still pinned rather than left to SQLite, because this row
    /// decides `is_unpromoted_subagent` — and therefore whether the child may
    /// spawn at all. Unpromoted rows sort first, so an ambiguous state fails
    /// CLOSED (subordinate, no spawn tools) instead of by row order.
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
                 ORDER BY (promoted_at IS NULL) DESC, created_at ASC, id ASC
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

    pub fn list_subagent_children(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.list_children_by_relation(SessionLinkRelation::Subagent, parent_session_id)
    }

    /// How many of the parent's eight delegation slots are occupied right now.
    ///
    /// This predicate is the fanout cap, so it is written ONCE and read by
    /// everything that has an opinion about the cap: the spawn pre-check and
    /// the numbers `get_subagent_launch_options` advertises. Its WHERE clause
    /// is deliberately identical to the subselect in
    /// [`Self::insert_subagent_with_child_limit`], which is the cap that
    /// actually rejects an insert — an advertised count that disagreed with it
    /// would tell an agent it is out of slots while `spawn_subagent` keeps
    /// succeeding.
    pub fn count_open_unpromoted_subagent_children(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<usize> {
        self.db.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*)
                 FROM session_links
                 WHERE relation = 'subagent' AND parent_session_id = ?1
                   AND closed_at IS NULL
                   AND promoted_at IS NULL",
                [parent_session_id],
                |row| row.get(0),
            )?;
            Ok(count.max(0) as usize)
        })
    }

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.find_parent_by_relation(SessionLinkRelation::Subagent, child_session_id)
    }

    /// Promotion is one idempotent write. The guard, not a `COALESCE`, is what
    /// makes it idempotent AND reportable: zero rows updated means "already
    /// promoted, or closed", so the caller can say so instead of silently
    /// re-dating the row.
    ///
    /// The relation stays `'subagent'`. The row is still the ownership fact
    /// that lets the former parent close this agent individually; what changes
    /// is that the cascade stops following it and the spawn tools unlock.
    pub fn promote_link(&self, id: &str, promoted_at: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let updated = conn.execute(
                "UPDATE session_links
                 SET promoted_at = ?1
                 WHERE id = ?2 AND promoted_at IS NULL AND closed_at IS NULL",
                params![promoted_at, id],
            )?;
            Ok(updated > 0)
        })
    }

    /// Stamp who asked for this close and why, WITHOUT closing the link.
    ///
    /// On an open row this is the durable "end requested" record: the close was
    /// authorized and is now waiting for the target's in-flight turn to finish.
    ///
    /// Written once, and the FIRST requester is the one recorded. Both guards
    /// are needed for that: `closed_at IS NULL` stops a second close of an
    /// already-closed agent from rewriting history, and
    /// `closed_by_session_id IS NULL` stops a second close during the
    /// end-requested window — which is a whole turn wide — from doing the same.
    /// Zero rows updated therefore means "already requested, or already
    /// closed", which is exactly what the caller wants to report.
    pub fn record_close_attribution(
        &self,
        id: &str,
        closed_by_session_id: &str,
        close_reason: Option<&str>,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let updated = conn.execute(
                "UPDATE session_links
                 SET closed_by_session_id = ?1, close_reason = ?2
                 WHERE id = ?3 AND closed_at IS NULL AND closed_by_session_id IS NULL",
                params![closed_by_session_id, close_reason, id],
            )?;
            Ok(updated > 0)
        })
    }

    /// The one link that makes `parent_session_id` the owner of
    /// `child_session_id`, across BOTH ownership relations. Open rows win over
    /// closed ones so a re-linked pair resolves to the live relationship.
    pub fn find_owned_link_including_closed(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_links
                 WHERE parent_session_id = ?1
                   AND child_session_id = ?2
                   AND relation IN ('subagent', 'owned_agent')
                 ORDER BY (closed_at IS NULL) DESC, created_at DESC, id DESC
                 LIMIT 1",
                params![parent_session_id, child_session_id],
                map_session_link,
            )
            .optional()
        })
    }

    /// Every session `parent_session_id` owns, open rows only — the set
    /// `close_agent` may target.
    pub fn list_owned_children(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_links
                 WHERE parent_session_id = ?1
                   AND relation IN ('subagent', 'owned_agent')
                   AND closed_at IS NULL
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([parent_session_id], map_session_link)?;
            rows.collect()
        })
    }

    /// The soft-close read, run once for every session that finishes a turn: is
    /// there an open ownership link naming this session as end-requested?
    /// Served by `idx_session_links_pending_close_request`.
    pub fn find_pending_close_request(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_links
                 WHERE child_session_id = ?1
                   AND closed_at IS NULL
                   AND closed_by_session_id IS NOT NULL
                   AND relation IN ('subagent', 'owned_agent')
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1",
                [child_session_id],
                map_session_link,
            )
            .optional()
        })
    }

    /// Every close still owed, runtime-wide — the boot-time reconciliation read.
    ///
    /// A close request is durable precisely so a runtime that dies mid-turn
    /// still owes it, but the turn-finish hook can only pay a debt whose turn
    /// finishes. If the process died instead, nothing will ever finish that
    /// turn and the agent would sit open forever, having been told to stop. The
    /// startup pass sweeps these rows and settles them.
    ///
    /// Same predicate (and same partial index) as
    /// [`Self::find_pending_close_request`], unfiltered by child.
    pub fn list_pending_close_requests(&self) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_links
                 WHERE closed_at IS NULL
                   AND closed_by_session_id IS NOT NULL
                   AND relation IN ('subagent', 'owned_agent')
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([], map_session_link)?;
            rows.collect()
        })
    }

    /// One query for a whole page of children. `list_agents` renders a subagent
    /// by the label its parent gave it, and doing that per row is a query per
    /// row; the page size is bounded but the shape is not.
    ///
    /// Rows come back in no particular order and a child has at most one open
    /// subagent parent, so callers index by `child_session_id`.
    pub fn find_subagent_parents(
        &self,
        child_session_ids: &[String],
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        if child_session_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.db.with_conn(|conn| {
            let placeholders = std::iter::repeat("?")
                .take(child_session_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT * FROM session_links
                 WHERE relation = ?
                   AND closed_at IS NULL
                   AND child_session_id IN ({placeholders})"
            );
            let mut bound = Vec::with_capacity(child_session_ids.len() + 1);
            bound.push(SessionLinkRelation::Subagent.as_str());
            bound.extend(child_session_ids.iter().map(String::as_str));
            let mut stmt = conn.prepare(&sql)?;
            let rows =
                stmt.query_map(rusqlite::params_from_iter(bound.iter()), map_session_link)?;
            rows.collect()
        })
    }
}

pub(crate) fn delete_session_link_rows_for_session_in_tx(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> rusqlite::Result<()> {
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

fn map_session_link(row: &rusqlite::Row) -> rusqlite::Result<SessionLinkRecord> {
    let relation: String = row.get("relation")?;
    let workspace_relation: String = row.get("workspace_relation")?;
    Ok(SessionLinkRecord {
        id: row.get("id")?,
        public_id: row.get("public_id")?,
        relation: parse_relation_for_row(&relation)?,
        parent_session_id: row.get("parent_session_id")?,
        child_session_id: row.get("child_session_id")?,
        workspace_relation: parse_workspace_relation_for_row(&workspace_relation)?,
        label: row.get("label")?,
        created_by_turn_id: row.get("created_by_turn_id")?,
        created_by_tool_call_id: row.get("created_by_tool_call_id")?,
        created_at: row.get("created_at")?,
        closed_at: row.get("closed_at")?,
        promoted_at: row.get("promoted_at")?,
        closed_by_session_id: row.get("closed_by_session_id")?,
        close_reason: row.get("close_reason")?,
    })
}

fn parse_relation_for_row(value: &str) -> rusqlite::Result<SessionLinkRelation> {
    SessionLinkRelation::parse(value).map_err(map_parse_error)
}

fn parse_workspace_relation_for_row(value: &str) -> rusqlite::Result<SessionLinkWorkspaceRelation> {
    SessionLinkWorkspaceRelation::parse(value).map_err(map_parse_error)
}

fn map_parse_error(error: SessionLinkParseError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
