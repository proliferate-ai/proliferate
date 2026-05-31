use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use uuid::Uuid;

#[cfg(test)]
use super::branch_refresh::BranchRefreshBatchOutcome;
use super::branch_refresh::WorkspaceBranchRefreshCoordinator;
use super::deletion::WorkspaceDeleteWorkflow;
use super::detector;
use super::model::{ResolvedGitContext, WorkspaceRecord};
use super::resolver;
use super::service::WorkspaceService;
use super::store::WorkspaceStore;
use super::types::{
    CreateWorktreeResult, PreparedWorkspaceMobilityDestination, ProjectSetupDetectionResult,
    ResolveRepoRootError, SetWorkspaceDisplayNameError,
};
use crate::adapters::git::service::GitService;
use crate::origin::OriginContext;
use crate::repo_roots::model::{CreateRepoRootInput, RepoRootRecord};
use crate::repo_roots::service::RepoRootService;
use crate::workspaces::creator_context::WorkspaceCreatorContext;
use crate::workspaces::env::read_materialized_session_env;
use crate::workspaces::managed_root::canonical_managed_worktrees_root;

const BRANCH_PUBLISH_TIMEOUT: Duration = Duration::from_secs(20);

pub struct WorkspaceRuntime {
    service: WorkspaceService,
    store: WorkspaceStore,
    delete_workflow: WorkspaceDeleteWorkflow,
    repo_root_service: RepoRootService,
    runtime_home: PathBuf,
    branch_refresh: WorkspaceBranchRefreshCoordinator,
}

#[derive(Debug, Clone)]
pub struct WorkspaceResolution {
    pub repo_root: RepoRootRecord,
    pub workspace: WorkspaceRecord,
}

impl WorkspaceRuntime {
    pub fn new(
        service: WorkspaceService,
        store: WorkspaceStore,
        delete_workflow: WorkspaceDeleteWorkflow,
        repo_root_service: RepoRootService,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            service,
            store,
            delete_workflow,
            repo_root_service,
            runtime_home,
            branch_refresh: WorkspaceBranchRefreshCoordinator::new(),
        }
    }

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
            .find_retired_incomplete_cleanup_by_path_and_kind(&canonical_path, "worktree")?
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

        resolver::create_git_worktree(&source.path, target_path, new_branch_name, base_branch)?;
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
            "worktree",
            surface,
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

    pub fn list_repo_root_workspaces(
        &self,
        repo_root_id: &str,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        Ok(self
            .store
            .list_by_repo_root_id(repo_root_id)?
            .into_iter()
            .filter(|record| matches!(record.kind.as_str(), "local" | "worktree"))
            .collect())
    }

    pub fn create_mobility_destination(
        &self,
        repo_root_id: &str,
        requested_branch: &str,
        requested_base_sha: &str,
        destination_id: Option<&str>,
        preferred_workspace_name: Option<&str>,
    ) -> anyhow::Result<PreparedWorkspaceMobilityDestination> {
        let requested_branch = requested_branch.trim();
        let requested_base_sha = requested_base_sha.trim();
        if requested_branch.is_empty() {
            anyhow::bail!("requested branch is required");
        }
        if requested_base_sha.is_empty() {
            anyhow::bail!("requested base sha is required");
        }

        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let base_dir = self
            .runtime_home
            .join("mobility")
            .join("destinations")
            .join(&repo_root.id);
        fs::create_dir_all(&base_dir)?;

        let target_path = if let Some(destination_id) = destination_id {
            validate_mobility_destination_id(destination_id)?;
            let candidate = base_dir.join(destination_id);
            let candidate_string = candidate.to_string_lossy().to_string();
            // Mobility destinations are managed worktree paths and must not
            // collide with any active workspace row, regardless of kind.
            if let Some(existing) = self.store.find_active_by_path(&candidate_string)? {
                if existing.current_branch.as_deref() == Some(requested_branch) {
                    self.validate_reusable_mobility_destination_workspace(
                        &existing,
                        requested_branch,
                        requested_base_sha,
                    )?;
                    return Ok(PreparedWorkspaceMobilityDestination {
                        workspace: existing,
                        created: false,
                    });
                }
                anyhow::bail!(
                    "mobility destination conflict: destination id already belongs to branch {}",
                    existing.current_branch.as_deref().unwrap_or("<unknown>")
                );
            }
            if candidate.exists() {
                let workspace = self.adopt_existing_mobility_destination(
                    &repo_root,
                    &candidate,
                    requested_branch,
                    requested_base_sha,
                )?;
                return Ok(PreparedWorkspaceMobilityDestination {
                    workspace,
                    created: true,
                });
            }
            candidate
        } else {
            if let Some(existing) = self.find_reusable_mobility_destination_workspace(
                &repo_root.id,
                requested_branch,
                requested_base_sha,
            )? {
                return Ok(PreparedWorkspaceMobilityDestination {
                    workspace: existing,
                    created: false,
                });
            }

            let mut slug = sanitize_mobility_destination_name(
                preferred_workspace_name.unwrap_or(requested_branch),
            );
            if slug.is_empty() {
                slug = "workspace".to_string();
            }
            let short_sha = requested_base_sha.chars().take(8).collect::<String>();

            (0..100)
                .map(|attempt| {
                    let suffix = if attempt == 0 {
                        String::new()
                    } else {
                        format!("-{}", attempt + 1)
                    };
                    base_dir.join(format!("{slug}-{short_sha}{suffix}"))
                })
                .find(|candidate| {
                    let candidate_string = candidate.to_string_lossy();
                    !candidate.exists()
                        // Mobility destinations are managed worktree paths and
                        // remain unique across all active workspace kinds.
                        && self
                            .store
                            .find_active_by_path(&candidate_string)
                            .ok()
                            .flatten()
                            .is_none()
                })
                .ok_or_else(|| anyhow::anyhow!("unable to allocate a mobility destination path"))?
        };

        let target_path_string = target_path.display().to_string();
        let branch_existed_before_create = git_ref_exists(
            Path::new(&repo_root.path),
            &format!("refs/heads/{requested_branch}"),
        );

        resolver::create_mobility_git_worktree(
            &repo_root.path,
            &target_path_string,
            requested_branch,
            requested_base_sha,
        )?;

        let ctx = resolver::resolve_git_context(&target_path_string)?;
        if !branch_existed_before_create {
            publish_created_branch_if_possible(
                &ctx.repo_root,
                requested_branch,
                ctx.remote_url.as_deref(),
            );
        }
        let record = build_workspace_record(
            &repo_root,
            &ctx.repo_root,
            "worktree",
            "standard",
            ctx.current_branch.clone(),
            OriginContext::system_local_runtime(),
            None,
        );
        self.store.insert(&record)?;

        Ok(PreparedWorkspaceMobilityDestination {
            workspace: record,
            created: true,
        })
    }

    fn validate_reusable_mobility_destination_workspace(
        &self,
        workspace: &WorkspaceRecord,
        requested_branch: &str,
        requested_base_sha: &str,
    ) -> anyhow::Result<()> {
        if workspace.kind != "worktree"
            || workspace.surface != "standard"
            || workspace.current_branch.as_deref() != Some(requested_branch)
        {
            anyhow::bail!(
                "mobility destination conflict: destination workspace is not a reusable worktree"
            );
        }

        let ctx = resolver::resolve_git_context(&workspace.path)?;
        if !ctx.is_worktree || ctx.current_branch.as_deref() != Some(requested_branch) {
            anyhow::bail!(
                "mobility destination conflict: destination workspace is not on requested branch {requested_branch}"
            );
        }
        let workspace_path = Path::new(&ctx.repo_root);
        let actual_head = git_stdout_result(workspace_path, &["rev-parse", "HEAD"])?;
        let requested_head = git_stdout_result(
            workspace_path,
            &[
                "rev-parse",
                "--verify",
                &format!("{requested_base_sha}^{{commit}}"),
            ],
        )?;
        if actual_head != requested_head {
            anyhow::bail!(
                "mobility destination conflict: destination workspace is at {actual_head}, not requested commit {requested_head}"
            );
        }
        let status = git_stdout_result(
            workspace_path,
            &["status", "--porcelain", "--untracked-files=all"],
        )?;
        if !status.trim().is_empty() {
            anyhow::bail!(
                "mobility destination conflict: destination workspace has uncommitted changes"
            );
        }
        Ok(())
    }

    fn find_reusable_mobility_destination_workspace(
        &self,
        repo_root_id: &str,
        requested_branch: &str,
        requested_base_sha: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        let requested_head = format!("{requested_base_sha}^{{commit}}");
        let base_dir = self
            .runtime_home
            .join("mobility")
            .join("destinations")
            .join(repo_root_id);
        for workspace in self.store.list_active_by_repo_root_id(repo_root_id)? {
            if workspace.kind != "worktree"
                || workspace.surface != "standard"
                || workspace.current_branch.as_deref() != Some(requested_branch)
                || !Path::new(&workspace.path).exists()
                || !Path::new(&workspace.path).starts_with(&base_dir)
            {
                continue;
            }

            let ctx = match resolver::resolve_git_context(&workspace.path) {
                Ok(ctx) => ctx,
                Err(_) => continue,
            };
            if !ctx.is_worktree || ctx.current_branch.as_deref() != Some(requested_branch) {
                continue;
            }

            let workspace_path = Path::new(&ctx.repo_root);
            let actual_head = git_stdout_result(workspace_path, &["rev-parse", "HEAD"])?;
            let requested_head =
                git_stdout_result(workspace_path, &["rev-parse", "--verify", &requested_head])?;
            if actual_head != requested_head {
                continue;
            }

            let status = git_stdout_result(
                workspace_path,
                &["status", "--porcelain", "--untracked-files=all"],
            )?;
            if !status.trim().is_empty() {
                anyhow::bail!(
                    "mobility destination conflict: existing branch {requested_branch} has uncommitted changes in {}",
                    workspace.path
                );
            }

            return Ok(Some(workspace));
        }

        Ok(None)
    }

    fn adopt_existing_mobility_destination(
        &self,
        repo_root: &RepoRootRecord,
        target_path: &Path,
        requested_branch: &str,
        requested_base_sha: &str,
    ) -> anyhow::Result<WorkspaceRecord> {
        let target_path_string = target_path.display().to_string();

        if let Some(retired) = self
            .store
            .find_retired_incomplete_cleanup_by_path_and_kind(&target_path_string, "worktree")?
        {
            anyhow::bail!(
                "mobility destination conflict: destination path has pending cleanup from retired workspace {}",
                retired.id
            );
        }

        let ctx = resolver::resolve_git_context(&target_path_string).map_err(|error| {
            anyhow::anyhow!(
                "mobility destination conflict: destination path already exists but is not a usable git worktree: {error}"
            )
        })?;
        if !ctx.is_worktree {
            anyhow::bail!(
                "mobility destination conflict: destination path already exists but is not a git worktree"
            );
        }
        if ctx.current_branch.as_deref() != Some(requested_branch) {
            anyhow::bail!(
                "mobility destination conflict: destination path already exists for branch {}",
                ctx.current_branch.as_deref().unwrap_or("<unknown>")
            );
        }

        let actual_head = git_stdout_result(Path::new(&ctx.repo_root), &["rev-parse", "HEAD"])?;
        let requested_head = git_stdout_result(
            Path::new(&ctx.repo_root),
            &[
                "rev-parse",
                "--verify",
                &format!("{requested_base_sha}^{{commit}}"),
            ],
        )?;
        if actual_head != requested_head {
            anyhow::bail!(
                "mobility destination conflict: destination path is at {actual_head}, not requested commit {requested_head}"
            );
        }

        let status = git_stdout_result(
            Path::new(&ctx.repo_root),
            &["status", "--porcelain", "--untracked-files=all"],
        )?;
        if !status.trim().is_empty() {
            anyhow::bail!(
                "mobility destination conflict: destination path already exists with uncommitted changes"
            );
        }

        let record = build_workspace_record(
            repo_root,
            &ctx.repo_root,
            "worktree",
            "standard",
            ctx.current_branch.clone(),
            OriginContext::system_local_runtime(),
            None,
        );
        self.store.insert(&record)?;

        Ok(record)
    }

    pub fn resolve_repo_root_default_branch(&self, repo_root_id: &str) -> anyhow::Result<String> {
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;
        let default_branch =
            detect_repo_default_branch(Path::new(&repo_root.path)).ok_or_else(|| {
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

    pub fn get_workspace(&self, workspace_id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        let record = self.store.find_by_id(workspace_id)?;
        if let Some(record) = record.as_ref() {
            self.branch_refresh
                .schedule_refresh(self.store.clone(), std::slice::from_ref(record));
        }
        Ok(record)
    }

    pub fn delete_workspace_record(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.delete_workflow.delete_workspace_record(workspace_id)
    }

    pub fn set_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
    ) -> Result<WorkspaceRecord, SetWorkspaceDisplayNameError> {
        self.service.set_display_name(workspace_id, display_name)
    }

    pub fn detect_setup(&self, workspace_id: &str) -> anyhow::Result<ProjectSetupDetectionResult> {
        self.service.detect_setup(workspace_id)
    }

    pub fn list_workspaces(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        let started = Instant::now();
        let store_started = Instant::now();
        let records = self.store.list_execution_surfaces()?;
        tracing::info!(
            workspace_count = records.len(),
            elapsed_ms = store_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] workspace.runtime.list.store_loaded"
        );

        let schedule_started = Instant::now();
        let branch_refresh = self
            .branch_refresh
            .schedule_refresh(self.store.clone(), &records);
        tracing::info!(
            workspace_count = records.len(),
            branch_refresh_scheduled_count = branch_refresh.scheduled_count,
            elapsed_ms = schedule_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] workspace.runtime.list.ready"
        );
        Ok(records)
    }

    #[cfg(test)]
    fn refresh_workspace_branches_for_test(&self) -> anyhow::Result<BranchRefreshBatchOutcome> {
        let records = self.store.list_execution_surfaces()?;
        Ok(self
            .branch_refresh
            .run_refresh_for_test(self.store.clone(), &records))
    }

    #[cfg(test)]
    fn scheduled_branch_refresh_batches_for_test(&self) -> u64 {
        self.branch_refresh.scheduled_batch_count_for_test()
    }

    pub fn set_lifecycle_cleanup_state(
        &self,
        workspace_id: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
        cleanup_error_message: Option<&str>,
        cleanup_failed_at: Option<&str>,
        cleanup_attempted_at: Option<&str>,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.store.update_lifecycle_cleanup_state(
            workspace_id,
            lifecycle_state,
            cleanup_state,
            cleanup_operation,
            cleanup_error_message,
            cleanup_failed_at,
            cleanup_attempted_at,
            &now,
        )?;
        self.get_workspace(workspace_id)
    }

    pub fn find_active_workspace_by_path_and_kind(
        &self,
        path: &str,
        kind: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store.find_active_by_path_and_kind(path, kind)
    }

    pub fn find_active_worktree_by_path_excluding_id(
        &self,
        path: &str,
        excluded_id: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store
            .find_active_by_path_and_kind_excluding_id(path, "worktree", excluded_id)
    }

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
        let output = Command::new("git")
            .args([
                "-C",
                &workspace.source_repo_root_path,
                "worktree",
                "remove",
                "--force",
                &workspace.path,
            ])
            .output()?;
        if !output.status.success() && worktree.exists() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            anyhow::bail!("failed to remove worktree materialization: {stderr}");
        }
        Ok(())
    }

    pub fn workspace_env(
        &self,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<BTreeMap<String, String>> {
        Ok(self
            .build_workspace_env(workspace, None)?
            .into_iter()
            .collect())
    }

    pub fn build_workspace_env(
        &self,
        workspace: &WorkspaceRecord,
        base_ref: Option<&str>,
    ) -> anyhow::Result<Vec<(String, String)>> {
        let repo_root_id = workspace
            .repo_root_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("workspace missing repo_root_id: {}", workspace.id))?;
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let mut env = BTreeMap::new();
        env.insert("PROLIFERATE_WORKSPACE_ID".into(), workspace.id.clone());
        env.insert("PROLIFERATE_WORKSPACE_KIND".into(), workspace.kind.clone());
        env.insert("PROLIFERATE_WORKSPACE_DIR".into(), workspace.path.clone());
        env.insert("PROLIFERATE_REPO_ROOT_ID".into(), repo_root.id.clone());
        env.insert("PROLIFERATE_REPO_DIR".into(), repo_root.path.clone());
        env.insert(
            "PROLIFERATE_RUNTIME_HOME".into(),
            self.runtime_home.display().to_string(),
        );
        let repo_name = repo_root
            .remote_repo_name
            .clone()
            .unwrap_or_else(|| path_basename(&repo_root.path));
        env.insert("PROLIFERATE_REPO_NAME".into(), repo_name);
        if let Some(branch) = workspace
            .current_branch
            .as_ref()
            .or(workspace.original_branch.as_ref())
        {
            env.insert("PROLIFERATE_BRANCH".into(), branch.clone());
        }
        if let Some(base_ref) = base_ref {
            env.insert("PROLIFERATE_BASE_REF".into(), base_ref.to_string());
        }
        if let Some(provider) = &repo_root.remote_provider {
            env.insert("PROLIFERATE_GIT_PROVIDER".into(), provider.clone());
        }
        if let Some(owner) = &repo_root.remote_owner {
            env.insert("PROLIFERATE_GIT_OWNER".into(), owner.clone());
        }
        if let Some(repo) = &repo_root.remote_repo_name {
            env.insert("PROLIFERATE_GIT_REPO".into(), repo.clone());
        }
        if workspace.kind == "worktree" {
            env.insert("PROLIFERATE_WORKTREE_DIR".into(), workspace.path.clone());
        }
        env.extend(read_materialized_session_env(Path::new(&workspace.path))?);

        Ok(env.into_iter().collect())
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
            let output = Command::new("git")
                .args([
                    "-C",
                    repo_root_path,
                    "worktree",
                    "remove",
                    "--force",
                    worktree_path,
                ])
                .output()?;
            if !output.status.success() && worktree.exists() {
                fs::remove_dir_all(worktree)?;
            }
        }
        resolver::prune_stale_worktrees_if_possible(Path::new(repo_root_path));

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
            git_ref_exists(workspace_path, &format!("refs/heads/{default_branch}"));
        let remote_branch_exists = git_ref_exists(
            workspace_path,
            &format!("refs/remotes/origin/{default_branch}"),
        );

        let switch_args: Vec<String> = if local_branch_exists {
            vec!["switch".into(), default_branch.to_string()]
        } else if remote_branch_exists {
            vec![
                "switch".into(),
                "--track".into(),
                "-c".into(),
                default_branch.to_string(),
                format!("origin/{default_branch}"),
            ]
        } else {
            anyhow::bail!(
                "default branch '{default_branch}' is not available locally or on origin"
            );
        };

        let output = Command::new("git")
            .args(["-C", &workspace.path])
            .args(&switch_args)
            .output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            anyhow::bail!(
                "failed to park local workspace on default branch '{default_branch}': {stderr}"
            );
        }

        self.delete_workflow
            .delete_workspace_record(&workspace.id)?;
        Ok(())
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
        let detected_default_branch = detect_repo_default_branch(Path::new(&repo_root_path));
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

        if let Some(default_branch) = detect_repo_default_branch(Path::new(&repo_root.path)) {
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

fn build_workspace_record(
    repo_root: &RepoRootRecord,
    path: &str,
    kind: &str,
    surface: &str,
    current_branch: Option<String>,
    origin: OriginContext,
    creator_context: Option<WorkspaceCreatorContext>,
) -> WorkspaceRecord {
    let now = chrono::Utc::now().to_rfc3339();
    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind: kind.to_string(),
        repo_root_id: Some(repo_root.id.clone()),
        path: path.to_string(),
        surface: surface.to_string(),
        source_repo_root_path: repo_root.path.clone(),
        source_workspace_id: None,
        git_provider: repo_root.remote_provider.clone(),
        git_owner: repo_root.remote_owner.clone(),
        git_repo_name: repo_root.remote_repo_name.clone(),
        original_branch: current_branch.clone(),
        current_branch,
        display_name: None,
        origin: Some(origin),
        creator_context,
        lifecycle_state: "active".to_string(),
        cleanup_state: "none".to_string(),
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn reconcile_current_branch(mut record: WorkspaceRecord) -> anyhow::Result<WorkspaceRecord> {
    let next_branch = resolver::resolve_git_context(&record.path)
        .ok()
        .and_then(|ctx| ctx.current_branch)
        .or(record.current_branch.clone());

    record.current_branch = next_branch;
    Ok(record)
}

fn publish_created_branch_if_possible(
    workspace_path: &str,
    branch_name: &str,
    remote_url: Option<&str>,
) {
    if remote_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        tracing::info!(
            workspace_path = %workspace_path,
            branch_name = %branch_name,
            "[workspace-latency] workspace.worktree.branch_publish.skipped_no_origin"
        );
        return;
    }

    let started = Instant::now();
    tracing::info!(
        workspace_path = %workspace_path,
        branch_name = %branch_name,
        "[workspace-latency] workspace.worktree.branch_publish.start"
    );

    match GitService::push_current_branch_with_timeout(
        Path::new(workspace_path),
        Some("origin"),
        BRANCH_PUBLISH_TIMEOUT,
    ) {
        Ok((remote, pushed_branch, published)) => {
            tracing::info!(
                workspace_path = %workspace_path,
                requested_branch = %branch_name,
                pushed_branch = %pushed_branch,
                remote = %remote,
                published,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] workspace.worktree.branch_publish.success"
            );
        }
        Err(error) => {
            tracing::info!(
                workspace_path = %workspace_path,
                branch_name = %branch_name,
                elapsed_ms = started.elapsed().as_millis(),
                error = %error,
                "[workspace-latency] workspace.worktree.branch_publish.skipped"
            );
        }
    }
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo")
        .to_string()
}

fn sanitize_mobility_destination_name(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' => ch.to_ascii_lowercase(),
            '-' | '_' => ch,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn validate_mobility_destination_id(value: &str) -> anyhow::Result<()> {
    if value.is_empty() || value.len() > 96 {
        anyhow::bail!("invalid destination id");
    }
    if value == "." || value == ".." || value.contains('/') || value.contains('\\') {
        anyhow::bail!("invalid destination id");
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        anyhow::bail!("invalid destination id");
    }
    Ok(())
}

fn detect_repo_default_branch(repo_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-C",
            &repo_root.display().to_string(),
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
        ])
        .output()
        .ok()?;
    if output.status.success() {
        let refname = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Some(default_branch) = refname.strip_prefix("refs/remotes/origin/") {
            return Some(default_branch.to_string());
        }
    }

    for candidate in ["main", "master", "develop"] {
        if git_ref_exists(repo_root, &format!("refs/remotes/origin/{candidate}"))
            || git_ref_exists(repo_root, &format!("refs/heads/{candidate}"))
        {
            return Some(candidate.to_string());
        }
    }

    None
}

fn git_ref_exists(repo_root: &Path, ref_name: &str) -> bool {
    Command::new("git")
        .args([
            "-C",
            &repo_root.display().to_string(),
            "rev-parse",
            "--verify",
            ref_name,
        ])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn git_stdout_result(repo_root: &Path, args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|error| anyhow::anyhow!("git {:?} failed: {error}", args))?;
    if !output.status.success() {
        anyhow::bail!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use uuid::Uuid;

    use super::WorkspaceRuntime;
    use crate::origin::OriginContext;
    use crate::persistence::Db;
    use crate::repo_roots::service::RepoRootService;
    use crate::repo_roots::store::RepoRootStore;
    use crate::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::sessions::store::SessionStore;
    use crate::workspaces::deletion::WorkspaceDeleteWorkflow;
    use crate::workspaces::service::WorkspaceService;
    use crate::workspaces::store::WorkspaceStore;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path = env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn create_worktree_keeps_created_branch_local() {
        let remote = TempDirGuard::new("runtime-worktree-remote");
        let source = TempDirGuard::new("runtime-worktree-source");
        let target = TempDirGuard::new("runtime-worktree-target");
        let runtime_home = TempDirGuard::new("runtime-worktree-home");
        let _ = fs::remove_dir_all(target.path());

        run_git(remote.path(), ["init", "--bare", "-b", "main"]);
        init_repo(source.path());
        let remote_path = remote.path().display().to_string();
        run_git(source.path(), ["remote", "add", "origin", &remote_path]);
        run_git(source.path(), ["push", "-u", "origin", "main"]);

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create source workspace");

        let result = runtime
            .create_worktree(
                &source_workspace.repo_root.id,
                &target.path().display().to_string(),
                "feature/local-only",
                Some("main"),
                None,
            )
            .expect("create worktree");

        let worktree_path = Path::new(&result.workspace.path);
        let local_head = git_stdout(worktree_path, ["rev-parse", "HEAD"]);
        let main_head = git_stdout(source.path(), ["rev-parse", "main"]);

        assert_eq!(local_head.trim(), main_head.trim());
        assert_git_ref_missing(remote.path(), "refs/heads/feature/local-only");
        assert_git_command_fails(
            worktree_path,
            [
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        );
    }

    #[test]
    fn create_mobility_destination_publishes_created_branch_to_origin() {
        let remote = TempDirGuard::new("runtime-mobility-remote");
        let source = TempDirGuard::new("runtime-mobility-source");
        let runtime_home = TempDirGuard::new("runtime-mobility-home");

        run_git(remote.path(), ["init", "--bare", "-b", "main"]);
        init_repo(source.path());
        let remote_path = remote.path().display().to_string();
        run_git(source.path(), ["remote", "add", "origin", &remote_path]);
        run_git(source.path(), ["push", "-u", "origin", "main"]);

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create source workspace");
        let duplicate_source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create duplicate source workspace");
        assert_ne!(
            source_workspace.workspace.id,
            duplicate_source_workspace.workspace.id
        );
        let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);

        let prepared = runtime
            .create_mobility_destination(
                &source_workspace.repo_root.id,
                "feature/mobility-pushed",
                &base_sha,
                Some("destination-1"),
                None,
            )
            .expect("create mobility destination");

        assert!(prepared.created);
        let worktree_path = Path::new(&prepared.workspace.path);
        let local_head = git_stdout(worktree_path, ["rev-parse", "HEAD"]);
        let remote_head = git_stdout(
            remote.path(),
            ["rev-parse", "refs/heads/feature/mobility-pushed"],
        );
        let upstream = git_stdout(
            worktree_path,
            [
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        );

        assert_eq!(local_head.trim(), remote_head.trim());
        assert_eq!(upstream.trim(), "origin/feature/mobility-pushed");
    }

    #[test]
    fn create_mobility_destination_adopts_clean_existing_destination_path() {
        let source = TempDirGuard::new("runtime-mobility-adopt-source");
        let runtime_home = TempDirGuard::new("runtime-mobility-adopt-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create source workspace");
        let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);
        let destination_path = runtime_home
            .path()
            .join("mobility")
            .join("destinations")
            .join(&source_workspace.repo_root.id)
            .join("destination-1");
        fs::create_dir_all(destination_path.parent().expect("destination parent"))
            .expect("create destination parent");
        crate::workspaces::resolver::create_mobility_git_worktree(
            &source.path().display().to_string(),
            &destination_path.display().to_string(),
            "feature/adopt",
            &base_sha,
        )
        .expect("create orphan destination worktree");

        let prepared = runtime
            .create_mobility_destination(
                &source_workspace.repo_root.id,
                "feature/adopt",
                &base_sha,
                Some("destination-1"),
                None,
            )
            .expect("adopt destination");

        assert!(prepared.created);
        let workspace = prepared.workspace;
        assert_eq!(
            Path::new(&workspace.path),
            fs::canonicalize(&destination_path)
                .expect("canonicalize destination")
                .as_path()
        );
        assert_eq!(workspace.current_branch.as_deref(), Some("feature/adopt"));
        let stored = WorkspaceStore::new(db.clone())
            .find_active_by_path(&workspace.path)
            .expect("find by path")
            .expect("stored workspace");
        assert_eq!(stored.id, workspace.id);
    }

    #[test]
    fn create_mobility_destination_reuses_clean_existing_branch_worktree() {
        let source = TempDirGuard::new("runtime-mobility-reuse-source");
        let runtime_home = TempDirGuard::new("runtime-mobility-reuse-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create source workspace");
        let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);

        let first = runtime
            .create_mobility_destination(
                &source_workspace.repo_root.id,
                "feature/reuse-existing",
                &base_sha,
                None,
                Some("feature reuse existing"),
            )
            .expect("create first destination");
        let second = runtime
            .create_mobility_destination(
                &source_workspace.repo_root.id,
                "feature/reuse-existing",
                &base_sha,
                None,
                Some("feature reuse existing"),
            )
            .expect("reuse existing destination");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(second.workspace.id, first.workspace.id);
        let active_branch_workspaces = WorkspaceStore::new(db.clone())
            .list_active_by_repo_root_id(&source_workspace.repo_root.id)
            .expect("list workspaces")
            .into_iter()
            .filter(|workspace| {
                workspace.current_branch.as_deref() == Some("feature/reuse-existing")
            })
            .collect::<Vec<_>>();
        assert_eq!(active_branch_workspaces.len(), 1);
    }

    #[test]
    fn create_mobility_destination_rejects_dirty_existing_destination_path() {
        let source = TempDirGuard::new("runtime-mobility-dirty-adopt-source");
        let runtime_home = TempDirGuard::new("runtime-mobility-dirty-adopt-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create source workspace");
        let base_sha = git_stdout(source.path(), ["rev-parse", "HEAD"]);
        let destination_path = runtime_home
            .path()
            .join("mobility")
            .join("destinations")
            .join(&source_workspace.repo_root.id)
            .join("destination-1");
        fs::create_dir_all(destination_path.parent().expect("destination parent"))
            .expect("create destination parent");
        crate::workspaces::resolver::create_mobility_git_worktree(
            &source.path().display().to_string(),
            &destination_path.display().to_string(),
            "feature/dirty-adopt",
            &base_sha,
        )
        .expect("create orphan destination worktree");
        fs::write(destination_path.join("dirty.txt"), "dirty\n").expect("dirty destination");

        let error = runtime
            .create_mobility_destination(
                &source_workspace.repo_root.id,
                "feature/dirty-adopt",
                &base_sha,
                Some("destination-1"),
                None,
            )
            .expect_err("dirty destination must not be adopted");

        assert!(error
            .to_string()
            .contains("destination path already exists with uncommitted changes"));
    }

    #[test]
    fn create_workspace_creates_distinct_local_records_for_existing_path() {
        let source = TempDirGuard::new("runtime-create-duplicate-local-source");
        let runtime_home = TempDirGuard::new("runtime-create-duplicate-local-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let path = source.path().display().to_string();

        let first = runtime
            .create_workspace(&path)
            .expect("create first workspace");
        let second = runtime
            .create_workspace(&path)
            .expect("create duplicate local workspace");

        assert_ne!(first.workspace.id, second.workspace.id);
        assert_eq!(first.workspace.kind, "local");
        assert_eq!(second.workspace.kind, "local");
        assert_eq!(first.workspace.path, second.workspace.path);
        assert_eq!(first.repo_root.id, second.repo_root.id);

        let repo_roots = RepoRootStore::new(db.clone())
            .list_all()
            .expect("list repo roots");
        assert_eq!(repo_roots.len(), 1);
        assert_eq!(repo_roots[0].id, first.repo_root.id);

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces SET created_at = ?1 WHERE id = ?2",
                ["2026-01-01T00:00:00Z", first.workspace.id.as_str()],
            )?;
            conn.execute(
                "UPDATE workspaces SET created_at = ?1 WHERE id = ?2",
                ["2026-01-01T00:00:01Z", second.workspace.id.as_str()],
            )?;
            Ok(())
        })
        .expect("pin canonical ordering");

        let resolved = runtime.resolve_from_path(&path).expect("resolve existing");
        assert_eq!(resolved.workspace.id, first.workspace.id);
    }

    #[test]
    fn duplicate_local_workspace_sessions_are_isolated_by_workspace_id() {
        let source = TempDirGuard::new("runtime-duplicate-local-sessions-source");
        let runtime_home = TempDirGuard::new("runtime-duplicate-local-sessions-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let path = source.path().display().to_string();
        let first = runtime
            .create_workspace(&path)
            .expect("create first workspace");
        let second = runtime
            .create_workspace(&path)
            .expect("create duplicate local workspace");
        let session_store = SessionStore::new(db.clone());

        session_store
            .insert(&session_record("session-first", &first.workspace.id))
            .expect("insert first session");
        session_store
            .insert(&session_record("session-second", &second.workspace.id))
            .expect("insert second session");

        let first_sessions = session_store
            .list_visible_by_workspace(&first.workspace.id)
            .expect("list first workspace sessions");
        let second_sessions = session_store
            .list_visible_by_workspace(&second.workspace.id)
            .expect("list second workspace sessions");

        assert_eq!(
            first_sessions
                .iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            vec!["session-first"]
        );
        assert_eq!(
            second_sessions
                .iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            vec!["session-second"]
        );
    }

    #[test]
    fn list_workspaces_returns_stored_branch_without_inline_git_refresh() {
        let source = TempDirGuard::new("runtime-list-stored-branch-source");
        let runtime_home = TempDirGuard::new("runtime-list-stored-branch-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create workspace")
            .workspace;

        run_git(source.path(), ["branch", "-m", "renamed"]);
        let listed = runtime.list_workspaces().expect("list workspaces");
        let listed_workspace = listed
            .iter()
            .find(|record| record.id == workspace.id)
            .expect("listed workspace");

        assert_eq!(listed_workspace.current_branch.as_deref(), Some("main"));
    }

    #[test]
    fn get_workspace_returns_stored_branch_without_inline_git_refresh() {
        let source = TempDirGuard::new("runtime-get-stored-branch-source");
        let runtime_home = TempDirGuard::new("runtime-get-stored-branch-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create workspace")
            .workspace;

        run_git(source.path(), ["branch", "-m", "renamed"]);
        let fetched = runtime
            .get_workspace(&workspace.id)
            .expect("get workspace")
            .expect("workspace exists");

        assert_eq!(fetched.current_branch.as_deref(), Some("main"));
    }

    #[test]
    fn background_branch_refresh_persists_changed_branch_and_throttles() {
        let source = TempDirGuard::new("runtime-branch-refresh-source");
        let runtime_home = TempDirGuard::new("runtime-branch-refresh-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create workspace")
            .workspace;

        run_git(source.path(), ["branch", "-m", "renamed"]);
        let outcome = runtime
            .refresh_workspace_branches_for_test()
            .expect("refresh branches");
        assert_eq!(outcome.schedule.scheduled_count, 1);
        assert_eq!(outcome.updated_count, 1);
        assert_eq!(runtime.scheduled_branch_refresh_batches_for_test(), 1);

        let refreshed = WorkspaceStore::new(db.clone())
            .find_by_id(&workspace.id)
            .expect("load stored workspace")
            .expect("workspace exists");
        assert_eq!(refreshed.current_branch.as_deref(), Some("renamed"));

        let throttled = runtime
            .refresh_workspace_branches_for_test()
            .expect("refresh branches again");
        assert_eq!(throttled.schedule.scheduled_count, 0);
        assert_eq!(throttled.schedule.skipped_throttled_count, 1);
        assert_eq!(runtime.scheduled_branch_refresh_batches_for_test(), 1);
    }

    #[test]
    fn create_workspace_rejects_existing_active_worktree_path() {
        let remote = TempDirGuard::new("runtime-create-existing-worktree-remote");
        let source = TempDirGuard::new("runtime-create-existing-worktree-source");
        let target = TempDirGuard::new("runtime-create-existing-worktree-target");
        let runtime_home = TempDirGuard::new("runtime-create-existing-worktree-home");
        let _ = fs::remove_dir_all(target.path());

        run_git(remote.path(), ["init", "--bare", "-b", "main"]);
        init_repo(source.path());
        let remote_path = remote.path().display().to_string();
        run_git(source.path(), ["remote", "add", "origin", &remote_path]);
        run_git(source.path(), ["push", "-u", "origin", "main"]);

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create source workspace");
        let worktree = runtime
            .create_worktree(
                &source_workspace.repo_root.id,
                &target.path().display().to_string(),
                "feature/existing-worktree",
                Some("main"),
                None,
            )
            .expect("create worktree");

        let error = match runtime.create_workspace(&worktree.workspace.path) {
            Ok(_) => panic!("create should reject existing worktree path"),
            Err(error) => error,
        };

        assert!(error
            .to_string()
            .contains("a workspace record already exists for path"));
    }

    fn init_repo(path: &Path) {
        run_git(path, ["init", "-b", "main"]);
        run_git(path, ["config", "user.email", "codex@example.com"]);
        run_git(path, ["config", "user.name", "Codex"]);
        fs::write(path.join("README.md"), "seed\n").expect("write seed file");
        run_git(path, ["add", "README.md"]);
        run_git(path, ["commit", "-m", "Initial commit"]);
    }

    fn make_runtime(db: &Db, runtime_home: &Path) -> WorkspaceRuntime {
        let workspace_service =
            WorkspaceService::new(WorkspaceStore::new(db.clone()), runtime_home.to_path_buf());
        let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
        WorkspaceRuntime::new(
            workspace_service,
            WorkspaceStore::new(db.clone()),
            WorkspaceDeleteWorkflow::new(
                db.clone(),
                crate::sessions::deletion::SessionDeleteWorkflow::new(db.clone()),
            ),
            repo_root_service,
            runtime_home.to_path_buf(),
        )
    }

    fn session_record(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_scope: None,
            required_agent_auth_revision: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: Some(OriginContext::api_local_runtime()),
        }
    }

    fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn assert_git_ref_missing(cwd: &Path, ref_name: &str) {
        assert_git_command_fails(cwd, ["rev-parse", "--verify", ref_name]);
    }

    fn assert_git_command_fails<const N: usize>(cwd: &Path, args: [&str; N]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            !output.status.success(),
            "git {:?} unexpectedly succeeded with stdout: {}",
            args,
            String::from_utf8_lossy(&output.stdout)
        );
    }

    fn git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }
}
