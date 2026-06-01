use std::time::Instant;

use uuid::Uuid;

use super::records::{build_local_workspace_record, build_repo_workspace_record};
use super::WorkspaceService;
use crate::origin::OriginContext;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::resolver;
use crate::workspaces::types::RegisterRepoWorkspaceError;

impl WorkspaceService {
    pub fn resolve_from_path(&self, path: &str) -> anyhow::Result<WorkspaceRecord> {
        let started = Instant::now();
        tracing::info!(path = %path, "[workspace-latency] workspace.resolve.start");

        let ctx = resolver::resolve_git_context(path)?;
        let workspace_path = &ctx.repo_root;
        tracing::info!(
            path = %path,
            repo_root = %workspace_path,
            is_worktree = ctx.is_worktree,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] workspace.resolve.git_context_resolved"
        );

        if ctx.is_worktree {
            if let Some(existing) = self.store.find_active_by_path(workspace_path)? {
                tracing::info!(
                    path = %path,
                    workspace_id = %existing.id,
                    workspace_kind = %existing.kind,
                    total_elapsed_ms = started.elapsed().as_millis(),
                    "[workspace-latency] workspace.resolve.existing_hit"
                );
                return self.reconcile_current_branch(existing);
            }
            if let Some(retired) = self
                .store
                .find_retired_incomplete_cleanup_by_path_and_kind(workspace_path, "worktree")?
            {
                anyhow::bail!(
                    "workspace path still has pending cleanup from retired workspace {}: {}",
                    retired.id,
                    workspace_path
                );
            }

            let remote = ctx
                .remote_url
                .as_deref()
                .and_then(resolver::parse_remote_url);
            let now = chrono::Utc::now().to_rfc3339();

            let main_path = ctx.main_worktree_path.as_deref().unwrap_or(workspace_path);
            let ensure_started = Instant::now();
            let source_ws = self.ensure_repo_workspace(main_path)?;
            tracing::info!(
                path = %path,
                source_workspace_id = %source_ws.id,
                elapsed_ms = ensure_started.elapsed().as_millis(),
                "[workspace-latency] workspace.resolve.source_workspace_ready"
            );

            let record = WorkspaceRecord {
                id: Uuid::new_v4().to_string(),
                kind: "worktree".into(),
                repo_root_id: None,
                path: workspace_path.clone(),
                surface: "standard".into(),
                source_repo_root_path: main_path.to_string(),
                source_workspace_id: Some(source_ws.id.clone()),
                git_provider: remote.as_ref().map(|r| r.provider.clone()),
                git_owner: remote.as_ref().map(|r| r.owner.clone()),
                git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
                original_branch: ctx.current_branch.clone(),
                current_branch: ctx.current_branch.clone(),
                display_name: None,
                origin: Some(OriginContext::api_local_runtime()),
                creator_context: None,
                lifecycle_state: "active".to_string(),
                cleanup_state: "none".to_string(),
                cleanup_operation: None,
                cleanup_error_message: None,
                cleanup_failed_at: None,
                cleanup_attempted_at: None,
                created_at: now.clone(),
                updated_at: now,
            };
            self.store.insert(&record)?;
            tracing::info!(
                path = %path,
                workspace_id = %record.id,
                workspace_kind = %record.kind,
                total_elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] workspace.resolve.completed"
            );
            Ok(record)
        } else {
            // Non-worktree: look for an existing "local" workspace at this path.
            if let Some(existing) = self
                .store
                .find_active_by_path_and_kind(workspace_path, "local")?
            {
                tracing::info!(
                    path = %path,
                    workspace_id = %existing.id,
                    workspace_kind = %existing.kind,
                    total_elapsed_ms = started.elapsed().as_millis(),
                    "[workspace-latency] workspace.resolve.existing_hit"
                );
                return self.reconcile_current_branch(existing);
            }

            let source_ws = self.ensure_repo_workspace(workspace_path)?;
            let record = build_local_workspace_record(&ctx, &source_ws);
            self.store.insert(&record)?;
            tracing::info!(
                path = %path,
                workspace_id = %record.id,
                workspace_kind = %record.kind,
                total_elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] workspace.resolve.completed"
            );
            Ok(record)
        }
    }

    pub fn register_repo_from_path(
        &self,
        path: &str,
    ) -> Result<WorkspaceRecord, RegisterRepoWorkspaceError> {
        let ctx = resolver::resolve_git_context(path)
            .map_err(|_| RegisterRepoWorkspaceError::NotGitRepo)?;

        if ctx.is_worktree {
            return Err(RegisterRepoWorkspaceError::WorktreeNotAllowed);
        }

        if let Some(existing) = self
            .store
            .find_repo_by_source_root_path(&ctx.repo_root)
            .map_err(RegisterRepoWorkspaceError::Unexpected)?
        {
            return self
                .reconcile_current_branch(existing)
                .map_err(RegisterRepoWorkspaceError::Unexpected);
        }

        let record = build_repo_workspace_record(&ctx);
        self.store
            .insert(&record)
            .map_err(RegisterRepoWorkspaceError::Unexpected)?;
        Ok(record)
    }

    fn ensure_repo_workspace(&self, path: &str) -> anyhow::Result<WorkspaceRecord> {
        if let Some(existing) = self.store.find_repo_by_source_root_path(path)? {
            return Ok(existing);
        }
        let ctx = resolver::resolve_git_context(path)?;
        let record = build_repo_workspace_record(&ctx);
        self.store.insert(&record)?;
        Ok(record)
    }

    pub(super) fn reconcile_current_branch(
        &self,
        mut record: WorkspaceRecord,
    ) -> anyhow::Result<WorkspaceRecord> {
        let next_branch = resolver::resolve_git_context(&record.path)
            .ok()
            .and_then(|ctx| ctx.current_branch)
            .or(record.current_branch.clone());

        if next_branch != record.current_branch {
            let now = chrono::Utc::now().to_rfc3339();
            self.store
                .update_current_branch(&record.id, next_branch.as_deref(), &now)?;
            record.current_branch = next_branch;
            record.updated_at = now;
            return Ok(record);
        }

        record.current_branch = next_branch;
        Ok(record)
    }
}
