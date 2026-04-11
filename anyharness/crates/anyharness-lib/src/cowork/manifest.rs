use std::collections::{BTreeMap, HashSet};
use std::path::{Component, Path, PathBuf};

use anyharness_contract::v1::{CoworkArtifactSummary, CoworkArtifactType};
use serde::{Deserialize, Serialize};

pub const COWORK_ARTIFACT_MANIFEST_VERSION: u32 = 1;
pub const COWORK_ARTIFACT_MANIFEST_RELATIVE_PATH: &str = ".proliferate/artifacts.json";

#[derive(Debug, thiserror::Error)]
pub enum CoworkArtifactError {
    #[error("workspace is not a cowork workspace")]
    WorkspaceNotCowork,
    #[error("cowork artifact manifest is invalid: {0}")]
    ManifestInvalid(String),
    #[error("artifact path is invalid: {0}")]
    InvalidPath(String),
    #[error("artifact type is unsupported for path: {0}")]
    UnsupportedType(String),
    #[error("artifact already exists for path: {0}")]
    PathAlreadyRegistered(String),
    #[error("artifact not found: {0}")]
    ArtifactNotFound(String),
    #[error("artifact file is invalid: {0}")]
    ArtifactFileInvalid(String),
    #[error("artifact path is protected: {0}")]
    ProtectedPath(String),
    #[error("{0}")]
    Io(String),
}

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
    pub r#type: CoworkArtifactType,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl ArtifactManifestDocument {
    pub fn empty() -> Self {
        Self {
            version: COWORK_ARTIFACT_MANIFEST_VERSION,
            artifacts: BTreeMap::new(),
        }
    }
}

pub fn manifest_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(COWORK_ARTIFACT_MANIFEST_RELATIVE_PATH)
}

pub fn load_manifest_if_present(
    workspace_root: &Path,
) -> Result<Option<ArtifactManifestDocument>, CoworkArtifactError> {
    let manifest_path = manifest_path(workspace_root);
    if !manifest_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
    let manifest: ArtifactManifestDocument = serde_json::from_str(&content)
        .map_err(|error| CoworkArtifactError::ManifestInvalid(error.to_string()))?;
    validate_manifest(&manifest)?;
    Ok(Some(manifest))
}

pub fn load_manifest_or_empty(
    workspace_root: &Path,
) -> Result<ArtifactManifestDocument, CoworkArtifactError> {
    Ok(load_manifest_if_present(workspace_root)?.unwrap_or_else(ArtifactManifestDocument::empty))
}

pub fn validate_manifest(manifest: &ArtifactManifestDocument) -> Result<(), CoworkArtifactError> {
    if manifest.version != COWORK_ARTIFACT_MANIFEST_VERSION {
        return Err(CoworkArtifactError::ManifestInvalid(format!(
            "unsupported manifest version: {}",
            manifest.version
        )));
    }

    let mut seen_paths = HashSet::new();
    for (key, entry) in &manifest.artifacts {
        if key != &entry.id {
            return Err(CoworkArtifactError::ManifestInvalid(format!(
                "artifact key does not match id for {key}"
            )));
        }
        if entry.id.trim().is_empty() {
            return Err(CoworkArtifactError::ManifestInvalid(
                "artifact id must not be blank".to_string(),
            ));
        }
        validate_relative_artifact_path(&entry.path)?;
        let derived_type = artifact_type_from_path(&entry.path)?;
        if derived_type != entry.r#type {
            return Err(CoworkArtifactError::ManifestInvalid(format!(
                "artifact type mismatch for path {}",
                entry.path
            )));
        }
        if !seen_paths.insert(entry.path.clone()) {
            return Err(CoworkArtifactError::ManifestInvalid(format!(
                "duplicate artifact path: {}",
                entry.path
            )));
        }
    }

    Ok(())
}

pub fn validate_relative_artifact_path(path: &str) -> Result<(), CoworkArtifactError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(CoworkArtifactError::InvalidPath(
            "path must not be blank".to_string(),
        ));
    }

    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err(CoworkArtifactError::InvalidPath(trimmed.to_string()));
    }

    let mut parts = Vec::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => {
                let value = part.to_string_lossy();
                if value.trim().is_empty() {
                    return Err(CoworkArtifactError::InvalidPath(trimmed.to_string()));
                }
                parts.push(value.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(CoworkArtifactError::InvalidPath(trimmed.to_string()));
            }
        }
    }

    if parts.is_empty() || parts.first().map(|value| value.as_str()) == Some(".proliferate") {
        return Err(CoworkArtifactError::InvalidPath(trimmed.to_string()));
    }

    Ok(())
}

pub fn artifact_type_from_path(path: &str) -> Result<CoworkArtifactType, CoworkArtifactError> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".md") {
        return Ok(CoworkArtifactType::TextMarkdown);
    }
    if lower.ends_with(".html") {
        return Ok(CoworkArtifactType::TextHtml);
    }
    if lower.ends_with(".svg") {
        return Ok(CoworkArtifactType::ImageSvgXml);
    }
    if lower.ends_with(".jsx") || lower.ends_with(".tsx") {
        return Ok(CoworkArtifactType::ApplicationVndProliferateReact);
    }

    Err(CoworkArtifactError::UnsupportedType(path.to_string()))
}

pub fn enrich_manifest_entry(
    workspace_root: &Path,
    entry: &ArtifactManifestEntry,
) -> CoworkArtifactSummary {
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

    CoworkArtifactSummary {
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
