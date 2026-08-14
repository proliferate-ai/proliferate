use std::path::{Path, PathBuf};
use std::time::Duration;

use super::default_branch;
use super::executor::resolve_git_repo_root;
pub use super::operations::clone::CloneError;
use super::operations::snapshot::WorkspaceSnapshot;
use super::operations::worktree_branch;
use super::operations::worktree_restore::WorktreeRestoreOptions;
use super::operations::{
    branches, clone, commit, commit_all, diff, diff_files, push, revert_patches, scratch,
    snapshot, snapshot_restore, staging, status, status_summary, worktrees,
};
use super::types::{
    CommitError, GitBranch, GitBranchDiffFilesResult, GitDiffError, GitDiffResult, GitDiffScope,
    GitRevertPatchEntry, GitRevertPatchesError, GitRevertPatchesResult, GitStatusSnapshot,
    GitStatusSummarySnapshot, GitWorktreeRestoreError, GitWorktreeRestoreOutcome, PushError,
    QuiesceReport, SnapshotError, SnapshotNotice, WorktreeBaseFetch, WorktreeRegistration,
    WorktreeRemoveError, WorktreeRemoveOutcome,
};

pub struct GitService;

impl GitService {
    pub fn resolve_repo_root(workspace_path: &Path) -> anyhow::Result<PathBuf> {
        resolve_git_repo_root(workspace_path)
    }

    pub fn status(workspace_id: &str, workspace_path: &Path) -> anyhow::Result<GitStatusSnapshot> {
        status::status(workspace_id, workspace_path)
    }

    pub fn status_summary(workspace_path: &Path) -> GitStatusSummarySnapshot {
        status_summary::status_summary(workspace_path)
    }

    pub fn diff_for_path(workspace_path: &Path, file_path: &str) -> anyhow::Result<GitDiffResult> {
        Self::diff_for_path_with_scope(
            workspace_path,
            file_path,
            GitDiffScope::WorkingTree,
            None,
            None,
        )
        .map_err(anyhow::Error::from)
    }

    pub fn diff_for_path_with_scope(
        workspace_path: &Path,
        file_path: &str,
        scope: GitDiffScope,
        base_ref: Option<&str>,
        old_path: Option<&str>,
    ) -> Result<GitDiffResult, GitDiffError> {
        diff::diff_for_path_with_scope(workspace_path, file_path, scope, base_ref, old_path)
    }

    pub fn branch_diff_files(
        workspace_path: &Path,
        base_ref: Option<&str>,
    ) -> Result<GitBranchDiffFilesResult, GitDiffError> {
        diff_files::branch_diff_files(workspace_path, base_ref)
    }

    pub fn base_worktree_diff_files(
        workspace_path: &Path,
        base_ref: Option<&str>,
    ) -> Result<GitBranchDiffFilesResult, GitDiffError> {
        diff_files::base_worktree_diff_files(workspace_path, base_ref)
    }

    pub fn list_branches(workspace_path: &Path) -> anyhow::Result<Vec<GitBranch>> {
        branches::list_branches(workspace_path)
    }

    pub fn head_is_ancestor_of(workspace_path: &Path, base_ref: &str) -> anyhow::Result<bool> {
        branches::head_is_ancestor_of(workspace_path, base_ref)
    }

    pub fn resolve_ref_oid(workspace_path: &Path, ref_name: &str) -> anyhow::Result<String> {
        branches::resolve_ref_oid(workspace_path, ref_name)
    }

    pub fn detect_default_branch(repo_root: &Path) -> Option<String> {
        default_branch::detect_default_branch(repo_root)
    }

    pub fn create_worktree(
        source_repo_root: &str,
        target_path: &str,
        new_branch: &str,
        base_branch: Option<&str>,
    ) -> anyhow::Result<()> {
        worktrees::create_worktree(source_repo_root, target_path, new_branch, base_branch)
    }

    pub fn create_detached_worktree(
        source_repo_root: &str,
        target_path: &str,
        base_branch: Option<&str>,
    ) -> anyhow::Result<()> {
        worktrees::create_detached_worktree(source_repo_root, target_path, base_branch)
    }

    /// Clone `clone_url` into `target_path` using the ambient local Git
    /// credential chain. Auth failures are classified as `CloneError::AuthRequired`.
    pub fn clone_repository(clone_url: &str, target_path: &str) -> Result<(), CloneError> {
        clone::clone_repository(clone_url, target_path)
    }

    pub fn create_worktree_at_ref(
        source_repo_root: &str,
        target_path: &str,
        branch_name: &str,
        exact_ref: &str,
    ) -> anyhow::Result<()> {
        worktrees::create_worktree_at_ref(source_repo_root, target_path, branch_name, exact_ref)
    }

    pub fn fetch_worktree_base(repo_root: &Path, branch_name: &str) -> WorktreeBaseFetch {
        worktrees::fetch_worktree_base(repo_root, branch_name)
    }

    pub fn restore_worktree(
        source_repo_root: &Path,
        target_path: &Path,
        options: WorktreeRestoreOptions<'_>,
    ) -> Result<GitWorktreeRestoreOutcome, GitWorktreeRestoreError> {
        super::operations::worktree_restore::restore_worktree(
            source_repo_root,
            target_path,
            options,
        )
    }

    pub fn prune_stale_worktrees_if_possible(cwd: &Path) {
        worktrees::prune_stale_worktrees_if_possible(cwd)
    }

    /// Initialize one blank local Git repository (Workflow scratch placement):
    /// branch `main`, stable non-personal identity, one empty initial commit, no
    /// remote.
    pub fn init_scratch_repository(path: &str) -> anyhow::Result<()> {
        scratch::init_scratch_repository(path)
    }

    /// The short branch name of `checkout_path`'s HEAD, or `None` when detached.
    pub fn checkout_current_branch(checkout_path: &Path) -> anyhow::Result<Option<String>> {
        scratch::current_branch(checkout_path)
    }

    /// The number of commits reachable from HEAD.
    pub fn head_commit_count(checkout_path: &Path) -> anyhow::Result<u64> {
        scratch::head_commit_count(checkout_path)
    }

    /// Whether the repository at `checkout_path` has no configured remotes.
    pub fn has_no_remotes(checkout_path: &Path) -> anyhow::Result<bool> {
        scratch::has_no_remotes(checkout_path)
    }

    /// Whether HEAD points at an empty tree (an empty initial commit).
    pub fn head_tree_is_empty(checkout_path: &Path) -> anyhow::Result<bool> {
        scratch::head_tree_is_empty(checkout_path)
    }

    /// The absolute common git directory shared by a worktree and its source.
    pub fn common_git_dir(checkout_path: &Path) -> anyhow::Result<String> {
        scratch::common_git_dir(checkout_path)
    }

    /// Whether `checkout_path` is a linked worktree (not the primary checkout).
    pub fn is_linked_worktree(checkout_path: &Path) -> anyhow::Result<bool> {
        scratch::is_linked_worktree(checkout_path)
    }

    /// Whether the repository at `checkout_path` carries the stable AnyHarness
    /// scratch identity (part of the exact scratch initialization contract).
    pub fn scratch_identity_matches(checkout_path: &Path) -> anyhow::Result<bool> {
        scratch::scratch_identity_matches(checkout_path)
    }

    /// Create a linked worktree for a Workflow placement at the exact base OID.
    /// Unlike [`Self::create_worktree`], its failure carries no raw Git stderr —
    /// the frozen placement contract excludes raw Git stderr from stored/logged
    /// detail, so this seam returns a correlation-only bounded error.
    pub fn create_workflow_worktree(
        source_repo_root: &str,
        target_path: &str,
        new_branch: &str,
        base_oid: &str,
    ) -> anyhow::Result<()> {
        worktrees::create_workflow_worktree(source_repo_root, target_path, new_branch, base_oid)
    }

    pub fn remove_worktree_force(
        repo_root_path: &str,
        worktree_path: &str,
    ) -> Result<WorktreeRemoveOutcome, WorktreeRemoveError> {
        worktrees::remove_worktree_force(repo_root_path, worktree_path)
    }

    pub fn ref_exists(repo_root: &Path, ref_name: &str) -> bool {
        worktrees::ref_exists(repo_root, ref_name)
    }

    pub fn stdout_result(repo_root: &Path, args: &[&str]) -> anyhow::Result<String> {
        worktrees::stdout_result(repo_root, args)
    }

    pub fn switch_to_existing_branch(
        workspace_path: &Path,
        branch_name: &str,
    ) -> anyhow::Result<()> {
        worktrees::switch_to_existing_branch(workspace_path, branch_name)
    }

    pub fn switch_to_tracking_branch(
        workspace_path: &Path,
        branch_name: &str,
        upstream: &str,
    ) -> anyhow::Result<()> {
        worktrees::switch_to_tracking_branch(workspace_path, branch_name, upstream)
    }

    pub fn rename_branch(
        workspace_path: &Path,
        new_name: &str,
    ) -> anyhow::Result<(String, String)> {
        branches::rename_branch(workspace_path, new_name)
    }

    pub fn stage_paths(workspace_path: &Path, paths: &[String]) -> anyhow::Result<()> {
        staging::stage_paths(workspace_path, paths)
    }

    pub fn unstage_paths(workspace_path: &Path, paths: &[String]) -> anyhow::Result<()> {
        staging::unstage_paths(workspace_path, paths)
    }

    pub fn stage_patch(workspace_path: &Path, patch: &str) -> anyhow::Result<()> {
        staging::stage_patch(workspace_path, patch)
    }

    pub fn unstage_patch(workspace_path: &Path, patch: &str) -> anyhow::Result<()> {
        staging::unstage_patch(workspace_path, patch)
    }

    pub fn revert_patches(
        workspace_path: &Path,
        entries: &[GitRevertPatchEntry],
    ) -> Result<GitRevertPatchesResult, GitRevertPatchesError> {
        revert_patches::revert_patches(workspace_path, entries)
    }

    pub fn commit_staged(
        workspace_path: &Path,
        summary: &str,
        body: Option<&str>,
    ) -> Result<(String, String), CommitError> {
        commit::commit_staged(workspace_path, summary, body)
    }

    pub fn push_current_branch(
        workspace_path: &Path,
        remote: Option<&str>,
    ) -> Result<(String, String, bool), PushError> {
        push::push_current_branch(workspace_path, remote)
    }

    pub fn push_current_branch_with_timeout(
        workspace_path: &Path,
        remote: Option<&str>,
        timeout: Duration,
    ) -> Result<(String, String, bool), PushError> {
        push::push_current_branch_with_timeout(workspace_path, remote, timeout)
    }

    pub fn commit_all_if_dirty(
        workspace_path: &Path,
        summary: &str,
    ) -> anyhow::Result<Option<String>> {
        commit_all::commit_all_if_dirty(workspace_path, summary)
    }

    /// Capture a `WorkspaceSnapshot` of `workspace_path`: HEAD, branch, the
    /// exact staged tree, and the working tree tree (staged ∪ unstaged ∪
    /// untracked non-ignored). Dead code this rung — no caller in the product
    /// invokes it; R4's `archive.rs` is the only intended caller.
    pub fn snapshot_workspace(workspace_path: &Path) -> Result<WorkspaceSnapshot, SnapshotError> {
        snapshot::snapshot_workspace(workspace_path)
    }

    /// The read-only surface covering the three business-rule refusals
    /// (hollow checkout, conflict-bearing operation, unborn HEAD) so a caller
    /// can refuse before quiescing anything. Writes nothing to the worktree.
    pub fn probe_refusals(workspace_path: &Path) -> Result<(), SnapshotError> {
        snapshot::probe_refusals(workspace_path)
    }

    /// Reap the debris a caller's own kills left behind (stranded conflict
    /// sentinels and lock files) so the capture that follows is not
    /// permanently blocked by state only the caller's SIGKILLs created.
    pub fn repair_kill_debris(
        workspace_path: &Path,
        quiesce: &QuiesceReport,
    ) -> Result<Vec<SnapshotNotice>, SnapshotError> {
        snapshot::repair_kill_debris(workspace_path, quiesce)
    }

    /// Restore `workspace_path`'s disk and index to exactly what `snap`
    /// captured. Precondition owned by the caller: HEAD already sits at the
    /// archived SHA.
    pub fn restore_snapshot(
        workspace_path: &Path,
        snap: &WorkspaceSnapshot,
    ) -> Result<(), SnapshotError> {
        snapshot_restore::restore_snapshot(workspace_path, snap)
    }

    /// Tree-source variant of [`Self::restore_snapshot`] for a ref-driven
    /// restore that holds resolved tree OIDs rather than a `WorkspaceSnapshot`.
    pub fn restore_trees(
        workspace_path: &Path,
        work_tree: &str,
        index_tree: &str,
    ) -> Result<(), SnapshotError> {
        snapshot_restore::restore_trees(workspace_path, work_tree, index_tree)
    }

    /// Public projection of `git worktree list --porcelain` registrations for
    /// `repo_root`, so callers outside the git adapter can read registrations
    /// without re-parsing porcelain output themselves.
    pub fn list_worktree_registrations(
        repo_root: &Path,
    ) -> anyhow::Result<Vec<WorktreeRegistration>> {
        super::operations::worktree_registrations::list_worktree_registrations(repo_root)
    }

    /// The recreate-tier verb: create a new branch named `desired_branch`
    /// (uniquified on collision) at `sha`, never moving an existing ref.
    /// Explicitly not [`Self::create_worktree_at_ref`], whose fast-forward
    /// path runs `git branch --force`.
    pub fn create_branch_at_sha_uniquified(
        source_repo_root: &Path,
        desired_branch: &str,
        sha: &str,
    ) -> anyhow::Result<String> {
        worktree_branch::create_branch_at_sha_uniquified(source_repo_root, desired_branch, sha)
    }
}
