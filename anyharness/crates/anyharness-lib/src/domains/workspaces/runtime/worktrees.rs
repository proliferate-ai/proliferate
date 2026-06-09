use std::fs;
use std::path::Path;
use std::time::Instant;

use super::records::build_workspace_record;
use super::WorkspaceRuntime;
use crate::adapters::git::GitService;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceSurface};
use crate::domains::workspaces::types::CreateWorktreeResult;
use crate::origin::OriginContext;

impl WorkspaceRuntime {
    pub fn create_worktree(
        &self,
        repo_root_id: &str,
        target_path: &str,
        new_branch_name: &str,
        base_branch: Option<&str>,
        setup_script: Option<&str>,
    ) -> anyhow::Result<CreateWorktreeResult> {
        self.create_worktree_with_surface(
            repo_root_id,
            target_path,
            new_branch_name,
            base_branch,
            setup_script,
            "standard",
            OriginContext::api_local_runtime(),
            None,
        )
    }

    pub fn create_worktree_with_surface(
        &self,
        repo_root_id: &str,
        target_path: &str,
        new_branch_name: &str,
        base_branch: Option<&str>,
        _setup_script: Option<&str>,
        surface: &str,
        origin: OriginContext,
        creator_context: Option<WorkspaceCreatorContext>,
    ) -> anyhow::Result<CreateWorktreeResult> {
        let started = Instant::now();
        tracing::info!(
            repo_root_id = %repo_root_id,
            target_path = %target_path,
            new_branch_name = %new_branch_name,
            base_branch = ?base_branch,
            surface = %surface,
            "[workspace-latency] workspace.worktree.runtime_create.start"
        );

        let source_lookup_started = Instant::now();
        let source = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;
        tracing::info!(
            repo_root_id = %repo_root_id,
            source_path = %source.path,
            elapsed_ms = source_lookup_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.runtime_create.source_loaded"
        );

        let target = Path::new(target_path);
        let canonical_target = target
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .map(|parent| parent.join(target.file_name().unwrap_or_default()))
            .unwrap_or_else(|| target.to_path_buf());
        let canonical_path = canonical_target.to_string_lossy().to_string();

        if canonical_target.exists() {
            anyhow::bail!("worktree target path already exists: {canonical_path}");
        }

        let existing_lookup_started = Instant::now();
        // Worktrees own their materialized checkout path across workspace
        // kinds; do not create a worktree where any active workspace points.
        if self.store.find_active_by_path(&canonical_path)?.is_some() {
            anyhow::bail!("a workspace record already exists for path: {canonical_path}");
        }
        if let Some(retired) = self
            .store
            .find_retired_incomplete_cleanup_by_path_and_kind(
                &canonical_path,
                WorkspaceKind::Worktree,
            )?
        {
            anyhow::bail!(
                "workspace path still has pending cleanup from retired workspace {}: {}",
                retired.id,
                canonical_path
            );
        }
        tracing::info!(
            repo_root_id = %repo_root_id,
            target_path = %canonical_path,
            elapsed_ms = existing_lookup_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.runtime_create.path_checked"
        );

        GitService::create_worktree(&source.path, target_path, new_branch_name, base_branch)?;
        // The pre-create canonical target is only for checking the requested
        // target before it exists. Persist the canonical path of the worktree
        // that git actually materialized.
        let canonical_path = fs::canonicalize(target_path)
            .map_err(|error| {
                anyhow::anyhow!(
                    "failed to canonicalize created worktree path {target_path}: {error}"
                )
            })?
            .to_string_lossy()
            .to_string();

        let record = build_workspace_record(
            &source,
            &canonical_path,
            WorkspaceKind::Worktree,
            WorkspaceSurface::try_from(surface)?,
            // `git worktree add -b <name>` either creates this branch or
            // fails; avoid an extra post-create branch probe on the hot path.
            Some(new_branch_name.to_string()),
            origin,
            creator_context,
        );
        let insert_started = Instant::now();
        self.store.insert(&record)?;
        tracing::info!(
            workspace_id = %record.id,
            repo_root_id = %repo_root_id,
            elapsed_ms = insert_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.runtime_create.record_inserted"
        );

        let setup_script = None;

        tracing::info!(
            workspace_id = %record.id,
            repo_root_id = %repo_root_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.runtime_create.completed"
        );

        Ok(CreateWorktreeResult {
            workspace: record,
            setup_script,
        })
    }
}
