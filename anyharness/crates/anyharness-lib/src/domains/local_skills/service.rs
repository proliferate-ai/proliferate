use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use anyharness_contract::v1::{
    InstalledSkill, LocalSkillAuditStatus, LocalSkillFileSummary, MarketplaceSkill,
    MarketplaceSkillSearchResponse, RuntimeArtifactPayload, RuntimeArtifactRef, RuntimeSkill,
    RuntimeSkillSourceKind, WorkspaceSkill, WorkspaceSkillsResponse,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::model::{
    LocalSkillFile, LocalSkillRecord, LocalSkillSnapshot, MAX_SKILL_FILE_BYTES,
    MAX_SKILL_FILE_COUNT, MAX_SKILL_TOTAL_BYTES, SKILLS_SH_SOURCE_KIND, SKILL_MANIFEST_PATH,
};
use super::store::LocalSkillStore;
use crate::domains::runtime_config::model::RuntimeConfigExtraSkills;
use crate::integrations::skills_sh::{
    aggregate_audit_status, SkillsShClient, SkillsShClientError, SkillsShSkillDetail,
};

#[derive(Clone)]
pub struct LocalSkillService {
    store: LocalSkillStore,
    library_root: PathBuf,
    skills_sh_client: SkillsShClient,
}

#[derive(Debug, thiserror::Error)]
pub enum LocalSkillError {
    #[error("skill not found: {0}")]
    NotFound(String),
    #[error("invalid skill snapshot: {0}")]
    InvalidSnapshot(String),
    #[error("skill audit failed; install is blocked")]
    AuditFailed,
    #[error("skill audit status requires confirmation: {0:?}")]
    AuditConfirmationRequired(LocalSkillAuditStatus),
    #[error("skills.sh marketplace error: {0}")]
    Marketplace(#[from] SkillsShClientError),
    #[error("local skill storage error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl LocalSkillService {
    pub fn new(
        store: LocalSkillStore,
        runtime_home: PathBuf,
        skills_sh_client: SkillsShClient,
    ) -> Self {
        Self {
            store,
            library_root: runtime_home.join("skills"),
            skills_sh_client,
        }
    }

    pub fn list_installed(&self) -> Result<Vec<InstalledSkill>, LocalSkillError> {
        Ok(self
            .store
            .list_skills()?
            .into_iter()
            .map(|skill| skill.to_contract())
            .collect())
    }

    pub async fn search_marketplace(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> Result<MarketplaceSkillSearchResponse, LocalSkillError> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(MarketplaceSkillSearchResponse {
                query: String::new(),
                skills: Vec::new(),
            });
        }
        let summaries = self.skills_sh_client.search(query, limit).await?;
        let mut skills = Vec::new();
        for summary in summaries {
            let detail = self.skills_sh_client.get_skill(&summary.skill_id).await?;
            let audits = self
                .skills_sh_client
                .get_audit(&summary.skill_id)
                .await?
                .unwrap_or_default();
            let audit_status = aggregate_audit_status(&audits);
            let installed = self.store.find_skill(&summary.skill_id)?.is_some();
            skills.push(MarketplaceSkill {
                skill_id: summary.skill_id,
                slug: summary.slug,
                name: summary.name,
                description: summary.description.unwrap_or_default(),
                source: summary.source,
                source_type: summary.source_type,
                install_url: summary.install_url,
                source_url: summary.source_url,
                hash: summary.hash,
                install_count: summary.install_count,
                audit_status,
                audits,
                files: detail
                    .files
                    .iter()
                    .map(file_summary)
                    .collect::<Result<Vec<_>, _>>()?,
                installed,
            });
        }
        Ok(MarketplaceSkillSearchResponse {
            query: query.to_string(),
            skills,
        })
    }

    pub async fn install_from_marketplace(
        &self,
        skill_id: &str,
        enable_for_workspace_id: Option<&str>,
        allow_missing_audit: bool,
        allow_warning_audit: bool,
    ) -> Result<InstalledSkill, LocalSkillError> {
        let detail = self.skills_sh_client.get_skill(skill_id).await?;
        let audits = self
            .skills_sh_client
            .get_audit(skill_id)
            .await?
            .unwrap_or_default();
        let audit_status = aggregate_audit_status(&audits);
        let snapshot = snapshot_from_marketplace_detail(detail, audit_status, audits);
        let installed = self.install_snapshot(
            snapshot,
            enable_for_workspace_id,
            allow_missing_audit,
            allow_warning_audit,
        )?;
        Ok(installed)
    }

    pub fn install_snapshot(
        &self,
        snapshot: LocalSkillSnapshot,
        enable_for_workspace_id: Option<&str>,
        allow_missing_audit: bool,
        allow_warning_audit: bool,
    ) -> Result<InstalledSkill, LocalSkillError> {
        enforce_audit_policy(
            &snapshot.audit_status,
            allow_missing_audit,
            allow_warning_audit,
        )?;
        let validated = validate_skill_snapshot(&snapshot)?;
        fs::create_dir_all(&self.library_root).map_err(|error| {
            LocalSkillError::Internal(anyhow::anyhow!("create skills library: {error}"))
        })?;
        let target_path = self
            .library_root
            .join(safe_skill_dir_name(&snapshot.skill_id));
        write_snapshot_files(&self.library_root, &target_path, &validated.files)?;
        let record = LocalSkillRecord {
            skill_id: snapshot.skill_id,
            source_kind: SKILLS_SH_SOURCE_KIND.to_string(),
            source: snapshot.source,
            slug: snapshot.slug,
            display_name: validated.display_name,
            description: validated.description,
            install_url: snapshot.install_url,
            source_url: snapshot.source_url,
            hash: snapshot.hash,
            install_count: snapshot.install_count,
            audit_status: snapshot.audit_status,
            audits: snapshot.audits,
            files: validated.file_summaries,
            library_path: target_path,
            installed_at: String::new(),
            updated_at: String::new(),
        };
        self.store.upsert_skill(&record)?;
        if let Some(workspace_id) = enable_for_workspace_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            self.store
                .set_workspace_skill_enabled(workspace_id, &record.skill_id, true)?;
        }
        let installed = self
            .store
            .find_skill(&record.skill_id)?
            .ok_or_else(|| LocalSkillError::NotFound(record.skill_id.clone()))?;
        Ok(installed.to_contract())
    }

    pub fn delete_skill(&self, skill_id: &str) -> Result<bool, LocalSkillError> {
        if let Some(record) = self.store.find_skill(skill_id)? {
            remove_skill_dir_if_safe(&self.library_root, &record.library_path)?;
        }
        self.store
            .delete_skill(skill_id)
            .map_err(LocalSkillError::from)
    }

    pub fn workspace_skills(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceSkillsResponse, LocalSkillError> {
        let skills = self
            .store
            .list_workspace_skills(workspace_id)?
            .into_iter()
            .map(|(skill, enabled)| WorkspaceSkill {
                skill: skill.to_contract(),
                enabled,
            })
            .collect();
        Ok(WorkspaceSkillsResponse { skills })
    }

    pub fn set_workspace_skill_enabled(
        &self,
        workspace_id: &str,
        skill_id: &str,
        enabled: bool,
    ) -> Result<WorkspaceSkill, LocalSkillError> {
        let skill = self
            .store
            .find_skill(skill_id)?
            .ok_or_else(|| LocalSkillError::NotFound(skill_id.to_string()))?;
        self.store
            .set_workspace_skill_enabled(workspace_id, skill_id, enabled)?;
        Ok(WorkspaceSkill {
            skill: skill.to_contract(),
            enabled,
        })
    }

    pub fn runtime_config_skills_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<RuntimeConfigExtraSkills, LocalSkillError> {
        let records = self.store.list_enabled_for_workspace(workspace_id)?;
        let mut bundle = RuntimeConfigExtraSkills {
            workspace_id: workspace_id.to_string(),
            skills: Vec::new(),
            artifacts: Vec::new(),
            artifact_payloads: Vec::new(),
        };
        for record in records {
            append_runtime_skill(&mut bundle, &record)?;
        }
        Ok(bundle)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ValidatedSkillSnapshot {
    display_name: String,
    description: String,
    files: Vec<LocalSkillFile>,
    file_summaries: Vec<LocalSkillFileSummary>,
}

fn validate_skill_snapshot(
    snapshot: &LocalSkillSnapshot,
) -> Result<ValidatedSkillSnapshot, LocalSkillError> {
    if snapshot.skill_id.trim().is_empty() {
        return Err(LocalSkillError::InvalidSnapshot(
            "skill_id is required".to_string(),
        ));
    }
    if snapshot.files.is_empty() {
        return Err(LocalSkillError::InvalidSnapshot(
            "at least one file is required".to_string(),
        ));
    }
    if snapshot.files.len() > MAX_SKILL_FILE_COUNT {
        return Err(LocalSkillError::InvalidSnapshot(format!(
            "too many files: {} > {MAX_SKILL_FILE_COUNT}",
            snapshot.files.len()
        )));
    }
    let mut files = BTreeMap::new();
    let mut total_size = 0usize;
    for file in &snapshot.files {
        validate_skill_path(&file.path)?;
        let byte_size = file.content.as_bytes().len();
        if byte_size > MAX_SKILL_FILE_BYTES {
            return Err(LocalSkillError::InvalidSnapshot(format!(
                "file exceeds size limit: {}",
                file.path
            )));
        }
        total_size += byte_size;
        if total_size > MAX_SKILL_TOTAL_BYTES {
            return Err(LocalSkillError::InvalidSnapshot(format!(
                "skill exceeds total size limit: {MAX_SKILL_TOTAL_BYTES}"
            )));
        }
        if files.insert(file.path.clone(), file.clone()).is_some() {
            return Err(LocalSkillError::InvalidSnapshot(format!(
                "duplicate file path: {}",
                file.path
            )));
        }
    }
    let manifest = files.get(SKILL_MANIFEST_PATH).ok_or_else(|| {
        LocalSkillError::InvalidSnapshot(format!("{SKILL_MANIFEST_PATH} is required"))
    })?;
    let parsed_metadata = parse_skill_metadata(&manifest.content);
    let display_name = first_non_empty([
        snapshot.display_name.as_deref(),
        parsed_metadata.name.as_deref(),
        Some(snapshot.slug.as_str()),
        Some(snapshot.skill_id.as_str()),
    ])
    .unwrap_or("Skill")
    .to_string();
    let description = first_non_empty([
        snapshot.description.as_deref(),
        parsed_metadata.description.as_deref(),
        first_markdown_paragraph(&manifest.content).as_deref(),
    ])
    .unwrap_or("")
    .to_string();
    let files = files.into_values().collect::<Vec<_>>();
    let file_summaries = files
        .iter()
        .map(file_summary)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ValidatedSkillSnapshot {
        display_name,
        description,
        files,
        file_summaries,
    })
}

fn enforce_audit_policy(
    status: &LocalSkillAuditStatus,
    allow_missing_audit: bool,
    allow_warning_audit: bool,
) -> Result<(), LocalSkillError> {
    match status {
        LocalSkillAuditStatus::Pass => Ok(()),
        LocalSkillAuditStatus::Fail => Err(LocalSkillError::AuditFailed),
        LocalSkillAuditStatus::Warn if allow_warning_audit => Ok(()),
        LocalSkillAuditStatus::Warn => Err(LocalSkillError::AuditConfirmationRequired(
            LocalSkillAuditStatus::Warn,
        )),
        LocalSkillAuditStatus::Missing if allow_missing_audit => Ok(()),
        LocalSkillAuditStatus::Missing => Err(LocalSkillError::AuditConfirmationRequired(
            LocalSkillAuditStatus::Missing,
        )),
    }
}

fn write_snapshot_files(
    library_root: &Path,
    target_path: &Path,
    files: &[LocalSkillFile],
) -> Result<(), LocalSkillError> {
    let tmp_path = library_root.join(format!(".install-{}", Uuid::new_v4()));
    fs::create_dir_all(&tmp_path).map_err(|error| {
        LocalSkillError::Internal(anyhow::anyhow!("create temp skill dir: {error}"))
    })?;
    let write_result = (|| -> Result<(), LocalSkillError> {
        for file in files {
            let destination = tmp_path.join(&file.path);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    LocalSkillError::Internal(anyhow::anyhow!("create skill file parent: {error}"))
                })?;
            }
            fs::write(&destination, file.content.as_bytes()).map_err(|error| {
                LocalSkillError::Internal(anyhow::anyhow!(
                    "write skill file {}: {error}",
                    file.path
                ))
            })?;
        }
        if target_path.exists() {
            remove_skill_dir_if_safe(library_root, target_path)?;
        }
        fs::rename(&tmp_path, target_path).map_err(|error| {
            LocalSkillError::Internal(anyhow::anyhow!("move skill snapshot into library: {error}"))
        })?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_dir_all(&tmp_path);
    }
    write_result
}

fn remove_skill_dir_if_safe(library_root: &Path, path: &Path) -> Result<(), LocalSkillError> {
    let library_root = library_root
        .canonicalize()
        .unwrap_or_else(|_| library_root.to_path_buf());
    let candidate = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if !candidate.starts_with(&library_root) || candidate == library_root {
        return Err(LocalSkillError::InvalidSnapshot(format!(
            "refusing to remove path outside skill library: {}",
            path.display()
        )));
    }
    if candidate.exists() {
        fs::remove_dir_all(candidate).map_err(|error| {
            LocalSkillError::Internal(anyhow::anyhow!("remove skill dir: {error}"))
        })?;
    }
    Ok(())
}

fn append_runtime_skill(
    bundle: &mut RuntimeConfigExtraSkills,
    record: &LocalSkillRecord,
) -> Result<(), LocalSkillError> {
    let mut instruction_artifact = None;
    let mut resources = Vec::new();
    let mut artifact_refs = Vec::new();
    let mut payloads = Vec::new();
    for file in &record.files {
        validate_skill_path(&file.path)?;
        let content_path = record.library_path.join(&file.path);
        let content = fs::read_to_string(&content_path).map_err(|error| {
            LocalSkillError::Internal(anyhow::anyhow!(
                "read skill file {}: {error}",
                content_path.display()
            ))
        })?;
        let (artifact, payload) = runtime_artifact_for_file(&record.skill_id, &file.path, &content);
        if file.path == SKILL_MANIFEST_PATH {
            instruction_artifact = Some(artifact.clone());
        } else {
            resources.push(artifact.clone());
        }
        artifact_refs.push(artifact);
        payloads.push(payload);
    }
    let instruction_artifact = instruction_artifact.ok_or_else(|| {
        LocalSkillError::InvalidSnapshot(format!(
            "installed skill {} is missing {SKILL_MANIFEST_PATH}",
            record.skill_id
        ))
    })?;
    bundle.artifacts.extend(artifact_refs);
    bundle.artifact_payloads.extend(payloads);
    bundle.skills.push(RuntimeSkill {
        id: record.skill_id.clone(),
        source_kind: RuntimeSkillSourceKind::SkillsSh,
        display_name: record.display_name.clone(),
        description: record.description.clone(),
        instruction_artifact,
        resources,
        required_mcp_server_ids: Vec::new(),
        credential_refs: Vec::new(),
    });
    Ok(())
}

fn runtime_artifact_for_file(
    skill_id: &str,
    path: &str,
    content: &str,
) -> (RuntimeArtifactRef, RuntimeArtifactPayload) {
    let hash = runtime_artifact_hash(content);
    let content_type = content_type_for_path(path).to_string();
    let byte_size = content.as_bytes().len() as i64;
    let source_ref = Some(format!("skills_sh:{skill_id}:{path}"));
    let resource_id = if path == SKILL_MANIFEST_PATH {
        None
    } else {
        Some(path.to_string())
    };
    let display_name = if path == SKILL_MANIFEST_PATH {
        None
    } else {
        Some(path.to_string())
    };
    let artifact = RuntimeArtifactRef {
        hash: hash.clone(),
        content_type: content_type.clone(),
        byte_size,
        source_ref: source_ref.clone(),
        resource_id: resource_id.clone(),
        display_name: display_name.clone(),
    };
    let payload = RuntimeArtifactPayload {
        hash,
        content_type,
        byte_size,
        source_ref,
        resource_id,
        display_name,
        content: content.to_string(),
    };
    (artifact, payload)
}

fn runtime_artifact_hash(content: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(content.as_bytes()))
}

fn content_type_for_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
    {
        "md" | "mdx" => "text/markdown",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        _ => "text/plain",
    }
}

fn validate_skill_path(path: &str) -> Result<(), LocalSkillError> {
    if path.trim().is_empty() {
        return Err(LocalSkillError::InvalidSnapshot(
            "file path is required".to_string(),
        ));
    }
    if path.contains('\\') || path.ends_with('/') {
        return Err(LocalSkillError::InvalidSnapshot(format!(
            "unsafe file path: {path}"
        )));
    }
    let path_obj = Path::new(path);
    if path_obj.is_absolute() {
        return Err(LocalSkillError::InvalidSnapshot(format!(
            "absolute file path is not allowed: {path}"
        )));
    }
    for component in path_obj.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(LocalSkillError::InvalidSnapshot(format!(
                    "unsafe file path: {path}"
                )))
            }
        }
    }
    Ok(())
}

fn safe_skill_dir_name(skill_id: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(skill_id.as_bytes()));
    let mut stem = skill_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    stem.truncate(80);
    let stem = stem.trim_matches('_');
    let stem = if stem.is_empty() { "skill" } else { stem };
    format!("{}-{}", stem, &digest[..12])
}

fn file_summary(file: &LocalSkillFile) -> Result<LocalSkillFileSummary, LocalSkillError> {
    Ok(LocalSkillFileSummary {
        path: file.path.clone(),
        byte_size: i64::try_from(file.content.as_bytes().len()).map_err(|_| {
            LocalSkillError::InvalidSnapshot(format!("file is too large: {}", file.path))
        })?,
    })
}

fn snapshot_from_marketplace_detail(
    detail: SkillsShSkillDetail,
    audit_status: LocalSkillAuditStatus,
    audits: Vec<anyharness_contract::v1::LocalSkillAuditEntry>,
) -> LocalSkillSnapshot {
    LocalSkillSnapshot {
        skill_id: detail.summary.skill_id,
        source: detail.summary.source,
        slug: detail.summary.slug,
        display_name: Some(detail.summary.name),
        description: detail.summary.description,
        install_url: detail.summary.install_url,
        source_url: detail.summary.source_url,
        hash: detail.summary.hash,
        install_count: detail.summary.install_count,
        audit_status,
        audits,
        files: detail.files,
    }
}

#[derive(Default)]
struct ParsedSkillMetadata {
    name: Option<String>,
    description: Option<String>,
}

fn parse_skill_metadata(content: &str) -> ParsedSkillMetadata {
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return ParsedSkillMetadata::default();
    }
    let mut metadata = ParsedSkillMetadata::default();
    for line in lines {
        let line = line.trim();
        if line == "---" {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = clean_metadata_value(value);
        match key.trim() {
            "name" | "title" => metadata.name = value,
            "description" => metadata.description = value,
            _ => {}
        }
    }
    metadata
}

fn clean_metadata_value(value: &str) -> Option<String> {
    let value = value.trim().trim_matches('"').trim_matches('\'').trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn first_markdown_paragraph(content: &str) -> Option<String> {
    let mut in_frontmatter = content.lines().next() == Some("---");
    let mut saw_frontmatter_end = !in_frontmatter;
    for line in content.lines().skip(if in_frontmatter { 1 } else { 0 }) {
        let line = line.trim();
        if in_frontmatter {
            if line == "---" {
                in_frontmatter = false;
                saw_frontmatter_end = true;
            }
            continue;
        }
        if !saw_frontmatter_end || line.is_empty() || line.starts_with('#') {
            continue;
        }
        return Some(line.to_string());
    }
    None
}

fn first_non_empty<'a, const N: usize>(items: [Option<&'a str>; N]) -> Option<&'a str> {
    items
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|item| !item.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;
    use anyharness_contract::v1::LocalSkillAuditStatus;

    #[test]
    fn validation_requires_root_skill_markdown() {
        let snapshot = test_snapshot(vec![LocalSkillFile {
            path: "nested/SKILL.md".to_string(),
            content: "# Skill\n".to_string(),
        }]);

        assert!(matches!(
            validate_skill_snapshot(&snapshot),
            Err(LocalSkillError::InvalidSnapshot(detail)) if detail.contains("SKILL.md")
        ));
    }

    #[test]
    fn validation_rejects_unsafe_paths() {
        let snapshot = test_snapshot(vec![
            LocalSkillFile {
                path: SKILL_MANIFEST_PATH.to_string(),
                content: "# Skill\n".to_string(),
            },
            LocalSkillFile {
                path: "../secret".to_string(),
                content: "bad".to_string(),
            },
        ]);

        assert!(matches!(
            validate_skill_snapshot(&snapshot),
            Err(LocalSkillError::InvalidSnapshot(detail)) if detail.contains("unsafe")
        ));
    }

    #[test]
    fn validation_parses_frontmatter_metadata() {
        let mut snapshot = test_snapshot(vec![LocalSkillFile {
            path: SKILL_MANIFEST_PATH.to_string(),
            content: "---\nname: Planner\ndescription: Plans work\n---\n# Planner\n".to_string(),
        }]);
        snapshot.display_name = None;
        snapshot.description = None;

        let validated = validate_skill_snapshot(&snapshot).expect("validated");

        assert_eq!(validated.display_name, "Planner");
        assert_eq!(validated.description, "Plans work");
    }

    #[test]
    fn workspace_enablement_controls_runtime_compilation() {
        let (service, runtime_home) = test_service();
        service
            .install_snapshot(
                test_snapshot(vec![
                    LocalSkillFile {
                        path: SKILL_MANIFEST_PATH.to_string(),
                        content: "# Test Skill\nUse it.\n".to_string(),
                    },
                    LocalSkillFile {
                        path: "guide.md".to_string(),
                        content: "Guide".to_string(),
                    },
                ]),
                Some("workspace-1"),
                false,
                false,
            )
            .expect("install");

        let workspace_1 = service
            .runtime_config_skills_for_workspace("workspace-1")
            .expect("workspace 1");
        let workspace_2 = service
            .runtime_config_skills_for_workspace("workspace-2")
            .expect("workspace 2");

        assert_eq!(workspace_1.skills.len(), 1);
        assert_eq!(
            workspace_1.skills.first().expect("skill").source_kind,
            RuntimeSkillSourceKind::SkillsSh
        );
        assert_eq!(workspace_1.artifact_payloads.len(), 2);
        assert!(workspace_2.skills.is_empty());
        let _ = fs::remove_dir_all(runtime_home);
    }

    #[test]
    fn install_snapshot_enforces_audit_confirmation_policy() {
        let (service, runtime_home) = test_service();
        let mut snapshot = test_snapshot(vec![LocalSkillFile {
            path: SKILL_MANIFEST_PATH.to_string(),
            content: "# Test Skill\n".to_string(),
        }]);

        snapshot.audit_status = LocalSkillAuditStatus::Fail;
        assert!(matches!(
            service.install_snapshot(snapshot.clone(), None, true, true),
            Err(LocalSkillError::AuditFailed)
        ));

        snapshot.audit_status = LocalSkillAuditStatus::Warn;
        assert!(matches!(
            service.install_snapshot(snapshot.clone(), None, false, false),
            Err(LocalSkillError::AuditConfirmationRequired(
                LocalSkillAuditStatus::Warn
            ))
        ));

        snapshot.audit_status = LocalSkillAuditStatus::Missing;
        assert!(matches!(
            service.install_snapshot(snapshot.clone(), None, false, false),
            Err(LocalSkillError::AuditConfirmationRequired(
                LocalSkillAuditStatus::Missing
            ))
        ));

        service
            .install_snapshot(snapshot, None, true, false)
            .expect("missing audit allowed");
        let installed = service.list_installed().expect("installed skills");
        assert_eq!(installed.len(), 1);
        let _ = fs::remove_dir_all(runtime_home);
    }

    #[test]
    fn delete_skill_removes_snapshot_and_workspace_enablement() {
        let (service, runtime_home) = test_service();
        let installed = service
            .install_snapshot(
                test_snapshot(vec![LocalSkillFile {
                    path: SKILL_MANIFEST_PATH.to_string(),
                    content: "# Test Skill\nUse it.\n".to_string(),
                }]),
                Some("workspace-1"),
                false,
                false,
            )
            .expect("install");
        let record = service
            .store
            .find_skill(&installed.skill_id)
            .expect("find")
            .expect("record");
        assert!(record.library_path.join(SKILL_MANIFEST_PATH).exists());

        assert!(service.delete_skill(&installed.skill_id).expect("delete"));

        assert!(!record.library_path.exists());
        assert!(service.list_installed().expect("installed").is_empty());
        assert!(service
            .runtime_config_skills_for_workspace("workspace-1")
            .expect("runtime skills")
            .skills
            .is_empty());
        let _ = fs::remove_dir_all(runtime_home);
    }

    fn test_service() -> (LocalSkillService, PathBuf) {
        let db = Db::open_in_memory().expect("db");
        let runtime_home = std::env::temp_dir().join(format!("skills-test-{}", Uuid::new_v4()));
        let service = LocalSkillService::new(
            LocalSkillStore::new(db),
            runtime_home.clone(),
            SkillsShClient::from_env(),
        );
        (service, runtime_home)
    }

    fn test_snapshot(files: Vec<LocalSkillFile>) -> LocalSkillSnapshot {
        LocalSkillSnapshot {
            skill_id: "owner/repo/test-skill".to_string(),
            source: "skills.sh".to_string(),
            slug: "test-skill".to_string(),
            display_name: Some("Test Skill".to_string()),
            description: Some("Fallback description".to_string()),
            install_url: None,
            source_url: None,
            hash: None,
            install_count: 0,
            audit_status: LocalSkillAuditStatus::Pass,
            audits: Vec::new(),
            files,
        }
    }
}
