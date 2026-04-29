use anyharness_contract::v1::{
    CoworkArtifactDetailResponse, CoworkArtifactManifestResponse, CoworkRoot, CoworkStatus,
    CoworkThread, CreateCoworkThreadRequest, CreateCoworkThreadResponse, Workspace,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::Value;

use super::blocking::run_blocking;
use super::error::ApiError;
use super::workspaces_contract::workspace_to_contract_with_summary;
use crate::app::AppState;
use crate::cowork::manifest::CoworkArtifactError;
use crate::cowork::mcp::handle_json_rpc;
use crate::cowork::model::CoworkRootRecord;
use crate::cowork::runtime::{CoworkCreateThreadError, CoworkThreadSummary};
use crate::repo_roots::model::RepoRootRecord;
use crate::sessions::mcp::{bindings_from_contract, validate_binding_summaries};
use crate::workspaces::model::WorkspaceRecord;

#[utoipa::path(
    get,
    path = "/v1/cowork",
    responses((status = 200, description = "Cowork status", body = CoworkStatus)),
    tag = "cowork"
)]
pub async fn get_cowork_status(
    State(state): State<AppState>,
) -> Result<Json<CoworkStatus>, ApiError> {
    let cowork_runtime = state.cowork_runtime.clone();
    let (root, thread_count) = run_blocking("cowork status", move || cowork_runtime.status())
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(CoworkStatus {
        enabled: root.is_some(),
        root: root.map(|(cowork_root, repo_root)| cowork_root_to_contract(cowork_root, repo_root)),
        thread_count,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/cowork/enable",
    responses((status = 200, description = "Enabled cowork", body = CoworkStatus)),
    tag = "cowork"
)]
pub async fn enable_cowork(State(state): State<AppState>) -> Result<Json<CoworkStatus>, ApiError> {
    let cowork_runtime = state.cowork_runtime.clone();
    let (cowork_root, repo_root) = run_blocking("enable cowork", move || cowork_runtime.enable())
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let thread_count = run_blocking("count cowork threads", {
        let cowork_runtime = state.cowork_runtime.clone();
        move || cowork_runtime.list_threads().map(|threads| threads.len())
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(CoworkStatus {
        enabled: true,
        root: Some(cowork_root_to_contract(cowork_root, repo_root)),
        thread_count,
    }))
}

#[utoipa::path(
    get,
    path = "/v1/cowork/threads",
    responses((status = 200, description = "Cowork threads", body = Vec<CoworkThread>)),
    tag = "cowork"
)]
pub async fn list_cowork_threads(
    State(state): State<AppState>,
) -> Result<Json<Vec<CoworkThread>>, ApiError> {
    let cowork_runtime = state.cowork_runtime.clone();
    let threads = run_blocking("list cowork threads", move || cowork_runtime.list_threads())
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(
        threads.into_iter().map(cowork_thread_to_contract).collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/v1/cowork/threads",
    request_body = CreateCoworkThreadRequest,
    responses(
        (status = 200, description = "Created cowork thread", body = CreateCoworkThreadResponse),
        (status = 409, description = "Cowork not enabled", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "cowork"
)]
pub async fn create_cowork_thread(
    State(state): State<AppState>,
    Json(req): Json<CreateCoworkThreadRequest>,
) -> Result<Json<CreateCoworkThreadResponse>, ApiError> {
    if let Some(summaries) = req.mcp_binding_summaries.as_deref() {
        validate_binding_summaries(summaries)
            .map_err(|error| ApiError::bad_request(error.to_string(), "INVALID_MCP_SUMMARY"))?;
    }
    let mcp_servers = bindings_from_contract(req.mcp_servers.unwrap_or_default());
    let result = state
        .cowork_runtime
        .create_thread(
            &req.agent_kind,
            req.model_id.as_deref(),
            req.mode_id.as_deref(),
            mcp_servers,
            req.mcp_binding_summaries,
        )
        .await
        .map_err(map_create_cowork_thread_error)?;

    Ok(Json(CreateCoworkThreadResponse {
        thread: cowork_thread_to_contract(result.thread),
        workspace: workspace_to_contract(&state, result.workspace).await?,
        session: state
            .session_runtime
            .session_to_contract(&result.session)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
    }))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/cowork/manifest",
    params(
        ("workspace_id" = String, Path, description = "Workspace id")
    ),
    responses(
        (status = 200, description = "Cowork artifact manifest", body = CoworkArtifactManifestResponse),
        (status = 409, description = "Manifest invalid", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "cowork"
)]
pub async fn get_cowork_manifest(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<CoworkArtifactManifestResponse>, ApiError> {
    let workspace = load_workspace(&state, &workspace_id).await?;
    let artifact_runtime = state.cowork_artifact_runtime.clone();
    let manifest = run_blocking("get cowork manifest", move || {
        artifact_runtime.get_manifest(&workspace)
    })
    .await?
    .map_err(map_cowork_artifact_error)?;
    Ok(Json(manifest))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/cowork/artifacts/{artifact_id}",
    params(
        ("workspace_id" = String, Path, description = "Workspace id"),
        ("artifact_id" = String, Path, description = "Artifact id")
    ),
    responses(
        (status = 200, description = "Cowork artifact detail", body = CoworkArtifactDetailResponse),
        (status = 404, description = "Artifact not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Artifact invalid", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "cowork"
)]
pub async fn get_cowork_artifact(
    State(state): State<AppState>,
    Path((workspace_id, artifact_id)): Path<(String, String)>,
) -> Result<Json<CoworkArtifactDetailResponse>, ApiError> {
    let workspace = load_workspace(&state, &workspace_id).await?;
    let artifact_runtime = state.cowork_artifact_runtime.clone();
    let artifact = run_blocking("get cowork artifact", move || {
        artifact_runtime.get_artifact(&workspace, &artifact_id)
    })
    .await?
    .map_err(map_cowork_artifact_error)?;
    Ok(Json(artifact))
}

pub async fn get_cowork_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_cowork_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let capability_header = headers
        .get(state.cowork_session_hooks.capability_header_name())
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::unauthorized(
                "Missing cowork capability token.",
                "COWORK_MCP_UNAUTHORIZED",
            )
        })?;
    let is_valid = state
        .cowork_session_hooks
        .validate_capability_token(capability_header, &workspace_id, &session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if !is_valid {
        return Err(ApiError::unauthorized(
            "Invalid cowork capability token.",
            "COWORK_MCP_UNAUTHORIZED",
        ));
    }

    let artifact_runtime = state.cowork_artifact_runtime.clone();
    let session_service = state.session_service.clone();
    let workspace_runtime = state.workspace_runtime.clone();
    let cowork_service = state.cowork_service.clone();
    let response = run_blocking("cowork mcp call", move || {
        handle_json_rpc(
            &artifact_runtime,
            &session_service,
            &workspace_runtime,
            &cowork_service,
            &workspace_id,
            &session_id,
            body,
        )
    })
    .await?
    .map_err(|error| ApiError::bad_request(error.to_string(), "COWORK_MCP_REQUEST_INVALID"))?;

    match response {
        Some(payload) => Ok((StatusCode::OK, Json(payload)).into_response()),
        None => Ok(StatusCode::ACCEPTED.into_response()),
    }
}

fn map_create_cowork_thread_error(error: CoworkCreateThreadError) -> ApiError {
    match error {
        CoworkCreateThreadError::NotEnabled => {
            ApiError::conflict("cowork is not enabled", "COWORK_NOT_ENABLED")
        }
        CoworkCreateThreadError::Setup(error) => {
            ApiError::internal(format!("cowork setup failed: {error}"))
        }
        CoworkCreateThreadError::CreateSession(error) => match error {
            crate::sessions::runtime::CreateAndStartSessionError::WorkspaceSingleSession {
                session_id,
            } => ApiError::conflict(
                format!("workspace only allows a single session; existing session: {session_id}"),
                "WORKSPACE_SINGLE_SESSION",
            ),
            crate::sessions::runtime::CreateAndStartSessionError::WorkspaceNotFound => {
                ApiError::bad_request("workspace not found", "WORKSPACE_NOT_FOUND")
            }
            crate::sessions::runtime::CreateAndStartSessionError::Invalid(detail) => {
                ApiError::bad_request(detail, "SESSION_CREATE_FAILED")
            }
            crate::sessions::runtime::CreateAndStartSessionError::MissingDataKey => {
                ApiError::internal(
                    crate::sessions::mcp::SessionMcpBindingsError::missing_data_key_detail(),
                )
            }
            crate::sessions::runtime::CreateAndStartSessionError::StartFailed(error) => {
                ApiError::internal(format!("ACP session start failed: {error}"))
            }
            crate::sessions::runtime::CreateAndStartSessionError::Internal(error) => {
                ApiError::internal(error.to_string())
            }
        },
        CoworkCreateThreadError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn map_cowork_artifact_error(error: CoworkArtifactError) -> ApiError {
    match error {
        CoworkArtifactError::ArtifactNotFound(id) => ApiError::not_found(
            format!("artifact not found: {id}"),
            "COWORK_ARTIFACT_NOT_FOUND",
        ),
        CoworkArtifactError::ArtifactFileInvalid(detail) => {
            ApiError::conflict(detail, "COWORK_ARTIFACT_FILE_INVALID")
        }
        CoworkArtifactError::ManifestInvalid(detail) => {
            ApiError::conflict(detail, "COWORK_ARTIFACT_MANIFEST_INVALID")
        }
        CoworkArtifactError::UnsupportedType(detail) => {
            ApiError::bad_request(detail, "COWORK_ARTIFACT_TYPE_UNSUPPORTED")
        }
        CoworkArtifactError::InvalidPath(detail) => {
            ApiError::bad_request(detail, "COWORK_ARTIFACT_PATH_INVALID")
        }
        CoworkArtifactError::WorkspaceNotCowork => ApiError::conflict(
            "workspace is not a cowork workspace",
            "COWORK_WORKSPACE_REQUIRED",
        ),
        CoworkArtifactError::PathAlreadyRegistered(detail)
        | CoworkArtifactError::ProtectedPath(detail) => {
            ApiError::conflict(detail, "COWORK_ARTIFACT_CONFLICT")
        }
        CoworkArtifactError::Io(detail) => ApiError::internal(detail),
    }
}

fn cowork_root_to_contract(cowork_root: CoworkRootRecord, repo_root: RepoRootRecord) -> CoworkRoot {
    CoworkRoot {
        id: cowork_root.id,
        repo_root_id: cowork_root.repo_root_id,
        repo_root_path: repo_root.path,
        default_branch: repo_root.default_branch.unwrap_or_else(|| "main".into()),
        created_at: cowork_root.created_at,
        updated_at: cowork_root.updated_at,
    }
}

fn cowork_thread_to_contract(summary: CoworkThreadSummary) -> CoworkThread {
    CoworkThread {
        id: summary.thread.id,
        repo_root_id: summary.thread.repo_root_id,
        workspace_id: summary.thread.workspace_id,
        session_id: summary.thread.session_id,
        agent_kind: summary.thread.agent_kind,
        requested_model_id: summary.thread.requested_model_id,
        branch_name: summary.thread.branch_name,
        title: summary.title,
        created_at: summary.thread.created_at,
        updated_at: summary.updated_at,
        last_activity_at: summary.last_activity_at,
    }
}

async fn workspace_to_contract(
    state: &AppState,
    record: WorkspaceRecord,
) -> Result<Workspace, ApiError> {
    let execution_summary = state
        .session_runtime
        .workspace_execution_summary(&record.id)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(workspace_to_contract_with_summary(
        record,
        execution_summary,
    ))
}

async fn load_workspace(state: &AppState, workspace_id: &str) -> Result<WorkspaceRecord, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let workspace_id = workspace_id.to_string();
    run_blocking("load cowork workspace", move || {
        workspace_runtime
            .get_workspace(&workspace_id)
            .map_err(|error| ApiError::internal(error.to_string()))?
            .ok_or_else(|| {
                ApiError::not_found(
                    format!("workspace not found: {workspace_id}"),
                    "WORKSPACE_NOT_FOUND",
                )
            })
    })
    .await?
}
