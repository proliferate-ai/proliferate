use rusqlite::{params, OptionalExtension};

use super::model::{MaterializationKind, MaterializationOperationRecord, MaterializationState};
use crate::persistence::Db;

#[derive(Clone)]
pub struct MaterializationOperationStore {
    db: Db,
}

impl MaterializationOperationStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn find(
        &self,
        operation_id: &str,
    ) -> anyhow::Result<Option<MaterializationOperationRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT operation_id, kind, request_hash, state, intended_kind, repo_root_id,
                        workspace_id, destination_path, observed_head_sha, failure_code,
                        created_at, updated_at
                 FROM local_materialization_operation WHERE operation_id = ?1",
                [operation_id],
                map_row,
            )
            .optional()
        })
    }

    /// Insert a fresh running row. Returns a unique-violation error if the
    /// operation id already exists (the caller converts that into a converge or
    /// conflict decision by re-reading the row).
    pub fn insert_running(
        &self,
        operation_id: &str,
        kind: MaterializationKind,
        request_hash: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO local_materialization_operation (
                    operation_id, kind, request_hash, state, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'running', ?4, ?4)",
                params![operation_id, kind.as_str(), request_hash, now],
            )?;
            Ok(())
        })
    }

    /// Transition a row back to running for a retry of a previously failed
    /// operation with a matching request hash.
    pub fn mark_running(&self, operation_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE local_materialization_operation
                 SET state = 'running', failure_code = NULL, updated_at = ?2
                 WHERE operation_id = ?1",
                params![operation_id, now],
            )?;
            Ok(())
        })
    }

    /// Record the intended repo-root kind on the running row. Called when the
    /// clone path is chosen so a crash between clone and registration recovers
    /// as a `managed` root rather than being downgraded to `external` adoption.
    pub fn set_intended_kind(&self, operation_id: &str, intended_kind: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE local_materialization_operation
                 SET intended_kind = ?2, updated_at = ?3
                 WHERE operation_id = ?1",
                params![operation_id, intended_kind, now],
            )?;
            Ok(())
        })
    }

    pub fn mark_completed_repo_root(
        &self,
        operation_id: &str,
        repo_root_id: &str,
        destination_path: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE local_materialization_operation
                 SET state = 'completed', repo_root_id = ?2, destination_path = ?3,
                     failure_code = NULL, updated_at = ?4
                 WHERE operation_id = ?1",
                params![operation_id, repo_root_id, destination_path, now],
            )?;
            Ok(())
        })
    }

    pub fn mark_completed_workspace(
        &self,
        operation_id: &str,
        workspace_id: &str,
        destination_path: &str,
        observed_head_sha: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE local_materialization_operation
                 SET state = 'completed', workspace_id = ?2, destination_path = ?3,
                     observed_head_sha = ?4, failure_code = NULL, updated_at = ?5
                 WHERE operation_id = ?1",
                params![
                    operation_id,
                    workspace_id,
                    destination_path,
                    observed_head_sha,
                    now
                ],
            )?;
            Ok(())
        })
    }

    pub fn mark_failed(&self, operation_id: &str, failure_code: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE local_materialization_operation
                 SET state = 'failed', failure_code = ?2, updated_at = ?3
                 WHERE operation_id = ?1",
                params![operation_id, failure_code, now],
            )?;
            Ok(())
        })
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MaterializationOperationRecord> {
    let kind_str: String = row.get("kind")?;
    let state_str: String = row.get("state")?;
    let kind = match kind_str.as_str() {
        "workspace" => MaterializationKind::Workspace,
        _ => MaterializationKind::RepoRoot,
    };
    let state = MaterializationState::from_wire(&state_str).unwrap_or(MaterializationState::Failed);
    Ok(MaterializationOperationRecord {
        operation_id: row.get("operation_id")?,
        kind,
        request_hash: row.get("request_hash")?,
        state,
        intended_kind: row.get("intended_kind")?,
        repo_root_id: row.get("repo_root_id")?,
        workspace_id: row.get("workspace_id")?,
        destination_path: row.get("destination_path")?,
        observed_head_sha: row.get("observed_head_sha")?,
        failure_code: row.get("failure_code")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
