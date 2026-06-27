use std::path::PathBuf;

use anyharness_contract::v1::{
    InstalledSkill, LocalSkillAuditEntry, LocalSkillAuditStatus, LocalSkillFileSummary,
    RuntimeSkillSourceKind,
};

pub const SKILLS_SH_SOURCE_KIND: &str = "skills_sh";
pub const SKILL_MANIFEST_PATH: &str = "SKILL.md";
pub const MAX_SKILL_FILE_COUNT: usize = 128;
pub const MAX_SKILL_FILE_BYTES: usize = 1024 * 1024;
pub const MAX_SKILL_TOTAL_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSkillFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSkillSnapshot {
    pub skill_id: String,
    pub source: String,
    pub slug: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub install_url: Option<String>,
    pub source_url: Option<String>,
    pub hash: Option<String>,
    pub install_count: i64,
    pub audit_status: LocalSkillAuditStatus,
    pub audits: Vec<LocalSkillAuditEntry>,
    pub files: Vec<LocalSkillFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSkillRecord {
    pub skill_id: String,
    pub source_kind: String,
    pub source: String,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub install_url: Option<String>,
    pub source_url: Option<String>,
    pub hash: Option<String>,
    pub install_count: i64,
    pub audit_status: LocalSkillAuditStatus,
    pub audits: Vec<LocalSkillAuditEntry>,
    pub files: Vec<LocalSkillFileSummary>,
    pub library_path: PathBuf,
    pub installed_at: String,
    pub updated_at: String,
}

impl LocalSkillRecord {
    pub fn to_contract(&self) -> InstalledSkill {
        InstalledSkill {
            skill_id: self.skill_id.clone(),
            source_kind: RuntimeSkillSourceKind::SkillsSh,
            source: self.source.clone(),
            slug: self.slug.clone(),
            display_name: self.display_name.clone(),
            description: self.description.clone(),
            install_url: self.install_url.clone(),
            source_url: self.source_url.clone(),
            hash: self.hash.clone(),
            install_count: self.install_count,
            audit_status: self.audit_status.clone(),
            audits: self.audits.clone(),
            files: self.files.clone(),
            installed_at: self.installed_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}
