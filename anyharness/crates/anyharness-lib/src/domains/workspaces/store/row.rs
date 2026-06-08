use rusqlite::types::Type;
use rusqlite::{params, Connection};

use crate::domains::workspaces::creator_context::{
    decode_creator_context_json, encode_creator_context_json,
};
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorkspaceModelError, WorkspaceRecord, WorkspaceSurface,
};
use crate::origin::{decode_origin_json, encode_origin_json};

pub(super) const WORKSPACE_COLUMNS: &str = "\
    id, kind, repo_root_id, path, surface, original_branch, current_branch, display_name,
    origin_json, creator_context_json, lifecycle_state, cleanup_state, cleanup_operation,
    cleanup_error_message, cleanup_failed_at, cleanup_attempted_at, created_at, updated_at";

pub(super) fn insert_workspace(conn: &Connection, r: &WorkspaceRecord) -> rusqlite::Result<()> {
    let origin_json = encode_origin_json(&r.origin)?;
    let creator_context_json = encode_creator_context_json(&r.creator_context)?;
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, original_branch, current_branch, display_name,
            origin_json, creator_context_json, lifecycle_state, cleanup_state, cleanup_operation,
            cleanup_error_message, cleanup_failed_at, cleanup_attempted_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            r.id,
            r.kind.as_str(),
            r.repo_root_id,
            r.path,
            r.surface.as_str(),
            r.original_branch,
            r.current_branch,
            r.display_name,
            origin_json,
            creator_context_json,
            r.lifecycle_state.as_str(),
            r.cleanup_state.as_str(),
            r.cleanup_operation.map(WorkspaceCleanupOperation::as_str),
            r.cleanup_error_message,
            r.cleanup_failed_at,
            r.cleanup_attempted_at,
            r.created_at,
            r.updated_at,
        ],
    )?;
    Ok(())
}

pub(super) fn map_row(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceRecord> {
    let id: String = row.get("id")?;
    let origin_json: Option<String> = row.get("origin_json")?;
    let creator_context_json: Option<String> = row.get("creator_context_json")?;
    let cleanup_operation =
        parse_optional_workspace_enum::<WorkspaceCleanupOperation>(row, "cleanup_operation", 12)?;
    Ok(WorkspaceRecord {
        id: id.clone(),
        kind: parse_workspace_enum::<WorkspaceKind>(row, "kind", 1)?,
        repo_root_id: row.get("repo_root_id")?,
        path: row.get("path")?,
        surface: parse_workspace_enum::<WorkspaceSurface>(row, "surface", 4)?,
        original_branch: row.get("original_branch")?,
        current_branch: row.get("current_branch")?,
        display_name: row.get("display_name")?,
        origin: decode_origin_json("workspaces", &id, origin_json),
        creator_context: decode_creator_context_json("workspaces", &id, creator_context_json),
        lifecycle_state: parse_workspace_enum::<WorkspaceLifecycleState>(
            row,
            "lifecycle_state",
            10,
        )?,
        cleanup_state: parse_workspace_enum::<WorkspaceCleanupState>(row, "cleanup_state", 11)?,
        cleanup_operation,
        cleanup_error_message: row.get("cleanup_error_message")?,
        cleanup_failed_at: row.get("cleanup_failed_at")?,
        cleanup_attempted_at: row.get("cleanup_attempted_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parse_workspace_enum<T>(
    row: &rusqlite::Row,
    column_name: &str,
    column_index: usize,
) -> rusqlite::Result<T>
where
    T: for<'a> TryFrom<&'a str, Error = WorkspaceModelError>,
{
    let value: String = row.get(column_name)?;
    T::try_from(value.as_str()).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(column_index, Type::Text, Box::new(error))
    })
}

fn parse_optional_workspace_enum<T>(
    row: &rusqlite::Row,
    column_name: &str,
    column_index: usize,
) -> rusqlite::Result<Option<T>>
where
    T: for<'a> TryFrom<&'a str, Error = WorkspaceModelError>,
{
    let value: Option<String> = row.get(column_name)?;
    value
        .as_deref()
        .map(T::try_from)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(column_index, Type::Text, Box::new(error))
        })
}
