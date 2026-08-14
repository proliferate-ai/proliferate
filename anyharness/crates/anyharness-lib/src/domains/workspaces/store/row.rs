use rusqlite::types::Type;
use rusqlite::{params, Connection};

use crate::domains::workspaces::creator_context::{
    decode_creator_context_json, encode_creator_context_json,
};
use crate::domains::workspaces::model::{
    WorkspaceKind, WorkspaceLifecycleState, WorkspaceModelError, WorkspaceRecord, WorkspaceSurface,
};
use crate::origin::{decode_origin_json, encode_origin_json};

pub(super) const WORKSPACE_COLUMNS: &str = "\
    id, kind, repo_root_id, path, surface, original_branch, current_branch, display_name,
    origin_json, creator_context_json, lifecycle_state, archived_head_sha,
    archived_branch, archived_at, partial_capture_json, created_at, updated_at";

pub(super) fn insert_workspace(conn: &Connection, r: &WorkspaceRecord) -> rusqlite::Result<()> {
    let origin_json = encode_origin_json(&r.origin)?;
    let creator_context_json = encode_creator_context_json(&r.creator_context)?;
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, original_branch, current_branch, display_name,
            origin_json, creator_context_json, lifecycle_state, archived_head_sha,
            archived_branch, archived_at, partial_capture_json, created_at, updated_at
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
         )",
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
            r.archived_head_sha,
            r.archived_branch,
            r.archived_at,
            r.partial_capture_json,
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
        lifecycle_state: parse_workspace_lifecycle(row, &id)?,
        archived_head_sha: row.get("archived_head_sha")?,
        archived_branch: row.get("archived_branch")?,
        archived_at: row.get("archived_at")?,
        partial_capture_json: row.get("partial_capture_json")?,
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

// Lifecycle-only tolerance. parse_workspace_enum stays generic and STRICT for
// kind / surface; splitting lifecycle off the shared helper is
// the point of this rung. Unknown value -> Archived: hidden from the store's
// active-lifecycle readers, and never a collection-wide parse failure. The
// column read itself still errors (a missing or non-text column is a schema
// fault, not an unknown enum value).
fn parse_workspace_lifecycle(
    row: &rusqlite::Row,
    workspace_id: &str,
) -> rusqlite::Result<WorkspaceLifecycleState> {
    let value: String = row.get("lifecycle_state")?;
    Ok(
        WorkspaceLifecycleState::try_from(value.as_str()).unwrap_or_else(|_| {
            tracing::warn!(
                table = "workspaces",
                row_id = workspace_id,
                lifecycle_state = %value,
                "unknown workspace lifecycle_state; reading as archived"
            );
            WorkspaceLifecycleState::Archived
        }),
    )
}
