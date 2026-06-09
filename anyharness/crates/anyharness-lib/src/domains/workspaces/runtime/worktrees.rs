use std::fs;
use std::path::Path;
use std::time::Instant;

use super::records::build_workspace_record;
use super::WorkspaceRuntime;
use crate::adapters::git::GitService;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceSurface};
use crate::domains::workspaces::types::CreateWorktreeResult;
use crate::domains::workspaces::worktree_checkout::WorktreeCheckoutMode;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
use crate::origin::OriginContext;

const MAX_WORKTREE_NAME_ATTEMPTS: usize = 10_000;

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
            WorktreeNameConflictPolicy::Fail,
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
        name_conflict_policy: WorktreeNameConflictPolicy,
        origin: OriginContext,
        creator_context: Option<WorkspaceCreatorContext>,
    ) -> anyhow::Result<CreateWorktreeResult> {
        self.create_worktree_with_surface_and_checkout_mode(
            repo_root_id,
            target_path,
            new_branch_name,
            base_branch,
            _setup_script,
            surface,
            WorktreeCheckoutMode::NewBranch,
            name_conflict_policy,
            origin,
            creator_context,
        )
    }

    pub fn create_worktree_with_surface_and_checkout_mode(
        &self,
        repo_root_id: &str,
        target_path: &str,
        new_branch_name: &str,
        base_branch: Option<&str>,
        _setup_script: Option<&str>,
        surface: &str,
        checkout_mode: WorktreeCheckoutMode,
        name_conflict_policy: WorktreeNameConflictPolicy,
        origin: OriginContext,
        creator_context: Option<WorkspaceCreatorContext>,
    ) -> anyhow::Result<CreateWorktreeResult> {
        let started = Instant::now();
        let effective_conflict_policy =
            effective_name_conflict_policy(checkout_mode, name_conflict_policy);
        tracing::info!(
            repo_root_id = %repo_root_id,
            target_path = %target_path,
            new_branch_name = %new_branch_name,
            base_branch = ?base_branch,
            surface = %surface,
            checkout_mode = ?checkout_mode,
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

        for attempt_index in 0..MAX_WORKTREE_NAME_ATTEMPTS {
            let suffix = if attempt_index == 0 {
                None
            } else {
                Some(attempt_index + 1)
            };
            let candidate =
                effective_conflict_policy.candidate(target_path, new_branch_name, suffix);
            let candidate_target_path = candidate.target_path.to_string_lossy().to_string();
            let canonical_target = canonical_target_path(&candidate.target_path);
            let canonical_candidate_path = canonical_target.to_string_lossy().to_string();

            if checkout_mode.creates_branch()
                && GitService::ref_exists(
                    Path::new(&source.path),
                    &format!("refs/heads/{}", candidate.branch_name),
                )
            {
                if effective_conflict_policy.can_retry_branch() {
                    continue;
                }
                anyhow::bail!("worktree branch already exists: {}", candidate.branch_name);
            }

            let existing_lookup_started = Instant::now();
            if let Some(error) = self.path_conflict_error(&canonical_target)? {
                if effective_conflict_policy.can_retry() {
                    continue;
                }
                return Err(error);
            }
            tracing::info!(
                repo_root_id = %repo_root_id,
                target_path = %canonical_candidate_path,
                new_branch_name = %candidate.branch_name,
                checkout_mode = ?checkout_mode,
                elapsed_ms = existing_lookup_started.elapsed().as_millis(),
                "[workspace-latency] workspace.worktree.runtime_create.path_checked"
            );

            match create_git_worktree_for_checkout_mode(
                checkout_mode,
                &source.path,
                &candidate_target_path,
                &candidate.branch_name,
                base_branch,
            ) {
                Ok(()) => {
                    // The pre-create canonical target is only for checking the
                    // requested target before it exists. Persist the canonical
                    // path of the worktree that git actually materialized.
                    let canonical_path = fs::canonicalize(&candidate_target_path)
                        .map_err(|error| {
                            anyhow::anyhow!(
                                "failed to canonicalize created worktree path {}: {error}",
                                candidate_target_path
                            )
                        })?
                        .to_string_lossy()
                        .to_string();

                    return self.insert_created_worktree_record(
                        &source,
                        repo_root_id,
                        &canonical_path,
                        &candidate.branch_name,
                        base_branch,
                        checkout_mode,
                        surface,
                        origin,
                        creator_context,
                        started,
                    );
                }
                Err(error)
                    if should_retry_git_worktree_name_error(&error, effective_conflict_policy) =>
                {
                    continue;
                }
                Err(error) => return Err(error),
            }
        }

        anyhow::bail!(
            "could not find an available worktree path for {target_path} after {MAX_WORKTREE_NAME_ATTEMPTS} attempts"
        )
    }

    fn path_conflict_error(
        &self,
        canonical_target: &Path,
    ) -> anyhow::Result<Option<anyhow::Error>> {
        let canonical_path = canonical_target.to_string_lossy().to_string();
        if canonical_target.exists() {
            return Ok(Some(anyhow::anyhow!(
                "worktree target path already exists: {canonical_path}"
            )));
        }

        // Worktrees own their materialized checkout path across workspace
        // kinds; do not create a worktree where any active workspace points.
        if self.store.find_active_by_path(&canonical_path)?.is_some() {
            return Ok(Some(anyhow::anyhow!(
                "a workspace record already exists for path: {canonical_path}"
            )));
        }
        if let Some(retired) = self
            .store
            .find_retired_incomplete_cleanup_by_path_and_kind(
                &canonical_path,
                WorkspaceKind::Worktree,
            )?
        {
            return Ok(Some(anyhow::anyhow!(
                "workspace path still has pending cleanup from retired workspace {}: {}",
                retired.id,
                canonical_path
            )));
        }
        Ok(None)
    }

    fn insert_created_worktree_record(
        &self,
        source: &crate::domains::repo_roots::model::RepoRootRecord,
        repo_root_id: &str,
        canonical_path: &str,
        branch_name: &str,
        base_branch: Option<&str>,
        checkout_mode: WorktreeCheckoutMode,
        surface: &str,
        origin: OriginContext,
        creator_context: Option<WorkspaceCreatorContext>,
        started: Instant,
    ) -> anyhow::Result<CreateWorktreeResult> {
        let record = build_workspace_record(
            source,
            canonical_path,
            WorkspaceKind::Worktree,
            WorkspaceSurface::try_from(surface)?,
            current_branch_for_checkout_mode(checkout_mode, branch_name),
            original_branch_for_checkout_mode(checkout_mode, branch_name, base_branch),
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

fn canonical_target_path(target: &Path) -> std::path::PathBuf {
    target
        .parent()
        .and_then(|parent| std::fs::canonicalize(parent).ok())
        .map(|parent| parent.join(target.file_name().unwrap_or_default()))
        .unwrap_or_else(|| target.to_path_buf())
}

fn effective_name_conflict_policy(
    checkout_mode: WorktreeCheckoutMode,
    policy: WorktreeNameConflictPolicy,
) -> WorktreeNameConflictPolicy {
    match (checkout_mode, policy) {
        (WorktreeCheckoutMode::DetachedRef, WorktreeNameConflictPolicy::SuffixPathAndBranch) => {
            WorktreeNameConflictPolicy::SuffixPath
        }
        _ => policy,
    }
}

fn create_git_worktree_for_checkout_mode(
    checkout_mode: WorktreeCheckoutMode,
    source_repo_root: &str,
    target_path: &str,
    branch_name: &str,
    base_branch: Option<&str>,
) -> anyhow::Result<()> {
    match checkout_mode {
        WorktreeCheckoutMode::NewBranch => {
            GitService::create_worktree(source_repo_root, target_path, branch_name, base_branch)
        }
        WorktreeCheckoutMode::DetachedRef => {
            GitService::create_detached_worktree(source_repo_root, target_path, base_branch)
        }
    }
}

fn current_branch_for_checkout_mode(
    checkout_mode: WorktreeCheckoutMode,
    branch_name: &str,
) -> Option<String> {
    match checkout_mode {
        WorktreeCheckoutMode::NewBranch => Some(branch_name.to_string()),
        WorktreeCheckoutMode::DetachedRef => None,
    }
}

fn original_branch_for_checkout_mode(
    checkout_mode: WorktreeCheckoutMode,
    branch_name: &str,
    base_branch: Option<&str>,
) -> Option<String> {
    match checkout_mode {
        WorktreeCheckoutMode::NewBranch => Some(branch_name.to_string()),
        WorktreeCheckoutMode::DetachedRef => Some(base_branch.unwrap_or("HEAD").to_string()),
    }
}

fn should_retry_git_worktree_name_error(
    error: &anyhow::Error,
    policy: WorktreeNameConflictPolicy,
) -> bool {
    if !policy.can_retry() {
        return false;
    }
    let message = error.to_string().to_lowercase();
    if message.contains("already exists") && !git_error_mentions_branch_conflict(&message) {
        return true;
    }
    policy.can_retry_branch() && git_error_mentions_branch_conflict(&message)
}

fn git_error_mentions_branch_conflict(message: &str) -> bool {
    message.contains("branch named")
        || message.contains("a branch")
        || (message.contains("branch") && message.contains("already exists"))
}
