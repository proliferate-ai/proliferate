use anyharness_contract::v1::{RepoRoot, RepoRootKind};
use axum::{
    extract::{Path, State},
    Json,
};

use super::blocking::run_blocking;
use super::error::ApiError;
use crate::app::AppState;
use crate::repo_roots::model::RepoRootRecord;

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
    let repo_root_service = state.repo_root_service.clone();
    let repo_root = run_blocking("get repo root", move || {
        repo_root_service.get_repo_root(&repo_root_id)
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?
    .ok_or_else(|| ApiError::not_found("Repo root not found", "REPO_ROOT_NOT_FOUND"))?;
    Ok(Json(repo_root_to_contract(repo_root)))
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
