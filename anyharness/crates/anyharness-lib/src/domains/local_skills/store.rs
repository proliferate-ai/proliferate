use std::collections::HashMap;
use std::path::PathBuf;

use anyharness_contract::v1::{LocalSkillAuditEntry, LocalSkillAuditStatus, LocalSkillFileSummary};
use rusqlite::{params, OptionalExtension, Row};

use super::model::{LocalSkillRecord, SKILLS_SH_SOURCE_KIND};
use crate::persistence::Db;

#[derive(Clone)]
pub struct LocalSkillStore {
    db: Db,
}

impl LocalSkillStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn list_skills(&self) -> anyhow::Result<Vec<LocalSkillRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT skill_id, source_kind, source, slug, display_name, description,
                        install_url, source_url, hash, install_count, audit_status, audits_json,
                        files_json, library_path, installed_at, updated_at
                 FROM local_skills
                 ORDER BY lower(display_name), lower(skill_id)",
            )?;
            let rows = stmt.query_map([], local_skill_record_from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
    }

    pub fn find_skill(&self, skill_id: &str) -> anyhow::Result<Option<LocalSkillRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT skill_id, source_kind, source, slug, display_name, description,
                        install_url, source_url, hash, install_count, audit_status, audits_json,
                        files_json, library_path, installed_at, updated_at
                 FROM local_skills
                 WHERE skill_id = ?1",
                [skill_id],
                local_skill_record_from_row,
            )
            .optional()
        })
    }

    pub fn upsert_skill(&self, record: &LocalSkillRecord) -> anyhow::Result<()> {
        let audits_json = serde_json::to_string(&record.audits)?;
        let files_json = serde_json::to_string(&record.files)?;
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO local_skills (
                    skill_id, source_kind, source, slug, display_name, description,
                    install_url, source_url, hash, install_count, audit_status, audits_json,
                    files_json, library_path, installed_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    datetime('now'), datetime('now')
                 )
                 ON CONFLICT(skill_id) DO UPDATE SET
                    source_kind = excluded.source_kind,
                    source = excluded.source,
                    slug = excluded.slug,
                    display_name = excluded.display_name,
                    description = excluded.description,
                    install_url = excluded.install_url,
                    source_url = excluded.source_url,
                    hash = excluded.hash,
                    install_count = excluded.install_count,
                    audit_status = excluded.audit_status,
                    audits_json = excluded.audits_json,
                    files_json = excluded.files_json,
                    library_path = excluded.library_path,
                    updated_at = datetime('now')",
                params![
                    record.skill_id,
                    record.source_kind,
                    record.source,
                    record.slug,
                    record.display_name,
                    record.description,
                    record.install_url.as_deref(),
                    record.source_url.as_deref(),
                    record.hash.as_deref(),
                    record.install_count,
                    status_to_db(&record.audit_status),
                    audits_json,
                    files_json,
                    record.library_path.to_string_lossy().as_ref(),
                ],
            )?;
            Ok(())
        })
    }

    pub fn delete_skill(&self, skill_id: &str) -> anyhow::Result<bool> {
        let changed = self.db.with_conn(|conn| {
            conn.execute("DELETE FROM local_skills WHERE skill_id = ?1", [skill_id])
        })?;
        Ok(changed > 0)
    }

    pub fn list_workspace_skills(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<(LocalSkillRecord, bool)>> {
        let enabled = self.workspace_enabled_map(workspace_id)?;
        Ok(self
            .list_skills()?
            .into_iter()
            .map(|skill| {
                let enabled = enabled.get(&skill.skill_id).copied().unwrap_or(false);
                (skill, enabled)
            })
            .collect())
    }

    pub fn list_enabled_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<LocalSkillRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.skill_id, s.source_kind, s.source, s.slug, s.display_name, s.description,
                        s.install_url, s.source_url, s.hash, s.install_count, s.audit_status,
                        s.audits_json, s.files_json, s.library_path, s.installed_at, s.updated_at
                 FROM local_skills s
                 INNER JOIN workspace_local_skills ws ON ws.skill_id = s.skill_id
                 WHERE ws.workspace_id = ?1 AND ws.enabled = 1
                 ORDER BY lower(s.display_name), lower(s.skill_id)",
            )?;
            let rows = stmt.query_map([workspace_id], local_skill_record_from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
    }

    pub fn set_workspace_skill_enabled(
        &self,
        workspace_id: &str,
        skill_id: &str,
        enabled: bool,
    ) -> anyhow::Result<()> {
        let enabled_int = if enabled { 1_i64 } else { 0_i64 };
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspace_local_skills (
                    workspace_id, skill_id, enabled, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, datetime('now'), datetime('now'))
                 ON CONFLICT(workspace_id, skill_id) DO UPDATE SET
                    enabled = excluded.enabled,
                    updated_at = datetime('now')",
                params![workspace_id, skill_id, enabled_int],
            )?;
            Ok(())
        })
    }

    fn workspace_enabled_map(&self, workspace_id: &str) -> anyhow::Result<HashMap<String, bool>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT skill_id, enabled
                 FROM workspace_local_skills
                 WHERE workspace_id = ?1",
            )?;
            let rows = stmt.query_map([workspace_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? == 1))
            })?;
            rows.collect::<rusqlite::Result<HashMap<_, _>>>()
        })
    }
}

fn local_skill_record_from_row(row: &Row<'_>) -> rusqlite::Result<LocalSkillRecord> {
    let audits_json: String = row.get(11)?;
    let files_json: String = row.get(12)?;
    let audits =
        serde_json::from_str::<Vec<LocalSkillAuditEntry>>(&audits_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let files =
        serde_json::from_str::<Vec<LocalSkillFileSummary>>(&files_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                12,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let source_kind: String = row.get(1)?;
    Ok(LocalSkillRecord {
        skill_id: row.get(0)?,
        source_kind: if source_kind.is_empty() {
            SKILLS_SH_SOURCE_KIND.to_string()
        } else {
            source_kind
        },
        source: row.get(2)?,
        slug: row.get(3)?,
        display_name: row.get(4)?,
        description: row.get(5)?,
        install_url: row.get(6)?,
        source_url: row.get(7)?,
        hash: row.get(8)?,
        install_count: row.get(9)?,
        audit_status: status_from_db(row.get::<_, String>(10)?.as_str()),
        audits,
        files,
        library_path: PathBuf::from(row.get::<_, String>(13)?),
        installed_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

pub fn status_to_db(status: &LocalSkillAuditStatus) -> &'static str {
    match status {
        LocalSkillAuditStatus::Pass => "pass",
        LocalSkillAuditStatus::Warn => "warn",
        LocalSkillAuditStatus::Fail => "fail",
        LocalSkillAuditStatus::Missing => "missing",
    }
}

pub fn status_from_db(value: &str) -> LocalSkillAuditStatus {
    match value {
        "pass" => LocalSkillAuditStatus::Pass,
        "warn" => LocalSkillAuditStatus::Warn,
        "fail" => LocalSkillAuditStatus::Fail,
        _ => LocalSkillAuditStatus::Missing,
    }
}
