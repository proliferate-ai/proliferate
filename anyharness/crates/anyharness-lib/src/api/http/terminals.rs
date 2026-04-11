use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;

use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::terminals::model::{
    CreateTerminalOptions, ResizeTerminalOptions, TerminalRecord as InternalTerminalRecord,
    TerminalStatus as InternalTerminalStatus,
};
use anyharness_contract::v1::terminals::{
    CreateTerminalRequest, ResizeTerminalRequest, TerminalRecord as ContractTerminalRecord,
    TerminalStatus as ContractTerminalStatus,
};

fn resolve_workspace(state: &AppState, workspace_id: &str) -> Result<(String, String), ApiError> {
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
    Ok((ws.id.clone(), ws.path.clone()))
}

pub async fn list_terminals(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let (ws_id, _) = resolve_workspace(&state, &workspace_id)?;
    let terminals = state.terminal_service.list_terminals(&ws_id).await;
    Ok(Json(
        terminals
            .into_iter()
            .map(terminal_record_to_contract)
            .collect::<Vec<_>>(),
    ))
}

pub async fn create_terminal(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<CreateTerminalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (ws_id, ws_path) = resolve_workspace(&state, &workspace_id)?;
    let record = state
        .terminal_service
        .create_terminal(
            &ws_id,
            &ws_path,
            CreateTerminalOptions {
                cwd: request.cwd,
                shell: request.shell,
                cols: request.cols,
                rows: request.rows,
            },
        )
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(terminal_record_to_contract(record)))
}

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

pub async fn resize_terminal(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Json(request): Json<ResizeTerminalRequest>,
) -> Result<impl IntoResponse, ApiError> {
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

pub async fn delete_terminal(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
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
