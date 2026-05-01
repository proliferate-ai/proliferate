use anyharness_contract::v1::{
    CommitRequest, CommitResponse, GitActionAvailability as ContractGitActionAvailability,
    GitBranchDiffFilesResponse, GitBranchRef, GitChangedFile as ContractGitChangedFile,
    GitDiffFile as ContractGitDiffFile, GitDiffResponse, GitDiffScope as ContractGitDiffScope,
    GitFileStatus as ContractGitFileStatus, GitIncludedState as ContractGitIncludedState,
    GitOperation as ContractGitOperation, GitStatusSnapshot,
    GitStatusSummary as ContractGitStatusSummary, PushRequest, PushResponse, RenameBranchRequest,
    RenameBranchResponse, StagePathsRequest, UnstagePathsRequest,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use super::access::{assert_workspace_mutable, assert_workspace_not_retired};
use super::error::ApiError;
use crate::app::AppState;
use crate::git::types::{
    CommitError, GitActionAvailability as InternalGitActionAvailability,
    GitBranch as InternalGitBranch, GitBranchDiffFilesResult as InternalGitBranchDiffFilesResult,
    GitChangedFile as InternalGitChangedFile, GitDiffError, GitDiffFile as InternalGitDiffFile,
    GitDiffResult as InternalGitDiffResult, GitDiffScope as InternalGitDiffScope,
    GitFileStatus as InternalGitFileStatus, GitIncludedState as InternalGitIncludedState,
    GitOperation as InternalGitOperation, GitStatusSnapshot as InternalGitStatusSnapshot,
    GitStatusSummary as InternalGitStatusSummary, PushError,
};
use crate::git::GitService;
use crate::workspaces::operation_gate::WorkspaceOperationKind;

fn resolve_workspace_path(
    workspace_runtime: &crate::workspaces::runtime::WorkspaceRuntime,
    workspace_id: &str,
) -> Result<std::path::PathBuf, ApiError> {
    let workspace = workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("Workspace not found", "WORKSPACE_NOT_FOUND"))?;

    Ok(std::path::PathBuf::from(workspace.path))
}

async fn run_git_task<T, F>(
    state: &AppState,
    workspace_id: String,
    task_label: &'static str,
    task: F,
) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(String, std::path::PathBuf) -> Result<T, ApiError> + Send + 'static,
{
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(state, &workspace_id)?;
    let workspace_runtime = state.workspace_runtime.clone();
    tokio::task::spawn_blocking(move || {
        let workspace_path = resolve_workspace_path(&workspace_runtime, &workspace_id)?;
        task(workspace_id, workspace_path)
    })
    .await
    .map_err(|e| ApiError::internal(format!("{task_label} task failed: {e}")))?
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/git/status",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Git status snapshot", body = GitStatusSnapshot),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn get_git_status(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<GitStatusSnapshot>, ApiError> {
    let snapshot = run_git_task(
        &state,
        workspace_id,
        "git status",
        |workspace_id, ws_path| {
            GitService::status(&workspace_id, &ws_path)
                .map(git_status_to_contract)
                .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_STATUS_FAILED"))
        },
    )
    .await?;

    Ok(Json(snapshot))
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffQuery {
    pub path: String,
    pub scope: Option<ContractGitDiffScope>,
    pub base_ref: Option<String>,
    pub old_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchDiffFilesQuery {
    pub base_ref: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/git/diff",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("path" = String, Query, description = "File path relative to repo root"),
        ("scope" = Option<ContractGitDiffScope>, Query, description = "Diff scope. Defaults to working_tree."),
        ("baseRef" = Option<String>, Query, description = "Branch base ref. Only valid for scope=branch."),
        ("oldPath" = Option<String>, Query, description = "Old path for branch rename/copy rows. Only valid for scope=branch."),
    ),
    responses(
        (status = 200, description = "File diff", body = GitDiffResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn get_git_diff(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<DiffQuery>,
) -> Result<Json<GitDiffResponse>, ApiError> {
    let diff_path = query.path;
    let scope = query
        .scope
        .map(git_diff_scope_to_internal)
        .unwrap_or(InternalGitDiffScope::WorkingTree);
    let base_ref = normalize_query_string(query.base_ref);
    let old_path = normalize_query_string(query.old_path);
    let diff = run_git_task(&state, workspace_id, "git diff", move |_, ws_path| {
        GitService::diff_for_path_with_scope(
            &ws_path,
            &diff_path,
            scope,
            base_ref.as_deref(),
            old_path.as_deref(),
        )
        .map(git_diff_to_contract)
        .map_err(git_diff_error_to_api)
    })
    .await?;

    Ok(Json(diff))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/git/diff/branch-files",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("baseRef" = Option<String>, Query, description = "Branch base ref. Defaults to runtime default branch resolution."),
    ),
    responses(
        (status = 200, description = "Branch diff file list", body = GitBranchDiffFilesResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn list_git_branch_diff_files(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<BranchDiffFilesQuery>,
) -> Result<Json<GitBranchDiffFilesResponse>, ApiError> {
    let base_ref = normalize_query_string(query.base_ref);
    let response = run_git_task(
        &state,
        workspace_id,
        "git branch diff files",
        move |_, ws_path| {
            GitService::branch_diff_files(&ws_path, base_ref.as_deref())
                .map(git_branch_diff_files_to_contract)
                .map_err(git_diff_error_to_api)
        },
    )
    .await?;

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/git/branches",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Branch list", body = Vec<GitBranchRef>),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn list_git_branches(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Vec<GitBranchRef>>, ApiError> {
    let branches = run_git_task(&state, workspace_id, "git branches", move |_, ws_path| {
        GitService::list_branches(&ws_path)
            .map(|branches| branches.into_iter().map(git_branch_to_contract).collect())
            .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_BRANCHES_FAILED"))
    })
    .await?;

    Ok(Json(branches))
}

// ---------------------------------------------------------------------------
// Rename branch
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/rename-branch",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = RenameBranchRequest,
    responses(
        (status = 200, description = "Branch renamed", body = RenameBranchResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Rename failed", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn rename_branch(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<RenameBranchRequest>,
) -> Result<Json<RenameBranchResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::GitWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let new_name = req.new_name;
    let response = run_git_task(
        &state,
        workspace_id,
        "git rename branch",
        move |_, ws_path| {
            GitService::rename_branch(&ws_path, &new_name)
                .map(|(old_name, new_name)| RenameBranchResponse { old_name, new_name })
                .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_RENAME_BRANCH_FAILED"))
        },
    )
    .await?;

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/stage",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = StagePathsRequest,
    responses(
        (status = 200, description = "Files staged"),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn stage_paths(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<StagePathsRequest>,
) -> Result<Json<()>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::GitWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let paths = req.paths;
    run_git_task(&state, workspace_id, "git stage", move |_, ws_path| {
        GitService::stage_paths(&ws_path, &paths)
            .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_STAGE_FAILED"))?;
        Ok(())
    })
    .await?;

    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Unstage
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/unstage",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = UnstagePathsRequest,
    responses(
        (status = 200, description = "Files unstaged"),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn unstage_paths(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<UnstagePathsRequest>,
) -> Result<Json<()>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::GitWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let paths = req.paths;
    run_git_task(&state, workspace_id, "git unstage", move |_, ws_path| {
        GitService::unstage_paths(&ws_path, &paths)
            .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_UNSTAGE_FAILED"))?;
        Ok(())
    })
    .await?;

    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/commit",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = CommitRequest,
    responses(
        (status = 200, description = "Commit created", body = CommitResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Commit failed", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Nothing staged", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn commit(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<CommitRequest>,
) -> Result<Json<CommitResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::GitWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let summary = req.summary;
    let body = req.body;
    let response = run_git_task(&state, workspace_id, "git commit", move |_, ws_path| {
        GitService::commit_staged(&ws_path, &summary, body.as_deref())
            .map(|(oid, summary)| CommitResponse { oid, summary })
            .map_err(|error| match error {
                CommitError::NothingStaged => {
                    ApiError::conflict("Nothing staged to commit", "GIT_NOTHING_STAGED")
                }
                CommitError::Failed { message } => {
                    ApiError::bad_request(message, "GIT_COMMIT_FAILED")
                }
                CommitError::Internal(error) => {
                    ApiError::bad_request(error.to_string(), "GIT_COMMIT_FAILED")
                }
            })
    })
    .await?;

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/push",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = PushRequest,
    responses(
        (status = 200, description = "Push result", body = PushResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Push failed", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Push rejected", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn push(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::GitWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let remote = req.remote;
    let response = run_git_task(&state, workspace_id, "git push", move |_, ws_path| {
        GitService::push_current_branch(&ws_path, remote.as_deref())
            .map(|(remote, branch, published)| PushResponse {
                remote,
                branch,
                published,
            })
            .map_err(|error| match error {
                PushError::DetachedHead => {
                    ApiError::bad_request("cannot push a detached HEAD", "GIT_DETACHED_HEAD")
                }
                PushError::Rejected { message } => ApiError::conflict(message, "GIT_PUSH_REJECTED"),
                PushError::Failed { message } => ApiError::bad_request(message, "GIT_PUSH_FAILED"),
                PushError::Internal(error) => {
                    ApiError::bad_request(error.to_string(), "GIT_PUSH_FAILED")
                }
            })
    })
    .await?;

    Ok(Json(response))
}

fn git_status_to_contract(snapshot: InternalGitStatusSnapshot) -> GitStatusSnapshot {
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

fn git_diff_to_contract(diff: InternalGitDiffResult) -> GitDiffResponse {
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

fn git_branch_diff_files_to_contract(
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

fn git_branch_to_contract(branch: InternalGitBranch) -> GitBranchRef {
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

fn git_diff_scope_to_internal(scope: ContractGitDiffScope) -> InternalGitDiffScope {
    match scope {
        ContractGitDiffScope::WorkingTree => InternalGitDiffScope::WorkingTree,
        ContractGitDiffScope::Unstaged => InternalGitDiffScope::Unstaged,
        ContractGitDiffScope::Staged => InternalGitDiffScope::Staged,
        ContractGitDiffScope::Branch => InternalGitDiffScope::Branch,
    }
}

fn git_diff_scope_to_contract(scope: InternalGitDiffScope) -> ContractGitDiffScope {
    match scope {
        InternalGitDiffScope::WorkingTree => ContractGitDiffScope::WorkingTree,
        InternalGitDiffScope::Unstaged => ContractGitDiffScope::Unstaged,
        InternalGitDiffScope::Staged => ContractGitDiffScope::Staged,
        InternalGitDiffScope::Branch => ContractGitDiffScope::Branch,
    }
}

fn git_diff_error_to_api(error: GitDiffError) -> ApiError {
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

fn normalize_query_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn git_included_state_to_contract(state: InternalGitIncludedState) -> ContractGitIncludedState {
    match state {
        InternalGitIncludedState::Included => ContractGitIncludedState::Included,
        InternalGitIncludedState::Excluded => ContractGitIncludedState::Excluded,
        InternalGitIncludedState::Partial => ContractGitIncludedState::Partial,
    }
}
