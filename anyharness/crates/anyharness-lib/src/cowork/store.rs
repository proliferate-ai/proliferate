use rusqlite::{params, OptionalExtension};

use super::model::{CoworkRootRecord, CoworkThreadRecord};
use crate::persistence::Db;

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
                    branch_name, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    record.id,
                    record.repo_root_id,
                    record.workspace_id,
                    record.session_id,
                    record.agent_kind,
                    record.requested_model_id,
                    record.branch_name,
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
        created_at: row.get("created_at")?,
    })
}
