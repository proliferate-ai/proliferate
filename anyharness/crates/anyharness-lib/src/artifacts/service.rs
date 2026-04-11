use std::path::{Path, PathBuf};

use crate::artifacts::model::{
    ArtifactContentData, ArtifactManifest, ArtifactRendererKind, WorkspaceArtifactDetailData,
    WorkspaceArtifactSummaryData,
};
use crate::files::safety::{resolve_safe_path, SafetyError};
use crate::git::types::CommitError;
use crate::git::GitService;

#[derive(Debug, Clone)]
pub struct ArtifactMutationInput {
    pub id: String,
    pub title: String,
    pub renderer: ArtifactRendererKind,
    pub entry: String,
}

pub struct ArtifactService;

impl ArtifactService {
    pub fn new() -> Self {
        Self
    }

    pub fn list_workspace_artifacts(
        &self,
        workspace_root: &Path,
    ) -> Result<Vec<WorkspaceArtifactSummaryData>, ArtifactServiceError> {
        let artifacts_root = workspace_root.join(".artifacts");
        if !artifacts_root.exists() {
            return Ok(Vec::new());
        }
        if !artifacts_root.is_dir() {
            return Err(ArtifactServiceError::InvalidManifest(
                ".artifacts is not a directory".to_string(),
            ));
        }

        let mut summaries = Vec::new();
        let read_dir =
            std::fs::read_dir(&artifacts_root).map_err(|error| ArtifactServiceError::Io {
                detail: error.to_string(),
            })?;

        for entry in read_dir {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    tracing::warn!(error = %error, "failed to read artifact directory entry");
                    continue;
                }
            };

            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }

            let artifact_id = entry.file_name().to_string_lossy().to_string();
            match self.load_artifact_manifest(workspace_root, &artifact_id) {
                Ok(manifest) => summaries.push(WorkspaceArtifactSummaryData {
                    id: manifest.id,
                    title: manifest.title,
                    renderer: manifest.renderer,
                    entry: manifest.entry,
                    updated_at: manifest.updated_at,
                }),
                Err(error) => {
                    tracing::warn!(artifact_id = %artifact_id, error = %error, "skipping invalid artifact manifest");
                }
            }
        }

        summaries.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });

        Ok(summaries)
    }

    pub fn get_workspace_artifact(
        &self,
        workspace_root: &Path,
        artifact_id: &str,
    ) -> Result<WorkspaceArtifactDetailData, ArtifactServiceError> {
        let manifest = self.load_artifact_manifest(workspace_root, artifact_id)?;
        Ok(WorkspaceArtifactDetailData {
            id: manifest.id,
            title: manifest.title,
            kind: manifest.kind,
            renderer: manifest.renderer,
            entry: manifest.entry,
            created_at: manifest.created_at,
            updated_at: manifest.updated_at,
        })
    }

    pub fn read_workspace_artifact_content(
        &self,
        workspace_root: &Path,
        artifact_id: &str,
        relative_path: &str,
    ) -> Result<ArtifactContentData, ArtifactServiceError> {
        if relative_path.trim().is_empty() {
            return Err(ArtifactServiceError::NotAFile(relative_path.to_string()));
        }

        let artifact_root = self.resolve_artifact_root(workspace_root, artifact_id)?;
        let content_path = resolve_safe_path(&artifact_root, relative_path)
            .map_err(ArtifactServiceError::Safety)?;

        if !content_path.exists() {
            return Err(ArtifactServiceError::ArtifactNotFound(format!(
                "{artifact_id}/{relative_path}"
            )));
        }
        if content_path.is_dir() {
            return Err(ArtifactServiceError::NotAFile(relative_path.to_string()));
        }

        let bytes = std::fs::read(&content_path).map_err(|error| ArtifactServiceError::Io {
            detail: error.to_string(),
        })?;

        Ok(ArtifactContentData {
            content_type: infer_content_type(&content_path).to_string(),
            bytes,
        })
    }

    pub fn create_workspace_artifact(
        &self,
        workspace_root: &Path,
        input: &ArtifactMutationInput,
    ) -> Result<WorkspaceArtifactDetailData, ArtifactServiceError> {
        let artifact_root =
            self.resolve_existing_artifact_root_for_write(workspace_root, &input.id)?;
        let manifest_path = artifact_root.join("manifest.json");
        if manifest_path.exists() {
            return Err(ArtifactServiceError::ArtifactAlreadyExists(
                input.id.clone(),
            ));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let manifest = ArtifactManifest {
            version: 1,
            id: input.id.clone(),
            title: input.title.clone(),
            kind: "artifact".to_string(),
            renderer: input.renderer.clone(),
            entry: input.entry.clone(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.validate_manifest(&artifact_root, &input.id, &manifest)?;
        self.write_manifest(&manifest_path, &manifest)?;
        self.autosave_artifact(workspace_root, &input.id, "create")?;
        Ok(self.detail_from_manifest(manifest))
    }

    pub fn update_workspace_artifact(
        &self,
        workspace_root: &Path,
        input: &ArtifactMutationInput,
    ) -> Result<WorkspaceArtifactDetailData, ArtifactServiceError> {
        let artifact_root = self.resolve_artifact_root(workspace_root, &input.id)?;
        let existing = self.load_artifact_manifest(workspace_root, &input.id)?;
        let manifest_path = artifact_root.join("manifest.json");
        let manifest = ArtifactManifest {
            version: 1,
            id: input.id.clone(),
            title: input.title.clone(),
            kind: existing.kind,
            renderer: input.renderer.clone(),
            entry: input.entry.clone(),
            created_at: existing.created_at,
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        self.validate_manifest(&artifact_root, &input.id, &manifest)?;
        self.write_manifest(&manifest_path, &manifest)?;
        self.autosave_artifact(workspace_root, &input.id, "update")?;
        Ok(self.detail_from_manifest(manifest))
    }

    fn load_artifact_manifest(
        &self,
        workspace_root: &Path,
        artifact_id: &str,
    ) -> Result<ArtifactManifest, ArtifactServiceError> {
        let artifact_root = self.resolve_artifact_root(workspace_root, artifact_id)?;
        let manifest_path = artifact_root.join("manifest.json");
        if !manifest_path.exists() {
            return Err(ArtifactServiceError::ArtifactNotFound(
                artifact_id.to_string(),
            ));
        }

        let manifest_content =
            std::fs::read_to_string(&manifest_path).map_err(|error| ArtifactServiceError::Io {
                detail: error.to_string(),
            })?;
        let manifest: ArtifactManifest =
            serde_json::from_str(&manifest_content).map_err(|error| {
                ArtifactServiceError::InvalidManifest(format!("invalid manifest.json: {error}"))
            })?;
        self.validate_manifest(&artifact_root, artifact_id, &manifest)?;
        Ok(manifest)
    }

    fn resolve_artifact_root(
        &self,
        workspace_root: &Path,
        artifact_id: &str,
    ) -> Result<PathBuf, ArtifactServiceError> {
        if !is_valid_artifact_id(artifact_id) {
            return Err(ArtifactServiceError::InvalidArtifactId(
                artifact_id.to_string(),
            ));
        }

        let artifact_path = resolve_safe_path(workspace_root, &format!(".artifacts/{artifact_id}"))
            .map_err(ArtifactServiceError::Safety)?;

        if !artifact_path.exists() || !artifact_path.is_dir() {
            return Err(ArtifactServiceError::ArtifactNotFound(
                artifact_id.to_string(),
            ));
        }

        Ok(artifact_path)
    }

    fn resolve_existing_artifact_root_for_write(
        &self,
        workspace_root: &Path,
        artifact_id: &str,
    ) -> Result<PathBuf, ArtifactServiceError> {
        if !is_valid_artifact_id(artifact_id) {
            return Err(ArtifactServiceError::InvalidArtifactId(
                artifact_id.to_string(),
            ));
        }

        let artifact_path = resolve_safe_path(workspace_root, &format!(".artifacts/{artifact_id}"))
            .map_err(ArtifactServiceError::Safety)?;
        if !artifact_path.exists() || !artifact_path.is_dir() {
            return Err(ArtifactServiceError::ArtifactNotFound(
                artifact_id.to_string(),
            ));
        }

        Ok(artifact_path)
    }

    fn validate_manifest(
        &self,
        artifact_root: &Path,
        artifact_id: &str,
        manifest: &ArtifactManifest,
    ) -> Result<(), ArtifactServiceError> {
        if manifest.version != 1 {
            return Err(ArtifactServiceError::InvalidManifest(format!(
                "unsupported artifact manifest version: {}",
                manifest.version
            )));
        }

        if manifest.id != artifact_id {
            return Err(ArtifactServiceError::InvalidManifest(format!(
                "artifact manifest id '{}' does not match directory '{}'",
                manifest.id, artifact_id
            )));
        }

        let entry_path = resolve_safe_path(artifact_root, &manifest.entry)
            .map_err(ArtifactServiceError::Safety)?;
        if !entry_path.exists() || entry_path.is_dir() {
            return Err(ArtifactServiceError::InvalidManifest(format!(
                "artifact entry '{}' does not exist",
                manifest.entry
            )));
        }

        match manifest.renderer {
            ArtifactRendererKind::Text
            | ArtifactRendererKind::Markdown
            | ArtifactRendererKind::Code => {}
            ArtifactRendererKind::Html | ArtifactRendererKind::React => {
                validate_extension(&manifest.entry, &["html"])?;
            }
            ArtifactRendererKind::Svg => {
                validate_extension(&manifest.entry, &["svg"])?;
            }
            ArtifactRendererKind::Mermaid => {
                validate_extension(&manifest.entry, &["mmd", "mermaid"])?;
            }
        }

        Ok(())
    }

    fn write_manifest(
        &self,
        manifest_path: &Path,
        manifest: &ArtifactManifest,
    ) -> Result<(), ArtifactServiceError> {
        let contents =
            serde_json::to_string_pretty(manifest).map_err(|error| ArtifactServiceError::Io {
                detail: format!("serialize manifest: {error}"),
            })?;
        std::fs::write(manifest_path, format!("{contents}\n")).map_err(|error| {
            ArtifactServiceError::Io {
                detail: error.to_string(),
            }
        })?;
        Ok(())
    }

    fn detail_from_manifest(&self, manifest: ArtifactManifest) -> WorkspaceArtifactDetailData {
        WorkspaceArtifactDetailData {
            id: manifest.id,
            title: manifest.title,
            kind: manifest.kind,
            renderer: manifest.renderer,
            entry: manifest.entry,
            created_at: manifest.created_at,
            updated_at: manifest.updated_at,
        }
    }

    fn autosave_artifact(
        &self,
        workspace_root: &Path,
        artifact_id: &str,
        action: &str,
    ) -> Result<(), ArtifactServiceError> {
        let artifact_path = format!(".artifacts/{artifact_id}");
        GitService::stage_paths(workspace_root, &[artifact_path]).map_err(|error| {
            ArtifactServiceError::Io {
                detail: format!("stage artifact changes: {error}"),
            }
        })?;
        match GitService::commit_paths(
            workspace_root,
            &[format!(".artifacts/{artifact_id}")],
            &format!("cowork: {action} artifact {artifact_id}"),
            None,
        ) {
            Ok(_) | Err(CommitError::NothingStaged) => Ok(()),
            Err(error) => Err(ArtifactServiceError::Io {
                detail: format!("autosave artifact changes: {error}"),
            }),
        }
    }
}

#[derive(Debug)]
pub enum ArtifactServiceError {
    InvalidArtifactId(String),
    ArtifactAlreadyExists(String),
    ArtifactNotFound(String),
    InvalidManifest(String),
    NotAFile(String),
    Safety(SafetyError),
    Io { detail: String },
}

impl std::fmt::Display for ArtifactServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidArtifactId(id) => write!(f, "invalid artifact id: {id}"),
            Self::ArtifactAlreadyExists(id) => write!(f, "artifact already exists: {id}"),
            Self::ArtifactNotFound(id) => write!(f, "artifact not found: {id}"),
            Self::InvalidManifest(detail) => write!(f, "{detail}"),
            Self::NotAFile(path) => write!(f, "artifact content is not a file: {path}"),
            Self::Safety(error) => write!(f, "{error}"),
            Self::Io { detail } => write!(f, "{detail}"),
        }
    }
}

impl std::error::Error for ArtifactServiceError {}

impl ArtifactServiceError {
    pub fn status_code(&self) -> u16 {
        match self {
            Self::ArtifactAlreadyExists(_) => 409,
            Self::ArtifactNotFound(_) => 404,
            Self::InvalidArtifactId(_)
            | Self::InvalidManifest(_)
            | Self::NotAFile(_)
            | Self::Safety(_) => 400,
            Self::Io { .. } => 500,
        }
    }

    pub fn problem_code(&self) -> &'static str {
        match self {
            Self::ArtifactAlreadyExists(_) => "ARTIFACT_ALREADY_EXISTS",
            Self::ArtifactNotFound(_) => "ARTIFACT_NOT_FOUND",
            Self::InvalidArtifactId(_) => "INVALID_ARTIFACT_ID",
            Self::InvalidManifest(_) => "INVALID_ARTIFACT_MANIFEST",
            Self::NotAFile(_) => "ARTIFACT_NOT_A_FILE",
            Self::Safety(error) => error.problem_code(),
            Self::Io { .. } => "ARTIFACT_IO_ERROR",
        }
    }
}

fn is_valid_artifact_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|char| char.is_ascii_lowercase() || char.is_ascii_digit() || char == '-')
}

fn validate_extension(entry: &str, extensions: &[&str]) -> Result<(), ArtifactServiceError> {
    let has_valid_extension = Path::new(entry)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extensions.contains(&extension))
        .unwrap_or(false);

    if has_valid_extension {
        return Ok(());
    }

    Err(ArtifactServiceError::InvalidManifest(format!(
        "artifact entry '{}' must use one of: {}",
        entry,
        extensions.join(", ")
    )))
}

fn infer_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("json") => "application/json; charset=utf-8",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("txt") | Some("md") | Some("mmd") | Some("mermaid") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
