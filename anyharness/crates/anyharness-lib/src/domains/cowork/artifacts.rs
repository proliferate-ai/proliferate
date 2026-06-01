use std::sync::Arc;

use crate::domains::artifacts::model::{
    ArtifactDetail, ArtifactError, ArtifactManifest, ArtifactSummary, CreateArtifactInput,
    UpdateArtifactInput,
};
use crate::domains::artifacts::runtime::ArtifactRuntime;
use crate::workspaces::model::WorkspaceRecord;

pub type CreateCoworkArtifactInput = CreateArtifactInput;
pub type UpdateCoworkArtifactInput = UpdateArtifactInput;
pub type CoworkArtifactManifest = ArtifactManifest;
pub type CoworkArtifactDetail = ArtifactDetail;
pub type CoworkArtifactSummary = ArtifactSummary;

#[derive(Clone)]
pub struct CoworkArtifactRuntime {
    artifact_runtime: Arc<ArtifactRuntime>,
}

impl CoworkArtifactRuntime {
    pub fn new() -> Self {
        Self::from_artifact_runtime(Arc::new(ArtifactRuntime::new()))
    }

    pub fn from_artifact_runtime(artifact_runtime: Arc<ArtifactRuntime>) -> Self {
        Self { artifact_runtime }
    }

    pub fn get_manifest(
        &self,
        workspace: &WorkspaceRecord,
    ) -> Result<CoworkArtifactManifest, ArtifactError> {
        ensure_cowork_workspace(workspace)?;
        self.artifact_runtime.get_manifest(workspace)
    }

    pub fn get_artifact(
        &self,
        workspace: &WorkspaceRecord,
        artifact_id: &str,
    ) -> Result<CoworkArtifactDetail, ArtifactError> {
        ensure_cowork_workspace(workspace)?;
        self.artifact_runtime.get_artifact(workspace, artifact_id)
    }

    pub fn create_artifact(
        &self,
        workspace: &WorkspaceRecord,
        input: CreateCoworkArtifactInput,
    ) -> Result<CoworkArtifactSummary, ArtifactError> {
        ensure_cowork_workspace(workspace)?;
        self.artifact_runtime.create_artifact(workspace, input)
    }

    pub fn update_artifact(
        &self,
        workspace: &WorkspaceRecord,
        input: UpdateCoworkArtifactInput,
    ) -> Result<CoworkArtifactSummary, ArtifactError> {
        ensure_cowork_workspace(workspace)?;
        self.artifact_runtime.update_artifact(workspace, input)
    }

    pub fn delete_artifact(
        &self,
        workspace: &WorkspaceRecord,
        artifact_id: &str,
    ) -> Result<(), ArtifactError> {
        ensure_cowork_workspace(workspace)?;
        self.artifact_runtime
            .delete_artifact(workspace, artifact_id)
    }
}

impl Default for CoworkArtifactRuntime {
    fn default() -> Self {
        Self::new()
    }
}

fn ensure_cowork_workspace(workspace: &WorkspaceRecord) -> Result<(), ArtifactError> {
    if workspace.surface != "cowork" {
        return Err(ArtifactError::WorkspaceNotCowork);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn compatibility_wrapper_rejects_non_cowork_workspaces() {
        let workspace = TestWorkspace::new("standard");
        let runtime = CoworkArtifactRuntime::new();
        let error = runtime
            .get_manifest(workspace.record())
            .expect_err("standard workspace rejected");
        assert!(matches!(error, ArtifactError::WorkspaceNotCowork));
    }

    struct TestWorkspace {
        path: std::path::PathBuf,
        record: WorkspaceRecord,
    }

    impl TestWorkspace {
        fn new(surface: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-cowork-artifacts-compat-test-{}",
                Uuid::new_v4()
            ));
            std::fs::create_dir(&path).expect("create temp workspace");
            let now = chrono::Utc::now().to_rfc3339();
            let record = WorkspaceRecord {
                id: format!("workspace-{}", Uuid::new_v4()),
                kind: "local".to_string(),
                repo_root_id: None,
                path: path.to_string_lossy().to_string(),
                surface: surface.to_string(),
                source_repo_root_path: path.to_string_lossy().to_string(),
                source_workspace_id: None,
                git_provider: None,
                git_owner: None,
                git_repo_name: None,
                original_branch: None,
                current_branch: None,
                display_name: None,
                origin: None,
                creator_context: None,
                lifecycle_state: "ready".to_string(),
                cleanup_state: "none".to_string(),
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
