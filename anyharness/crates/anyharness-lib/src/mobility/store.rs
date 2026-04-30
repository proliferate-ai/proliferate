use rusqlite::{params, OptionalExtension};

use crate::mobility::model::ImportedWorkspaceArchiveSummary;
use crate::persistence::Db;

#[derive(Clone)]
pub struct MobilityStore {
    db: Db,
}

impl MobilityStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn find_completed_install(
        &self,
        workspace_id: &str,
        operation_id: &str,
    ) -> anyhow::Result<Option<ImportedWorkspaceArchiveSummary>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT workspace_id, source_workspace_path, base_commit_sha,
                        imported_session_ids_json, applied_file_count, deleted_file_count,
                        imported_agent_artifact_count
                 FROM mobility_archive_installs
                 WHERE workspace_id = ?1 AND operation_id = ?2 AND status = 'complete'",
                params![workspace_id, operation_id],
                |row| {
                    let imported_session_ids_json: String = row.get(3)?;
                    let imported_session_ids =
                        serde_json::from_str::<Vec<String>>(&imported_session_ids_json)
                            .unwrap_or_default();
                    Ok(ImportedWorkspaceArchiveSummary {
                        workspace_id: row.get(0)?,
                        source_workspace_path: row.get(1)?,
                        base_commit_sha: row.get(2)?,
                        imported_session_ids,
                        applied_file_count: row.get::<_, i64>(4)?.max(0) as usize,
                        deleted_file_count: row.get::<_, i64>(5)?.max(0) as usize,
                        imported_agent_artifact_count: row.get::<_, i64>(6)?.max(0) as usize,
                    })
                },
            )
            .optional()
        })
    }

    pub fn record_completed_install(
        &self,
        workspace_id: &str,
        operation_id: &str,
        summary: &ImportedWorkspaceArchiveSummary,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let imported_session_ids_json = serde_json::to_string(&summary.imported_session_ids)?;
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO mobility_archive_installs (
                    workspace_id, operation_id, status, source_workspace_path, base_commit_sha,
                    imported_session_ids_json, applied_file_count, deleted_file_count,
                    imported_agent_artifact_count, completed_at
                 ) VALUES (?1, ?2, 'complete', ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(workspace_id, operation_id) DO UPDATE SET
                    status = excluded.status,
                    source_workspace_path = excluded.source_workspace_path,
                    base_commit_sha = excluded.base_commit_sha,
                    imported_session_ids_json = excluded.imported_session_ids_json,
                    applied_file_count = excluded.applied_file_count,
                    deleted_file_count = excluded.deleted_file_count,
                    imported_agent_artifact_count = excluded.imported_agent_artifact_count,
                    completed_at = excluded.completed_at",
                params![
                    workspace_id,
                    operation_id,
                    summary.source_workspace_path,
                    summary.base_commit_sha,
                    imported_session_ids_json,
                    summary.applied_file_count as i64,
                    summary.deleted_file_count as i64,
                    summary.imported_agent_artifact_count as i64,
                    now,
                ],
            )?;
            Ok(())
        })
    }
}
