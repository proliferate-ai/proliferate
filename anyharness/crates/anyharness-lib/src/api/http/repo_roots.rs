use anyharness_contract::v1::{
    DetectProjectSetupResponse, GitBranchRef, PrepareRepoRootMobilityDestinationRequest,
    PrepareRepoRootMobilityDestinationResponse, RepoRoot, RepoRootKind,
    ResolveRepoRootFromPathRequest,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::access::map_access_error;
use super::blocking::run_blocking;
use super::error::ApiError;
use super::workspaces::workspace_to_contract;
use super::workspaces_contract::detection_result_to_contract;
use crate::app::AppState;
use crate::git::GitService;
use crate::repo_roots::model::RepoRootRecord;
use crate::workspaces::types::ResolveRepoRootError;

#[utoipa::path(
    get,
    path = "/v1/repo-roots",
    responses((status = 200, description = "List repo roots", body = Vec<RepoRoot>)),
    tag = "repo-roots"
)]
pub async fn list_repo_roots(
    State(state): State<AppState>,
) -> Result<Json<Vec<RepoRoot>>, ApiError> {
    let repo_root_service = state.repo_root_service.clone();
    let repo_roots = run_blocking("list repo roots", move || {
        repo_root_service.list_repo_roots()
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(
        repo_roots.into_iter().map(repo_root_to_contract).collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/v1/repo-roots/{repo_root_id}",
    params(("repo_root_id" = String, Path, description = "Repo root ID")),
    responses(
        (status = 200, description = "Repo root", body = RepoRoot),
        (status = 404, description = "Repo root not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "repo-roots"
)]
pub async fn get_repo_root(
    State(state): State<AppState>,
    Path(repo_root_id): Path<String>,
) -> Result<Json<RepoRoot>, ApiError> {
    let repo_root = load_repo_root(&state, repo_root_id).await?;
    Ok(Json(repo_root_to_contract(repo_root)))
}

#[utoipa::path(
    post,
    path = "/v1/repo-roots/resolve",
    request_body = ResolveRepoRootFromPathRequest,
    responses(
        (status = 200, description = "Resolved repo root", body = RepoRoot),
        (status = 400, description = "Invalid path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "repo-roots"
)]
pub async fn resolve_repo_root(
    State(state): State<AppState>,
    Json(req): Json<ResolveRepoRootFromPathRequest>,
) -> Result<Json<RepoRoot>, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let path = req.path;
    let repo_root = run_blocking("resolve repo root", move || {
        workspace_runtime.resolve_repo_root_from_path(&path)
    })
    .await?
    .map_err(|error| match error {
        ResolveRepoRootError::NotGitRepo => {
            ApiError::bad_request(error.to_string(), "REPO_ROOT_NOT_GIT_REPO")
        }
        ResolveRepoRootError::WorktreeNotAllowed => {
            ApiError::bad_request(error.to_string(), "REPO_ROOT_WORKTREE_UNSUPPORTED")
        }
        ResolveRepoRootError::Unexpected(inner) => {
            ApiError::bad_request(inner.to_string(), "REPO_ROOT_RESOLVE_FAILED")
        }
    })?;

    Ok(Json(repo_root_to_contract(repo_root)))
}

#[utoipa::path(
    get,
    path = "/v1/repo-roots/{repo_root_id}/git/branches",
    params(("repo_root_id" = String, Path, description = "Repo root ID")),
    responses(
        (status = 200, description = "Branch list", body = Vec<GitBranchRef>),
        (status = 404, description = "Repo root not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "repo-roots"
)]
pub async fn list_repo_root_git_branches(
    State(state): State<AppState>,
    Path(repo_root_id): Path<String>,
) -> Result<Json<Vec<GitBranchRef>>, ApiError> {
    let repo_root = load_repo_root(&state, repo_root_id).await?;
    let repo_root_path = repo_root.path;
    let branches = run_blocking("repo root branches", move || {
        GitService::list_branches(std::path::Path::new(&repo_root_path))
    })
    .await?
    .map_err(|error| ApiError::bad_request(error.to_string(), "GIT_BRANCHES_FAILED"))?;

    Ok(Json(
        branches
            .into_iter()
            .map(|branch| GitBranchRef {
                name: branch.name,
                is_remote: branch.is_remote,
                is_head: branch.is_head,
                is_default: branch.is_default,
                upstream: branch.upstream,
            })
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/v1/repo-roots/{repo_root_id}/detect-setup",
    params(("repo_root_id" = String, Path, description = "Repo root ID")),
    responses(
        (status = 200, description = "Detected project setup hints", body = DetectProjectSetupResponse),
        (status = 404, description = "Repo root not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "repo-roots"
)]
pub async fn detect_repo_root_setup(
    State(state): State<AppState>,
    Path(repo_root_id): Path<String>,
) -> Result<Json<DetectProjectSetupResponse>, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let result = run_blocking("repo root detect setup", move || {
        workspace_runtime.detect_repo_root_setup(&repo_root_id)
    })
    .await?
    .map_err(|error| {
        if error.to_string().contains("repo root not found") {
            ApiError::not_found("Repo root not found", "REPO_ROOT_NOT_FOUND")
        } else {
            ApiError::internal(error.to_string())
        }
    })?;

    Ok(Json(detection_result_to_contract(result)))
}

#[utoipa::path(
    post,
    path = "/v1/repo-roots/{repo_root_id}/mobility/prepare-destination",
    params(("repo_root_id" = String, Path, description = "Repo root ID")),
    request_body = PrepareRepoRootMobilityDestinationRequest,
    responses(
        (status = 200, description = "Prepared repo root mobility destination", body = PrepareRepoRootMobilityDestinationResponse),
        (status = 400, description = "Invalid request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Repo root not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "repo-roots"
)]
pub async fn prepare_repo_root_mobility_destination(
    State(state): State<AppState>,
    Path(repo_root_id): Path<String>,
    Json(req): Json<PrepareRepoRootMobilityDestinationRequest>,
) -> Result<Json<PrepareRepoRootMobilityDestinationResponse>, ApiError> {
    state
        .workspace_access_gate
        .assert_can_prepare_mobility_destination_for_repo_root(&repo_root_id)
        .map_err(map_access_error)?;

    let mobility_service = state.mobility_service.clone();
    let requested_branch = req.requested_branch;
    let requested_base_sha = req.requested_base_sha;
    let preferred_workspace_name = req.preferred_workspace_name;

    let record = mobility_service
        .prepare_repo_root_destination(
            &repo_root_id,
            &requested_branch,
            &requested_base_sha,
            preferred_workspace_name.as_deref(),
        )
        .await
        .map_err(|error| match error {
            crate::mobility::service::MobilityError::WorkspaceNotFound(_)
            | crate::mobility::service::MobilityError::Invalid(_) => {
                ApiError::bad_request(error.to_string(), "MOBILITY_DESTINATION_PREPARE_FAILED")
            }
            crate::mobility::service::MobilityError::NotGitWorkspace(_) => {
                ApiError::bad_request(error.to_string(), "MOBILITY_DESTINATION_PREPARE_FAILED")
            }
            crate::mobility::service::MobilityError::BaseCommitMismatch { .. }
            | crate::mobility::service::MobilityError::SessionAlreadyExists(_)
            | crate::mobility::service::MobilityError::SizeLimitExceeded(_) => {
                ApiError::bad_request(error.to_string(), "MOBILITY_DESTINATION_PREPARE_FAILED")
            }
            crate::mobility::service::MobilityError::Internal(inner) => {
                if inner.to_string().contains("repo root not found") {
                    ApiError::not_found("Repo root not found", "REPO_ROOT_NOT_FOUND")
                } else {
                    ApiError::bad_request(inner.to_string(), "MOBILITY_DESTINATION_PREPARE_FAILED")
                }
            }
        })?;

    Ok(Json(PrepareRepoRootMobilityDestinationResponse {
        workspace: workspace_to_contract(&state, record).await?,
    }))
}

fn repo_root_to_contract(record: RepoRootRecord) -> RepoRoot {
    RepoRoot {
        id: record.id,
        kind: match record.kind.as_str() {
            "managed" => RepoRootKind::Managed,
            _ => RepoRootKind::External,
        },
        path: record.path,
        display_name: record.display_name,
        default_branch: record.default_branch,
        remote_provider: record.remote_provider,
        remote_owner: record.remote_owner,
        remote_repo_name: record.remote_repo_name,
        remote_url: record.remote_url,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

async fn load_repo_root(
    state: &AppState,
    repo_root_id: String,
) -> Result<RepoRootRecord, ApiError> {
    let repo_root_service = state.repo_root_service.clone();
    run_blocking("get repo root", move || {
        repo_root_service.get_repo_root(&repo_root_id)
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?
    .ok_or_else(|| ApiError::not_found("Repo root not found", "REPO_ROOT_NOT_FOUND"))
}
