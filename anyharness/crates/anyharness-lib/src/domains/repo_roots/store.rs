use rusqlite::{params, OptionalExtension};

use super::model::RepoRootRecord;
use crate::persistence::Db;

#[derive(Clone)]
pub struct RepoRootStore {
    db: Db,
}

impl RepoRootStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<RepoRootRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM repo_roots WHERE id = ?1", [id], map_row)
                .optional()
        })
    }

    pub fn find_by_path(&self, path: &str) -> anyhow::Result<Option<RepoRootRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM repo_roots WHERE path = ?1 ORDER BY created_at ASC LIMIT 1",
                [path],
                map_row,
            )
            .optional()
        })
    }

    pub fn list_all(&self) -> anyhow::Result<Vec<RepoRootRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM repo_roots ORDER BY updated_at DESC")?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        })
    }

    pub fn insert(&self, record: &RepoRootRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO repo_roots (
                    id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                    remote_repo_name, remote_url, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    record.id,
                    record.kind,
                    record.path,
                    record.display_name,
                    record.default_branch,
                    record.remote_provider,
                    record.remote_owner,
                    record.remote_repo_name,
                    record.remote_url,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn update_default_branch(
        &self,
        repo_root_id: &str,
        default_branch: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE repo_roots
                 SET default_branch = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![repo_root_id, default_branch, updated_at],
            )?;
            Ok(())
        })
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepoRootRecord> {
    Ok(RepoRootRecord {
        id: row.get("id")?,
        kind: row.get("kind")?,
        path: row.get("path")?,
        display_name: row.get("display_name")?,
        default_branch: row.get("default_branch")?,
        remote_provider: row.get("remote_provider")?,
        remote_owner: row.get("remote_owner")?,
        remote_repo_name: row.get("remote_repo_name")?,
        remote_url: row.get("remote_url")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
