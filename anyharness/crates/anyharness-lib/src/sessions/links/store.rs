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
                    id, relation, parent_session_id, child_session_id, workspace_relation,
                    label, created_by_turn_id, created_by_tool_call_id, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.id,
                    record.relation.as_str(),
                    record.parent_session_id,
                    record.child_session_id,
                    record.workspace_relation.as_str(),
                    record.label,
                    record.created_by_turn_id,
                    record.created_by_tool_call_id,
                    record.created_at,
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
                    id, relation, parent_session_id, child_session_id, workspace_relation,
                    label, created_by_turn_id, created_by_tool_call_id, created_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
                 WHERE (
                    SELECT COUNT(*)
                    FROM session_links
                    WHERE relation = 'subagent' AND parent_session_id = ?3
                 ) < ?10",
                params![
                    record.id,
                    record.relation.as_str(),
                    record.parent_session_id,
                    record.child_session_id,
                    record.workspace_relation.as_str(),
                    record.label,
                    record.created_by_turn_id,
                    record.created_by_tool_call_id,
                    record.created_at,
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
                   AND child_session_id = ?3",
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

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.find_parent_by_relation(SessionLinkRelation::Subagent, child_session_id)
    }
}

fn map_session_link(row: &rusqlite::Row) -> rusqlite::Result<SessionLinkRecord> {
    let relation: String = row.get("relation")?;
    let workspace_relation: String = row.get("workspace_relation")?;
    Ok(SessionLinkRecord {
        id: row.get("id")?,
        relation: parse_relation_for_row(&relation)?,
        parent_session_id: row.get("parent_session_id")?,
        child_session_id: row.get("child_session_id")?,
        workspace_relation: parse_workspace_relation_for_row(&workspace_relation)?,
        label: row.get("label")?,
        created_by_turn_id: row.get("created_by_turn_id")?,
        created_by_tool_call_id: row.get("created_by_tool_call_id")?,
        created_at: row.get("created_at")?,
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
