use std::path::{Path, PathBuf};
use std::time::Duration;

use super::executor::resolve_git_repo_root;
use super::operations::{
    branches, commit, commit_all, diff, diff_files, push, revert_patches, staging, status,
};
use super::types::{
    CommitError, GitBranch, GitBranchDiffFilesResult, GitDiffError, GitDiffResult, GitDiffScope,
    GitRevertPatchEntry, GitRevertPatchesError, GitRevertPatchesResult, GitStatusSnapshot,
    PushError,
};

pub struct GitService;

impl GitService {
    pub fn resolve_repo_root(workspace_path: &Path) -> anyhow::Result<PathBuf> {
        resolve_git_repo_root(workspace_path)
    }

    pub fn status(workspace_id: &str, workspace_path: &Path) -> anyhow::Result<GitStatusSnapshot> {
        status::status(workspace_id, workspace_path)
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
}
