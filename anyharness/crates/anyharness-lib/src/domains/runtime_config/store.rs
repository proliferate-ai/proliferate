use anyharness_contract::v1::{
    RuntimeArtifactPayload, RuntimeConfigExternalScope, RuntimeConfigManifest,
    RuntimeConfigRevision,
};
use rusqlite::{params, OptionalExtension, Row};
use std::collections::HashSet;

use super::model::{default_external_scope, RuntimeConfigApplyInput, RuntimeConfigRecord};
use crate::persistence::Db;

#[derive(Clone)]
pub struct RuntimeConfigStore {
    db: Db,
}

impl RuntimeConfigStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub(crate) fn upsert_current(
        &self,
        scope_key: &str,
        input: &RuntimeConfigApplyInput,
    ) -> anyhow::Result<bool> {
        let manifest_json = serde_json::to_string(&input.manifest)?;
        let scope = input
            .revision
            .external_scope
            .clone()
            .unwrap_or_else(default_external_scope);
        let changed = self.db.with_tx(|conn| {
            let changed = conn.execute(
                "INSERT INTO runtime_config_current (
                    scope_key, scope_provider, scope_id, target_id, revision_id, sequence,
                    content_hash, manifest_json, source,
                    applied_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    datetime('now'), datetime('now')
                 )
                 ON CONFLICT(scope_key) DO UPDATE SET
                    scope_provider = excluded.scope_provider,
                    scope_id = excluded.scope_id,
                    target_id = excluded.target_id,
                    revision_id = excluded.revision_id,
                    sequence = excluded.sequence,
                    content_hash = excluded.content_hash,
                    manifest_json = excluded.manifest_json,
                    source = excluded.source,
                    applied_at = datetime('now'),
                    updated_at = datetime('now')
                 WHERE runtime_config_current.sequence <= excluded.sequence",
                params![
                    scope_key,
                    scope.provider,
                    scope.id,
                    scope.target_id.as_deref(),
                    input.revision.id,
                    input.revision.sequence,
                    input.revision.content_hash,
                    manifest_json,
                    input.source,
                ],
            )?;
            for artifact in &input.artifact_payloads {
                conn.execute(
                    "INSERT INTO runtime_config_artifacts (
                        hash, content_type, byte_size, source_ref, content, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                     ON CONFLICT(hash) DO UPDATE SET
                        content_type = excluded.content_type,
                        byte_size = excluded.byte_size,
                        source_ref = excluded.source_ref,
                        content = excluded.content,
                        updated_at = datetime('now')",
                    params![
                        artifact.hash,
                        artifact.content_type,
                        artifact.byte_size,
                        artifact.source_ref.as_deref(),
                        artifact.content,
                    ],
                )?;
            }
            Ok(changed > 0)
        })?;
        Ok(changed)
    }

    pub(crate) fn latest(&self) -> anyhow::Result<Option<RuntimeConfigRecord>> {
        let record = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision_id, sequence,
                        content_hash, manifest_json
                 FROM runtime_config_current
                 ORDER BY updated_at DESC
                 LIMIT 1",
                [],
                runtime_config_record_from_row,
            )
            .optional()
        })?;
        self.attach_artifact_payloads(record)
    }

    pub(crate) fn find_by_scope(
        &self,
        scope_key: &str,
    ) -> anyhow::Result<Option<RuntimeConfigRecord>> {
        let record = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision_id, sequence,
                        content_hash, manifest_json
                 FROM runtime_config_current
                 WHERE scope_key = ?1",
                [scope_key],
                runtime_config_record_from_row,
            )
            .optional()
        })?;
        self.attach_artifact_payloads(record)
    }

    pub(crate) fn set_session_context(
        &self,
        session_id: &str,
        record: &RuntimeConfigRecord,
    ) -> anyhow::Result<()> {
        let manifest_json = serde_json::to_string(&record.manifest)?;
        let scope = record
            .revision
            .external_scope
            .clone()
            .unwrap_or_else(default_external_scope);
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO runtime_config_session_context (
                    session_id, scope_provider, scope_id, target_id, revision_id, sequence,
                    content_hash, manifest_json, applied_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now')
                 )
                 ON CONFLICT(session_id) DO UPDATE SET
                    scope_provider = excluded.scope_provider,
                    scope_id = excluded.scope_id,
                    target_id = excluded.target_id,
                    revision_id = excluded.revision_id,
                    sequence = excluded.sequence,
                    content_hash = excluded.content_hash,
                    manifest_json = excluded.manifest_json,
                    applied_at = datetime('now'),
                    updated_at = datetime('now')",
                params![
                    session_id,
                    scope.provider,
                    scope.id,
                    scope.target_id.as_deref(),
                    record.revision.id,
                    record.revision.sequence,
                    record.revision.content_hash,
                    manifest_json,
                ],
            )?;
            for artifact in &record.artifact_payloads {
                conn.execute(
                    "INSERT INTO runtime_config_artifacts (
                        hash, content_type, byte_size, source_ref, content, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                     ON CONFLICT(hash) DO UPDATE SET
                        content_type = excluded.content_type,
                        byte_size = excluded.byte_size,
                        source_ref = excluded.source_ref,
                        content = excluded.content,
                        updated_at = datetime('now')",
                    params![
                        artifact.hash,
                        artifact.content_type,
                        artifact.byte_size,
                        artifact.source_ref.as_deref(),
                        artifact.content,
                    ],
                )?;
            }
            Ok(())
        })
    }

    pub(crate) fn find_session_context(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<RuntimeConfigRecord>> {
        let record = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision_id, sequence,
                        content_hash, manifest_json
                 FROM runtime_config_session_context
                 WHERE session_id = ?1",
                [session_id],
                runtime_config_record_from_row,
            )
            .optional()
        })?;
        self.attach_artifact_payloads(record)
    }

    pub(crate) fn cached_artifact_hashes(&self) -> anyhow::Result<HashSet<String>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT hash FROM runtime_config_artifacts")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let hashes = rows.collect::<rusqlite::Result<HashSet<_>>>()?;
            Ok(hashes)
        })
    }

    fn attach_artifact_payloads(
        &self,
        record: Option<RuntimeConfigRecord>,
    ) -> anyhow::Result<Option<RuntimeConfigRecord>> {
        let Some(mut record) = record else {
            return Ok(None);
        };
        record.artifact_payloads = self.artifact_payloads_for_manifest(&record.manifest)?;
        Ok(Some(record))
    }

    fn artifact_payloads_for_manifest(
        &self,
        manifest: &RuntimeConfigManifest,
    ) -> anyhow::Result<Vec<RuntimeArtifactPayload>> {
        self.db.with_conn(|conn| {
            let mut payloads = Vec::new();
            for artifact in &manifest.artifacts {
                let payload = conn
                    .query_row(
                        "SELECT hash, content_type, byte_size, source_ref, content
                         FROM runtime_config_artifacts
                         WHERE hash = ?1",
                        [artifact.hash.as_str()],
                        |row| {
                            Ok(RuntimeArtifactPayload {
                                hash: row.get(0)?,
                                content_type: row.get(1)?,
                                byte_size: row.get(2)?,
                                source_ref: row.get(3)?,
                                resource_id: artifact.resource_id.clone(),
                                display_name: artifact.display_name.clone(),
                                content: row.get(4)?,
                            })
                        },
                    )
                    .optional()?;
                if let Some(payload) = payload {
                    payloads.push(payload);
                }
            }
            Ok(payloads)
        })
    }
}

fn runtime_config_record_from_row(row: &Row<'_>) -> rusqlite::Result<RuntimeConfigRecord> {
    let scope = RuntimeConfigExternalScope {
        provider: row.get(0)?,
        id: row.get(1)?,
        target_id: row.get(2)?,
    };
    let manifest_json: String = row.get(6)?;
    let manifest = serde_json::from_str(&manifest_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(RuntimeConfigRecord {
        revision: RuntimeConfigRevision {
            id: row.get(3)?,
            sequence: row.get(4)?,
            content_hash: row.get(5)?,
            external_scope: Some(scope),
        },
        manifest,
        artifact_payloads: Vec::new(),
    })
}
