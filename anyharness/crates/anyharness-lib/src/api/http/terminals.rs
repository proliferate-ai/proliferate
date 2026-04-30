use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;

use crate::api::http::access::{assert_terminal_mutable, assert_workspace_mutable};
use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::terminals::model::{
    CreateTerminalOptions, ResizeTerminalOptions, TerminalRecord as InternalTerminalRecord,
    TerminalStatus as InternalTerminalStatus,
};
use crate::workspaces::model::WorkspaceRecord;
use anyharness_contract::v1::terminals::{
    CreateTerminalRequest, ResizeTerminalRequest, TerminalRecord as ContractTerminalRecord,
    TerminalStatus as ContractTerminalStatus,
};

fn resolve_workspace(state: &AppState, workspace_id: &str) -> Result<WorkspaceRecord, ApiError> {
    let ws = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("workspace not found: {workspace_id}"),
                "WORKSPACE_NOT_FOUND",
            )
        })?;
    Ok(ws)
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/terminals",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace terminals", body = Vec<ContractTerminalRecord>),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn list_terminals(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let ws = resolve_workspace(&state, &workspace_id)?;
    let terminals = state.terminal_service.list_terminals(&ws.id).await;
    Ok(Json(
        terminals
            .into_iter()
            .map(terminal_record_to_contract)
            .collect::<Vec<_>>(),
    ))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/terminals",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = CreateTerminalRequest,
    responses(
        (status = 200, description = "Terminal created", body = ContractTerminalRecord),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Terminal creation failed", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn create_terminal(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<CreateTerminalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    assert_workspace_mutable(&state, &workspace_id)?;
    let ws = resolve_workspace(&state, &workspace_id)?;
    let env_vars = match tokio::task::spawn_blocking({
        let workspace_runtime = state.workspace_runtime.clone();
        let ws_for_env = ws.clone();
        move || workspace_runtime.build_workspace_env(&ws_for_env, None)
    })
    .await
    {
        Ok(Ok(env_vars)) => env_vars,
        Ok(Err(error)) => {
            tracing::warn!(
                workspace_id = %ws.id,
                error = %error,
                "failed to build terminal workspace env; creating terminal without workspace env"
            );
            Vec::new()
        }
        Err(error) => {
            tracing::warn!(
                workspace_id = %ws.id,
                error = %error,
                "terminal workspace env task failed; creating terminal without workspace env"
            );
            Vec::new()
        }
    };
    let record = state
        .terminal_service
        .create_terminal(
            &ws.id,
            &ws.path,
            CreateTerminalOptions {
                cwd: request.cwd,
                shell: request.shell,
                title: request.title,
                env: env_vars,
                cols: request.cols,
                rows: request.rows,
            },
        )
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(terminal_record_to_contract(record)))
}

#[utoipa::path(
    get,
    path = "/v1/terminals/{terminal_id}",
    params(("terminal_id" = String, Path, description = "Terminal ID")),
    responses(
        (status = 200, description = "Terminal", body = ContractTerminalRecord),
        (status = 404, description = "Terminal not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn get_terminal(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let record = state
        .terminal_service
        .get_terminal(&terminal_id)
        .await
        .ok_or_else(|| ApiError::not_found("terminal not found", "TERMINAL_NOT_FOUND"))?;
    Ok(Json(terminal_record_to_contract(record)))
}

#[utoipa::path(
    post,
    path = "/v1/terminals/{terminal_id}/resize",
    params(("terminal_id" = String, Path, description = "Terminal ID")),
    request_body = ResizeTerminalRequest,
    responses(
        (status = 200, description = "Terminal resized", body = ContractTerminalRecord),
        (status = 404, description = "Terminal not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn resize_terminal(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Json(request): Json<ResizeTerminalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    assert_terminal_mutable(&state, &terminal_id).await?;
    let record = state
        .terminal_service
        .resize_terminal(
            &terminal_id,
            ResizeTerminalOptions {
                cols: request.cols,
                rows: request.rows,
            },
        )
        .await
        .map_err(|e| ApiError::not_found(e.to_string(), "TERMINAL_NOT_FOUND"))?;
    Ok(Json(terminal_record_to_contract(record)))
}

#[utoipa::path(
    delete,
    path = "/v1/terminals/{terminal_id}",
    params(("terminal_id" = String, Path, description = "Terminal ID")),
    responses(
        (status = 204, description = "Terminal closed"),
        (status = 404, description = "Terminal not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn delete_terminal(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    assert_terminal_mutable(&state, &terminal_id).await?;
    state
        .terminal_service
        .close_terminal(&terminal_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

fn terminal_record_to_contract(record: InternalTerminalRecord) -> ContractTerminalRecord {
    ContractTerminalRecord {
        id: record.id,
        workspace_id: record.workspace_id,
        title: record.title,
        cwd: record.cwd,
        status: terminal_status_to_contract(record.status),
        exit_code: record.exit_code,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn terminal_status_to_contract(status: InternalTerminalStatus) -> ContractTerminalStatus {
    match status {
        InternalTerminalStatus::Starting => ContractTerminalStatus::Starting,
        InternalTerminalStatus::Running => ContractTerminalStatus::Running,
        InternalTerminalStatus::Exited => ContractTerminalStatus::Exited,
        InternalTerminalStatus::Failed => ContractTerminalStatus::Failed,
    }
}
