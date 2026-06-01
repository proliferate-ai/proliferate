use std::path::Path;
use std::time::Instant;

use uuid::Uuid;

use super::WorkspaceService;
use crate::adapters::git::GitService;
use crate::origin::OriginContext;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::resolver;
use crate::workspaces::types::CreateWorktreeResult;

impl WorkspaceService {
    pub fn create_worktree(
        &self,
        source_workspace_id: &str,
        target_path: &str,
        new_branch_name: &str,
        base_branch: Option<&str>,
        setup_script: Option<&str>,
    ) -> anyhow::Result<CreateWorktreeResult> {
        let started = Instant::now();
        let has_setup_script = setup_script
            .map(str::trim)
            .map(|script| !script.is_empty())
            .unwrap_or(false);
        tracing::info!(
            source_workspace_id = %source_workspace_id,
            target_path = %target_path,
            new_branch_name = %new_branch_name,
            base_branch = ?base_branch,
            has_setup_script,
            "[workspace-latency] workspace.worktree.create.start"
        );

        let source_lookup_started = Instant::now();
        let source = self
            .store
            .find_by_id(source_workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("source workspace not found: {source_workspace_id}"))?;
        tracing::info!(
            source_workspace_id = %source_workspace_id,
            source_kind = %source.kind,
            elapsed_ms = source_lookup_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.source_loaded"
        );

        let effective_source = if source.kind == "local" {
            let parent_id = source
                .source_workspace_id
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("local workspace has no source_workspace_id"))?;
            self.store
                .find_by_id(parent_id)?
                .ok_or_else(|| anyhow::anyhow!("parent repo workspace not found: {parent_id}"))?
        } else if source.kind == "repo" {
            source
        } else {
            anyhow::bail!(
                "source must be a repo or local workspace, got '{}'",
                source.kind
            );
        };

        let target = Path::new(target_path);
        let canonical_target = target
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .map(|parent| parent.join(target.file_name().unwrap_or_default()))
            .unwrap_or_else(|| target.to_path_buf());
        let canonical_str = canonical_target.to_string_lossy();

        if canonical_target.exists() {
            anyhow::bail!("worktree target path already exists: {canonical_str}");
        }

        if self.store.find_active_by_path(&canonical_str)?.is_some() {
            anyhow::bail!("a workspace record already exists for path: {canonical_str}");
        }
        if let Some(retired) = self
            .store
            .find_retired_incomplete_cleanup_by_path_and_kind(&canonical_str, "worktree")?
        {
            anyhow::bail!(
                "workspace path still has pending cleanup from retired workspace {}: {}",
                retired.id,
                canonical_str
            );
        }

        GitService::create_worktree(
            &effective_source.path,
            target_path,
            new_branch_name,
            base_branch,
        )?;

        let context_started = Instant::now();
        let ctx = resolver::resolve_git_context(target_path)?;
        let remote = ctx
            .remote_url
            .as_deref()
            .and_then(resolver::parse_remote_url);
        let current_branch = ctx.current_branch.clone();
        tracing::info!(
            source_workspace_id = %source_workspace_id,
            target_path = %target_path,
            repo_root = %ctx.repo_root,
            current_branch = ?current_branch,
            elapsed_ms = context_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.context_resolved"
        );

        let now = chrono::Utc::now().to_rfc3339();
        let record = WorkspaceRecord {
            id: Uuid::new_v4().to_string(),
            kind: "worktree".into(),
            repo_root_id: None,
            path: ctx.repo_root,
            surface: "standard".into(),
            source_repo_root_path: effective_source.source_repo_root_path.clone(),
            source_workspace_id: Some(effective_source.id.clone()),
            git_provider: remote.as_ref().map(|r| r.provider.clone()),
            git_owner: remote.as_ref().map(|r| r.owner.clone()),
            git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
            original_branch: current_branch.clone(),
            current_branch,
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
        let insert_started = Instant::now();
        self.store.insert(&record)?;
        tracing::info!(
            workspace_id = %record.id,
            source_workspace_id = %source_workspace_id,
            elapsed_ms = insert_started.elapsed().as_millis(),
            "[workspace-latency] workspace.worktree.record_inserted"
        );

        tracing::info!(
            workspace_id = %record.id,
            "[workspace-latency] workspace.worktree.setup_script.skipped"
        );

        tracing::info!(
            workspace_id = %record.id,
            source_workspace_id = %source_workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            has_setup_script,
            "[workspace-latency] workspace.worktree.create.completed"
        );

        Ok(CreateWorktreeResult {
            workspace: record,
            setup_script: None,
        })
    }
}
