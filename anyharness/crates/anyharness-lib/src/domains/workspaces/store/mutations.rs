use rusqlite::{params, Connection};

use super::row::insert_workspace;
use super::WorkspaceStore;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceRecord,
};

impl WorkspaceStore {
    pub fn update_lifecycle_cleanup_state(
        &self,
        workspace_id: &str,
        lifecycle_state: WorkspaceLifecycleState,
        cleanup_state: WorkspaceCleanupState,
        cleanup_operation: Option<WorkspaceCleanupOperation>,
        cleanup_error_message: Option<&str>,
        cleanup_failed_at: Option<&str>,
        cleanup_attempted_at: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET lifecycle_state = ?2,
                     cleanup_state = ?3,
                     cleanup_operation = ?4,
                     cleanup_error_message = ?5,
                     cleanup_failed_at = ?6,
                     cleanup_attempted_at = ?7,
                     updated_at = ?8
                 WHERE id = ?1",
                params![
                    workspace_id,
                    lifecycle_state.as_str(),
                    cleanup_state.as_str(),
                    cleanup_operation.map(WorkspaceCleanupOperation::as_str),
                    cleanup_error_message,
                    cleanup_failed_at,
                    cleanup_attempted_at,
                    updated_at,
                ],
            )?;
            Ok(())
        })
    }

    /// Flip a row to archived and record the snapshot it can be restored from.
    /// The first code path in the product that writes an archived row: R1's
    /// migration wrote them in raw SQL, so this, [`Self::mark_active`], and
    /// [`Self::release_archive_state`] are all born together.
    ///
    /// `head_sha` NULL is meaningful, not missing: it is the "never
    /// snapshotted" shape (a `kind=local` archive, a directory that was
    /// already gone, an absorbed pre-archiving row) that every destructive
    /// predicate refuses to touch. `partial_capture_json` NULL means the
    /// capture was complete.
    pub fn mark_archived(
        &self,
        workspace_id: &str,
        head_sha: Option<&str>,
        archived_branch: Option<&str>,
        archived_at: &str,
        partial_capture_json: Option<&str>,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET lifecycle_state = 'archived',
                     archived_head_sha = ?2,
                     archived_branch = ?3,
                     archived_at = ?4,
                     partial_capture_json = ?5,
                     updated_at = ?4
                 WHERE id = ?1",
                params![
                    workspace_id,
                    head_sha,
                    archived_branch,
                    archived_at,
                    partial_capture_json,
                ],
            )?;
            Ok(())
        })
    }

    /// The reverse lifecycle transition, and the only one in the product.
    /// Clears `archived_at` ONLY: the snapshot columns survive until the
    /// post-restore verify proves the snapshot redundant, because a row that
    /// reads active with its columns still present is exactly what arms the
    /// retry of a failed verify.
    pub fn mark_active(&self, workspace_id: &str, updated_at: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET lifecycle_state = 'active',
                     archived_at = NULL,
                     updated_at = ?2
                 WHERE id = ?1",
                params![workspace_id, updated_at],
            )?;
            Ok(())
        })
    }

    /// Drop the snapshot bookkeeping after a verified restore (or a terminal
    /// restore that deliberately abandoned the snapshot). Always called BEFORE
    /// the refs are deleted: a crash between the two leaves inert refs on a
    /// clean row, which the sweep's orphaned-refs duty converges, whereas the
    /// inverse order leaves a sha pointing at deleted refs and manufactures a
    /// false `snapshot_lost` alarm on a healthy workspace.
    pub fn release_archive_state(
        &self,
        workspace_id: &str,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET archived_head_sha = NULL,
                     archived_branch = NULL,
                     partial_capture_json = NULL,
                     updated_at = ?2
                 WHERE id = ?1",
                params![workspace_id, updated_at],
            )?;
            Ok(())
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

    pub fn insert(&self, record: &WorkspaceRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| insert_workspace(conn, record))
    }

    pub fn delete_by_id(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db
            .with_tx(|conn| delete_workspace_row_in_tx(conn, workspace_id))
    }
}

pub(crate) fn delete_workspace_row_in_tx(
    conn: &Connection,
    workspace_id: &str,
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])?;
    Ok(())
}
