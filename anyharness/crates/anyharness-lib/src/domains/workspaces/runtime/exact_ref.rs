//! Shared exact-ref worktree mechanics.
//!
//! The branch/SHA validation and clean-tree checks used by both the retained
//! mobility runtime owner (`mobility.rs`) and the public exact-ref workspace
//! materialization service live here so there is exactly one implementation.
//! Worktree *creation* is already single-sourced in
//! `GitService::create_worktree_at_ref`; this module owns the *validation*
//! primitives (HEAD equality + cleanliness) plus a runtime method that
//! allocates a managed-root destination and creates/reuses/adopts a standard
//! worktree at an exact ref.

use std::fs;
use std::path::{Path, PathBuf};

use super::records::build_workspace_record;
use super::WorkspaceRuntime;
use crate::adapters::git::GitService;
use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord, WorkspaceSurface};
use crate::domains::workspaces::resolver;
use crate::origin::OriginContext;

/// Whether the exact-ref creation ran against a fresh path or adopted/reused an
/// existing checkout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExactRefOutcome {
    Created,
    Adopted,
    Reused,
}

/// Result of an exact-ref materialization: the workspace record, the observed
/// HEAD oid, and how the destination was obtained.
#[derive(Debug, Clone)]
pub struct ExactRefWorkspace {
    pub workspace: WorkspaceRecord,
    pub observed_head_sha: String,
    pub outcome: ExactRefOutcome,
}

/// Resolve the exact commit oid a `base_sha` reference points at. Peels tags to
/// the underlying commit (`^{commit}`). Errors if the ref does not exist.
pub(crate) fn resolve_requested_commit(repo_root: &Path, base_sha: &str) -> anyhow::Result<String> {
    GitService::stdout_result(
        repo_root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{base_sha}^{{commit}}"),
        ],
    )
}

/// The current HEAD commit oid of a checkout.
pub(crate) fn worktree_head_oid(repo_root: &Path) -> anyhow::Result<String> {
    GitService::stdout_result(repo_root, &["rev-parse", "HEAD"])
}

/// Whether HEAD points at exactly the requested commit.
pub(crate) fn worktree_head_matches(repo_root: &Path, base_sha: &str) -> anyhow::Result<bool> {
    let head = worktree_head_oid(repo_root)?;
    let requested = resolve_requested_commit(repo_root, base_sha)?;
    Ok(head == requested)
}

/// Whether the working tree (including untracked files) is clean.
pub(crate) fn worktree_is_clean(repo_root: &Path) -> anyhow::Result<bool> {
    let status = GitService::stdout_result(
        repo_root,
        &["status", "--porcelain", "--untracked-files=all"],
    )?;
    Ok(status.trim().is_empty())
}

impl WorkspaceRuntime {
    /// Resolve a validated ordinary managed-worktree destination without
    /// mutating it. The materialization ledger persists this path before Git
    /// creation so a crash retry can inspect and adopt the same checkout.
    pub(crate) fn standard_worktree_destination_path(
        &self,
        repo_root_id: &str,
        destination_id: &str,
    ) -> anyhow::Result<PathBuf> {
        validate_destination_id(destination_id)?;
        Ok(self
            .managed_destinations_base_dir(repo_root_id)?
            .join(destination_id))
    }

    /// Create, reuse, or adopt a standard managed worktree checked out on
    /// `branch_name` at exactly `head_sha`. Destinations live under the normal
    /// managed-worktree root (never `mobility/destinations`).
    ///
    /// Never resets/merges/rebases/stashes/detaches to repair a mismatch: a
    /// wrong branch, wrong HEAD, or dirty tree at the deterministic destination
    /// is an error.
    pub fn create_or_reuse_standard_worktree_at_ref(
        &self,
        repo_root_id: &str,
        branch_name: &str,
        head_sha: &str,
        destination_id: Option<&str>,
        preferred_workspace_name: Option<&str>,
    ) -> anyhow::Result<ExactRefWorkspace> {
        let branch_name = branch_name.trim();
        let head_sha = head_sha.trim();
        if branch_name.is_empty() {
            anyhow::bail!("branch name is required");
        }
        if head_sha.is_empty() {
            anyhow::bail!("head sha is required");
        }

        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let base_dir = self.managed_destinations_base_dir(&repo_root.id)?;
        fs::create_dir_all(&base_dir)?;

        if let Some(destination_id) = destination_id {
            let candidate =
                self.standard_worktree_destination_path(repo_root_id, destination_id)?;
            return self.materialize_at_candidate(&repo_root, &candidate, branch_name, head_sha);
        }

        // Reuse an existing clean worktree already on this branch at this exact
        // commit before allocating a new destination.
        if let Some(existing) =
            self.find_reusable_worktree_at_ref(&repo_root.id, &base_dir, branch_name, head_sha)?
        {
            let observed = worktree_head_oid(Path::new(&existing.path))?;
            return Ok(ExactRefWorkspace {
                workspace: existing,
                observed_head_sha: observed,
                outcome: ExactRefOutcome::Reused,
            });
        }

        let mut slug = sanitize_destination_name(preferred_workspace_name.unwrap_or(branch_name));
        if slug.is_empty() {
            slug = "workspace".to_string();
        }
        let short_sha = head_sha.chars().take(8).collect::<String>();
        let target_path = (0..100)
            .map(|attempt| {
                let suffix = if attempt == 0 {
                    String::new()
                } else {
                    format!("-{}", attempt + 1)
                };
                base_dir.join(format!("{slug}-{short_sha}{suffix}"))
            })
            .find(|candidate| {
                !candidate.exists()
                    && self
                        .store
                        .find_active_by_path(&candidate.to_string_lossy())
                        .ok()
                        .flatten()
                        .is_none()
            })
            .ok_or_else(|| anyhow::anyhow!("unable to allocate a managed worktree destination"))?;

        self.create_worktree_record_at_ref(&repo_root, &target_path, branch_name, head_sha)
    }

    /// Resolve `<managed_worktrees_root>/<repo_root_id>` as the base for
    /// exact-ref destinations, canonicalized so all path-safety checks compare
    /// canonical prefixes.
    fn managed_destinations_base_dir(&self, repo_root_id: &str) -> anyhow::Result<PathBuf> {
        let managed_root = canonical_managed_worktrees_root(&self.runtime_home)?;
        Ok(managed_root.join(repo_root_id))
    }

    /// Materialize at a caller-chosen deterministic `candidate` path: reuse an
    /// active workspace row, adopt an existing on-disk checkout, or create.
    fn materialize_at_candidate(
        &self,
        repo_root: &RepoRootRecord,
        candidate: &Path,
        branch_name: &str,
        head_sha: &str,
    ) -> anyhow::Result<ExactRefWorkspace> {
        let candidate_string = candidate.to_string_lossy().to_string();
        if let Some(existing) = self.store.find_active_by_path(&candidate_string)? {
            self.assert_reusable_workspace_record(&existing, branch_name, head_sha)?;
            let observed = worktree_head_oid(Path::new(&existing.path))?;
            return Ok(ExactRefWorkspace {
                workspace: existing,
                observed_head_sha: observed,
                outcome: ExactRefOutcome::Reused,
            });
        }
        if candidate.exists() {
            return self.adopt_existing_worktree_at_ref(
                repo_root,
                candidate,
                branch_name,
                head_sha,
            );
        }
        self.create_worktree_record_at_ref(repo_root, candidate, branch_name, head_sha)
    }

    /// Assert an already-registered active workspace row is a clean standard
    /// worktree on `branch_name` at exactly `head_sha` (reusable in place).
    fn assert_reusable_workspace_record(
        &self,
        workspace: &WorkspaceRecord,
        branch_name: &str,
        head_sha: &str,
    ) -> anyhow::Result<()> {
        if workspace.kind != WorkspaceKind::Worktree
            || workspace.surface != WorkspaceSurface::Standard
        {
            anyhow::bail!("destination workspace is not a reusable standard worktree");
        }
        let ctx = resolver::resolve_git_context(&workspace.path)?;
        assert_standard_worktree_on_ref(&ctx, branch_name, head_sha)
    }

    /// Find an active, clean standard worktree already checked out on
    /// `branch_name` at `head_sha` within the managed base dir. Returns None if
    /// no match; errors only on unexpected git failures.
    fn find_reusable_worktree_at_ref(
        &self,
        repo_root_id: &str,
        base_dir: &Path,
        branch_name: &str,
        head_sha: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        let canonical_base_dir =
            fs::canonicalize(base_dir).unwrap_or_else(|_| base_dir.to_path_buf());
        for workspace in self.store.list_active_by_repo_root_id(repo_root_id)? {
            if workspace.kind != WorkspaceKind::Worktree
                || workspace.surface != WorkspaceSurface::Standard
                || workspace.current_branch.as_deref() != Some(branch_name)
                || !Path::new(&workspace.path).exists()
                || !Path::new(&workspace.path).starts_with(&canonical_base_dir)
            {
                continue;
            }
            let ctx = match resolver::resolve_git_context(&workspace.path) {
                Ok(ctx) => ctx,
                Err(_) => continue,
            };
            if !ctx.is_worktree || ctx.current_branch.as_deref() != Some(branch_name) {
                continue;
            }
            let repo_root_path = Path::new(&ctx.repo_root);
            if !worktree_head_matches(repo_root_path, head_sha)? {
                continue;
            }
            if !worktree_is_clean(repo_root_path)? {
                continue;
            }
            return Ok(Some(workspace));
        }
        Ok(None)
    }

    /// Adopt an existing on-disk checkout at `target_path` as a workspace
    /// record, only after confirming it is a clean standard worktree on
    /// `branch_name` at exactly `head_sha`.
    fn adopt_existing_worktree_at_ref(
        &self,
        repo_root: &RepoRootRecord,
        target_path: &Path,
        branch_name: &str,
        head_sha: &str,
    ) -> anyhow::Result<ExactRefWorkspace> {
        let target_path_string = target_path.to_string_lossy().to_string();
        if let Some(retired) = self
            .store
            .find_retired_incomplete_cleanup_by_path_and_kind(
                &target_path_string,
                WorkspaceKind::Worktree,
            )?
        {
            anyhow::bail!(
                "destination path has pending cleanup from retired workspace {}",
                retired.id
            );
        }
        let ctx = resolver::resolve_git_context(&target_path_string).map_err(|error| {
            anyhow::anyhow!(
                "destination path already exists but is not a usable git worktree: {error}"
            )
        })?;
        assert_standard_worktree_on_ref(&ctx, branch_name, head_sha)?;
        let observed = worktree_head_oid(Path::new(&ctx.repo_root))?;
        let record = build_workspace_record(
            repo_root,
            &ctx.repo_root,
            WorkspaceKind::Worktree,
            WorkspaceSurface::Standard,
            ctx.current_branch.clone(),
            ctx.current_branch.clone(),
            OriginContext::system_local_runtime(),
            None,
        );
        self.store.insert(&record)?;
        Ok(ExactRefWorkspace {
            workspace: record,
            observed_head_sha: observed,
            outcome: ExactRefOutcome::Adopted,
        })
    }

    /// Create a fresh worktree at `target_path` on `branch_name` at `head_sha`
    /// and register the workspace record.
    fn create_worktree_record_at_ref(
        &self,
        repo_root: &RepoRootRecord,
        target_path: &Path,
        branch_name: &str,
        head_sha: &str,
    ) -> anyhow::Result<ExactRefWorkspace> {
        let target_path_string = target_path.to_string_lossy().to_string();
        GitService::create_worktree_at_ref(
            &repo_root.path,
            &target_path_string,
            branch_name,
            head_sha,
        )?;
        let ctx = resolver::resolve_git_context(&target_path_string)?;
        let observed = worktree_head_oid(Path::new(&ctx.repo_root))?;
        let record = build_workspace_record(
            repo_root,
            &ctx.repo_root,
            WorkspaceKind::Worktree,
            WorkspaceSurface::Standard,
            ctx.current_branch.clone(),
            ctx.current_branch.clone(),
            OriginContext::system_local_runtime(),
            None,
        );
        self.store.insert(&record)?;
        Ok(ExactRefWorkspace {
            workspace: record,
            observed_head_sha: observed,
            outcome: ExactRefOutcome::Created,
        })
    }
}

/// Assert a resolved git context is a standard worktree on the requested
/// case-sensitive `branch_name` at exactly `head_sha`, with a clean tree.
pub(crate) fn assert_standard_worktree_on_ref(
    ctx: &crate::domains::workspaces::model::ResolvedGitContext,
    branch_name: &str,
    head_sha: &str,
) -> anyhow::Result<()> {
    if !ctx.is_worktree {
        anyhow::bail!("destination path is not a git worktree");
    }
    if ctx.current_branch.as_deref() != Some(branch_name) {
        anyhow::bail!(
            "destination is on branch {}, not requested branch {branch_name}",
            ctx.current_branch.as_deref().unwrap_or("<detached>")
        );
    }
    let repo_root = Path::new(&ctx.repo_root);
    if !worktree_head_matches(repo_root, head_sha)? {
        let actual = worktree_head_oid(repo_root)?;
        anyhow::bail!("destination is at {actual}, not requested commit for {head_sha}");
    }
    if !worktree_is_clean(repo_root)? {
        anyhow::bail!("destination worktree has uncommitted changes");
    }
    Ok(())
}

fn sanitize_destination_name(value: &str) -> String {
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

fn validate_destination_id(value: &str) -> anyhow::Result<()> {
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
