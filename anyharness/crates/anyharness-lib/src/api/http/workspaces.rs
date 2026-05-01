use std::time::Instant;

use anyharness_contract::v1::{
    CreateWorkspaceRequest, CreateWorktreeWorkspaceRequest, CreateWorktreeWorkspaceResponse,
    DetectProjectSetupResponse, GetSetupStatusResponse, RepoRoot, RepoRootKind,
    ResolveWorkspaceFromPathRequest, ResolveWorkspaceResponse, StartWorkspaceSetupRequest,
    UpdateWorkspaceDisplayNameRequest, Workspace, WorkspaceCleanupState, WorkspaceKind,
    WorkspaceLifecycleState, WorkspacePurgeOutcome, WorkspacePurgePreflightResponse,
    WorkspacePurgeResponse, WorkspaceRetireBlocker, WorkspaceRetireBlockerCode,
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
    setup_command_run_to_contract, workspace_cleanup_operation_to_contract,
    workspace_session_launch_catalog_to_contract, workspace_to_contract_with_summary,
};
use crate::app::AppState;
use crate::origin::OriginContext;
use crate::repo_roots::model::RepoRootRecord;
use crate::sessions::execution_summary::idle_workspace_execution_summary;
use crate::workspaces::creator_context::WorkspaceCreatorContext;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::operation_gate::WorkspaceOperationKind;
use crate::workspaces::purge::WorkspacePurgeServiceOutcome;
use crate::workspaces::retire_preflight::RetirePreflightMode;
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

    state
        .workspace_retention_service
        .clone()
        .spawn_post_create_pass(result.workspace.id.clone());

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
        if current.cleanup_operation.as_deref() == Some("purge") {
            return Ok(Json(WorkspaceRetireResponse {
                workspace: workspace_to_contract(&state, current).await?,
                outcome: WorkspaceRetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(
                    "workspace is in purge cleanup state; use purge retry instead".to_string(),
                ),
            }));
        }
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
        if workspace.cleanup_operation.as_deref() == Some("purge") {
            return Ok(Json(WorkspaceRetireResponse {
                workspace: workspace_to_contract(&state, workspace).await?,
                outcome: WorkspaceRetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(
                    "workspace is in purge cleanup state; use purge retry instead".to_string(),
                ),
            }));
        }
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
            Some("retire"),
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
            Some("retire"),
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
        || workspace.cleanup_operation.as_deref() == Some("purge")
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
            Some("retire"),
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
            Some("retire"),
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
    get,
    path = "/v1/workspaces/{workspace_id}/purge/preflight",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Purge preflight", body = WorkspacePurgePreflightResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn purge_workspace_preflight(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspacePurgePreflightResponse>, ApiError> {
    Ok(Json(build_purge_preflight(&state, &workspace_id).await?))
}

#[utoipa::path(
    delete,
    path = "/v1/workspaces/{workspace_id}",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Purge workspace result", body = WorkspacePurgeResponse),
    ),
    tag = "workspaces"
)]
pub async fn purge_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspacePurgeResponse>, ApiError> {
    let preflight = match state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
    {
        Some(_) => Some(build_purge_preflight(&state, &workspace_id).await?),
        None => None,
    };
    if let Some(preflight) = preflight.as_ref() {
        if !preflight.can_purge {
            let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
            return Ok(Json(WorkspacePurgeResponse {
                outcome: WorkspacePurgeOutcome::Blocked,
                workspace: Some(workspace),
                preflight: Some(preflight.clone()),
                already_deleted: false,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: None,
            }));
        }
    }
    purge_response_from_service_outcome(
        &state,
        preflight,
        state
            .workspace_purge_service
            .purge(&workspace_id, false)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
    )
    .await
    .map(Json)
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/purge/retry",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Purge retry result", body = WorkspacePurgeResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retry_purge_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspacePurgeResponse>, ApiError> {
    let preflight = Some(build_purge_preflight(&state, &workspace_id).await?);
    if let Some(preflight) = preflight.as_ref() {
        if !preflight.can_purge {
            let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
            return Ok(Json(WorkspacePurgeResponse {
                outcome: WorkspacePurgeOutcome::Blocked,
                workspace: Some(workspace),
                preflight: Some(preflight.clone()),
                already_deleted: false,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: None,
            }));
        }
    }
    purge_response_from_service_outcome(
        &state,
        preflight,
        state
            .workspace_purge_service
            .purge(&workspace_id, true)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
    )
    .await
    .map(Json)
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
    let current = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let mode = if current.lifecycle_state == "retired"
        && matches!(current.cleanup_state.as_str(), "pending" | "failed")
        && current.cleanup_operation.as_deref() != Some("purge")
    {
        RetirePreflightMode::RetiredCleanupRetry
    } else {
        RetirePreflightMode::ActiveRetire
    };
    let result = state
        .retire_preflight_checker
        .check_workspace(current, mode)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(WorkspaceRetirePreflightResponse {
        workspace_id: result.workspace.id,
        workspace_kind: result.workspace_kind,
        lifecycle_state: result.lifecycle_state,
        cleanup_state: result.cleanup_state,
        cleanup_operation: result.cleanup_operation,
        can_retire: result.can_retire && mode == RetirePreflightMode::ActiveRetire,
        materialized: result.materialized,
        merged_into_base: result.merged_into_base,
        base_ref: result.base_ref,
        base_oid: result.base_oid,
        head_oid: result.head_oid,
        head_matches_base: result.head_matches_base,
        readiness_fingerprint: result.readiness_fingerprint,
        blockers: result.blockers,
    })
}

async fn build_purge_preflight(
    state: &AppState,
    workspace_id: &str,
) -> Result<WorkspacePurgePreflightResponse, ApiError> {
    let workspace = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let preflight = state
        .retire_preflight_checker
        .check_workspace(workspace.clone(), RetirePreflightMode::Purge)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(WorkspacePurgePreflightResponse {
        workspace_id: workspace.id,
        workspace_kind: workspace_kind_to_contract(&workspace.kind),
        lifecycle_state: workspace_lifecycle_to_contract(&workspace.lifecycle_state),
        cleanup_state: workspace_cleanup_to_contract(&workspace.cleanup_state),
        cleanup_operation: workspace_cleanup_operation_to_contract(
            workspace.cleanup_operation.as_deref(),
        ),
        can_purge: preflight.can_purge,
        materialized: preflight.materialized,
        blockers: preflight.blockers,
    })
}

async fn purge_response_from_service_outcome(
    state: &AppState,
    preflight: Option<WorkspacePurgePreflightResponse>,
    outcome: WorkspacePurgeServiceOutcome,
) -> Result<WorkspacePurgeResponse, ApiError> {
    match outcome {
        WorkspacePurgeServiceOutcome::Deleted {
            already_deleted,
            cleanup_attempted,
        } => Ok(WorkspacePurgeResponse {
            outcome: WorkspacePurgeOutcome::Deleted,
            workspace: None,
            preflight,
            already_deleted,
            cleanup_attempted,
            cleanup_succeeded: true,
            cleanup_message: None,
        }),
        WorkspacePurgeServiceOutcome::Blocked { workspace, message } => {
            Ok(WorkspacePurgeResponse {
                outcome: WorkspacePurgeOutcome::Blocked,
                workspace: Some(workspace_to_contract(state, workspace).await?),
                preflight,
                already_deleted: false,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(message),
            })
        }
        WorkspacePurgeServiceOutcome::CleanupFailed { workspace, message } => {
            Ok(WorkspacePurgeResponse {
                outcome: WorkspacePurgeOutcome::CleanupFailed,
                workspace: Some(workspace_to_contract(state, workspace).await?),
                preflight,
                already_deleted: false,
                cleanup_attempted: true,
                cleanup_succeeded: false,
                cleanup_message: Some(message),
            })
        }
    }
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;
    use crate::agents::seed::AgentSeedStore;
    use crate::app::test_support;
    use crate::persistence::Db;
    use crate::workspaces::store::WorkspaceStore;

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_allows_retired_complete_workspace() {
        let state = test_state("purge-retired-complete");
        let workspace = workspace_record(
            "workspace-retired-complete",
            "retired",
            "complete",
            Some("retire"),
        );
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(preflight.can_purge);
        assert!(preflight.blockers.is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_allows_retired_purge_retry_workspace() {
        let state = test_state("purge-retired-retry");
        let workspace =
            workspace_record("workspace-purge-retry", "retired", "failed", Some("purge"));
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(preflight.can_purge);
        assert!(preflight.blockers.is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_allows_dirty_active_workspace() {
        let checkout = TempDirGuard::new("purge-dirty-active");
        run_git(checkout.path(), ["init"]);
        std::fs::write(checkout.path().join("dirty.txt"), "delete me").expect("write dirty file");

        let state = test_state("purge-dirty-active");
        let workspace = workspace_record_with_path(
            "workspace-dirty-active",
            "active",
            "none",
            None,
            checkout.path().to_string_lossy().as_ref(),
        );
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(preflight.can_purge);
        assert!(preflight.blockers.iter().all(|blocker| {
            blocker.code != WorkspaceRetireBlockerCode::DirtyWorkingTree
                && blocker.code != WorkspaceRetireBlockerCode::ConflictedFiles
                && blocker.code != WorkspaceRetireBlockerCode::ActiveGitOperation
        }));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_reports_single_unsupported_workspace_blocker() {
        let state = test_state("purge-unsupported");
        let workspace = workspace_record_with_kind_surface(
            "workspace-local",
            "local",
            "standard",
            "active",
            "none",
            None,
            "/tmp/anyharness-local-workspace",
        );
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(!preflight.can_purge);
        assert_eq!(preflight.blockers.len(), 1);
        assert_eq!(
            preflight.blockers[0].message,
            "Purge is only available for standard worktree workspaces."
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_still_blocks_active_workspace_operations() {
        let state = test_state("purge-active-operation");
        let workspace = workspace_record("workspace-active-operation", "active", "none", None);
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");
        let _lease = state
            .workspace_operation_gate
            .acquire_shared(&workspace.id, WorkspaceOperationKind::ProcessRun)
            .await;

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(!preflight.can_purge);
        assert!(preflight
            .blockers
            .iter()
            .any(|blocker| blocker.code == WorkspaceRetireBlockerCode::RunningCommand));
    }

    fn test_state(name: &str) -> AppState {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _bearer_guard = test_support::set_bearer_token_env(None);
        let _data_key_guard = test_support::set_data_key_env(None);
        AppState::new(
            PathBuf::from(format!("/tmp/anyharness-{name}-runtime")),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("open db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state")
    }

    fn workspace_record(
        id: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
    ) -> WorkspaceRecord {
        workspace_record_with_path(
            id,
            lifecycle_state,
            cleanup_state,
            cleanup_operation,
            &format!("/tmp/anyharness-nonexistent-{id}"),
        )
    }

    fn workspace_record_with_path(
        id: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
        path: &str,
    ) -> WorkspaceRecord {
        workspace_record_with_kind_surface(
            id,
            "worktree",
            "standard",
            lifecycle_state,
            cleanup_state,
            cleanup_operation,
            path,
        )
    }

    fn workspace_record_with_kind_surface(
        id: &str,
        kind: &str,
        surface: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
        path: &str,
    ) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: kind.to_string(),
            repo_root_id: None,
            path: path.to_string(),
            surface: surface.to_string(),
            source_repo_root_path: path.to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: lifecycle_state.to_string(),
            cleanup_state: cleanup_state.to_string(),
            cleanup_operation: cleanup_operation.map(str::to_string),
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    fn run_git<const N: usize>(cwd: &std::path::Path, args: [&str; N]) {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-{name}-{}-{}",
                std::process::id(),
                chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            std::fs::create_dir_all(&path).expect("temp dir");
            Self { path }
        }

        fn path(&self) -> &std::path::Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}
