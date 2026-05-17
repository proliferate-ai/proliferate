use anyharness_contract::v1::{RuntimeArtifactCacheEntry, TargetRuntimeConfigRefreshRequest};
use chrono::Utc;
use rusqlite::{params, types::Type, OptionalExtension, Row};

use super::model::RuntimeConfigCurrentRecord;
use crate::persistence::Db;

#[derive(Clone)]
pub struct RuntimeConfigStore {
    db: Db,
}

impl RuntimeConfigStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn save_current(&self, manifest: &TargetRuntimeConfigRefreshRequest) -> anyhow::Result<()> {
        let manifest_json = serde_json::to_string(manifest)?;
        let source = serde_json::to_value(&manifest.source)?
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        let applied_at = Utc::now().to_rfc3339();
        self.db.with_tx(|conn| {
            conn.execute(
                "INSERT INTO runtime_config_current (
                    id, revision_id, revision_sequence, content_hash, manifest_json, source,
                    external_target_id, applied_at
                 )
                 VALUES ('current', ?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    revision_id = excluded.revision_id,
                    revision_sequence = excluded.revision_sequence,
                    content_hash = excluded.content_hash,
                    manifest_json = excluded.manifest_json,
                    source = excluded.source,
                    external_target_id = excluded.external_target_id,
                    applied_at = excluded.applied_at",
                params![
                    manifest.revision.id,
                    manifest.revision.sequence,
                    manifest.revision.content_hash,
                    manifest_json,
                    source,
                    manifest.revision.external_target_id,
                    applied_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn load_current(&self) -> anyhow::Result<Option<RuntimeConfigCurrentRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT manifest_json, applied_at FROM runtime_config_current WHERE id = 'current'",
                [],
                map_current,
            )
            .optional()
        })
    }

    pub fn upsert_artifact_cache(
        &self,
        hash: &str,
        content_type: &str,
        byte_size: u64,
        cache_path: &str,
    ) -> anyhow::Result<RuntimeArtifactCacheEntry> {
        let now = Utc::now().to_rfc3339();
        let byte_size_i64 = i64::try_from(byte_size)?;
        self.db.with_tx(|conn| {
            conn.execute(
                "INSERT INTO runtime_artifact_cache (
                    artifact_hash, content_type, byte_size, cache_path, created_at, last_used_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                 ON CONFLICT(artifact_hash) DO UPDATE SET
                    content_type = excluded.content_type,
                    byte_size = excluded.byte_size,
                    cache_path = excluded.cache_path,
                    last_used_at = excluded.last_used_at",
                params![hash, content_type, byte_size_i64, cache_path, now],
            )?;
            conn.query_row(
                "SELECT artifact_hash, content_type, byte_size, cache_path, created_at, last_used_at
                 FROM runtime_artifact_cache WHERE artifact_hash = ?1",
                [hash],
                map_artifact_cache,
            )
        })
    }

    pub fn find_artifact_cache(
        &self,
        hash: &str,
    ) -> anyhow::Result<Option<RuntimeArtifactCacheEntry>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT artifact_hash, content_type, byte_size, cache_path, created_at, last_used_at
                 FROM runtime_artifact_cache WHERE artifact_hash = ?1",
                [hash],
                map_artifact_cache,
            )
            .optional()
        })
    }

    pub fn touch_artifact_cache(&self, hash: &str) -> anyhow::Result<()> {
        let now = Utc::now().to_rfc3339();
        self.db.with_tx(|conn| {
            conn.execute(
                "UPDATE runtime_artifact_cache SET last_used_at = ?2 WHERE artifact_hash = ?1",
                params![hash, now],
            )?;
            Ok(())
        })
    }

    pub fn list_artifact_cache(&self) -> anyhow::Result<Vec<RuntimeArtifactCacheEntry>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT artifact_hash, content_type, byte_size, cache_path, created_at, last_used_at
                 FROM runtime_artifact_cache
                 ORDER BY last_used_at DESC",
            )?;
            let rows = stmt.query_map([], map_artifact_cache)?;
            rows.collect()
        })
    }
}

fn map_current(row: &Row<'_>) -> rusqlite::Result<RuntimeConfigCurrentRecord> {
    let manifest_json: String = row.get("manifest_json")?;
    let manifest = serde_json::from_str(&manifest_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
    })?;
    Ok(RuntimeConfigCurrentRecord {
        manifest,
        applied_at: row.get("applied_at")?,
    })
}

fn map_artifact_cache(row: &Row<'_>) -> rusqlite::Result<RuntimeArtifactCacheEntry> {
    let byte_size: i64 = row.get("byte_size")?;
    let byte_size = u64::try_from(byte_size).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, Type::Integer, Box::new(error))
    })?;
    Ok(RuntimeArtifactCacheEntry {
        hash: row.get("artifact_hash")?,
        content_type: row.get("content_type")?,
        byte_size,
        cache_path: row.get("cache_path")?,
        created_at: row.get("created_at")?,
        last_used_at: row.get("last_used_at")?,
    })
}
