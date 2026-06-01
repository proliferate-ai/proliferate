use std::path::Path;
use std::time::Instant;

use super::records::{build_workspace_record, reconcile_current_branch};
use super::{WorkspaceResolution, WorkspaceRuntime};
use crate::adapters::git::GitService;
use crate::domains::repo_roots::model::{CreateRepoRootInput, RepoRootRecord};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::ResolvedGitContext;
use crate::domains::workspaces::resolver;
use crate::domains::workspaces::types::ResolveRepoRootError;
use crate::origin::OriginContext;

impl WorkspaceRuntime {
    pub fn resolve_from_path(&self, path: &str) -> anyhow::Result<WorkspaceResolution> {
        self.resolve_from_path_with_origin(path, OriginContext::api_local_runtime())
    }

    pub fn resolve_from_path_with_origin(
        &self,
        path: &str,
        origin: OriginContext,
    ) -> anyhow::Result<WorkspaceResolution> {
        self.resolve_or_create_workspace(path, true, origin, None)
    }

    pub fn resolve_from_path_with_origin_and_creator_context(
        &self,
        path: &str,
        origin: OriginContext,
        creator_context: Option<WorkspaceCreatorContext>,
    ) -> anyhow::Result<WorkspaceResolution> {
        self.resolve_or_create_workspace(path, true, origin, creator_context)
    }

    pub fn create_workspace(&self, path: &str) -> anyhow::Result<WorkspaceResolution> {
        self.create_workspace_with_origin(path, OriginContext::api_local_runtime())
    }

    pub fn create_workspace_with_origin(
        &self,
        path: &str,
        origin: OriginContext,
    ) -> anyhow::Result<WorkspaceResolution> {
        self.resolve_or_create_workspace(path, false, origin, None)
    }

    pub fn create_workspace_with_origin_and_creator_context(
        &self,
        path: &str,
        origin: OriginContext,
        creator_context: Option<WorkspaceCreatorContext>,
    ) -> anyhow::Result<WorkspaceResolution> {
        self.resolve_or_create_workspace(path, false, origin, creator_context)
    }

    pub fn resolve_repo_root_from_path(
        &self,
        path: &str,
    ) -> Result<RepoRootRecord, ResolveRepoRootError> {
        let ctx =
            resolver::resolve_git_context(path).map_err(|_| ResolveRepoRootError::NotGitRepo)?;
        if ctx.is_worktree {
            return Err(ResolveRepoRootError::WorktreeNotAllowed);
        }

        self.ensure_repo_root_from_context(&ctx)
            .map_err(ResolveRepoRootError::Unexpected)
    }
    fn resolve_or_create_workspace(
        &self,
        path: &str,
        allow_existing: bool,
        origin: OriginContext,
        creator_context: Option<WorkspaceCreatorContext>,
    ) -> anyhow::Result<WorkspaceResolution> {
        let started = Instant::now();
        tracing::info!(path = %path, allow_existing, "[workspace-latency] workspace.runtime.resolve.start");
        let ctx = resolver::resolve_git_context(path)?;
        let repo_root = self.ensure_repo_root_from_context(&ctx)?;

        let workspace_kind = if ctx.is_worktree { "worktree" } else { "local" };
        let workspace_path = ctx.repo_root.clone();
        if let Some(existing) = self
            .store
            .find_active_by_path_and_kind(&workspace_path, workspace_kind)?
        {
            if allow_existing {
                return Ok(WorkspaceResolution {
                    repo_root,
                    workspace: reconcile_current_branch(existing)?,
                });
            }

            if workspace_kind == "worktree" {
                anyhow::bail!("a workspace record already exists for path: {workspace_path}");
            }
        }
        if let Some(retired) = self
            .store
            .find_retired_incomplete_cleanup_by_path_and_kind(&workspace_path, workspace_kind)?
        {
            anyhow::bail!(
                "workspace path still has pending cleanup from retired workspace {}: {}",
                retired.id,
                workspace_path
            );
        }

        let record = build_workspace_record(
            &repo_root,
            &workspace_path,
            workspace_kind,
            "standard",
            ctx.current_branch,
            origin,
            creator_context,
        );
        self.store.insert(&record)?;
        tracing::info!(
            path = %path,
            repo_root_id = %repo_root.id,
            workspace_id = %record.id,
            workspace_kind,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.runtime.resolve.completed"
        );
        Ok(WorkspaceResolution {
            repo_root,
            workspace: record,
        })
    }

    fn ensure_repo_root_from_context(
        &self,
        ctx: &ResolvedGitContext,
    ) -> anyhow::Result<RepoRootRecord> {
        let repo_root_path = ctx
            .main_worktree_path
            .clone()
            .unwrap_or_else(|| ctx.repo_root.clone());
        let remote = ctx
            .remote_url
            .as_deref()
            .and_then(resolver::parse_remote_url);
        let detected_default_branch = GitService::detect_default_branch(Path::new(&repo_root_path));
        let repo_root = self
            .repo_root_service
            .ensure_repo_root(CreateRepoRootInput {
                kind: "external".into(),
                path: repo_root_path,
                display_name: None,
                default_branch: detected_default_branch,
                remote_provider: remote.as_ref().map(|value| value.provider.clone()),
                remote_owner: remote.as_ref().map(|value| value.owner.clone()),
                remote_repo_name: remote.as_ref().map(|value| value.repo.clone()),
                remote_url: ctx.remote_url.clone(),
            })?;

        if let Some(default_branch) = GitService::detect_default_branch(Path::new(&repo_root.path))
        {
            if repo_root.default_branch.as_deref() != Some(default_branch.as_str()) {
                return Ok(self
                    .repo_root_service
                    .update_default_branch(&repo_root.id, Some(&default_branch))?
                    .unwrap_or(repo_root));
            }
        }

        Ok(repo_root)
    }
}
