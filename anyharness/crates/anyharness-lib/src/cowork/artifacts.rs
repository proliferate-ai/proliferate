use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyharness_contract::v1::{
    CoworkArtifactDetailResponse, CoworkArtifactManifestResponse, CoworkArtifactSummary,
};
use uuid::Uuid;

use super::manifest::{
    artifact_type_from_path, enrich_manifest_entry, load_manifest_if_present,
    load_manifest_or_empty, manifest_path, validate_relative_artifact_path,
    ArtifactManifestDocument, ArtifactManifestEntry, CoworkArtifactError,
    COWORK_ARTIFACT_MANIFEST_RELATIVE_PATH, COWORK_ARTIFACT_MANIFEST_VERSION,
};
use crate::workspaces::model::WorkspaceRecord;

#[derive(Clone, Default)]
pub struct CoworkArtifactRuntime {
    workspace_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

#[derive(Debug, Clone)]
pub struct CreateCoworkArtifactInput {
    pub path: String,
    pub content: String,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateCoworkArtifactInput {
    pub id: String,
    pub content: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
}

impl CoworkArtifactRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_manifest(
        &self,
        workspace: &WorkspaceRecord,
    ) -> Result<CoworkArtifactManifestResponse, CoworkArtifactError> {
        ensure_cowork_workspace(workspace)?;
        let workspace_root = Path::new(&workspace.path);
        let manifest = load_manifest_or_empty(workspace_root)?;
        let mut artifacts: Vec<CoworkArtifactSummary> = manifest
            .artifacts
            .values()
            .map(|entry| enrich_manifest_entry(workspace_root, entry))
            .collect();
        artifacts.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(CoworkArtifactManifestResponse {
            version: COWORK_ARTIFACT_MANIFEST_VERSION,
            artifacts,
        })
    }

    pub fn get_artifact(
        &self,
        workspace: &WorkspaceRecord,
        artifact_id: &str,
    ) -> Result<CoworkArtifactDetailResponse, CoworkArtifactError> {
        ensure_cowork_workspace(workspace)?;
        let workspace_root = Path::new(&workspace.path);
        let manifest = load_manifest_or_empty(workspace_root)?;
        let entry = manifest
            .artifacts
            .get(artifact_id)
            .ok_or_else(|| CoworkArtifactError::ArtifactNotFound(artifact_id.to_string()))?;
        let artifact = enrich_manifest_entry(workspace_root, entry);
        if !artifact.exists {
            return Err(CoworkArtifactError::ArtifactFileInvalid(entry.path.clone()));
        }
        let content = std::fs::read_to_string(workspace_root.join(&entry.path))
            .map_err(|error| CoworkArtifactError::ArtifactFileInvalid(error.to_string()))?;
        Ok(CoworkArtifactDetailResponse { artifact, content })
    }

    pub fn create_artifact(
        &self,
        workspace: &WorkspaceRecord,
        input: CreateCoworkArtifactInput,
    ) -> Result<CoworkArtifactSummary, CoworkArtifactError> {
        ensure_cowork_workspace(workspace)?;
        let lock = self.workspace_lock(&workspace.id);
        let _guard = lock
            .lock()
            .map_err(|_| CoworkArtifactError::Io("artifact lock poisoned".to_string()))?;

        let workspace_root = Path::new(&workspace.path);
        let mut manifest = load_manifest_or_empty(workspace_root)?;
        validate_relative_artifact_path(&input.path)?;
        let artifact_type = artifact_type_from_path(&input.path)?;
        if manifest
            .artifacts
            .values()
            .any(|entry| entry.path == input.path)
        {
            return Err(CoworkArtifactError::PathAlreadyRegistered(input.path));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let entry = ArtifactManifestEntry {
            id: format!("art_{}", Uuid::new_v4().simple()),
            path: input.path,
            r#type: artifact_type,
            title: input.title.trim().to_string(),
            description: normalize_optional_text(input.description),
            created_at: now.clone(),
            updated_at: now,
        };
        manifest.artifacts.insert(entry.id.clone(), entry.clone());

        let target_path = workspace_root.join(&entry.path);
        let content_temp = write_temp_file(&target_path, &input.content)?;
        let manifest_temp = write_manifest_temp(workspace_root, &manifest)?;

        if let Err(error) = commit_create(
            &content_temp,
            &target_path,
            &manifest_temp,
            &manifest_path(workspace_root),
        ) {
            cleanup_temp_file(&content_temp);
            cleanup_temp_file(&manifest_temp);
            return Err(error);
        }

        Ok(enrich_manifest_entry(workspace_root, &entry))
    }

    pub fn update_artifact(
        &self,
        workspace: &WorkspaceRecord,
        input: UpdateCoworkArtifactInput,
    ) -> Result<CoworkArtifactSummary, CoworkArtifactError> {
        ensure_cowork_workspace(workspace)?;
        let lock = self.workspace_lock(&workspace.id);
        let _guard = lock
            .lock()
            .map_err(|_| CoworkArtifactError::Io("artifact lock poisoned".to_string()))?;

        let workspace_root = Path::new(&workspace.path);
        let mut manifest = load_manifest_or_empty(workspace_root)?;
        let current = manifest
            .artifacts
            .get(&input.id)
            .cloned()
            .ok_or_else(|| CoworkArtifactError::ArtifactNotFound(input.id.clone()))?;

        let updated_entry = ArtifactManifestEntry {
            id: current.id.clone(),
            path: current.path.clone(),
            r#type: current.r#type.clone(),
            title: input
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| current.title.clone()),
            description: input
                .description
                .map(|value| normalize_optional_text(Some(value)))
                .unwrap_or_else(|| current.description.clone()),
            created_at: current.created_at.clone(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        manifest
            .artifacts
            .insert(updated_entry.id.clone(), updated_entry.clone());

        let target_path = workspace_root.join(&updated_entry.path);
        let content_temp = input
            .content
            .as_ref()
            .map(|content| write_temp_file(&target_path, content))
            .transpose()?;
        let manifest_temp = write_manifest_temp(workspace_root, &manifest)?;

        if let Err(error) = commit_update(
            content_temp.as_deref(),
            &target_path,
            &manifest_temp,
            &manifest_path(workspace_root),
        ) {
            if let Some(temp) = content_temp.as_ref() {
                cleanup_temp_file(temp);
            }
            cleanup_temp_file(&manifest_temp);
            return Err(error);
        }

        Ok(enrich_manifest_entry(workspace_root, &updated_entry))
    }

    pub fn delete_artifact(
        &self,
        workspace: &WorkspaceRecord,
        artifact_id: &str,
    ) -> Result<(), CoworkArtifactError> {
        ensure_cowork_workspace(workspace)?;
        let lock = self.workspace_lock(&workspace.id);
        let _guard = lock
            .lock()
            .map_err(|_| CoworkArtifactError::Io("artifact lock poisoned".to_string()))?;

        let workspace_root = Path::new(&workspace.path);
        let mut manifest = load_manifest_or_empty(workspace_root)?;
        let Some(entry) = manifest.artifacts.remove(artifact_id) else {
            return Ok(());
        };
        let manifest_temp = write_manifest_temp(workspace_root, &manifest)?;
        let target_path = workspace_root.join(&entry.path);

        if let Err(error) =
            commit_delete(&target_path, &manifest_temp, &manifest_path(workspace_root))
        {
            cleanup_temp_file(&manifest_temp);
            return Err(error);
        }

        Ok(())
    }

    pub fn is_protected_relative_path(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> Result<bool, CoworkArtifactError> {
        ensure_cowork_workspace(workspace)?;
        let normalized = normalize_compare_path(relative_path);
        if normalized == COWORK_ARTIFACT_MANIFEST_RELATIVE_PATH {
            return Ok(true);
        }

        let workspace_root = Path::new(&workspace.path);
        let Some(manifest) = load_manifest_if_present(workspace_root)? else {
            return Ok(false);
        };

        Ok(manifest
            .artifacts
            .values()
            .any(|entry| normalize_compare_path(&entry.path) == normalized))
    }

    fn workspace_lock(&self, workspace_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self
            .workspace_locks
            .lock()
            .expect("cowork artifact lock map should not be poisoned");
        locks
            .entry(workspace_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

fn ensure_cowork_workspace(workspace: &WorkspaceRecord) -> Result<(), CoworkArtifactError> {
    if workspace.surface != "cowork" {
        return Err(CoworkArtifactError::WorkspaceNotCowork);
    }
    Ok(())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_compare_path(path: &str) -> String {
    let candidate = Path::new(path.trim());
    let mut parts = Vec::new();
    for component in candidate.components() {
        if let std::path::Component::Normal(part) = component {
            parts.push(part.to_string_lossy().to_string());
        }
    }
    parts.join("/")
}

fn temp_path_for(target_path: &Path) -> Result<PathBuf, CoworkArtifactError> {
    let parent = target_path
        .parent()
        .ok_or_else(|| CoworkArtifactError::Io("cannot determine parent directory".to_string()))?;
    std::fs::create_dir_all(parent).map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
    Ok(parent.join(format!(".cowork-artifact-{}.tmp", Uuid::new_v4().simple())))
}

fn write_temp_file(target_path: &Path, content: &str) -> Result<PathBuf, CoworkArtifactError> {
    let temp_path = temp_path_for(target_path)?;
    std::fs::write(&temp_path, content.as_bytes())
        .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
    Ok(temp_path)
}

fn write_manifest_temp(
    workspace_root: &Path,
    manifest: &ArtifactManifestDocument,
) -> Result<PathBuf, CoworkArtifactError> {
    let manifest_path = manifest_path(workspace_root);
    let temp_path = temp_path_for(&manifest_path)?;
    let content = serde_json::to_vec_pretty(manifest)
        .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
    std::fs::write(&temp_path, content)
        .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
    Ok(temp_path)
}

fn cleanup_temp_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}

fn commit_create(
    content_temp: &Path,
    target_path: &Path,
    manifest_temp: &Path,
    manifest_path: &Path,
) -> Result<(), CoworkArtifactError> {
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
    }
    std::fs::rename(content_temp, target_path)
        .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
    if let Err(error) = std::fs::rename(manifest_temp, manifest_path) {
        let _ = std::fs::remove_file(target_path);
        return Err(CoworkArtifactError::Io(error.to_string()));
    }
    Ok(())
}

fn commit_update(
    content_temp: Option<&Path>,
    target_path: &Path,
    manifest_temp: &Path,
    manifest_path: &Path,
) -> Result<(), CoworkArtifactError> {
    let backup_path = if let Some(content_temp) = content_temp {
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
        }
        let backup_path = temp_path_for(target_path)?;
        if target_path.exists() {
            std::fs::rename(target_path, &backup_path)
                .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
        }
        if let Err(error) = std::fs::rename(content_temp, target_path) {
            if backup_path.exists() {
                let _ = std::fs::rename(&backup_path, target_path);
            }
            return Err(CoworkArtifactError::Io(error.to_string()));
        }
        Some(backup_path)
    } else {
        None
    };

    if let Err(error) = std::fs::rename(manifest_temp, manifest_path) {
        if let Some(backup_path) = backup_path.as_ref() {
            let _ = std::fs::remove_file(target_path);
            if backup_path.exists() {
                let _ = std::fs::rename(backup_path, target_path);
            }
        }
        return Err(CoworkArtifactError::Io(error.to_string()));
    }

    if let Some(backup_path) = backup_path {
        cleanup_temp_file(&backup_path);
    }
    Ok(())
}

fn commit_delete(
    target_path: &Path,
    manifest_temp: &Path,
    manifest_path: &Path,
) -> Result<(), CoworkArtifactError> {
    let backup_path = if target_path.exists() {
        let backup_path = temp_path_for(target_path)?;
        std::fs::rename(target_path, &backup_path)
            .map_err(|error| CoworkArtifactError::Io(error.to_string()))?;
        Some(backup_path)
    } else {
        None
    };

    if let Err(error) = std::fs::rename(manifest_temp, manifest_path) {
        if let Some(backup_path) = backup_path.as_ref() {
            if backup_path.exists() {
                let _ = std::fs::rename(backup_path, target_path);
            }
        }
        return Err(CoworkArtifactError::Io(error.to_string()));
    }

    if let Some(backup_path) = backup_path {
        cleanup_temp_file(&backup_path);
    }
    Ok(())
}
