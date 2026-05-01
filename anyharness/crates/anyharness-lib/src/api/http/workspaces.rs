use std::time::Instant;

use anyharness_contract::v1::{
    CreateWorkspaceRequest, CreateWorktreeWorkspaceRequest, CreateWorktreeWorkspaceResponse,
    DetectProjectSetupResponse, GetSetupStatusResponse, RepoRoot, RepoRootKind,
    ResolveWorkspaceFromPathRequest, ResolveWorkspaceResponse, StartWorkspaceSetupRequest,
    UpdateWorkspaceDisplayNameRequest, Workspace, WorkspaceCleanupState, WorkspaceKind,
    WorkspaceLifecycleState, WorkspaceRetireBlocker, WorkspaceRetireBlockerCode,
    WorkspaceRetireBlockerSeverity, WorkspaceRetireOutcome, WorkspaceRetirePreflightResponse,
    WorkspaceRetireResponse, WorkspaceSessionLaunchCatalog,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};

use super::access::{assert_workspace_mutable, assert_workspace_not_retired, map_access_error};
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
use crate::terminals::model::TerminalStatus;
use crate::workspaces::access_gate::WorkspaceAccessError;
use crate::workspaces::creator_context::WorkspaceCreatorContext;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::operation_gate::WorkspaceOperationKind;
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
        let _lease = state
            .workspace_operation_gate
            .acquire_shared(&result.workspace.id, WorkspaceOperationKind::SetupCommand)
            .await;
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
    get,
    path = "/v1/workspaces/{workspace_id}/retire/preflight",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Retire preflight", body = WorkspaceRetirePreflightResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retire_workspace_preflight(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetirePreflightResponse>, ApiError> {
    Ok(Json(build_retire_preflight(&state, &workspace_id).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/retire",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Retire workspace result", body = WorkspaceRetireResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retire_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetireResponse>, ApiError> {
    let current = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if current.lifecycle_state == "retired" {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        let cleanup_succeeded = current.cleanup_state == "complete";
        let cleanup_message = retired_cleanup_message(&current);
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, current).await?,
            outcome: WorkspaceRetireOutcome::AlreadyRetired,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded,
            cleanup_message,
        }));
    }

    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.can_retire {
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }

    let _exclusive = state
        .workspace_operation_gate
        .acquire_exclusive(&workspace_id)
        .await;
    let workspace = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if workspace.lifecycle_state == "retired" {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        let cleanup_succeeded = workspace.cleanup_state == "complete";
        let cleanup_message = retired_cleanup_message(&workspace);
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::AlreadyRetired,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded,
            cleanup_message,
        }));
    }
    if state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(&workspace_id)
        .is_err()
    {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }

    let mut preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.can_retire {
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }
    if let Some(active) = state
        .workspace_runtime
        .find_active_workspace_by_path_excluding_id(&workspace.path, &workspace.id)
        .map_err(|e| ApiError::internal(e.to_string()))?
    {
        preflight.can_retire = false;
        preflight
            .blockers
            .push(active_path_owner_retire_blocker(&active));
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(format!(
                "cleanup blocked because active workspace {} also owns path {}",
                active.id, active.path
            )),
        }));
    }

    let attempted_at = chrono::Utc::now().to_rfc3339();
    let pending = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            "pending",
            None,
            None,
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;

    let cleanup_result = {
        let runtime = state.workspace_runtime.clone();
        let workspace = pending.clone();
        run_blocking("retire worktree cleanup", move || {
            runtime.retire_worktree_materialization(&workspace)
        })
        .await?
    };

    let (outcome, cleanup_succeeded, cleanup_message, cleanup_state, error_at) =
        match cleanup_result {
            Ok(()) => (
                WorkspaceRetireOutcome::Retired,
                true,
                None,
                "complete",
                None,
            ),
            Err(error) => {
                let message = error.to_string();
                (
                    WorkspaceRetireOutcome::CleanupFailed,
                    false,
                    Some(message),
                    "failed",
                    Some(chrono::Utc::now().to_rfc3339()),
                )
            }
        };
    let final_record = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            cleanup_state,
            cleanup_message.as_deref(),
            error_at.as_deref(),
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;

    Ok(Json(WorkspaceRetireResponse {
        workspace: workspace_to_contract(&state, final_record).await?,
        outcome,
        preflight,
        cleanup_attempted: true,
        cleanup_succeeded,
        cleanup_message,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/retire/cleanup-retry",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Cleanup retry result", body = WorkspaceRetireResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retry_retire_cleanup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetireResponse>, ApiError> {
    let workspace = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if workspace.lifecycle_state != "retired"
        || !matches!(workspace.cleanup_state.as_str(), "failed" | "pending")
    {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some("cleanup retry is only available for retired workspaces with pending or failed cleanup".to_string()),
        }));
    }

    let _exclusive = state
        .workspace_operation_gate
        .acquire_exclusive(&workspace_id)
        .await;
    if let Some(active) = state
        .workspace_runtime
        .find_active_workspace_by_path_excluding_id(&workspace.path, &workspace.id)
        .map_err(|e| ApiError::internal(e.to_string()))?
    {
        let mut preflight = build_retire_preflight(&state, &workspace_id).await?;
        preflight
            .blockers
            .push(active_path_owner_retire_blocker(&active));
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(format!(
                "cleanup retry blocked because active workspace {} now owns path {}",
                active.id, active.path
            )),
        }));
    }
    let attempted_at = chrono::Utc::now().to_rfc3339();
    let _ = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            "pending",
            None,
            None,
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let cleanup_result = {
        let runtime = state.workspace_runtime.clone();
        let workspace = workspace.clone();
        run_blocking("retire cleanup retry", move || {
            runtime.retire_worktree_materialization(&workspace)
        })
        .await?
    };
    let (outcome, cleanup_succeeded, cleanup_message, cleanup_state, error_at) =
        match cleanup_result {
            Ok(()) => (
                WorkspaceRetireOutcome::Retired,
                true,
                None,
                "complete",
                None,
            ),
            Err(error) => {
                let message = error.to_string();
                (
                    WorkspaceRetireOutcome::CleanupFailed,
                    false,
                    Some(message),
                    "failed",
                    Some(chrono::Utc::now().to_rfc3339()),
                )
            }
        };
    let final_record = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            "retired",
            cleanup_state,
            cleanup_message.as_deref(),
            error_at.as_deref(),
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    Ok(Json(WorkspaceRetireResponse {
        workspace: workspace_to_contract(&state, final_record).await?,
        outcome,
        preflight,
        cleanup_attempted: true,
        cleanup_succeeded,
        cleanup_message,
    }))
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
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
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
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::SetupCommand)
        .await;
    assert_workspace_mutable(state, &workspace_id)?;
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

async fn build_retire_preflight(
    state: &AppState,
    workspace_id: &str,
) -> Result<WorkspaceRetirePreflightResponse, ApiError> {
    let workspace = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let mut blockers = Vec::new();
    let materialized = std::path::Path::new(&workspace.path).exists();
    let mut head_oid = None;
    let mut base_ref = None;
    let mut base_oid = None;
    let mut head_matches_base = false;
    let mut merged_into_base = false;

    if workspace.kind != "worktree" {
        blockers.push(retire_blocker(
            WorkspaceRetireBlockerCode::UnsupportedWorkspace,
            "Only worktree workspaces can be marked done.",
        ));
    }
    if workspace.lifecycle_state != "retired" {
        if let Err(error) = state
            .workspace_access_gate
            .assert_can_mutate_for_workspace(workspace_id)
        {
            blockers.push(workspace_access_retire_blocker(error));
        }
        if let Some(active) = state
            .workspace_runtime
            .find_active_workspace_by_path_excluding_id(&workspace.path, &workspace.id)
            .map_err(|e| ApiError::internal(e.to_string()))?
        {
            blockers.push(active_path_owner_retire_blocker(&active));
        }
    }

    if workspace.kind == "worktree" && workspace.lifecycle_state != "retired" && materialized {
        let workspace_id_for_task = workspace.id.clone();
        let workspace_path = workspace.path.clone();
        let status = run_blocking("retire git status", move || {
            crate::git::GitService::status(
                &workspace_id_for_task,
                std::path::Path::new(&workspace_path),
            )
        })
        .await?
        .map_err(|e| ApiError::bad_request(e.to_string(), "GIT_STATUS_FAILED"))?;
        head_oid = Some(status.head_oid.clone());
        if !status.clean {
            blockers.push(retire_blocker(
                WorkspaceRetireBlockerCode::DirtyWorkingTree,
                "Working tree has uncommitted changes.",
            ));
        }
        if status.conflicted {
            blockers.push(WorkspaceRetireBlocker {
                code: WorkspaceRetireBlockerCode::ConflictedFiles,
                message: "Working tree has conflicted files.".to_string(),
                severity: WorkspaceRetireBlockerSeverity::Blocking,
                retryable: true,
                session_id: None,
                terminal_id: None,
                command_run_id: None,
                path: None,
                paths: None,
                operation: None,
            });
        }
        if status.operation != crate::git::types::GitOperation::None {
            blockers.push(WorkspaceRetireBlocker {
                code: WorkspaceRetireBlockerCode::ActiveGitOperation,
                message: "A git operation is still in progress.".to_string(),
                severity: WorkspaceRetireBlockerSeverity::Blocking,
                retryable: true,
                session_id: None,
                terminal_id: None,
                command_run_id: None,
                path: None,
                paths: None,
                operation: Some(git_operation_to_contract(status.operation.clone())),
            });
        }
        if let Some(default_branch) = status.suggested_base_branch.as_deref() {
            let remote_ref = format!("origin/{default_branch}");
            let workspace_path = workspace.path.clone();
            let remote_merged = run_blocking("retire merged check", {
                let remote_ref = remote_ref.clone();
                let workspace_path = workspace_path.clone();
                move || {
                    crate::git::GitService::head_is_ancestor_of(
                        std::path::Path::new(&workspace_path),
                        &remote_ref,
                    )
                }
            })
            .await?
            .unwrap_or(false);
            if remote_merged {
                base_ref = Some(remote_ref);
                merged_into_base = true;
            } else {
                let local_ref = default_branch.to_string();
                let workspace_path = workspace.path.clone();
                merged_into_base = run_blocking("retire merged check", {
                    let local_ref = local_ref.clone();
                    move || {
                        crate::git::GitService::head_is_ancestor_of(
                            std::path::Path::new(&workspace_path),
                            &local_ref,
                        )
                    }
                })
                .await?
                .unwrap_or(false);
                base_ref = Some(local_ref);
            }
        }
        if let (Some(base), Some(head)) = (base_ref.as_deref(), head_oid.as_deref()) {
            let workspace_path = workspace.path.clone();
            base_oid = run_blocking("retire base oid", {
                let base = base.to_string();
                move || {
                    crate::git::GitService::resolve_ref_oid(
                        std::path::Path::new(&workspace_path),
                        &base,
                    )
                }
            })
            .await?
            .ok();
            head_matches_base = base_oid.as_deref() == Some(head);
        }
    }

    let execution_summary = state
        .session_runtime
        .workspace_execution_summary(workspace_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    if execution_summary.running_count > 0 || execution_summary.live_session_count > 0 {
        blockers.push(retire_blocker(
            WorkspaceRetireBlockerCode::LiveSession,
            "A live session is still running.",
        ));
    }
    if execution_summary.awaiting_interaction_count > 0 {
        blockers.push(retire_blocker(
            WorkspaceRetireBlockerCode::PendingInteraction,
            "A session is waiting for interaction.",
        ));
    }

    let sessions = state
        .session_service
        .list_sessions(Some(workspace_id), true)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for session in sessions {
        let prompts = state
            .session_service
            .store()
            .list_pending_prompts(&session.id)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        if !prompts.is_empty() {
            blockers.push(WorkspaceRetireBlocker {
                code: WorkspaceRetireBlockerCode::PendingPrompt,
                message: "A session has queued prompts.".to_string(),
                severity: WorkspaceRetireBlockerSeverity::Blocking,
                retryable: true,
                session_id: Some(session.id),
                terminal_id: None,
                command_run_id: None,
                path: None,
                paths: None,
                operation: None,
            });
            break;
        }
    }

    let terminals = state.terminal_service.list_terminals(workspace_id).await;
    if let Some(terminal) = terminals.iter().find(|terminal| {
        matches!(
            terminal.status,
            TerminalStatus::Starting | TerminalStatus::Running
        )
    }) {
        blockers.push(WorkspaceRetireBlocker {
            code: WorkspaceRetireBlockerCode::ActiveTerminal,
            message: "A terminal is still active.".to_string(),
            severity: WorkspaceRetireBlockerSeverity::Blocking,
            retryable: true,
            session_id: None,
            terminal_id: Some(terminal.id.clone()),
            command_run_id: None,
            path: None,
            paths: None,
            operation: None,
        });
    }

    let operation_snapshot = state.workspace_operation_gate.snapshot(workspace_id).await;
    let has_running_command_holder = operation_snapshot.has_any(&[
        WorkspaceOperationKind::MaterializationRead,
        WorkspaceOperationKind::FileWrite,
        WorkspaceOperationKind::GitWrite,
        WorkspaceOperationKind::ProcessRun,
        WorkspaceOperationKind::TerminalCommand,
        WorkspaceOperationKind::SessionStart,
        WorkspaceOperationKind::SessionPrompt,
        WorkspaceOperationKind::SessionResume,
        WorkspaceOperationKind::SetupCommand,
        WorkspaceOperationKind::HostingWrite,
        WorkspaceOperationKind::PlanWrite,
        WorkspaceOperationKind::ReviewWrite,
        WorkspaceOperationKind::CoworkWrite,
        WorkspaceOperationKind::SubagentWrite,
        WorkspaceOperationKind::MobilityWrite,
    ]);
    let active_runs = state
        .terminal_service
        .active_command_runs_for_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    if has_running_command_holder || !active_runs.is_empty() {
        let command_run = active_runs.first();
        blockers.push(WorkspaceRetireBlocker {
            code: WorkspaceRetireBlockerCode::RunningCommand,
            message: "Workspace work is still in progress.".to_string(),
            severity: WorkspaceRetireBlockerSeverity::Blocking,
            retryable: true,
            session_id: None,
            terminal_id: command_run.and_then(|run| run.terminal_id.clone()),
            command_run_id: command_run.map(|run| run.id.clone()),
            path: None,
            paths: None,
            operation: None,
        });
    }

    let can_retire = blockers.is_empty()
        && workspace.kind == "worktree"
        && workspace.lifecycle_state != "retired";
    let readiness_fingerprint = format!(
        "v1:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        workspace.id,
        workspace.lifecycle_state,
        workspace.cleanup_state,
        materialized,
        head_oid.as_deref().unwrap_or(""),
        base_ref.as_deref().unwrap_or(""),
        base_oid.as_deref().unwrap_or(""),
        merged_into_base,
        head_matches_base,
        blockers
            .iter()
            .map(|blocker| format!("{:?}", blocker.code))
            .collect::<Vec<_>>()
            .join(",")
    );

    Ok(WorkspaceRetirePreflightResponse {
        workspace_id: workspace.id,
        workspace_kind: workspace_kind_to_contract(&workspace.kind),
        lifecycle_state: workspace_lifecycle_to_contract(&workspace.lifecycle_state),
        cleanup_state: workspace_cleanup_to_contract(&workspace.cleanup_state),
        can_retire,
        materialized,
        merged_into_base,
        base_ref,
        base_oid,
        head_oid,
        head_matches_base,
        readiness_fingerprint,
        blockers,
    })
}

async fn workspace_contract_by_id(
    state: &AppState,
    workspace_id: &str,
) -> Result<Workspace, ApiError> {
    let record = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    workspace_to_contract(state, record).await
}

fn retire_blocker(code: WorkspaceRetireBlockerCode, message: &str) -> WorkspaceRetireBlocker {
    WorkspaceRetireBlocker {
        code,
        message: message.to_string(),
        severity: WorkspaceRetireBlockerSeverity::Blocking,
        retryable: true,
        session_id: None,
        terminal_id: None,
        command_run_id: None,
        path: None,
        paths: None,
        operation: None,
    }
}

fn active_path_owner_retire_blocker(active: &WorkspaceRecord) -> WorkspaceRetireBlocker {
    WorkspaceRetireBlocker {
        code: WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
        message: format!(
            "Another active workspace ({}) owns checkout path {}.",
            active.id, active.path
        ),
        severity: WorkspaceRetireBlockerSeverity::Blocking,
        retryable: true,
        session_id: None,
        terminal_id: None,
        command_run_id: None,
        path: Some(active.path.clone()),
        paths: None,
        operation: None,
    }
}

fn workspace_access_retire_blocker(error: WorkspaceAccessError) -> WorkspaceRetireBlocker {
    let message = match error {
        WorkspaceAccessError::MutationBlocked { mode, .. } => {
            format!(
                "Workspace cannot be marked done while access mode is {}.",
                mode.as_str()
            )
        }
        WorkspaceAccessError::LiveSessionStartBlocked { mode, .. } => {
            format!(
                "Workspace cannot be marked done while access mode is {}.",
                mode.as_str()
            )
        }
        WorkspaceAccessError::WorkspaceRetired(_) => "Workspace is already retired.".to_string(),
        WorkspaceAccessError::WorkspaceNotFound(_)
        | WorkspaceAccessError::SessionNotFound(_)
        | WorkspaceAccessError::TerminalNotFound(_) => {
            "Workspace access state could not be verified.".to_string()
        }
    };
    WorkspaceRetireBlocker {
        message,
        ..retire_blocker(
            WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
            "Workspace access is blocked.",
        )
    }
}

fn retired_cleanup_message(workspace: &WorkspaceRecord) -> Option<String> {
    match workspace.cleanup_state.as_str() {
        "complete" => None,
        "failed" => workspace
            .cleanup_error_message
            .clone()
            .or_else(|| Some("retired workspace cleanup failed".to_string())),
        "pending" => Some("retired workspace cleanup is still pending".to_string()),
        _ => Some(format!(
            "retired workspace cleanup is not complete: {}",
            workspace.cleanup_state
        )),
    }
}

fn workspace_kind_to_contract(kind: &str) -> WorkspaceKind {
    match kind {
        "worktree" => WorkspaceKind::Worktree,
        _ => WorkspaceKind::Local,
    }
}

fn workspace_lifecycle_to_contract(value: &str) -> WorkspaceLifecycleState {
    match value {
        "retired" => WorkspaceLifecycleState::Retired,
        _ => WorkspaceLifecycleState::Active,
    }
}

fn workspace_cleanup_to_contract(value: &str) -> WorkspaceCleanupState {
    match value {
        "pending" => WorkspaceCleanupState::Pending,
        "complete" => WorkspaceCleanupState::Complete,
        "failed" => WorkspaceCleanupState::Failed,
        _ => WorkspaceCleanupState::None,
    }
}

fn git_operation_to_contract(
    operation: crate::git::types::GitOperation,
) -> anyharness_contract::v1::git::GitOperation {
    match operation {
        crate::git::types::GitOperation::Merge => anyharness_contract::v1::git::GitOperation::Merge,
        crate::git::types::GitOperation::Rebase => {
            anyharness_contract::v1::git::GitOperation::Rebase
        }
        crate::git::types::GitOperation::CherryPick => {
            anyharness_contract::v1::git::GitOperation::CherryPick
        }
        crate::git::types::GitOperation::Revert => {
            anyharness_contract::v1::git::GitOperation::Revert
        }
        crate::git::types::GitOperation::None => anyharness_contract::v1::git::GitOperation::None,
    }
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
