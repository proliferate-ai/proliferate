use rusqlite::{params, Connection};

use crate::origin::{decode_origin_json, encode_origin_json};
use crate::workspaces::creator_context::{
    decode_creator_context_json, encode_creator_context_json,
};
use crate::workspaces::model::WorkspaceRecord;

pub(super) fn insert_workspace(conn: &Connection, r: &WorkspaceRecord) -> rusqlite::Result<()> {
    let origin_json = encode_origin_json(&r.origin)?;
    let creator_context_json = encode_creator_context_json(&r.creator_context)?;
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, source_repo_root_path, source_workspace_id,
            git_provider, git_owner, git_repo_name, original_branch, current_branch, display_name,
            origin_json, creator_context_json, lifecycle_state, cleanup_state, cleanup_operation,
            cleanup_error_message, cleanup_failed_at, cleanup_attempted_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        params![
            r.id,
            r.kind,
            r.repo_root_id,
            r.path,
            r.surface,
            r.source_repo_root_path,
            r.source_workspace_id,
            r.git_provider,
            r.git_owner,
            r.git_repo_name,
            r.original_branch,
            r.current_branch,
            r.display_name,
            origin_json,
            creator_context_json,
            r.lifecycle_state,
            r.cleanup_state,
            r.cleanup_operation,
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
    Ok(WorkspaceRecord {
        id: id.clone(),
        kind: row.get("kind")?,
        repo_root_id: row.get("repo_root_id")?,
        path: row.get("path")?,
        surface: row.get("surface")?,
        source_repo_root_path: row.get("source_repo_root_path")?,
        source_workspace_id: row.get("source_workspace_id")?,
        git_provider: row.get("git_provider")?,
        git_owner: row.get("git_owner")?,
        git_repo_name: row.get("git_repo_name")?,
        original_branch: row.get("original_branch")?,
        current_branch: row.get("current_branch")?,
        display_name: row.get("display_name")?,
        origin: decode_origin_json("workspaces", &id, origin_json),
        creator_context: decode_creator_context_json("workspaces", &id, creator_context_json),
        lifecycle_state: row.get("lifecycle_state")?,
        cleanup_state: row.get("cleanup_state")?,
        cleanup_operation: row.get("cleanup_operation")?,
        cleanup_error_message: row.get("cleanup_error_message")?,
        cleanup_failed_at: row.get("cleanup_failed_at")?,
        cleanup_attempted_at: row.get("cleanup_attempted_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
