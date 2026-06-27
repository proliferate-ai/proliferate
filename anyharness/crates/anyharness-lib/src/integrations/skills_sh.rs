use anyharness_contract::v1::{LocalSkillAuditEntry, LocalSkillAuditStatus};
use reqwest::StatusCode;
use serde_json::Value;

use crate::domains::local_skills::model::LocalSkillFile;

const DEFAULT_SKILLS_SH_BASE_URL: &str = "https://skills.sh";
const DEFAULT_MARKETPLACE_SEARCH_LIMIT: usize = 10;

#[derive(Clone)]
pub struct SkillsShClient {
    http: reqwest::Client,
    base_url: String,
    auth_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillsShSkillSummary {
    pub skill_id: String,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    pub source_type: String,
    pub install_url: Option<String>,
    pub source_url: Option<String>,
    pub hash: Option<String>,
    pub install_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillsShSkillDetail {
    pub summary: SkillsShSkillSummary,
    pub files: Vec<LocalSkillFile>,
}

#[derive(Debug, thiserror::Error)]
pub enum SkillsShClientError {
    #[error("skills.sh marketplace access requires SKILLS_SH_AUTH_TOKEN or VERCEL_OIDC_TOKEN")]
    MissingAuthToken,
    #[error("skills.sh rejected the marketplace request")]
    Unauthorized,
    #[error("skills.sh marketplace request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("skills.sh returned invalid marketplace data: {0}")]
    InvalidResponse(String),
}

impl SkillsShClient {
    pub fn from_env() -> Self {
        let auth_token = std::env::var("SKILLS_SH_AUTH_TOKEN")
            .ok()
            .or_else(|| std::env::var("VERCEL_OIDC_TOKEN").ok())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let base_url = std::env::var("SKILLS_SH_BASE_URL")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_SKILLS_SH_BASE_URL.to_string());
        Self {
            http: reqwest::Client::new(),
            base_url,
            auth_token,
        }
    }

    pub async fn search(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<SkillsShSkillSummary>, SkillsShClientError> {
        let limit = limit
            .unwrap_or(DEFAULT_MARKETPLACE_SEARCH_LIMIT)
            .clamp(1, DEFAULT_MARKETPLACE_SEARCH_LIMIT);
        let value = self
            .get_json(
                "/api/v1/skills/search",
                &[("q", query), ("limit", &limit.to_string())],
            )
            .await?;
        let items = response_array(&value, &["skills", "results", "data"])?;
        items.iter().map(skill_summary_from_value).collect()
    }

    pub async fn get_skill(
        &self,
        skill_id: &str,
    ) -> Result<SkillsShSkillDetail, SkillsShClientError> {
        validate_marketplace_id(skill_id)?;
        let path = format!("/api/v1/skills/{skill_id}");
        let value = self.get_json(&path, &[]).await?;
        let summary = skill_summary_from_value(&value)?;
        let files_value = value
            .get("files")
            .and_then(Value::as_array)
            .ok_or_else(|| SkillsShClientError::InvalidResponse("missing files".to_string()))?;
        let files = files_value
            .iter()
            .map(skill_file_from_value)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(SkillsShSkillDetail { summary, files })
    }

    pub async fn get_audit(
        &self,
        skill_id: &str,
    ) -> Result<Option<Vec<LocalSkillAuditEntry>>, SkillsShClientError> {
        validate_marketplace_id(skill_id)?;
        let path = format!("/api/v1/skills/audit/{skill_id}");
        match self.get_json(&path, &[]).await {
            Ok(value) => {
                let items = response_array(&value, &["audits", "results", "data"])?;
                let audits = items
                    .iter()
                    .map(audit_entry_from_value)
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Some(audits))
            }
            Err(SkillsShClientError::Request(error))
                if error.status() == Some(StatusCode::NOT_FOUND) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    async fn get_json(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<Value, SkillsShClientError> {
        let token = self
            .auth_token
            .as_deref()
            .ok_or(SkillsShClientError::MissingAuthToken)?;
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .query(query)
            .send()
            .await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(SkillsShClientError::Unauthorized);
        }
        let response = response.error_for_status()?;
        response
            .json::<Value>()
            .await
            .map_err(SkillsShClientError::Request)
    }
}

fn validate_marketplace_id(skill_id: &str) -> Result<(), SkillsShClientError> {
    if skill_id.is_empty()
        || skill_id
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~' | '/')))
    {
        return Err(SkillsShClientError::InvalidResponse(format!(
            "invalid skill id: {skill_id}"
        )));
    }
    Ok(())
}

fn response_array<'a>(
    value: &'a Value,
    field_names: &[&str],
) -> Result<&'a Vec<Value>, SkillsShClientError> {
    if let Some(items) = value.as_array() {
        return Ok(items);
    }
    for field_name in field_names {
        if let Some(items) = value.get(*field_name).and_then(Value::as_array) {
            return Ok(items);
        }
    }
    Err(SkillsShClientError::InvalidResponse(
        "missing array payload".to_string(),
    ))
}

fn skill_summary_from_value(value: &Value) -> Result<SkillsShSkillSummary, SkillsShClientError> {
    let skill_id = string_field(value, &["id", "skillId", "skill_id"])?;
    let slug = optional_string_field(value, &["slug"]).unwrap_or_else(|| {
        skill_id
            .rsplit('/')
            .next()
            .unwrap_or(skill_id.as_str())
            .to_string()
    });
    let name = optional_string_field(value, &["name", "displayName", "display_name"])
        .unwrap_or_else(|| slug.clone());
    Ok(SkillsShSkillSummary {
        skill_id,
        slug,
        name,
        description: optional_string_field(value, &["description"]),
        source: optional_string_field(value, &["source"])
            .unwrap_or_else(|| "skills.sh".to_string()),
        source_type: optional_string_field(value, &["sourceType", "source_type"])
            .unwrap_or_else(|| "skills_sh".to_string()),
        install_url: optional_string_field(value, &["installUrl", "install_url"]),
        source_url: optional_string_field(value, &["url", "sourceUrl", "source_url"]),
        hash: optional_string_field(value, &["hash"]),
        install_count: integer_field(value, &["installs", "installCount", "install_count"])
            .unwrap_or(0),
    })
}

fn skill_file_from_value(value: &Value) -> Result<LocalSkillFile, SkillsShClientError> {
    Ok(LocalSkillFile {
        path: string_field(value, &["path", "name"])?,
        content: string_field(value, &["contents", "content"])?,
    })
}

fn audit_entry_from_value(value: &Value) -> Result<LocalSkillAuditEntry, SkillsShClientError> {
    Ok(LocalSkillAuditEntry {
        provider: optional_string_field(value, &["provider", "auditor"])
            .unwrap_or_else(|| "skills.sh".to_string()),
        status: audit_status_from_str(
            optional_string_field(value, &["status"])
                .unwrap_or_else(|| "missing".to_string())
                .as_str(),
        ),
        summary: optional_string_field(value, &["summary", "message"]),
        audited_at: optional_string_field(
            value,
            &["auditedAt", "audited_at", "createdAt", "created_at"],
        ),
        risk_level: optional_string_field(value, &["riskLevel", "risk_level"]),
    })
}

pub fn aggregate_audit_status(audits: &[LocalSkillAuditEntry]) -> LocalSkillAuditStatus {
    if audits.is_empty() {
        return LocalSkillAuditStatus::Missing;
    }
    if audits
        .iter()
        .any(|audit| audit.status == LocalSkillAuditStatus::Fail)
    {
        return LocalSkillAuditStatus::Fail;
    }
    if audits
        .iter()
        .any(|audit| audit.status == LocalSkillAuditStatus::Warn)
    {
        return LocalSkillAuditStatus::Warn;
    }
    LocalSkillAuditStatus::Pass
}

fn audit_status_from_str(value: &str) -> LocalSkillAuditStatus {
    match value {
        "pass" | "passed" | "ok" => LocalSkillAuditStatus::Pass,
        "warn" | "warning" | "warnings" => LocalSkillAuditStatus::Warn,
        "fail" | "failed" | "error" | "blocked" => LocalSkillAuditStatus::Fail,
        _ => LocalSkillAuditStatus::Missing,
    }
}

fn string_field(value: &Value, names: &[&str]) -> Result<String, SkillsShClientError> {
    optional_string_field(value, names).ok_or_else(|| {
        SkillsShClientError::InvalidResponse(format!("missing string field: {}", names[0]))
    })
}

fn optional_string_field(value: &Value, names: &[&str]) -> Option<String> {
    for name in names {
        let Some(raw) = value.get(*name) else {
            continue;
        };
        if let Some(text) = raw.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn integer_field(value: &Value, names: &[&str]) -> Option<i64> {
    for name in names {
        let Some(raw) = value.get(*name) else {
            continue;
        };
        if let Some(number) = raw.as_i64() {
            return Some(number);
        }
        if let Some(text) = raw.as_str() {
            if let Ok(number) = text.parse::<i64>() {
                return Some(number);
            }
        }
    }
    None
}
