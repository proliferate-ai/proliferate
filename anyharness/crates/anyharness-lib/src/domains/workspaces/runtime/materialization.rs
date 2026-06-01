use std::fs;
use std::path::Path;

use super::WorkspaceRuntime;
use crate::adapters::git::GitService;
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::domains::workspaces::model::WorkspaceRecord;

impl WorkspaceRuntime {
    pub fn retire_worktree_materialization(
        &self,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<()> {
        if workspace.kind != "worktree" {
            anyhow::bail!("unsupported workspace kind for retire: {}", workspace.kind);
        }
        let worktree = Path::new(&workspace.path);
        if !worktree.exists() {
            return Ok(());
        }
        let managed_root = canonical_managed_worktrees_root(&self.runtime_home)?;
        let canonical_worktree = fs::canonicalize(worktree).map_err(|error| {
            anyhow::anyhow!("canonicalizing workspace checkout path for retire: {error}")
        })?;
        if !canonical_worktree.starts_with(&managed_root) {
            anyhow::bail!(
                "refusing to remove worktree outside managed worktrees root: {}",
                workspace.path
            );
        }
        let output =
            GitService::remove_worktree_force(&workspace.source_repo_root_path, &workspace.path)?;
        if !output.success && worktree.exists() {
            anyhow::bail!(
                "failed to remove worktree materialization: {}",
                output.stderr
            );
        }
        Ok(())
    }
    pub fn cleanup_failed_worktree(
        &self,
        repo_root_path: &str,
        workspace_id: &str,
        worktree_path: &str,
    ) -> anyhow::Result<()> {
        self.remove_worktree_workspace(repo_root_path, workspace_id, worktree_path)
    }

    pub fn destroy_source_workspace_materialization(
        &self,
        workspace: &WorkspaceRecord,
        default_branch: Option<&str>,
    ) -> anyhow::Result<()> {
        match workspace.kind.as_str() {
            "worktree" => self.remove_worktree_workspace(
                &workspace.source_repo_root_path,
                &workspace.id,
                &workspace.path,
            ),
            "local" => {
                let branch = default_branch
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        anyhow::anyhow!("default branch is required to park a local workspace")
                    })?;
                self.park_local_workspace(workspace, branch)
            }
            kind => anyhow::bail!("unsupported workspace kind for mobility source destroy: {kind}"),
        }
    }

    fn remove_worktree_workspace(
        &self,
        repo_root_path: &str,
        workspace_id: &str,
        worktree_path: &str,
    ) -> anyhow::Result<()> {
        let worktree = Path::new(worktree_path);
        if worktree.exists() {
            let output = GitService::remove_worktree_force(repo_root_path, worktree_path)?;
            if !output.success && worktree.exists() {
                fs::remove_dir_all(worktree)?;
            }
        }
        GitService::prune_stale_worktrees_if_possible(Path::new(repo_root_path));

        if self.store.find_by_id(workspace_id)?.is_some() {
            self.delete_workflow.delete_workspace_record(workspace_id)?;
        }

        Ok(())
    }

    fn park_local_workspace(
        &self,
        workspace: &WorkspaceRecord,
        default_branch: &str,
    ) -> anyhow::Result<()> {
        let workspace_path = Path::new(&workspace.path);
        let local_branch_exists =
            GitService::ref_exists(workspace_path, &format!("refs/heads/{default_branch}"));
        let remote_branch_exists = GitService::ref_exists(
            workspace_path,
            &format!("refs/remotes/origin/{default_branch}"),
        );

        let switch_result = if local_branch_exists {
            GitService::switch_to_existing_branch(workspace_path, default_branch)
        } else if remote_branch_exists {
            GitService::switch_to_tracking_branch(
                workspace_path,
                default_branch,
                &format!("origin/{default_branch}"),
            )
        } else {
            anyhow::bail!(
                "default branch '{default_branch}' is not available locally or on origin"
            );
        };
        switch_result.map_err(|error| {
            anyhow::anyhow!(
                "failed to park local workspace on default branch '{default_branch}': {error}"
            )
        })?;

        self.delete_workflow
            .delete_workspace_record(&workspace.id)?;
        Ok(())
    }
}
