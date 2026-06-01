use std::collections::{BTreeMap, HashSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model::{ArtifactError, ArtifactSummary, ArtifactType};

pub const ARTIFACT_MANIFEST_VERSION: u32 = 1;
pub const ARTIFACT_MANIFEST_RELATIVE_PATH: &str = ".proliferate/artifacts.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManifestDocument {
    pub version: u32,
    pub artifacts: BTreeMap<String, ArtifactManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManifestEntry {
    pub id: String,
    pub path: String,
    pub r#type: ArtifactType,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl ArtifactManifestDocument {
    pub fn empty() -> Self {
        Self {
            version: ARTIFACT_MANIFEST_VERSION,
            artifacts: BTreeMap::new(),
        }
    }
}

pub fn manifest_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(ARTIFACT_MANIFEST_RELATIVE_PATH)
}

pub fn load_manifest_if_present(
    workspace_root: &Path,
) -> Result<Option<ArtifactManifestDocument>, ArtifactError> {
    let manifest_path = manifest_path(workspace_root);
    if !manifest_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|error| ArtifactError::Io(error.to_string()))?;
    let manifest: ArtifactManifestDocument = serde_json::from_str(&content)
        .map_err(|error| ArtifactError::ManifestInvalid(error.to_string()))?;
    validate_manifest(&manifest)?;
    Ok(Some(manifest))
}

pub fn load_manifest_or_empty(
    workspace_root: &Path,
) -> Result<ArtifactManifestDocument, ArtifactError> {
    Ok(load_manifest_if_present(workspace_root)?.unwrap_or_else(ArtifactManifestDocument::empty))
}

pub fn validate_manifest(manifest: &ArtifactManifestDocument) -> Result<(), ArtifactError> {
    if manifest.version != ARTIFACT_MANIFEST_VERSION {
        return Err(ArtifactError::ManifestInvalid(format!(
            "unsupported manifest version: {}",
            manifest.version
        )));
    }

    let mut seen_paths = HashSet::new();
    for (key, entry) in &manifest.artifacts {
        if key != &entry.id {
            return Err(ArtifactError::ManifestInvalid(format!(
                "artifact key does not match id for {key}"
            )));
        }
        if entry.id.trim().is_empty() {
            return Err(ArtifactError::ManifestInvalid(
                "artifact id must not be blank".to_string(),
            ));
        }
        validate_relative_artifact_path(&entry.path)?;
        let derived_type = artifact_type_from_path(&entry.path)?;
        if derived_type != entry.r#type {
            return Err(ArtifactError::ManifestInvalid(format!(
                "artifact type mismatch for path {}",
                entry.path
            )));
        }
        if !seen_paths.insert(entry.path.clone()) {
            return Err(ArtifactError::ManifestInvalid(format!(
                "duplicate artifact path: {}",
                entry.path
            )));
        }
    }

    Ok(())
}

pub fn validate_relative_artifact_path(path: &str) -> Result<(), ArtifactError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(ArtifactError::InvalidPath(
            "path must not be blank".to_string(),
        ));
    }

    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err(ArtifactError::InvalidPath(trimmed.to_string()));
    }

    let mut parts = Vec::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => {
                let value = part.to_string_lossy();
                if value.trim().is_empty() {
                    return Err(ArtifactError::InvalidPath(trimmed.to_string()));
                }
                parts.push(value.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ArtifactError::InvalidPath(trimmed.to_string()));
            }
        }
    }

    if parts.is_empty() || parts.first().map(|value| value.as_str()) == Some(".proliferate") {
        return Err(ArtifactError::InvalidPath(trimmed.to_string()));
    }

    Ok(())
}

pub fn artifact_type_from_path(path: &str) -> Result<ArtifactType, ArtifactError> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".md") {
        return Ok(ArtifactType::TextMarkdown);
    }
    if lower.ends_with(".html") {
        return Ok(ArtifactType::TextHtml);
    }
    if lower.ends_with(".svg") {
        return Ok(ArtifactType::ImageSvgXml);
    }
    if lower.ends_with(".jsx") || lower.ends_with(".tsx") {
        return Ok(ArtifactType::ApplicationVndProliferateReact);
    }

    Err(ArtifactError::UnsupportedType(path.to_string()))
}

pub fn enrich_manifest_entry(
    workspace_root: &Path,
    entry: &ArtifactManifestEntry,
) -> ArtifactSummary {
    let path = workspace_root.join(&entry.path);
    let metadata = path.metadata().ok();
    let exists = metadata.is_some();
    let size_bytes = metadata
        .as_ref()
        .and_then(|value| value.is_file().then_some(value.len()));
    let modified_at = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|value| {
            chrono::DateTime::from_timestamp(value.as_secs() as i64, value.subsec_nanos())
                .map(|timestamp| timestamp.to_rfc3339())
        });

    ArtifactSummary {
        id: entry.id.clone(),
        path: entry.path.clone(),
        r#type: entry.r#type.clone(),
        title: entry.title.clone(),
        description: entry.description.clone(),
        created_at: entry.created_at.clone(),
        updated_at: entry.updated_at.clone(),
        exists,
        size_bytes,
        modified_at,
    }
}
