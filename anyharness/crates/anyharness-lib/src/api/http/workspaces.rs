use std::time::Instant;

use anyharness_contract::v1::{
    CreateCoworkWorkspaceRequest, CreateCoworkWorkspaceResponse, CreateWorkspaceRequest,
    CreateWorktreeWorkspaceRequest, CreateWorktreeWorkspaceResponse, DetectProjectSetupResponse,
    GetSetupStatusResponse, RegisterRepoWorkspaceRequest, ReplaceWorkspaceDefaultSessionRequest,
    ReplaceWorkspaceDefaultSessionResponse, ResolveWorkspaceFromPathRequest,
    StartWorkspaceSetupRequest, UpdateWorkspaceDisplayNameRequest, Workspace,
    WorkspaceSessionLaunchCatalog,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;

use super::blocking::run_blocking;
use super::error::ApiError;
use super::latency::{latency_trace_fields, LatencyRequestContext};
use super::sessions::map_create_session_error;
use super::workspaces_contract::{
    detection_result_to_contract, map_register_repo_workspace_error,
    map_set_workspace_display_name_error, setup_snapshot_to_contract,
    workspace_session_launch_catalog_to_contract, workspace_to_contract_with_summary,
};
use crate::app::AppState;
use crate::cowork::orchestrator::{CoworkCreateWorkspaceError, CoworkReplaceDefaultSessionError};
use crate::sessions::execution_summary::idle_workspace_execution_summary;
use crate::workspaces::model::WorkspaceRecord;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspacesQuery {
    pub surface_kind: Option<String>,
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/resolve",
    request_body = ResolveWorkspaceFromPathRequest,
    responses(
        (status = 200, description = "Resolved workspace", body = Workspace),
        (status = 400, description = "Invalid path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn resolve_workspace(
    State(state): State<AppState>,
    Json(req): Json<ResolveWorkspaceFromPathRequest>,
) -> Result<Json<Workspace>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let path = req.path;
    let record = run_blocking("resolve", move || {
        workspace_service.resolve_from_path(&path)
    })
    .await?
    .map_err(|e| ApiError::bad_request(e.to_string(), "WORKSPACE_RESOLVE_FAILED"))?;
    Ok(Json(workspace_to_contract(&state, record).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces",
    request_body = CreateWorkspaceRequest,
    responses(
        (status = 200, description = "Created workspace", body = Workspace),
        (status = 400, description = "Invalid path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn create_workspace(
    State(state): State<AppState>,
    Json(req): Json<CreateWorkspaceRequest>,
) -> Result<Json<Workspace>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let path = req.path;
    let record = run_blocking("create", move || workspace_service.create_workspace(&path))
        .await?
        .map_err(|e| ApiError::bad_request(e.to_string(), "WORKSPACE_CREATE_FAILED"))?;
    Ok(Json(workspace_to_contract(&state, record).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces:cowork",
    request_body = CreateCoworkWorkspaceRequest,
    responses(
        (status = 200, description = "Created Cowork workspace", body = CreateCoworkWorkspaceResponse),
        (status = 400, description = "Invalid Cowork request", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn create_cowork_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateCoworkWorkspaceRequest>,
) -> Result<Json<CreateCoworkWorkspaceResponse>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let result = state
        .cowork_orchestrator
        .create_workspace(&req.agent_kind, req.model_id.as_deref(), latency.as_ref())
        .await
        .map_err(map_create_cowork_workspace_error)?;

    Ok(Json(CreateCoworkWorkspaceResponse {
        workspace: workspace_to_contract(&state, result.workspace).await?,
        session: state
            .session_runtime
            .session_to_contract(&result.session)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/default-session:replace",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = ReplaceWorkspaceDefaultSessionRequest,
    responses(
        (status = 200, description = "Replaced Cowork default session", body = ReplaceWorkspaceDefaultSessionResponse),
        (status = 400, description = "Invalid replacement request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn replace_workspace_default_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(req): Json<ReplaceWorkspaceDefaultSessionRequest>,
) -> Result<Json<ReplaceWorkspaceDefaultSessionResponse>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let result = state
        .cowork_orchestrator
        .replace_default_session(
            &workspace_id,
            &req.agent_kind,
            req.model_id.as_deref(),
            latency.as_ref(),
        )
        .await
        .map_err(map_replace_default_session_error)?;

    Ok(Json(ReplaceWorkspaceDefaultSessionResponse {
        workspace: workspace_to_contract(&state, result.workspace).await?,
        session: state
            .session_runtime
            .session_to_contract(&result.session)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/repos",
    request_body = RegisterRepoWorkspaceRequest,
    responses(
        (status = 200, description = "Registered repo workspace", body = Workspace),
        (status = 400, description = "Invalid repo path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn register_repo_workspace(
    State(state): State<AppState>,
    Json(req): Json<RegisterRepoWorkspaceRequest>,
) -> Result<Json<Workspace>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let path = req.path;
    let record = run_blocking("register repo", move || {
        workspace_service.register_repo_from_path(&path)
    })
    .await?
    .map_err(map_register_repo_workspace_error)?;
    Ok(Json(workspace_to_contract(&state, record).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/worktrees",
    request_body = CreateWorktreeWorkspaceRequest,
    responses(
        (status = 200, description = "Created worktree workspace", body = CreateWorktreeWorkspaceResponse),
        (status = 400, description = "Invalid request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Source workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn create_worktree(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateWorktreeWorkspaceRequest>,
) -> Result<Json<CreateWorktreeWorkspaceResponse>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    let workspace_service = state.workspace_service.clone();
    let setup_execution_service = state.setup_execution_service.clone();
    let source_workspace_id = req.source_workspace_id;
    let target_path = req.target_path;
    let new_branch_name = req.new_branch_name;
    let base_branch = req.base_branch.clone();
    let setup_script = req.setup_script.clone();
    let source_workspace_id_for_task = source_workspace_id.clone();
    let has_setup_script = setup_script
        .as_deref()
        .map(str::trim)
        .map(|script| !script.is_empty())
        .unwrap_or(false);
    tracing::info!(
        source_workspace_id = %source_workspace_id,
        has_setup_script,
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] workspace.http.worktree.request_received"
    );

    // Create the worktree synchronously (fast — just git worktree add + DB insert).
    // Setup script is NOT run here anymore — it's fired async below.
    let result = run_blocking("worktree", {
        let base_branch = base_branch.clone();
        move || {
            workspace_service.create_worktree(
                &source_workspace_id_for_task,
                &target_path,
                &new_branch_name,
                base_branch.as_deref(),
                None, // no setup script — handled async
            )
        }
    })
    .await?
    .map_err(|e| ApiError::bad_request(e.to_string(), "WORKTREE_CREATE_FAILED"))?;

    // Fire setup script in background if provided.
    // The setup result is NOT returned inline — the frontend polls
    // GET /setup-status to observe progress. We return setupScript: null
    // to avoid abusing SetupScriptExecution for a non-terminal state.
    if let Some(script) = setup_script
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let workspace_service_for_env = state.workspace_service.clone();
        let env_vars = tokio::task::spawn_blocking({
            let record = result.workspace.clone();
            let base_branch = base_branch.clone();
            move || workspace_service_for_env.build_workspace_env(&record, base_branch.as_deref())
        })
        .await
        .map_err(|e| ApiError::internal(format!("env build task failed: {e}")))?;

        setup_execution_service
            .start(
                result.workspace.id.clone(),
                result.workspace.path.clone(),
                script.to_string(),
                env_vars,
            )
            .await;
    }

    tracing::info!(
        workspace_id = %result.workspace.id,
        source_workspace_id = %source_workspace_id,
        has_setup_script,
        elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] workspace.http.worktree.completed"
    );

    Ok(Json(CreateWorktreeWorkspaceResponse {
        workspace: workspace_to_contract(&state, result.workspace).await?,
        setup_script: None,
    }))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces",
    responses(
        (status = 200, description = "List workspaces", body = Vec<Workspace>),
    ),
    tag = "workspaces"
)]
pub async fn list_workspaces(
    State(state): State<AppState>,
    Query(query): Query<ListWorkspacesQuery>,
) -> Result<Json<Vec<Workspace>>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let surface_kind = query.surface_kind;
    let records = run_blocking("list", move || {
        workspace_service.list_workspaces(surface_kind.as_deref())
    })
    .await?
    .map_err(|e| ApiError::internal(e.to_string()))?;
    let summaries = state
        .session_runtime
        .workspace_execution_summaries()
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(
        records
            .into_iter()
            .map(|record| {
                let workspace_id = record.id.clone();
                workspace_to_contract_with_summary(
                    record,
                    summaries
                        .get(&workspace_id)
                        .cloned()
                        .unwrap_or_else(idle_workspace_execution_summary),
                )
            })
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace", body = Workspace),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn get_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Workspace>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let record = run_blocking("get", move || {
        workspace_service.get_workspace(&workspace_id)
    })
    .await?
    .map_err(|e| ApiError::internal(e.to_string()))?
    .ok_or_else(|| ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND"))?;
    Ok(Json(workspace_to_contract(&state, record).await?))
}

#[utoipa::path(
    patch,
    path = "/v1/workspaces/{workspace_id}/display-name",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = UpdateWorkspaceDisplayNameRequest,
    responses(
        (status = 200, description = "Updated workspace display name", body = Workspace),
        (status = 400, description = "Invalid display name", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn update_workspace_display_name(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<UpdateWorkspaceDisplayNameRequest>,
) -> Result<Json<Workspace>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let workspace_id_for_task = workspace_id.clone();
    let display_name = req.display_name;
    let record = run_blocking("display-name", move || {
        workspace_service.set_display_name(&workspace_id_for_task, display_name.as_deref())
    })
    .await?
    .map_err(map_set_workspace_display_name_error)?;

    Ok(Json(workspace_to_contract(&state, record).await?))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/session-launch",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace session launch catalog", body = WorkspaceSessionLaunchCatalog),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn get_workspace_session_launch_catalog(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceSessionLaunchCatalog>, ApiError> {
    let session_service = state.session_service.clone();
    let workspace_id_for_task = workspace_id.clone();
    let catalog = run_blocking("session launch", move || {
        session_service.get_workspace_session_launch_catalog(&workspace_id_for_task)
    })
    .await?
    .map_err(|error| {
        if error.to_string().contains("workspace not found") {
            ApiError::not_found(error.to_string(), "WORKSPACE_NOT_FOUND")
        } else {
            ApiError::internal(error.to_string())
        }
    })?;

    Ok(Json(workspace_session_launch_catalog_to_contract(catalog)))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/detect-setup",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Detected project setup hints", body = DetectProjectSetupResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn detect_project_setup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<DetectProjectSetupResponse>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let result = run_blocking("detect-setup", move || {
        workspace_service.detect_setup(&workspace_id)
    })
    .await?
    .map_err(|e| {
        if e.to_string().contains("not found") {
            ApiError::not_found(e.to_string(), "WORKSPACE_NOT_FOUND")
        } else {
            ApiError::internal(e.to_string())
        }
    })?;
    Ok(Json(detection_result_to_contract(result)))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/setup-status",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Setup execution status", body = GetSetupStatusResponse),
        (status = 404, description = "No setup execution found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn get_setup_status(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<GetSetupStatusResponse>, ApiError> {
    let snapshot = state
        .setup_execution_service
        .get_status(&workspace_id)
        .await
        .ok_or_else(|| {
            ApiError::not_found(
                "No setup execution found for this workspace".to_string(),
                "SETUP_NOT_FOUND",
            )
        })?;

    Ok(Json(setup_snapshot_to_contract(snapshot)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/setup-rerun",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Setup execution restarted", body = GetSetupStatusResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "No setup script configured", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn rerun_setup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<GetSetupStatusResponse>, ApiError> {
    // Get the previous execution to find the command
    let previous = state
        .setup_execution_service
        .get_status(&workspace_id)
        .await
        .ok_or_else(|| {
            ApiError::not_found(
                "No previous setup execution found for this workspace".to_string(),
                "SETUP_NOT_FOUND",
            )
        })?;

    let snapshot = start_setup_for_workspace(&state, workspace_id, previous.command, None).await?;

    Ok(Json(snapshot))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/setup-start",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = StartWorkspaceSetupRequest,
    responses(
        (status = 200, description = "Setup execution started", body = GetSetupStatusResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Invalid setup command", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn start_setup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<StartWorkspaceSetupRequest>,
) -> Result<Json<GetSetupStatusResponse>, ApiError> {
    let command = req.command.trim().to_string();
    if command.is_empty() {
        return Err(ApiError::bad_request(
            "Setup command must not be empty.",
            "INVALID_SETUP_COMMAND",
        ));
    }

    let snapshot = start_setup_for_workspace(&state, workspace_id, command, req.base_ref).await?;
    Ok(Json(snapshot))
}

async fn start_setup_for_workspace(
    state: &AppState,
    workspace_id: String,
    command: String,
    base_ref: Option<String>,
) -> Result<GetSetupStatusResponse, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let ws_id = workspace_id.clone();
    let record = run_blocking("workspace lookup", move || {
        workspace_service.get_workspace(&ws_id)
    })
    .await?
    .map_err(|e| ApiError::internal(e.to_string()))?
    .ok_or_else(|| ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND"))?;

    let env_vars = {
        let ws = state.workspace_service.clone();
        let rec = record.clone();
        let base_ref = base_ref.clone();
        tokio::task::spawn_blocking(move || ws.build_workspace_env(&rec, base_ref.as_deref()))
            .await
            .map_err(|e| ApiError::internal(format!("env build failed: {e}")))?
    };

    state
        .setup_execution_service
        .start(workspace_id.clone(), record.path, command, env_vars)
        .await;

    let snapshot = state
        .setup_execution_service
        .get_status(&workspace_id)
        .await
        .ok_or_else(|| ApiError::internal("Setup job disappeared after start".to_string()))?;

    Ok(setup_snapshot_to_contract(snapshot))
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

fn map_create_cowork_workspace_error(error: CoworkCreateWorkspaceError) -> ApiError {
    match error {
        CoworkCreateWorkspaceError::UnsupportedAgent(agent_kind) => ApiError::bad_request(
            format!("Cowork does not support agent '{agent_kind}'"),
            "COWORK_UNSUPPORTED_AGENT",
        ),
        CoworkCreateWorkspaceError::Workspace(error) => ApiError::internal(error.to_string()),
        CoworkCreateWorkspaceError::Session(error) => map_create_session_error(error),
    }
}

fn map_replace_default_session_error(error: CoworkReplaceDefaultSessionError) -> ApiError {
    match error {
        CoworkReplaceDefaultSessionError::UnsupportedAgent(agent_kind) => ApiError::bad_request(
            format!("unsupported Cowork agent kind: {agent_kind}"),
            "COWORK_AGENT_UNSUPPORTED",
        ),
        CoworkReplaceDefaultSessionError::Workspace(error) => {
            let message = error.to_string();
            if message.contains("not found") {
                ApiError::not_found(message, "WORKSPACE_NOT_FOUND")
            } else {
                ApiError::bad_request(message, "COWORK_WORKSPACE_REPLACE_FAILED")
            }
        }
        CoworkReplaceDefaultSessionError::Session(error) => map_create_session_error(error),
        CoworkReplaceDefaultSessionError::SessionLifecycle(error) => {
            ApiError::internal(error.to_string())
        }
    }
}
