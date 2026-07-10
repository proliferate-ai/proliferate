use std::time::Instant;

use anyharness_contract::v1::{
    CommitRequest, CommitResponse, GitBranchDiffFilesResponse, GitBranchRef, GitDiffResponse,
    GitDiffScope as ContractGitDiffScope, GitRevertPatchesRequest, GitRevertPatchesResponse,
    GitStatusSnapshot, PushRequest, PushResponse, RenameBranchRequest, RenameBranchResponse,
    StagePatchRequest, StagePathsRequest, UnstagePatchRequest, UnstagePathsRequest,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;

use super::error::ApiError;
use super::git_contract::{
    git_branch_diff_files_to_contract, git_branch_to_contract, git_diff_error_to_api,
    git_diff_scope_to_internal, git_diff_to_contract, git_revert_patch_entry_to_internal,
    git_revert_patches_error_to_api, git_revert_patches_to_contract, git_status_to_contract,
};
use super::git_task::{run_git_task, GitTaskAccess};
use crate::adapters::git::types::{CommitError, GitDiffScope as InternalGitDiffScope, PushError};
use crate::adapters::git::GitService;
use crate::app::AppState;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

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
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<GitStatusSnapshot>, ApiError> {
    let span = FlowHeaders::from_headers(&headers).span();
    async move {
        let started = Instant::now();
        tracing::info!(
            workspace_id = %workspace_id,
            "[anyharness-latency] git.http.status.request_received"
        );
        let snapshot = run_git_task(
            &state,
            workspace_id.clone(),
            GitTaskAccess::Read,
            "git status",
            |workspace_id, ws_path| {
                GitService::status(&workspace_id, &ws_path)
                    .map(git_status_to_contract)
                    .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_STATUS_FAILED"))
            },
        )
        .await?;

        tracing::info!(
            workspace_id = %workspace_id,
            changed_files = snapshot.summary.changed_files,
            included_files = snapshot.summary.included_files,
            elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] git.http.status.response_ready"
        );
        Ok(Json(snapshot))
    }
    .instrument(span)
    .await
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
        ("baseRef" = Option<String>, Query, description = "Base ref. Valid for scope=branch or scope=base_worktree."),
        ("oldPath" = Option<String>, Query, description = "Old path for rename/copy rows. Valid for scope=branch or scope=base_worktree."),
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
    let diff = run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Read,
        "git diff",
        move |_, ws_path| {
            GitService::diff_for_path_with_scope(
                &ws_path,
                &diff_path,
                scope,
                base_ref.as_deref(),
                old_path.as_deref(),
            )
            .map(git_diff_to_contract)
            .map_err(git_diff_error_to_api)
        },
    )
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
        GitTaskAccess::Read,
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

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/git/diff/base-worktree-files",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("baseRef" = Option<String>, Query, description = "Base ref. Defaults to runtime default branch resolution."),
    ),
    responses(
        (status = 200, description = "Base-to-worktree diff file list", body = GitBranchDiffFilesResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn list_git_base_worktree_diff_files(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<BranchDiffFilesQuery>,
) -> Result<Json<GitBranchDiffFilesResponse>, ApiError> {
    let base_ref = normalize_query_string(query.base_ref);
    let response = run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Read,
        "git base worktree diff files",
        move |_, ws_path| {
            GitService::base_worktree_diff_files(&ws_path, base_ref.as_deref())
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
    let branches = run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Read,
        "git branches",
        move |_, ws_path| {
            GitService::list_branches(&ws_path)
                .map(|branches| branches.into_iter().map(git_branch_to_contract).collect())
                .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_BRANCHES_FAILED"))
        },
    )
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
    let new_name = req.new_name;
    let response = run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
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
    let paths = req.paths;
    run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
        "git stage",
        move |_, ws_path| {
            GitService::stage_paths(&ws_path, &paths)
                .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_STAGE_FAILED"))?;
            Ok(())
        },
    )
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
    let paths = req.paths;
    run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
        "git unstage",
        move |_, ws_path| {
            GitService::unstage_paths(&ws_path, &paths)
                .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_UNSTAGE_FAILED"))?;
            Ok(())
        },
    )
    .await?;

    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Stage patch (hunk-level)
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/stage-patch",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = StagePatchRequest,
    responses(
        (status = 200, description = "Patch staged"),
        (status = 400, description = "Patch could not be applied", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn stage_patch(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<StagePatchRequest>,
) -> Result<Json<()>, ApiError> {
    let patch = req.patch;
    run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
        "git stage patch",
        move |_, ws_path| {
            GitService::stage_patch(&ws_path, &patch)
                .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_STAGE_PATCH_FAILED"))?;
            Ok(())
        },
    )
    .await?;

    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Unstage patch (hunk-level)
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/unstage-patch",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = UnstagePatchRequest,
    responses(
        (status = 200, description = "Patch unstaged"),
        (status = 400, description = "Patch could not be removed from index", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn unstage_patch(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<UnstagePatchRequest>,
) -> Result<Json<()>, ApiError> {
    let patch = req.patch;
    run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
        "git unstage patch",
        move |_, ws_path| {
            GitService::unstage_patch(&ws_path, &patch)
                .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_UNSTAGE_PATCH_FAILED"))?;
            Ok(())
        },
    )
    .await?;

    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Revert patches
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/git/revert-patches",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = GitRevertPatchesRequest,
    responses(
        (status = 200, description = "Patches reverted", body = GitRevertPatchesResponse),
        (status = 400, description = "Undo failed", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Patch no longer applies", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "git"
)]
pub async fn revert_patches(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<GitRevertPatchesRequest>,
) -> Result<Json<GitRevertPatchesResponse>, ApiError> {
    let entries = req
        .entries
        .into_iter()
        .map(git_revert_patch_entry_to_internal)
        .collect::<Vec<_>>();
    let response = run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
        "git revert patches",
        move |_, ws_path| {
            GitService::revert_patches(&ws_path, &entries)
                .map(git_revert_patches_to_contract)
                .map_err(git_revert_patches_error_to_api)
        },
    )
    .await?;

    Ok(Json(response))
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
    let summary = req.summary;
    let body = req.body;
    let response = run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
        "git commit",
        move |_, ws_path| {
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
        },
    )
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
    let remote = req.remote;
    let response = run_git_task(
        &state,
        workspace_id,
        GitTaskAccess::Write,
        "git push",
        move |_, ws_path| {
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
                    PushError::Rejected { message } => {
                        ApiError::conflict(message, "GIT_PUSH_REJECTED")
                    }
                    PushError::Failed { message } => {
                        ApiError::bad_request(message, "GIT_PUSH_FAILED")
                    }
                    PushError::Internal(error) => {
                        ApiError::bad_request(error.to_string(), "GIT_PUSH_FAILED")
                    }
                })
        },
    )
    .await?;

    Ok(Json(response))
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
