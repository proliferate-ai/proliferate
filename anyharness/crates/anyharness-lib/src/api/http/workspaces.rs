use std::time::Instant;

use anyharness_contract::v1::{
    CreateWorkspaceRequest, CreateWorktreeWorkspaceRequest, CreateWorktreeWorkspaceResponse,
    DetectProjectSetupResponse, GetSetupStatusResponse, RegisterRepoWorkspaceRequest,
    ResolveWorkspaceFromPathRequest, SetupHint, SetupHintCategory, SetupScriptStatus,
    StartWorkspaceSetupRequest, UpdateWorkspaceDisplayNameRequest, Workspace, WorkspaceKind,
    WorkspaceSessionLaunchAgent, WorkspaceSessionLaunchCatalog, WorkspaceSessionLaunchModel,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};

use super::blocking::run_blocking;
use super::error::ApiError;
use super::latency::{latency_trace_fields, LatencyRequestContext};
use crate::app::AppState;
use crate::sessions::execution_summary::idle_workspace_execution_summary;
use crate::sessions::service::{
    WorkspaceSessionLaunchAgentData, WorkspaceSessionLaunchCatalogData,
    WorkspaceSessionLaunchModelData,
};
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::setup_execution::{SetupJobSnapshot, SetupJobStatus};
use crate::workspaces::types::{
    DetectedHintCategory, DetectedSetupHint, ProjectSetupDetectionResult,
    RegisterRepoWorkspaceError, SetWorkspaceDisplayNameError,
};

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
) -> Result<Json<Vec<Workspace>>, ApiError> {
    let workspace_service = state.workspace_service.clone();
    let records = run_blocking("list", move || workspace_service.list_workspaces())
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

fn setup_snapshot_to_contract(snapshot: SetupJobSnapshot) -> GetSetupStatusResponse {
    GetSetupStatusResponse {
        status: match snapshot.status {
            SetupJobStatus::Queued => SetupScriptStatus::Queued,
            SetupJobStatus::Running => SetupScriptStatus::Running,
            SetupJobStatus::Succeeded => SetupScriptStatus::Succeeded,
            SetupJobStatus::Failed => SetupScriptStatus::Failed,
        },
        command: snapshot.command,
        exit_code: snapshot.exit_code,
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
        duration_ms: snapshot.duration_ms,
    }
}

fn detection_result_to_contract(result: ProjectSetupDetectionResult) -> DetectProjectSetupResponse {
    DetectProjectSetupResponse {
        hints: result
            .hints
            .into_iter()
            .map(setup_hint_to_contract)
            .collect(),
    }
}

fn map_register_repo_workspace_error(error: RegisterRepoWorkspaceError) -> ApiError {
    match error {
        RegisterRepoWorkspaceError::NotGitRepo => ApiError::bad_request(
            "Selected folder is not a Git repository.",
            "REPO_WORKSPACE_NOT_GIT_REPO",
        ),
        RegisterRepoWorkspaceError::WorktreeNotAllowed => ApiError::bad_request(
            "Select the main repository root, not a worktree.",
            "REPO_WORKSPACE_WORKTREE_UNSUPPORTED",
        ),
        RegisterRepoWorkspaceError::Unexpected(error) => ApiError::internal(error.to_string()),
    }
}

fn map_set_workspace_display_name_error(error: SetWorkspaceDisplayNameError) -> ApiError {
    match error {
        SetWorkspaceDisplayNameError::NotFound(workspace_id) => ApiError::not_found(
            format!("Workspace not found: {workspace_id}"),
            "WORKSPACE_NOT_FOUND",
        ),
        SetWorkspaceDisplayNameError::TooLong(limit) => ApiError::bad_request(
            format!("workspace display name cannot exceed {limit} characters"),
            "WORKSPACE_DISPLAY_NAME_TOO_LONG",
        ),
        SetWorkspaceDisplayNameError::Unexpected(error) => ApiError::internal(error.to_string()),
    }
}

fn setup_hint_to_contract(hint: DetectedSetupHint) -> SetupHint {
    SetupHint {
        id: hint.id,
        label: hint.label,
        suggested_command: hint.suggested_command,
        detected_file: hint.detected_file,
        category: match hint.category {
            DetectedHintCategory::BuildTool => SetupHintCategory::BuildTool,
            DetectedHintCategory::SecretSync => SetupHintCategory::SecretSync,
        },
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

fn workspace_to_contract_with_summary(
    record: WorkspaceRecord,
    execution_summary: anyharness_contract::v1::WorkspaceExecutionSummary,
) -> Workspace {
    Workspace {
        id: record.id,
        kind: match record.kind.as_str() {
            "worktree" => WorkspaceKind::Worktree,
            "local" => WorkspaceKind::Local,
            _ => WorkspaceKind::Repo,
        },
        path: record.path,
        source_repo_root_path: record.source_repo_root_path,
        source_workspace_id: record.source_workspace_id,
        git_provider: record.git_provider,
        git_owner: record.git_owner,
        git_repo_name: record.git_repo_name,
        original_branch: record.original_branch,
        current_branch: record.current_branch,
        display_name: record.display_name,
        execution_summary: Some(execution_summary),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn workspace_session_launch_catalog_to_contract(
    catalog: WorkspaceSessionLaunchCatalogData,
) -> WorkspaceSessionLaunchCatalog {
    WorkspaceSessionLaunchCatalog {
        workspace_id: catalog.workspace_id,
        agents: catalog
            .agents
            .into_iter()
            .map(workspace_session_launch_agent_to_contract)
            .collect(),
    }
}

fn workspace_session_launch_agent_to_contract(
    agent: WorkspaceSessionLaunchAgentData,
) -> WorkspaceSessionLaunchAgent {
    WorkspaceSessionLaunchAgent {
        kind: agent.kind,
        display_name: agent.display_name,
        default_model_id: agent.default_model_id,
        models: agent
            .models
            .into_iter()
            .map(workspace_session_launch_model_to_contract)
            .collect(),
    }
}

fn workspace_session_launch_model_to_contract(
    model: WorkspaceSessionLaunchModelData,
) -> WorkspaceSessionLaunchModel {
    WorkspaceSessionLaunchModel {
        id: model.id,
        display_name: model.display_name,
        is_default: model.is_default,
    }
}
