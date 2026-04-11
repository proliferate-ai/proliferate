use rusqlite::{params, Connection, OptionalExtension};

use super::model::WorkspaceRecord;
use crate::persistence::Db;

pub struct WorkspaceStore {
    db: Db,
}

impl WorkspaceStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn find_by_path(&self, path: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces WHERE path = ?1 ORDER BY created_at ASC LIMIT 1",
                [path],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_by_path_and_kind(
        &self,
        path: &str,
        kind: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces WHERE path = ?1 AND kind = ?2 ORDER BY created_at ASC LIMIT 1",
                params![path, kind],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_repo_by_source_root_path(
        &self,
        source_repo_root_path: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces
                 WHERE kind = 'repo' AND source_repo_root_path = ?1
                 ORDER BY created_at ASC
                 LIMIT 1",
                [source_repo_root_path],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_internal_repo_by_surface_kind(
        &self,
        surface_kind: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces
                 WHERE kind = 'repo' AND is_internal = 1 AND surface_kind = ?1
                 ORDER BY created_at ASC
                 LIMIT 1",
                [surface_kind],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM workspaces WHERE id = ?1", [id], |row| {
                map_row(row)
            })
            .optional()
        })
    }

    pub fn list_visible(&self, surface_kind: Option<&str>) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let sql = if surface_kind.is_some() {
                "SELECT * FROM workspaces
                 WHERE is_internal = 0 AND surface_kind = ?1
                 ORDER BY updated_at DESC"
            } else {
                "SELECT * FROM workspaces
                 WHERE is_internal = 0
                 ORDER BY updated_at DESC"
            };
            let mut stmt = conn.prepare(sql)?;
            let rows = if let Some(surface_kind) = surface_kind {
                stmt.query_map([surface_kind], map_row)?
            } else {
                stmt.query_map([], map_row)?
            };
            rows.collect()
        })
    }

    pub fn list_all(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC")?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        })
    }

    pub fn update_current_branch(
        &self,
        workspace_id: &str,
        current_branch: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET current_branch = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![workspace_id, current_branch, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn update_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET display_name = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![workspace_id, display_name, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn update_default_session_id(
        &self,
        workspace_id: &str,
        default_session_id: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET default_session_id = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![workspace_id, default_session_id, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn insert(&self, record: &WorkspaceRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| insert_workspace(conn, record))
    }

    pub fn delete_by_id(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])?;
            Ok(())
        })
    }
}

fn insert_workspace(conn: &Connection, r: &WorkspaceRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO workspaces (id, kind, surface_kind, is_internal, path, source_repo_root_path,
         source_workspace_id, git_provider, git_owner, git_repo_name, original_branch,
         current_branch, display_name, default_session_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            r.id,
            r.kind,
            r.surface_kind,
            r.is_internal,
            r.path,
            r.source_repo_root_path,
            r.source_workspace_id,
            r.git_provider,
            r.git_owner,
            r.git_repo_name,
            r.original_branch,
            r.current_branch,
            r.display_name,
            r.default_session_id,
            r.created_at,
            r.updated_at,
        ],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceRecord> {
    Ok(WorkspaceRecord {
        id: row.get("id")?,
        kind: row.get("kind")?,
        surface_kind: row.get("surface_kind")?,
        is_internal: row.get::<_, i64>("is_internal")? != 0,
        path: row.get("path")?,
        source_repo_root_path: row.get("source_repo_root_path")?,
        source_workspace_id: row.get("source_workspace_id")?,
        git_provider: row.get("git_provider")?,
        git_owner: row.get("git_owner")?,
        git_repo_name: row.get("git_repo_name")?,
        original_branch: row.get("original_branch")?,
        current_branch: row.get("current_branch")?,
        display_name: row.get("display_name")?,
        default_session_id: row.get("default_session_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
