use std::path::Path;

use super::WorkspaceRuntime;
use crate::adapters::git::GitService;
use crate::domains::workspaces::detector;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::types::ProjectSetupDetectionResult;

impl WorkspaceRuntime {
    pub fn list_repo_root_workspaces(
        &self,
        repo_root_id: &str,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.store.list_by_repo_root_id(repo_root_id)
    }
    pub fn resolve_repo_root_default_branch(&self, repo_root_id: &str) -> anyhow::Result<String> {
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;
        let default_branch = GitService::detect_default_branch(Path::new(&repo_root.path))
            .ok_or_else(|| {
                anyhow::anyhow!("canonical repo default branch could not be resolved")
            })?;

        if repo_root.default_branch.as_deref() != Some(default_branch.as_str()) {
            let _ = self
                .repo_root_service
                .update_default_branch(&repo_root.id, Some(&default_branch))?;
        }

        Ok(default_branch)
    }

    pub fn detect_repo_root_setup(
        &self,
        repo_root_id: &str,
    ) -> anyhow::Result<ProjectSetupDetectionResult> {
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;
        Ok(detector::detect_project_setup(Path::new(&repo_root.path)))
    }
}
