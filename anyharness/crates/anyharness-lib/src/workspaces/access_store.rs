use rusqlite::{params, OptionalExtension};

use super::access_model::{WorkspaceAccessMode, WorkspaceAccessRecord};
use crate::persistence::Db;

#[derive(Clone)]
pub struct WorkspaceAccessStore {
    db: Db,
}

impl WorkspaceAccessStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn find_by_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<WorkspaceAccessRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspace_access_modes WHERE workspace_id = ?1",
                [workspace_id],
                map_row,
            )
            .optional()
        })
    }

    pub fn upsert(&self, record: &WorkspaceAccessRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspace_access_modes (workspace_id, mode, handoff_op_id, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    mode = excluded.mode,
                    handoff_op_id = excluded.handoff_op_id,
                    updated_at = excluded.updated_at",
                params![
                    record.workspace_id,
                    record.mode.as_str(),
                    record.handoff_op_id,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn delete(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM workspace_access_modes WHERE workspace_id = ?1",
                [workspace_id],
            )?;
            Ok(())
        })
    }
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceAccessRecord> {
    Ok(WorkspaceAccessRecord {
        workspace_id: row.get("workspace_id")?,
        mode: WorkspaceAccessMode::parse(&row.get::<_, String>("mode")?),
        handoff_op_id: row.get("handoff_op_id")?,
        updated_at: row.get("updated_at")?,
    })
}
