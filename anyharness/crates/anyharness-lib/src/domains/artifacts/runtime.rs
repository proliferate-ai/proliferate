use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::manifest::{
    enrich_manifest_entry, load_manifest_or_empty, manifest_path, ArtifactManifestDocument,
};
use super::model::{
    ArtifactDetail, ArtifactError, ArtifactManifest, ArtifactSummary, CreateArtifactInput,
    UpdateArtifactInput,
};
use super::service::ArtifactService;
use crate::domains::workspaces::model::WorkspaceRecord;

#[derive(Clone, Default)]
pub struct ArtifactRuntime {
    workspace_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl ArtifactRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_manifest(
        &self,
        workspace: &WorkspaceRecord,
    ) -> Result<ArtifactManifest, ArtifactError> {
        let workspace_root = Path::new(&workspace.path);
        let manifest = load_manifest_or_empty(workspace_root)?;
        Ok(ArtifactService::manifest_read_model(
            workspace_root,
            &manifest,
        ))
    }

    pub fn get_artifact(
        &self,
        workspace: &WorkspaceRecord,
        artifact_id: &str,
    ) -> Result<ArtifactDetail, ArtifactError> {
        let workspace_root = Path::new(&workspace.path);
        let manifest = load_manifest_or_empty(workspace_root)?;
        ArtifactService::artifact_detail(workspace_root, &manifest, artifact_id)
    }

    pub fn create_artifact(
        &self,
        workspace: &WorkspaceRecord,
        input: CreateArtifactInput,
    ) -> Result<ArtifactSummary, ArtifactError> {
        let lock = self.workspace_lock(&workspace.id);
        let _guard = lock
            .lock()
            .map_err(|_| ArtifactError::Io("artifact lock poisoned".to_string()))?;

        let workspace_root = Path::new(&workspace.path);
        let mut manifest = load_manifest_or_empty(workspace_root)?;
        let plan = ArtifactService::plan_create(&mut manifest, input)?;

        let target_path = workspace_root.join(&plan.entry.path);
        let content_temp = write_temp_file(&target_path, &plan.content)?;
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

        Ok(enrich_manifest_entry(workspace_root, &plan.entry))
    }

    pub fn update_artifact(
        &self,
        workspace: &WorkspaceRecord,
        input: UpdateArtifactInput,
    ) -> Result<ArtifactSummary, ArtifactError> {
        let lock = self.workspace_lock(&workspace.id);
        let _guard = lock
            .lock()
            .map_err(|_| ArtifactError::Io("artifact lock poisoned".to_string()))?;

        let workspace_root = Path::new(&workspace.path);
        let mut manifest = load_manifest_or_empty(workspace_root)?;
        let plan = ArtifactService::plan_update(&mut manifest, input)?;

        let target_path = workspace_root.join(&plan.entry.path);
        let content_temp = plan
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

        Ok(enrich_manifest_entry(workspace_root, &plan.entry))
    }

    pub fn delete_artifact(
        &self,
        workspace: &WorkspaceRecord,
        artifact_id: &str,
    ) -> Result<(), ArtifactError> {
        let lock = self.workspace_lock(&workspace.id);
        let _guard = lock
            .lock()
            .map_err(|_| ArtifactError::Io("artifact lock poisoned".to_string()))?;

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

    fn workspace_lock(&self, workspace_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self
            .workspace_locks
            .lock()
            .expect("artifact lock map should not be poisoned");
        locks
            .entry(workspace_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

fn temp_path_for(target_path: &Path) -> Result<PathBuf, ArtifactError> {
    let parent = target_path
        .parent()
        .ok_or_else(|| ArtifactError::Io("cannot determine parent directory".to_string()))?;
    std::fs::create_dir_all(parent).map_err(|error| ArtifactError::Io(error.to_string()))?;
    Ok(parent.join(format!(".cowork-artifact-{}.tmp", Uuid::new_v4().simple())))
}

fn write_temp_file(target_path: &Path, content: &str) -> Result<PathBuf, ArtifactError> {
    let temp_path = temp_path_for(target_path)?;
    std::fs::write(&temp_path, content.as_bytes())
        .map_err(|error| ArtifactError::Io(error.to_string()))?;
    Ok(temp_path)
}

fn write_manifest_temp(
    workspace_root: &Path,
    manifest: &ArtifactManifestDocument,
) -> Result<PathBuf, ArtifactError> {
    let manifest_path = manifest_path(workspace_root);
    let temp_path = temp_path_for(&manifest_path)?;
    let content = serde_json::to_vec_pretty(manifest)
        .map_err(|error| ArtifactError::Io(error.to_string()))?;
    std::fs::write(&temp_path, content).map_err(|error| ArtifactError::Io(error.to_string()))?;
    Ok(temp_path)
}

fn cleanup_temp_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceSurface,
    };

    #[test]
    fn create_update_delete_round_trips_file_and_manifest() {
        let workspace = TestWorkspace::new();
        let runtime = ArtifactRuntime::new();
        let created = runtime
            .create_artifact(
                workspace.record(),
                CreateArtifactInput {
                    path: "reports/plan.md".to_string(),
                    content: "plan".to_string(),
                    title: "Plan".to_string(),
                    description: None,
                },
            )
            .expect("create artifact");
        assert_eq!(created.path, "reports/plan.md");

        let detail = runtime
            .get_artifact(workspace.record(), &created.id)
            .expect("read artifact");
        assert_eq!(detail.content, "plan");

        let updated = runtime
            .update_artifact(
                workspace.record(),
                UpdateArtifactInput {
                    id: created.id.clone(),
                    content: Some("updated".to_string()),
                    title: Some("Updated Plan".to_string()),
                    description: Some("next".to_string()),
                },
            )
            .expect("update artifact");
        assert_eq!(updated.path, "reports/plan.md");
        assert_eq!(updated.title, "Updated Plan");

        let detail = runtime
            .get_artifact(workspace.record(), &created.id)
            .expect("read updated artifact");
        assert_eq!(detail.content, "updated");

        runtime
            .delete_artifact(workspace.record(), &created.id)
            .expect("delete artifact");
        runtime
            .delete_artifact(workspace.record(), &created.id)
            .expect("delete is idempotent");
        assert!(matches!(
            runtime.get_artifact(workspace.record(), &created.id),
            Err(ArtifactError::ArtifactNotFound(_))
        ));
    }

    struct TestWorkspace {
        path: PathBuf,
        record: WorkspaceRecord,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-artifacts-runtime-test-{}",
                Uuid::new_v4()
            ));
            std::fs::create_dir(&path).expect("create temp workspace");
            let now = chrono::Utc::now().to_rfc3339();
            let record = WorkspaceRecord {
                id: format!("workspace-{}", Uuid::new_v4()),
                kind: WorkspaceKind::Local,
                repo_root_id: format!("repo-root-{}", Uuid::new_v4()),
                path: path.to_string_lossy().to_string(),
                surface: WorkspaceSurface::Cowork,
                original_branch: None,
                current_branch: None,
                display_name: None,
                origin: None,
                creator_context: None,
                lifecycle_state: WorkspaceLifecycleState::Active,
                cleanup_state: WorkspaceCleanupState::None,
                cleanup_operation: None,
                cleanup_error_message: None,
                cleanup_failed_at: None,
                cleanup_attempted_at: None,
                created_at: now.clone(),
                updated_at: now,
            };
            Self { path, record }
        }

        fn record(&self) -> &WorkspaceRecord {
            &self.record
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn commit_create(
    content_temp: &Path,
    target_path: &Path,
    manifest_temp: &Path,
    manifest_path: &Path,
) -> Result<(), ArtifactError> {
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| ArtifactError::Io(error.to_string()))?;
    }
    std::fs::rename(content_temp, target_path)
        .map_err(|error| ArtifactError::Io(error.to_string()))?;
    if let Err(error) = std::fs::rename(manifest_temp, manifest_path) {
        let _ = std::fs::remove_file(target_path);
        return Err(ArtifactError::Io(error.to_string()));
    }
    Ok(())
}

fn commit_update(
    content_temp: Option<&Path>,
    target_path: &Path,
    manifest_temp: &Path,
    manifest_path: &Path,
) -> Result<(), ArtifactError> {
    let backup_path = if let Some(content_temp) = content_temp {
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| ArtifactError::Io(error.to_string()))?;
        }
        let backup_path = temp_path_for(target_path)?;
        if target_path.exists() {
            std::fs::rename(target_path, &backup_path)
                .map_err(|error| ArtifactError::Io(error.to_string()))?;
        }
        if let Err(error) = std::fs::rename(content_temp, target_path) {
            if backup_path.exists() {
                let _ = std::fs::rename(&backup_path, target_path);
            }
            return Err(ArtifactError::Io(error.to_string()));
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
        return Err(ArtifactError::Io(error.to_string()));
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
) -> Result<(), ArtifactError> {
    let backup_path = if target_path.exists() {
        let backup_path = temp_path_for(target_path)?;
        std::fs::rename(target_path, &backup_path)
            .map_err(|error| ArtifactError::Io(error.to_string()))?;
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
        return Err(ArtifactError::Io(error.to_string()));
    }

    if let Some(backup_path) = backup_path {
        cleanup_temp_file(&backup_path);
    }
    Ok(())
}
