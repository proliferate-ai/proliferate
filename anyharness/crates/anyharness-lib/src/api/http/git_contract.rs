use anyharness_contract::v1::{
    FileChangeOperation, GitActionAvailability as ContractGitActionAvailability,
    GitBranchDiffFilesResponse, GitBranchRef, GitChangedFile as ContractGitChangedFile,
    GitDiffFile as ContractGitDiffFile, GitDiffResponse, GitDiffScope as ContractGitDiffScope,
    GitFileStatus as ContractGitFileStatus, GitIncludedState as ContractGitIncludedState,
    GitOperation as ContractGitOperation, GitRevertPatchEntry, GitRevertPatchesResponse,
    GitStatusSnapshot, GitStatusSummary as ContractGitStatusSummary,
};

use super::error::ApiError;
use crate::adapters::git::types::{
    GitActionAvailability as InternalGitActionAvailability, GitBranch as InternalGitBranch,
    GitBranchDiffFilesResult as InternalGitBranchDiffFilesResult,
    GitChangedFile as InternalGitChangedFile, GitDiffError, GitDiffFile as InternalGitDiffFile,
    GitDiffResult as InternalGitDiffResult, GitDiffScope as InternalGitDiffScope,
    GitFileStatus as InternalGitFileStatus, GitIncludedState as InternalGitIncludedState,
    GitOperation as InternalGitOperation, GitRevertPatchEntry as InternalGitRevertPatchEntry,
    GitRevertPatchOperation as InternalGitRevertPatchOperation, GitRevertPatchesError,
    GitRevertPatchesResult as InternalGitRevertPatchesResult,
    GitStatusSnapshot as InternalGitStatusSnapshot, GitStatusSummary as InternalGitStatusSummary,
};

pub(super) fn git_status_to_contract(snapshot: InternalGitStatusSnapshot) -> GitStatusSnapshot {
    GitStatusSnapshot {
        workspace_id: snapshot.workspace_id,
        workspace_path: snapshot.workspace_path,
        repo_root_path: snapshot.repo_root_path,
        current_branch: snapshot.current_branch,
        head_oid: snapshot.head_oid,
        detached: snapshot.detached,
        upstream_branch: snapshot.upstream_branch,
        suggested_base_branch: snapshot.suggested_base_branch,
        ahead: snapshot.ahead,
        behind: snapshot.behind,
        operation: git_operation_to_contract(snapshot.operation),
        conflicted: snapshot.conflicted,
        clean: snapshot.clean,
        summary: git_summary_to_contract(snapshot.summary),
        actions: git_actions_to_contract(snapshot.actions),
        files: snapshot
            .files
            .into_iter()
            .map(git_changed_file_to_contract)
            .collect(),
    }
}

fn git_summary_to_contract(summary: InternalGitStatusSummary) -> ContractGitStatusSummary {
    ContractGitStatusSummary {
        changed_files: summary.changed_files,
        additions: summary.additions,
        deletions: summary.deletions,
        included_files: summary.included_files,
        conflicted_files: summary.conflicted_files,
    }
}

fn git_actions_to_contract(
    actions: InternalGitActionAvailability,
) -> ContractGitActionAvailability {
    ContractGitActionAvailability {
        can_commit: actions.can_commit,
        can_push: actions.can_push,
        push_label: actions.push_label,
        can_create_pull_request: actions.can_create_pull_request,
        can_create_draft_pull_request: actions.can_create_draft_pull_request,
        can_create_branch_workspace: actions.can_create_branch_workspace,
        reason_if_blocked: actions.reason_if_blocked,
    }
}

fn git_changed_file_to_contract(file: InternalGitChangedFile) -> ContractGitChangedFile {
    ContractGitChangedFile {
        path: file.path,
        old_path: file.old_path,
        status: git_file_status_to_contract(file.status),
        additions: file.additions,
        deletions: file.deletions,
        binary: file.binary,
        included_state: git_included_state_to_contract(file.included_state),
    }
}

pub(super) fn git_diff_to_contract(diff: InternalGitDiffResult) -> GitDiffResponse {
    GitDiffResponse {
        path: diff.path,
        scope: git_diff_scope_to_contract(diff.scope),
        binary: diff.binary,
        truncated: diff.truncated,
        additions: diff.additions,
        deletions: diff.deletions,
        base_ref: diff.base_ref,
        resolved_base_oid: diff.resolved_base_oid,
        merge_base_oid: diff.merge_base_oid,
        head_oid: diff.head_oid,
        patch: diff.patch,
    }
}

pub(super) fn git_branch_diff_files_to_contract(
    response: InternalGitBranchDiffFilesResult,
) -> GitBranchDiffFilesResponse {
    GitBranchDiffFilesResponse {
        base_ref: response.base_ref,
        resolved_base_oid: response.resolved_base_oid,
        merge_base_oid: response.merge_base_oid,
        head_oid: response.head_oid,
        files: response
            .files
            .into_iter()
            .map(git_diff_file_to_contract)
            .collect(),
    }
}

pub(super) fn git_revert_patch_entry_to_internal(
    entry: GitRevertPatchEntry,
) -> InternalGitRevertPatchEntry {
    InternalGitRevertPatchEntry {
        path: entry.path,
        old_path: entry.old_path,
        operation: file_change_operation_to_internal(entry.operation),
        patch: entry.patch,
        patch_truncated: entry.patch_truncated.unwrap_or(false),
    }
}

pub(super) fn git_revert_patches_to_contract(
    response: InternalGitRevertPatchesResult,
) -> GitRevertPatchesResponse {
    GitRevertPatchesResponse {
        reverted_paths: response.reverted_paths,
        head_oid_before: response.head_oid_before,
        head_oid_after: response.head_oid_after,
    }
}

fn git_diff_file_to_contract(file: InternalGitDiffFile) -> ContractGitDiffFile {
    ContractGitDiffFile {
        path: file.path,
        old_path: file.old_path,
        status: git_file_status_to_contract(file.status),
        additions: file.additions,
        deletions: file.deletions,
        binary: file.binary,
    }
}

pub(super) fn git_branch_to_contract(branch: InternalGitBranch) -> GitBranchRef {
    GitBranchRef {
        name: branch.name,
        is_remote: branch.is_remote,
        is_head: branch.is_head,
        is_default: branch.is_default,
        upstream: branch.upstream,
    }
}

fn git_operation_to_contract(operation: InternalGitOperation) -> ContractGitOperation {
    match operation {
        InternalGitOperation::None => ContractGitOperation::None,
        InternalGitOperation::Merge => ContractGitOperation::Merge,
        InternalGitOperation::Rebase => ContractGitOperation::Rebase,
        InternalGitOperation::CherryPick => ContractGitOperation::CherryPick,
        InternalGitOperation::Revert => ContractGitOperation::Revert,
    }
}

fn file_change_operation_to_internal(
    operation: FileChangeOperation,
) -> InternalGitRevertPatchOperation {
    match operation {
        FileChangeOperation::Create => InternalGitRevertPatchOperation::Create,
        FileChangeOperation::Edit => InternalGitRevertPatchOperation::Edit,
        FileChangeOperation::Delete => InternalGitRevertPatchOperation::Delete,
        FileChangeOperation::Move => InternalGitRevertPatchOperation::Move,
    }
}

fn git_file_status_to_contract(status: InternalGitFileStatus) -> ContractGitFileStatus {
    match status {
        InternalGitFileStatus::Modified => ContractGitFileStatus::Modified,
        InternalGitFileStatus::Added => ContractGitFileStatus::Added,
        InternalGitFileStatus::Deleted => ContractGitFileStatus::Deleted,
        InternalGitFileStatus::Renamed => ContractGitFileStatus::Renamed,
        InternalGitFileStatus::Copied => ContractGitFileStatus::Copied,
        InternalGitFileStatus::Untracked => ContractGitFileStatus::Untracked,
        InternalGitFileStatus::Conflicted => ContractGitFileStatus::Conflicted,
    }
}

pub(super) fn git_diff_scope_to_internal(scope: ContractGitDiffScope) -> InternalGitDiffScope {
    match scope {
        ContractGitDiffScope::WorkingTree => InternalGitDiffScope::WorkingTree,
        ContractGitDiffScope::Unstaged => InternalGitDiffScope::Unstaged,
        ContractGitDiffScope::Staged => InternalGitDiffScope::Staged,
        ContractGitDiffScope::Branch => InternalGitDiffScope::Branch,
        ContractGitDiffScope::BaseWorktree => InternalGitDiffScope::BaseWorktree,
    }
}

fn git_diff_scope_to_contract(scope: InternalGitDiffScope) -> ContractGitDiffScope {
    match scope {
        InternalGitDiffScope::WorkingTree => ContractGitDiffScope::WorkingTree,
        InternalGitDiffScope::Unstaged => ContractGitDiffScope::Unstaged,
        InternalGitDiffScope::Staged => ContractGitDiffScope::Staged,
        InternalGitDiffScope::Branch => ContractGitDiffScope::Branch,
        InternalGitDiffScope::BaseWorktree => ContractGitDiffScope::BaseWorktree,
    }
}

pub(super) fn git_diff_error_to_api(error: GitDiffError) -> ApiError {
    match error {
        GitDiffError::InvalidBaseRef => {
            ApiError::bad_request("invalid git diff base ref", "GIT_DIFF_INVALID_BASE_REF")
        }
        GitDiffError::BaseRefNotFound | GitDiffError::MergeBaseNotFound => {
            ApiError::bad_request("git diff base ref not found", "GIT_DIFF_BASE_NOT_FOUND")
        }
        GitDiffError::GitFailed { message } => ApiError::bad_request(message, "GIT_DIFF_FAILED"),
        GitDiffError::Internal(error) => {
            ApiError::bad_request(error.to_string(), "GIT_DIFF_FAILED")
        }
    }
}

pub(super) fn git_revert_patches_error_to_api(error: GitRevertPatchesError) -> ApiError {
    match error {
        GitRevertPatchesError::NothingToRevert => {
            ApiError::bad_request("nothing to undo", "GIT_UNDO_EMPTY")
        }
        GitRevertPatchesError::MissingPatch { path } => ApiError::bad_request(
            format!("cannot undo {path} because the patch is missing"),
            "GIT_UNDO_PATCH_MISSING",
        ),
        GitRevertPatchesError::TruncatedPatch { path } => ApiError::bad_request(
            format!("cannot undo {path} because the patch was truncated"),
            "GIT_UNDO_PATCH_TRUNCATED",
        ),
        GitRevertPatchesError::UnsafePath { path } => ApiError::bad_request(
            format!("cannot undo unsafe path {path}"),
            "GIT_UNDO_UNSAFE_PATH",
        ),
        GitRevertPatchesError::PartialStaging { path } => ApiError::conflict(
            format!("cannot undo {path} because it has partially staged changes"),
            "GIT_UNDO_PARTIAL_STAGING",
        ),
        GitRevertPatchesError::StagedChanges { path } => ApiError::conflict(
            format!("cannot undo {path} because it has staged changes"),
            "GIT_UNDO_STAGED_CHANGES",
        ),
        GitRevertPatchesError::ConflictedOperation => ApiError::conflict(
            "cannot undo while git is resolving another operation",
            "GIT_UNDO_CONFLICTED_OPERATION",
        ),
        GitRevertPatchesError::PatchRejected { message, .. } => {
            ApiError::conflict(message, "GIT_UNDO_PATCH_REJECTED")
        }
        GitRevertPatchesError::GitFailed { message } => {
            ApiError::bad_request(message, "GIT_UNDO_FAILED")
        }
        GitRevertPatchesError::Internal(error) => {
            ApiError::bad_request(error.to_string(), "GIT_UNDO_FAILED")
        }
    }
}

fn git_included_state_to_contract(state: InternalGitIncludedState) -> ContractGitIncludedState {
    match state {
        InternalGitIncludedState::Included => ContractGitIncludedState::Included,
        InternalGitIncludedState::Excluded => ContractGitIncludedState::Excluded,
        InternalGitIncludedState::Partial => ContractGitIncludedState::Partial,
    }
}
