use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::RuntimeSkillSourceKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LocalSkillAuditStatus {
    Pass,
    Warn,
    Fail,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkillAuditEntry {
    pub provider: String,
    pub status: LocalSkillAuditStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audited_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk_level: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkillFileSummary {
    pub path: String,
    pub byte_size: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub skill_id: String,
    pub source_kind: RuntimeSkillSourceKind,
    pub source: String,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    pub install_count: i64,
    pub audit_status: LocalSkillAuditStatus,
    #[serde(default)]
    pub audits: Vec<LocalSkillAuditEntry>,
    #[serde(default)]
    pub files: Vec<LocalSkillFileSummary>,
    pub installed_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkillsResponse {
    #[serde(default)]
    pub skills: Vec<InstalledSkill>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillRequest {
    pub skill_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_for_workspace_id: Option<String>,
    #[serde(default)]
    pub allow_missing_audit: bool,
    #[serde(default)]
    pub allow_warning_audit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSkillResponse {
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkill {
    pub skill: InstalledSkill,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkillsResponse {
    #[serde(default)]
    pub skills: Vec<WorkspaceSkill>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceSkillRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSkill {
    pub skill_id: String,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub source_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    pub install_count: i64,
    pub audit_status: LocalSkillAuditStatus,
    #[serde(default)]
    pub audits: Vec<LocalSkillAuditEntry>,
    #[serde(default)]
    pub files: Vec<LocalSkillFileSummary>,
    pub installed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSkillSearchResponse {
    pub query: String,
    #[serde(default)]
    pub skills: Vec<MarketplaceSkill>,
}
