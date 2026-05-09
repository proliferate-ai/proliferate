use rusqlite::{params, OptionalExtension};

use super::sessions::{insert_session_row, map_session};
use super::SessionStore;
use crate::sessions::links::model::{SessionLinkRecord, SessionLinkRelation};
use crate::sessions::model::SessionRecord;

impl SessionStore {
    pub fn insert_session_with_link(
        &self,
        record: &SessionRecord,
        link: &SessionLinkRecord,
    ) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            insert_session_row(conn, record)?;
            insert_session_link_row(conn, link)?;
            Ok(())
        })
    }

    pub fn insert_fork_session_with_link_and_event_snapshot(
        &self,
        record: &SessionRecord,
        link: &SessionLinkRecord,
    ) -> anyhow::Result<usize> {
        anyhow::ensure!(
            link.relation == SessionLinkRelation::Fork,
            "event snapshots are only supported for fork links"
        );
        anyhow::ensure!(
            link.child_session_id == record.id,
            "fork link child id must match inserted session"
        );

        self.db.with_tx(|conn| {
            insert_session_row(conn, record)?;
            insert_session_link_row(conn, link)?;
            let copied = conn.execute(
                "INSERT INTO session_events (
                    session_id, seq, timestamp, event_type, turn_id, item_id, payload_json
                 )
                 SELECT ?1, seq, timestamp, event_type, turn_id, item_id, payload_json
                 FROM session_events
                 WHERE session_id = ?2
                 ORDER BY seq ASC",
                params![record.id, link.parent_session_id],
            )?;
            Ok(copied)
        })
    }

    pub fn has_inbound_link_relation(
        &self,
        session_id: &str,
        relation: SessionLinkRelation,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM session_links
                    WHERE child_session_id = ?1 AND relation = ?2
                )",
                params![session_id, relation.as_str()],
                |row| row.get(0),
            )
            .map_err(Into::into)
        })
    }

    pub fn find_parent_by_inbound_link_relation(
        &self,
        session_id: &str,
        relation: SessionLinkRelation,
    ) -> anyhow::Result<Option<SessionRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT sessions.*
                 FROM session_links
                 JOIN sessions ON sessions.id = session_links.parent_session_id
                 WHERE session_links.child_session_id = ?1
                   AND session_links.relation = ?2
                 ORDER BY session_links.created_at ASC, session_links.id ASC
                 LIMIT 1",
                params![session_id, relation.as_str()],
                map_session,
            )
            .optional()
            .map_err(Into::into)
        })
    }
}

fn insert_session_link_row(
    conn: &rusqlite::Connection,
    record: &SessionLinkRecord,
) -> rusqlite::Result<()> {
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
}
