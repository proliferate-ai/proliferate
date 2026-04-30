use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use super::model::{CoworkManagedWorkspaceRecord, CoworkRootRecord, CoworkThreadRecord};
use crate::persistence::Db;
use crate::sessions::links::model::SessionLinkRecord;

#[derive(Clone)]
pub struct CoworkStore {
    db: Db,
}

impl CoworkStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn get_root(&self) -> anyhow::Result<Option<CoworkRootRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_roots WHERE id = 'cowork-root'",
                [],
                map_root_row,
            )
            .optional()
        })
    }

    pub fn upsert_root(&self, record: &CoworkRootRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO cowork_roots (id, repo_root_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                    repo_root_id = excluded.repo_root_id,
                    updated_at = excluded.updated_at",
                params![
                    record.id,
                    record.repo_root_id,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn insert_thread(&self, record: &CoworkThreadRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO cowork_threads (
                    id, repo_root_id, workspace_id, session_id, agent_kind, requested_model_id,
                    branch_name, workspace_delegation_enabled, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.id,
                    record.repo_root_id,
                    record.workspace_id,
                    record.session_id,
                    record.agent_kind,
                    record.requested_model_id,
                    record.branch_name,
                    if record.workspace_delegation_enabled {
                        1
                    } else {
                        0
                    },
                    record.created_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_threads(&self) -> anyhow::Result<Vec<CoworkThreadRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM cowork_threads ORDER BY created_at DESC")?;
            let rows = stmt.query_map([], map_thread_row)?;
            rows.collect()
        })
    }

    pub fn find_thread_by_session(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<CoworkThreadRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_threads WHERE session_id = ?1",
                [session_id],
                map_thread_row,
            )
            .optional()
        })
    }

    pub fn find_managed_workspace_by_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<CoworkManagedWorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_managed_workspaces WHERE workspace_id = ?1",
                [workspace_id],
                map_managed_workspace_row,
            )
            .optional()
        })
    }

    pub fn find_managed_workspace(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<Option<CoworkManagedWorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_managed_workspaces
                 WHERE parent_session_id = ?1 AND workspace_id = ?2",
                params![parent_session_id, workspace_id],
                map_managed_workspace_row,
            )
            .optional()
        })
    }

    pub fn list_managed_workspaces(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<CoworkManagedWorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM cowork_managed_workspaces
                 WHERE parent_session_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([parent_session_id], map_managed_workspace_row)?;
            rows.collect()
        })
    }

    pub fn insert_managed_workspace_with_limit(
        &self,
        record: &CoworkManagedWorkspaceRecord,
        max_workspaces: usize,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let inserted = conn.execute(
                "INSERT INTO cowork_managed_workspaces (
                    id, parent_session_id, workspace_id, source_workspace_id, label, created_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6
                 WHERE (
                    SELECT COUNT(*)
                    FROM cowork_managed_workspaces
                    WHERE parent_session_id = ?2
                 ) < ?7",
                params![
                    record.id,
                    record.parent_session_id,
                    record.workspace_id,
                    record.source_workspace_id,
                    record.label,
                    record.created_at,
                    max_workspaces as i64,
                ],
            )?;
            Ok(inserted > 0)
        })
    }

    pub fn delete_managed_workspace(&self, id: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute("DELETE FROM cowork_managed_workspaces WHERE id = ?1", [id])?;
            Ok(())
        })
    }

    pub fn insert_coding_session_link_with_workspace_limit(
        &self,
        record: &SessionLinkRecord,
        workspace_id: &str,
        max_sessions_per_workspace: usize,
    ) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let inserted = conn.execute(
                "INSERT INTO session_links (
                    id, relation, parent_session_id, child_session_id, workspace_relation,
                    label, created_by_turn_id, created_by_tool_call_id, created_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
                 WHERE (
                    SELECT COUNT(*)
                    FROM session_links links
                    JOIN sessions child ON child.id = links.child_session_id
                    WHERE links.relation = ?2
                      AND links.parent_session_id = ?3
                      AND child.workspace_id = ?10
                 ) < ?11",
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
                    workspace_id,
                    max_sessions_per_workspace as i64,
                ],
            )?;
            Ok(inserted > 0)
        })
    }
}

fn map_root_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoworkRootRecord> {
    Ok(CoworkRootRecord {
        id: row.get("id")?,
        repo_root_id: row.get("repo_root_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_thread_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoworkThreadRecord> {
    Ok(CoworkThreadRecord {
        id: row.get("id")?,
        repo_root_id: row.get("repo_root_id")?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        agent_kind: row.get("agent_kind")?,
        requested_model_id: row.get("requested_model_id")?,
        branch_name: row.get("branch_name")?,
        workspace_delegation_enabled: row.get::<_, i64>("workspace_delegation_enabled")? != 0,
        created_at: row.get("created_at")?,
    })
}

fn map_managed_workspace_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<CoworkManagedWorkspaceRecord> {
    Ok(CoworkManagedWorkspaceRecord {
        id: row.get("id")?,
        parent_session_id: row.get("parent_session_id")?,
        workspace_id: row.get("workspace_id")?,
        source_workspace_id: row.get("source_workspace_id")?,
        label: row.get("label")?,
        created_at: row.get("created_at")?,
    })
}

pub fn new_managed_workspace_record(
    parent_session_id: &str,
    workspace_id: &str,
    source_workspace_id: Option<String>,
    label: Option<String>,
) -> CoworkManagedWorkspaceRecord {
    CoworkManagedWorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        parent_session_id: parent_session_id.to_string(),
        workspace_id: workspace_id.to_string(),
        source_workspace_id,
        label,
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}
