use std::time::Instant;

use anyharness_contract::v1::{
    CreateWorkspaceRequest, CreateWorktreeWorkspaceRequest, CreateWorktreeWorkspaceResponse,
    DetectProjectSetupResponse, GetSetupStatusResponse, RepoRoot, RepoRootKind,
    ResolveWorkspaceFromPathRequest, ResolveWorkspaceResponse, StartWorkspaceSetupRequest,
    UpdateWorkspaceDisplayNameRequest, Workspace, WorkspaceSessionLaunchCatalog,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};

use super::access::{assert_workspace_mutable, map_access_error};
use super::blocking::run_blocking;
use super::error::ApiError;
use super::latency::{latency_trace_fields, LatencyRequestContext};
use super::workspaces_contract::{
    detection_result_to_contract, map_set_workspace_display_name_error,
    setup_command_run_to_contract, workspace_session_launch_catalog_to_contract,
    workspace_to_contract_with_summary,
};
use crate::app::AppState;
use crate::origin::OriginContext;
use crate::repo_roots::model::RepoRootRecord;
use crate::sessions::execution_summary::idle_workspace_execution_summary;
use crate::workspaces::creator_context::WorkspaceCreatorContext;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::runtime::WorkspaceResolution;

#[utoipa::path(
    post,
    path = "/v1/workspaces/resolve",
    request_body = ResolveWorkspaceFromPathRequest,
    responses(
        (status = 200, description = "Resolved workspace", body = ResolveWorkspaceResponse),
        (status = 400, description = "Invalid path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn resolve_workspace(
    State(state): State<AppState>,
    Json(req): Json<ResolveWorkspaceFromPathRequest>,
) -> Result<Json<ResolveWorkspaceResponse>, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let path = req.path;
    let origin = request_origin_or_api_default(req.origin, "resolve_workspace");
    let creator_context = req
        .creator_context
        .map(WorkspaceCreatorContext::from_contract);
    let result = run_blocking("resolve", move || {
        workspace_runtime.resolve_from_path_with_origin_and_creator_context(
            &path,
            origin,
            creator_context,
        )
    })
    .await?
    .map_err(|e| ApiError::bad_request(e.to_string(), "WORKSPACE_RESOLVE_FAILED"))?;
    Ok(Json(
        resolve_workspace_response_to_contract(&state, result).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces",
    request_body = CreateWorkspaceRequest,
    responses(
        (status = 200, description = "Created workspace", body = ResolveWorkspaceResponse),
        (status = 400, description = "Invalid path", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn create_workspace(
    State(state): State<AppState>,
    Json(req): Json<CreateWorkspaceRequest>,
) -> Result<Json<ResolveWorkspaceResponse>, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let path = req.path;
    let origin = request_origin_or_api_default(req.origin, "create_workspace");
    let creator_context = req
        .creator_context
        .map(WorkspaceCreatorContext::from_contract);
    let result = run_blocking("create", move || {
        workspace_runtime.create_workspace_with_origin_and_creator_context(
            &path,
            origin,
            creator_context,
        )
    })
    .await?
    .map_err(|e| ApiError::bad_request(e.to_string(), "WORKSPACE_CREATE_FAILED"))?;
    Ok(Json(
        resolve_workspace_response_to_contract(&state, result).await?,
    ))
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
    let workspace_runtime = state.workspace_runtime.clone();
    let repo_root_id = req.repo_root_id;
    let target_path = req.target_path;
    let new_branch_name = req.new_branch_name;
    let base_branch = req.base_branch.clone();
    let setup_script = req.setup_script.clone();
    let origin = request_origin_or_api_default(req.origin, "create_worktree");
    let creator_context = req
        .creator_context
        .map(WorkspaceCreatorContext::from_contract);
    let repo_root_id_for_task = repo_root_id.clone();
    let has_setup_script = setup_script
        .as_deref()
        .map(str::trim)
        .map(|script| !script.is_empty())
        .unwrap_or(false);
    tracing::info!(
        repo_root_id = %repo_root_id,
        has_setup_script,
        flow_id = latency_fields.flow_id,
        flow_kind = latency_fields.flow_kind,
        flow_source = latency_fields.flow_source,
        prompt_id = latency_fields.prompt_id,
        "[workspace-latency] workspace.http.worktree.request_received"
    );

    state
        .workspace_access_gate
        .assert_can_mutate_for_repo_root(&repo_root_id)
        .map_err(map_access_error)?;

    let result = run_blocking("worktree", {
        let base_branch = base_branch.clone();
        move || {
            workspace_runtime.create_worktree_with_surface(
                &repo_root_id_for_task,
                &target_path,
                &new_branch_name,
                base_branch.as_deref(),
                None,
                "standard",
                origin,
                creator_context,
            )
        }
    })
    .await?
    .map_err(|e| ApiError::bad_request(e.to_string(), "WORKTREE_CREATE_FAILED"))?;

    if let Some(script) = setup_script
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let workspace_runtime_for_env = state.workspace_runtime.clone();
        let env_vars = tokio::task::spawn_blocking({
            let record = result.workspace.clone();
            let base_branch = base_branch.clone();
            move || workspace_runtime_for_env.build_workspace_env(&record, base_branch.as_deref())
        })
        .await
        .map_err(|e| ApiError::internal(format!("env build task failed: {e}")))?
        .map_err(|e| ApiError::internal(e.to_string()))?;

        state
            .terminal_service
            .start_setup_command(
                &result.workspace.id,
                &result.workspace.path,
                script.to_string(),
                env_vars,
                None,
            )
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }

    tracing::info!(
        workspace_id = %result.workspace.id,
        repo_root_id = %repo_root_id,
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
) -> Result<Json<Vec<Workspace>>, ApiError> {
    let workspace_runtime = state.workspace_runtime.clone();
    let records = run_blocking("list", move || workspace_runtime.list_workspaces())
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
    let workspace_runtime = state.workspace_runtime.clone();
    let record = run_blocking("get", move || {
        workspace_runtime.get_workspace(&workspace_id)
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
    assert_workspace_mutable(&state, &workspace_id)?;
    let workspace_runtime = state.workspace_runtime.clone();
    let workspace_id_for_task = workspace_id.clone();
    let display_name = req.display_name;
    let record = run_blocking("display-name", move || {
        workspace_runtime.set_display_name(&workspace_id_for_task, display_name.as_deref())
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
    let workspace_runtime = state.workspace_runtime.clone();
    let result = run_blocking("detect-setup", move || {
        workspace_runtime.detect_setup(&workspace_id)
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
    let run = state
        .terminal_service
        .latest_setup_run(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                "No setup execution found for this workspace".to_string(),
                "SETUP_NOT_FOUND",
            )
        })?;

    Ok(Json(setup_command_run_to_contract(run)))
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
    assert_workspace_mutable(&state, &workspace_id)?;
    let previous = state
        .terminal_service
        .latest_setup_run(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
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
    assert_workspace_mutable(&state, &workspace_id)?;
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
    let workspace_runtime = state.workspace_runtime.clone();
    let ws_id = workspace_id.clone();
    let record = run_blocking("workspace lookup", move || {
        workspace_runtime.get_workspace(&ws_id)
    })
    .await?
    .map_err(|e| ApiError::internal(e.to_string()))?
    .ok_or_else(|| ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND"))?;

    let env_vars = {
        let workspace_runtime = state.workspace_runtime.clone();
        let rec = record.clone();
        let base_ref = base_ref.clone();
        tokio::task::spawn_blocking(move || {
            workspace_runtime.build_workspace_env(&rec, base_ref.as_deref())
        })
        .await
        .map_err(|e| ApiError::internal(format!("env build failed: {e}")))?
        .map_err(|e| ApiError::internal(e.to_string()))?
    };

    let run = state
        .terminal_service
        .start_setup_command(&workspace_id, &record.path, command, env_vars, None)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(setup_command_run_to_contract(run))
}

async fn resolve_workspace_response_to_contract(
    state: &AppState,
    result: WorkspaceResolution,
) -> Result<ResolveWorkspaceResponse, ApiError> {
    Ok(ResolveWorkspaceResponse {
        repo_root: repo_root_to_contract(result.repo_root),
        workspace: workspace_to_contract(state, result.workspace).await?,
    })
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

fn request_origin_or_api_default(
    origin: Option<anyharness_contract::v1::OriginContext>,
    operation: &'static str,
) -> OriginContext {
    match origin {
        Some(origin) => OriginContext::from_contract(origin),
        None => {
            tracing::warn!(
                operation,
                "AnyHarness request omitted origin; defaulting to api/local_runtime"
            );
            OriginContext::api_local_runtime()
        }
    }
}

pub(crate) async fn workspace_to_contract(
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
