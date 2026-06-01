use std::path::Path;
use std::sync::Arc;

use super::manifest::{load_manifest_if_present, ARTIFACT_MANIFEST_RELATIVE_PATH};
use super::model::ArtifactError;
use crate::domains::workspaces::files_runtime::WorkspaceFileProtection;
use crate::domains::workspaces::model::WorkspaceRecord;

#[derive(Clone)]
pub struct ArtifactProtectionService {
    protected_surfaces: Arc<[String]>,
}

impl ArtifactProtectionService {
    pub fn for_surfaces(surfaces: impl IntoIterator<Item = impl Into<String>>) -> Self {
        let protected_surfaces: Vec<String> = surfaces.into_iter().map(Into::into).collect();
        Self {
            protected_surfaces: protected_surfaces.into(),
        }
    }

    pub fn is_protected_relative_path(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> Result<bool, ArtifactError> {
        if !self.protects_workspace(workspace) {
            return Ok(false);
        }

        let normalized = normalize_compare_path(relative_path);
        if normalized == ARTIFACT_MANIFEST_RELATIVE_PATH {
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

    pub fn is_protected_relative_path_or_ancestor(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> Result<bool, ArtifactError> {
        if !self.protects_workspace(workspace) {
            return Ok(false);
        }

        let normalized = normalize_compare_path(relative_path);
        if is_same_or_ancestor_path(&normalized, ARTIFACT_MANIFEST_RELATIVE_PATH) {
            return Ok(true);
        }

        let workspace_root = Path::new(&workspace.path);
        let Some(manifest) = load_manifest_if_present(workspace_root)? else {
            return Ok(false);
        };

        Ok(manifest.artifacts.values().any(|entry| {
            is_same_or_ancestor_path(&normalized, &normalize_compare_path(&entry.path))
        }))
    }

    fn protects_workspace(&self, workspace: &WorkspaceRecord) -> bool {
        self.protected_surfaces
            .iter()
            .any(|surface| surface == &workspace.surface)
    }
}

impl WorkspaceFileProtection for ArtifactProtectionService {
    fn is_protected_relative_path(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> anyhow::Result<bool> {
        Ok(ArtifactProtectionService::is_protected_relative_path(
            self,
            workspace,
            relative_path,
        )?)
    }

    fn is_protected_relative_path_or_ancestor(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> anyhow::Result<bool> {
        Ok(
            ArtifactProtectionService::is_protected_relative_path_or_ancestor(
                self,
                workspace,
                relative_path,
            )?,
        )
    }
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

fn is_same_or_ancestor_path(candidate: &str, protected_path: &str) -> bool {
    candidate == protected_path || protected_path.starts_with(&format!("{candidate}/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::artifacts::model::CreateArtifactInput;
    use crate::domains::artifacts::runtime::ArtifactRuntime;
    use uuid::Uuid;

    #[test]
    fn protected_path_or_ancestor_matches_manifest_and_artifact_ancestors() {
        let workspace = TestWorkspace::new("cowork");
        let runtime = ArtifactRuntime::new();
        runtime
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

        let protection = ArtifactProtectionService::for_surfaces(["cowork"]);
        assert!(protection
            .is_protected_relative_path_or_ancestor(workspace.record(), "reports")
            .expect("check reports"));
        assert!(protection
            .is_protected_relative_path_or_ancestor(workspace.record(), "reports/plan.md")
            .expect("check artifact"));
        assert!(protection
            .is_protected_relative_path_or_ancestor(workspace.record(), ".proliferate")
            .expect("check manifest parent"));
        assert!(!protection
            .is_protected_relative_path_or_ancestor(workspace.record(), "reports-plan")
            .expect("check sibling prefix"));

        let mut standard_workspace = workspace.record().clone();
        standard_workspace.surface = "standard".to_string();
        assert!(
            !<ArtifactProtectionService as WorkspaceFileProtection>::is_protected_relative_path_or_ancestor(
                &protection,
                &standard_workspace,
                ".proliferate",
            )
            .expect("standard workspaces keep current protection behavior")
        );
    }

    struct TestWorkspace {
        path: std::path::PathBuf,
        record: WorkspaceRecord,
    }

    impl TestWorkspace {
        fn new(surface: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-artifacts-protection-test-{}",
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
