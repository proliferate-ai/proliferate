use super::model::{
    SessionLinkParseError, SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};

pub(crate) fn map_session_link(row: &rusqlite::Row) -> rusqlite::Result<SessionLinkRecord> {
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
        subagent_closed_at: row.get("subagent_closed_at")?,
        closed_at: row.get("closed_at")?,
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
