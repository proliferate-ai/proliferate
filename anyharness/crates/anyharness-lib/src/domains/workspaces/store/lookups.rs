use rusqlite::{params, OptionalExtension};

use super::row::{map_row, WORKSPACE_COLUMNS};
use super::WorkspaceStore;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord};

impl WorkspaceStore {
    pub fn find_by_path(&self, path: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE path = ?1 ORDER BY created_at ASC, id ASC LIMIT 1"),
                [path],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_active_by_path(&self, path: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                [path],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_active_by_path_excluding_id(
        &self,
        path: &str,
        excluded_id: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND id <> ?2 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, excluded_id],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_active_by_path_and_kind_excluding_id(
        &self,
        path: &str,
        kind: WorkspaceKind,
        excluded_id: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND kind = ?2 AND id <> ?3 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, kind.as_str(), excluded_id],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_by_path_and_kind(
        &self,
        path: &str,
        kind: WorkspaceKind,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND kind = ?2
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, kind.as_str()],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_active_by_path_and_kind(
        &self,
        path: &str,
        kind: WorkspaceKind,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND kind = ?2 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, kind.as_str()],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_retired_incomplete_cleanup_by_path_and_kind(
        &self,
        path: &str,
        kind: WorkspaceKind,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1
                   AND kind = ?2
                   AND lifecycle_state = 'retired'
                   AND cleanup_state IN ('pending', 'failed')
                 ORDER BY updated_at DESC
                 LIMIT 1"
                ),
                params![path, kind.as_str()],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?1"),
                [id],
                |row| map_row(row),
            )
            .optional()
        })
    }
}
