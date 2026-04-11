use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;

use anyharness_contract::v1::{WorkspaceArtifactDetail, WorkspaceArtifactSummary};

use super::error::ApiError;
use crate::app::AppState;
use crate::artifacts::model::{WorkspaceArtifactDetailData, WorkspaceArtifactSummaryData};
use crate::artifacts::service::ArtifactServiceError;
use crate::workspaces::model::WorkspaceRecord;

#[derive(Debug, Deserialize)]
pub struct ArtifactContentQuery {
    pub path: String,
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/artifacts",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "List workspace artifacts", body = Vec<WorkspaceArtifactSummary>),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "artifacts"
)]
pub async fn list_artifacts(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Vec<WorkspaceArtifactSummary>>, ApiError> {
    let workspace = get_cowork_workspace(&state, &workspace_id)?;
    let artifact_service = state.artifact_service.clone();
    let workspace_path = workspace.path.clone();

    let artifacts = tokio::task::spawn_blocking(move || {
        artifact_service.list_workspace_artifacts(std::path::Path::new(&workspace_path))
    })
    .await
    .map_err(|error| ApiError::internal(format!("artifact list task failed: {error}")))?
    .map_err(map_artifact_service_error)?;

    Ok(Json(
        artifacts.into_iter().map(summary_to_contract).collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("artifact_id" = String, Path, description = "Artifact ID")
    ),
    responses(
        (status = 200, description = "Workspace artifact detail", body = WorkspaceArtifactDetail),
        (status = 404, description = "Artifact not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "artifacts"
)]
pub async fn get_artifact(
    State(state): State<AppState>,
    Path((workspace_id, artifact_id)): Path<(String, String)>,
) -> Result<Json<WorkspaceArtifactDetail>, ApiError> {
    let workspace = get_cowork_workspace(&state, &workspace_id)?;
    let artifact_service = state.artifact_service.clone();
    let workspace_path = workspace.path.clone();

    let artifact = tokio::task::spawn_blocking(move || {
        artifact_service.get_workspace_artifact(std::path::Path::new(&workspace_path), &artifact_id)
    })
    .await
    .map_err(|error| ApiError::internal(format!("artifact detail task failed: {error}")))?
    .map_err(map_artifact_service_error)?;

    Ok(Json(detail_to_contract(artifact)))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/content",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("artifact_id" = String, Path, description = "Artifact ID"),
        ("path" = String, Query, description = "Artifact-relative file path")
    ),
    responses(
        (status = 200, description = "Artifact content"),
        (status = 404, description = "Artifact content not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "artifacts"
)]
pub async fn get_artifact_content(
    State(state): State<AppState>,
    Path((workspace_id, artifact_id)): Path<(String, String)>,
    Query(query): Query<ArtifactContentQuery>,
) -> Result<Response, ApiError> {
    let workspace = get_cowork_workspace(&state, &workspace_id)?;
    let artifact_service = state.artifact_service.clone();
    let workspace_path = workspace.path.clone();
    let relative_path = query.path;

    let content = tokio::task::spawn_blocking(move || {
        artifact_service.read_workspace_artifact_content(
            std::path::Path::new(&workspace_path),
            &artifact_id,
            &relative_path,
        )
    })
    .await
    .map_err(|error| ApiError::internal(format!("artifact content task failed: {error}")))?
    .map_err(map_artifact_service_error)?;

    let mut response = Response::new(Body::from(content.bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content.content_type)
            .map_err(|error| ApiError::internal(format!("invalid content-type header: {error}")))?,
    );
    Ok(response)
}

fn get_cowork_workspace(state: &AppState, workspace_id: &str) -> Result<WorkspaceRecord, ApiError> {
    let workspace = state
        .workspace_service
        .get_workspace(workspace_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Workspace not found: {workspace_id}"),
                "WORKSPACE_NOT_FOUND",
            )
        })?;

    if workspace.surface_kind != "cowork" {
        return Err(ApiError::bad_request(
            "Artifacts are only available for Cowork workspaces.",
            "ARTIFACTS_UNSUPPORTED_FOR_WORKSPACE",
        ));
    }

    Ok(workspace)
}

fn map_artifact_service_error(error: ArtifactServiceError) -> ApiError {
    match error.status_code() {
        404 => ApiError::not_found(error.to_string(), error.problem_code()),
        400 => ApiError::bad_request(error.to_string(), error.problem_code()),
        _ => ApiError::internal(error.to_string()),
    }
}

fn summary_to_contract(summary: WorkspaceArtifactSummaryData) -> WorkspaceArtifactSummary {
    WorkspaceArtifactSummary {
        id: summary.id,
        title: summary.title,
        renderer: summary.renderer.to_contract(),
        entry: summary.entry,
        updated_at: summary.updated_at,
    }
}

fn detail_to_contract(detail: WorkspaceArtifactDetailData) -> WorkspaceArtifactDetail {
    WorkspaceArtifactDetail {
        id: detail.id,
        title: detail.title,
        kind: detail.kind,
        renderer: detail.renderer.to_contract(),
        entry: detail.entry,
        created_at: detail.created_at,
        updated_at: detail.updated_at,
    }
}
