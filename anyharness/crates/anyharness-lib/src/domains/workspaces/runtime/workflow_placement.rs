//! The narrow, workspace-owned exact ensure/adopt seam for Workflow placement
//! (spec `workflow-workspace-placement`). It resolves the deterministic path and
//! immutable base OID, then materializes exactly one visible ordinary workspace
//! — creating fresh, or adopting an exact orphan artifact from a crash gap. It
//! is fail-closed: on any mismatch it never deletes, resets, checks out,
//! renames, or suffixes. It is not a public generic idempotency framework.

use std::path::{Path, PathBuf};

use super::exact_ref::{
    assert_standard_worktree_on_ref, resolve_requested_commit, worktree_head_oid, worktree_is_clean,
};
use super::records::build_workspace_record;
use super::WorkspaceRuntime;
use crate::adapters::git::GitService;
use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord, WorkspaceSurface};
use crate::domains::workspaces::resolver;
use crate::domains::workspaces::workflow_placement::{
    ResolvedWorkflowPlacement, WorkflowPlacementError, WorkflowPlacementRequest,
};
use crate::origin::OriginContext;

impl WorkspaceRuntime {
    /// Resolve a placement request into its immutable form: the deterministic
    /// target path and, for a repository worktree, the exact base OID resolved
    /// from the requested ref before any effect. This performs no filesystem or
    /// Git artifact effect.
    pub fn resolve_workflow_placement(
        &self,
        request: &WorkflowPlacementRequest,
    ) -> Result<ResolvedWorkflowPlacement, WorkflowPlacementError> {
        let run_id = request.run_id().to_string();
        let target_path = self.deterministic_workflow_path(&run_id)?;
        match request {
            WorkflowPlacementRequest::Scratch { .. } => Ok(ResolvedWorkflowPlacement::Scratch {
                run_id,
                target_path,
            }),
            WorkflowPlacementRequest::RepositoryWorktree {
                repo_root_id,
                base_ref,
                ..
            } => {
                let repo_root = self
                    .repo_root_service
                    .get_repo_root(repo_root_id)
                    .map_err(WorkflowPlacementError::Git)?
                    .ok_or(WorkflowPlacementError::RepoRootNotFound)?;
                // `resolve_requested_commit` peels to `<baseRef>^{commit}`, so an
                // annotated tag yields the commit it points at (what a checkout
                // will actually land HEAD on), never the tag object's own OID.
                let base_oid = resolve_requested_commit(Path::new(&repo_root.path), base_ref)
                    .map_err(|_error| WorkflowPlacementError::BaseRefUnresolvable)?;
                Ok(ResolvedWorkflowPlacement::RepositoryWorktree {
                    run_id: run_id.clone(),
                    repo_root_id: repo_root_id.clone(),
                    base_ref: base_ref.clone(),
                    base_oid,
                    branch: workflow_branch(&run_id),
                    target_path,
                })
            }
        }
    }

    /// Materialize exactly one visible ordinary workspace for the resolved
    /// placement, or adopt the exact artifact left by a crash gap. Fail-closed
    /// and never destructive.
    pub fn ensure_workflow_workspace(
        &self,
        resolved: &ResolvedWorkflowPlacement,
    ) -> Result<WorkspaceRecord, WorkflowPlacementError> {
        let target_path = resolved.target_path();

        // PATH-01: before any filesystem/Git effect or adoption, prove the
        // target is a symlink-free descendant of the canonical managed root. A
        // preplaced symlink at `workflows/` or `workflows/<runId>` must never
        // let this API initialize or adopt a repository outside the tree.
        self.assert_target_contained(target_path)?;

        // Rule 1+4/5: a workspace row already claims this deterministic path.
        // Adopt only on an exact Workflow-provenance and placement-field match.
        if let Some(existing) = self
            .store
            .find_active_by_path(target_path)
            .map_err(WorkflowPlacementError::Git)?
        {
            self.validate_workflow_workspace_row(&existing, resolved)?;
            return Ok(existing);
        }

        // Rule 3: a Git artifact exists without a workspace row (crash between
        // artifact creation and row insert). Adopt only on an exact shape match.
        if Path::new(target_path).exists() {
            self.validate_workflow_orphan_artifact(resolved)?;
            return self.register_workflow_artifact(resolved);
        }

        // Rule 2: nothing exists — create through the workspace-owned seam.
        match resolved {
            ResolvedWorkflowPlacement::Scratch {
                run_id,
                target_path,
            } => self.create_scratch_workflow_workspace(run_id, target_path),
            ResolvedWorkflowPlacement::RepositoryWorktree {
                run_id,
                repo_root_id,
                base_oid,
                branch,
                target_path,
                ..
            } => self.create_repository_workflow_worktree(
                run_id,
                repo_root_id,
                base_oid,
                branch,
                target_path,
            ),
        }
    }

    /// The deterministic target path `<canonical-managed-root>/workflows/<runId>`.
    /// PATH-01: fail closed on canonical-root errors (a relative/invalid
    /// `ANYHARNESS_WORKTREES_ROOT` is rejected by the owning seam and must not
    /// fall back to the raw configured value).
    fn deterministic_workflow_path(&self, run_id: &str) -> Result<String, WorkflowPlacementError> {
        let root = canonical_managed_worktrees_root(&self.runtime_home).map_err(|_error| {
            WorkflowPlacementError::Git(anyhow::anyhow!(
                "managed worktrees root could not be resolved"
            ))
        })?;
        Ok(root
            .join("workflows")
            .join(run_id)
            .to_string_lossy()
            .to_string())
    }

    /// Prove the target is contained in the canonical managed root and no
    /// existing component along `<root>/workflows/<runId>` is a symlink. Fail
    /// closed (never destructive) if a preplaced symlink could escape the tree.
    fn assert_target_contained(&self, target_path: &str) -> Result<(), WorkflowPlacementError> {
        let root = canonical_managed_worktrees_root(&self.runtime_home).map_err(|_error| {
            WorkflowPlacementError::Git(anyhow::anyhow!(
                "managed worktrees root could not be resolved"
            ))
        })?;
        let target = Path::new(target_path);
        // Lexical containment: the deterministic path is built from the
        // canonical root plus fixed components, so this must hold by
        // construction; a mismatch is a hostile/ambiguous path.
        if !target.starts_with(&root) {
            return Err(WorkflowPlacementError::Mismatch(
                "target path escapes managed root".into(),
            ));
        }
        // No existing component below the root may be a symlink. Walk each
        // component `root/workflows`, `root/workflows/<runId>` and reject a
        // symlink that could redirect creation/adoption outside the tree.
        let suffix = target.strip_prefix(&root).map_err(|_| {
            WorkflowPlacementError::Mismatch("target path escapes managed root".into())
        })?;
        let mut current = root.clone();
        for component in suffix.components() {
            current = current.join(component);
            match std::fs::symlink_metadata(&current) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    return Err(WorkflowPlacementError::Mismatch(
                        "target path traverses a symlink".into(),
                    ));
                }
                // Missing component (not yet created) or plain dir: fine.
                _ => {}
            }
        }
        Ok(())
    }

    // ── Fresh creation (rule 2) ──────────────────────────────────────────────

    fn create_scratch_workflow_workspace(
        &self,
        run_id: &str,
        target_path: &str,
    ) -> Result<WorkspaceRecord, WorkflowPlacementError> {
        if let Some(parent) = Path::new(target_path).parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                WorkflowPlacementError::Git(anyhow::anyhow!(
                    "failed to create scratch parent directory: {error}"
                ))
            })?;
        }
        GitService::init_scratch_repository(target_path).map_err(WorkflowPlacementError::Git)?;
        let repo_root = self
            .resolve_repo_root_from_path(target_path)
            .map_err(|error| WorkflowPlacementError::Git(anyhow::Error::new(error)))?;
        self.insert_workflow_workspace_record(
            &repo_root,
            target_path,
            WorkspaceKind::Local,
            Some(scratch_branch()),
            run_id,
        )
    }

    fn create_repository_workflow_worktree(
        &self,
        run_id: &str,
        repo_root_id: &str,
        base_oid: &str,
        branch: &str,
        target_path: &str,
    ) -> Result<WorkspaceRecord, WorkflowPlacementError> {
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)
            .map_err(WorkflowPlacementError::Git)?
            .ok_or(WorkflowPlacementError::RepoRootNotFound)?;
        if let Some(parent) = Path::new(target_path).parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                WorkflowPlacementError::Git(anyhow::anyhow!(
                    "failed to create worktree parent directory: {error}"
                ))
            })?;
        }
        // Create the branch at the exact persisted OID, name-conflict policy
        // Fail (never suffix path or branch); create from the persisted OID, not
        // by resolving the ref again. This seam is secret-safe: no raw Git
        // stderr can reach the stored/logged failure detail (FAILURE-01).
        GitService::create_workflow_worktree(&repo_root.path, target_path, branch, base_oid)
            .map_err(WorkflowPlacementError::Git)?;
        // GIT-01: verify the created checkout's HEAD is exactly the persisted
        // base OID before declaring readiness / inserting the row.
        self.assert_head_matches(target_path, base_oid)?;
        self.insert_workflow_workspace_record(
            &repo_root,
            target_path,
            WorkspaceKind::Worktree,
            Some(branch.to_string()),
            run_id,
        )
    }

    // ── Orphan artifact adoption (rule 3) ────────────────────────────────────

    fn register_workflow_artifact(
        &self,
        resolved: &ResolvedWorkflowPlacement,
    ) -> Result<WorkspaceRecord, WorkflowPlacementError> {
        match resolved {
            ResolvedWorkflowPlacement::Scratch {
                run_id,
                target_path,
            } => {
                let repo_root = self
                    .resolve_repo_root_from_path(target_path)
                    .map_err(|error| WorkflowPlacementError::Git(anyhow::Error::new(error)))?;
                self.insert_workflow_workspace_record(
                    &repo_root,
                    target_path,
                    WorkspaceKind::Local,
                    Some(scratch_branch()),
                    run_id,
                )
            }
            ResolvedWorkflowPlacement::RepositoryWorktree {
                run_id,
                repo_root_id,
                branch,
                target_path,
                ..
            } => {
                let repo_root = self
                    .repo_root_service
                    .get_repo_root(repo_root_id)
                    .map_err(WorkflowPlacementError::Git)?
                    .ok_or(WorkflowPlacementError::RepoRootNotFound)?;
                self.insert_workflow_workspace_record(
                    &repo_root,
                    target_path,
                    WorkspaceKind::Worktree,
                    Some(branch.clone()),
                    run_id,
                )
            }
        }
    }

    fn insert_workflow_workspace_record(
        &self,
        repo_root: &RepoRootRecord,
        target_path: &str,
        kind: WorkspaceKind,
        branch: Option<String>,
        run_id: &str,
    ) -> Result<WorkspaceRecord, WorkflowPlacementError> {
        let canonical_path = std::fs::canonicalize(target_path)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| target_path.to_string());
        let mut record = build_workspace_record(
            repo_root,
            &canonical_path,
            kind,
            WorkspaceSurface::Standard,
            branch.clone(),
            branch,
            OriginContext::api_local_runtime(),
            Some(WorkspaceCreatorContext::Workflow {
                run_id: run_id.to_string(),
            }),
        );
        record.display_name = Some(workflow_display_name(run_id));
        self.store
            .insert(&record)
            .map_err(WorkflowPlacementError::Git)?;
        Ok(record)
    }

    // ── Exact-match validation (rules 4/5/6) ─────────────────────────────────

    fn validate_workflow_workspace_row(
        &self,
        existing: &WorkspaceRecord,
        resolved: &ResolvedWorkflowPlacement,
    ) -> Result<(), WorkflowPlacementError> {
        // Rule 4: adopt only when the creator context is exactly Workflow for
        // this run.
        let creator_run = existing
            .creator_context
            .as_ref()
            .and_then(WorkspaceCreatorContext::workflow_run_id);
        if creator_run != Some(resolved.run_id()) {
            return Err(WorkflowPlacementError::Mismatch(
                "existing workspace is not Workflow provenance for this run".into(),
            ));
        }
        if existing.path != resolved.target_path() {
            return Err(WorkflowPlacementError::Mismatch("workspace path".into()));
        }
        match resolved {
            ResolvedWorkflowPlacement::Scratch { .. } => {
                if existing.kind != WorkspaceKind::Local {
                    return Err(WorkflowPlacementError::Mismatch("scratch kind".into()));
                }
                // ADOPTION-01: an existing row is not enough — reprove the exact
                // scratch initialization contract on disk (branch main, one
                // empty commit, no remote, stable identity, clean worktree).
                self.assert_scratch_shape(&existing.path)?;
            }
            ResolvedWorkflowPlacement::RepositoryWorktree {
                repo_root_id,
                base_oid,
                branch,
                ..
            } => {
                if existing.kind != WorkspaceKind::Worktree {
                    return Err(WorkflowPlacementError::Mismatch("worktree kind".into()));
                }
                if &existing.repo_root_id != repo_root_id {
                    return Err(WorkflowPlacementError::Mismatch("repo root".into()));
                }
                if existing.current_branch.as_deref() != Some(branch.as_str())
                    && existing.original_branch.as_deref() != Some(branch.as_str())
                {
                    return Err(WorkflowPlacementError::Mismatch("branch".into()));
                }
                // ADOPTION-01: prove linkage + exact source common dir even for
                // an existing row (a squatting standalone/nested repo must not
                // be adopted merely because the row's fields line up).
                let repo_root = self
                    .repo_root_service
                    .get_repo_root(repo_root_id)
                    .map_err(WorkflowPlacementError::Git)?
                    .ok_or(WorkflowPlacementError::RepoRootNotFound)?;
                self.assert_linked_worktree_of(&existing.path, &repo_root.path)?;
                self.assert_standard_worktree_shape(&existing.path, branch, base_oid)?;
            }
        }
        Ok(())
    }

    fn validate_workflow_orphan_artifact(
        &self,
        resolved: &ResolvedWorkflowPlacement,
    ) -> Result<(), WorkflowPlacementError> {
        match resolved {
            ResolvedWorkflowPlacement::Scratch { target_path, .. } => {
                // Exact scratch shape + clean initialization + stable identity.
                // Never adopt an arbitrary pre-existing directory.
                self.assert_scratch_shape(target_path)
            }
            ResolvedWorkflowPlacement::RepositoryWorktree {
                repo_root_id,
                base_oid,
                branch,
                target_path,
                ..
            } => {
                let repo_root = self
                    .repo_root_service
                    .get_repo_root(repo_root_id)
                    .map_err(WorkflowPlacementError::Git)?
                    .ok_or(WorkflowPlacementError::RepoRootNotFound)?;
                self.assert_linked_worktree_of(target_path, &repo_root.path)?;
                self.assert_standard_worktree_shape(target_path, branch, base_oid)
            }
        }
    }

    /// Prove the exact scratch initialization contract on disk: branch `main`,
    /// exactly one empty initial commit, no remote, the stable AnyHarness scratch
    /// identity, and a clean worktree.
    fn assert_scratch_shape(&self, checkout_path: &str) -> Result<(), WorkflowPlacementError> {
        let checkout = Path::new(checkout_path);
        let branch =
            GitService::checkout_current_branch(checkout).map_err(|_| scratch_shape_mismatch())?;
        if branch.as_deref() != Some(scratch_branch().as_str()) {
            return Err(scratch_shape_mismatch());
        }
        if GitService::head_commit_count(checkout).map_err(|_| scratch_shape_mismatch())? != 1 {
            return Err(scratch_shape_mismatch());
        }
        if !GitService::head_tree_is_empty(checkout).map_err(|_| scratch_shape_mismatch())? {
            return Err(scratch_shape_mismatch());
        }
        if !GitService::has_no_remotes(checkout).map_err(|_| scratch_shape_mismatch())? {
            return Err(scratch_shape_mismatch());
        }
        if !GitService::scratch_identity_matches(checkout).map_err(|_| scratch_shape_mismatch())? {
            return Err(scratch_shape_mismatch());
        }
        if !worktree_is_clean(checkout).map_err(|_| scratch_shape_mismatch())? {
            return Err(scratch_shape_mismatch());
        }
        Ok(())
    }

    /// Prove `checkout_path` is a linked worktree whose shared common git dir is
    /// exactly the expected source repository's own common git dir. Rejects a
    /// standalone/primary checkout (not linked) and a nested-but-different repo
    /// (common dir mismatch).
    fn assert_linked_worktree_of(
        &self,
        checkout_path: &str,
        repo_root_path: &str,
    ) -> Result<(), WorkflowPlacementError> {
        let checkout = Path::new(checkout_path);
        if !GitService::is_linked_worktree(checkout)
            .map_err(|_| WorkflowPlacementError::Mismatch("not a linked worktree".into()))?
        {
            return Err(WorkflowPlacementError::Mismatch(
                "not a linked worktree".into(),
            ));
        }
        let expected = GitService::common_git_dir(Path::new(repo_root_path))
            .map_err(WorkflowPlacementError::Git)?;
        let actual = GitService::common_git_dir(checkout).map_err(WorkflowPlacementError::Git)?;
        if canonicalize(&expected) != canonicalize(&actual) {
            return Err(WorkflowPlacementError::Mismatch("common dir".into()));
        }
        Ok(())
    }

    fn assert_standard_worktree_shape(
        &self,
        checkout_path: &str,
        branch: &str,
        base_oid: &str,
    ) -> Result<(), WorkflowPlacementError> {
        let ctx = resolver::resolve_git_context(checkout_path)
            .map_err(|_| WorkflowPlacementError::Mismatch("worktree shape".into()))?;
        assert_standard_worktree_on_ref(&ctx, branch, base_oid)
            .map_err(|_| WorkflowPlacementError::Mismatch("worktree shape".into()))
    }

    fn assert_head_matches(
        &self,
        checkout_path: &str,
        expected_oid: &str,
    ) -> Result<(), WorkflowPlacementError> {
        let head =
            worktree_head_oid(Path::new(checkout_path)).map_err(WorkflowPlacementError::Git)?;
        if head != expected_oid {
            return Err(WorkflowPlacementError::Mismatch("base OID".into()));
        }
        Ok(())
    }
}

fn canonicalize(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf())
}

fn scratch_shape_mismatch() -> WorkflowPlacementError {
    WorkflowPlacementError::Mismatch("scratch shape".into())
}

fn workflow_branch(run_id: &str) -> String {
    format!("workflow/{run_id}")
}

fn scratch_branch() -> String {
    crate::adapters::git::operations::scratch::SCRATCH_INITIAL_BRANCH.to_string()
}

fn workflow_display_name(run_id: &str) -> String {
    format!("Workflow run {run_id}")
}
