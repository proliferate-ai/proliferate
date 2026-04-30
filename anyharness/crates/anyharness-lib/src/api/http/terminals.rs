use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;

use crate::api::http::access::{assert_terminal_mutable, assert_workspace_mutable};
use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::terminals::model::{
    CreateTerminalOptions, ResizeTerminalOptions, RunTerminalCommandOptions,
    TerminalCommandOutputMode as InternalTerminalCommandOutputMode,
    TerminalCommandRunRecord as InternalTerminalCommandRunRecord,
    TerminalCommandRunStatus as InternalTerminalCommandRunStatus,
    TerminalPurpose as InternalTerminalPurpose, TerminalRecord as InternalTerminalRecord,
    TerminalStatus as InternalTerminalStatus,
};
use crate::workspaces::model::WorkspaceRecord;
use anyharness_contract::v1::terminals::{
    CreateTerminalRequest, ResizeTerminalRequest, StartTerminalCommandRequest,
    StartTerminalCommandResponse, TerminalCommandOutputMode as ContractTerminalCommandOutputMode,
    TerminalCommandRunDetail as ContractTerminalCommandRunDetail,
    TerminalCommandRunStatus as ContractTerminalCommandRunStatus,
    TerminalCommandRunSummary as ContractTerminalCommandRunSummary,
    TerminalPurpose as ContractTerminalPurpose, TerminalRecord as ContractTerminalRecord,
    TerminalStatus as ContractTerminalStatus, UpdateTerminalTitleRequest,
};

const MAX_TERMINAL_TITLE_CHARS: usize = 160;

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
                purpose: request
                    .purpose
                    .map(terminal_purpose_to_internal)
                    .unwrap_or(InternalTerminalPurpose::General),
                env: env_vars,
                startup_command: request.startup_command,
                startup_command_env: request
                    .startup_command_env
                    .unwrap_or_default()
                    .into_iter()
                    .collect(),
                startup_command_timeout_ms: request.startup_command_timeout_ms,
                cols: request.cols,
                rows: request.rows,
            },
        )
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(terminal_record_to_contract(record)))
}

#[utoipa::path(
    post,
    path = "/v1/terminals/{terminal_id}/commands",
    params(("terminal_id" = String, Path, description = "Terminal ID")),
    request_body = StartTerminalCommandRequest,
    responses(
        (status = 200, description = "Terminal command started", body = StartTerminalCommandResponse),
        (status = 400, description = "Invalid command", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Terminal not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn start_terminal_command(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Json(request): Json<StartTerminalCommandRequest>,
) -> Result<Json<StartTerminalCommandResponse>, ApiError> {
    assert_terminal_mutable(&state, &terminal_id).await?;
    let command = request.command.trim().to_string();
    if command.is_empty() {
        return Err(ApiError::bad_request(
            "command must not be empty",
            "INVALID_TERMINAL_COMMAND",
        ));
    }
    let run = state
        .terminal_service
        .run_terminal_command(
            &terminal_id,
            RunTerminalCommandOptions {
                command,
                env: request.env.unwrap_or_default().into_iter().collect(),
                interrupt: request.interrupt.unwrap_or(false),
                timeout_ms: request.timeout_ms,
            },
        )
        .await
        .map_err(map_terminal_command_error)?;
    let terminal = state
        .terminal_service
        .get_terminal(&terminal_id)
        .await
        .ok_or_else(|| ApiError::not_found("terminal not found", "TERMINAL_NOT_FOUND"))?;
    Ok(Json(StartTerminalCommandResponse {
        terminal: terminal_record_to_contract(terminal),
        command_run: terminal_command_run_summary_to_contract(run),
    }))
}

#[utoipa::path(
    get,
    path = "/v1/terminal-command-runs/{command_run_id}",
    params(("command_run_id" = String, Path, description = "Terminal command run ID")),
    responses(
        (status = 200, description = "Terminal command run", body = ContractTerminalCommandRunDetail),
        (status = 404, description = "Command run not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn get_terminal_command_run(
    State(state): State<AppState>,
    Path(command_run_id): Path<String>,
) -> Result<Json<ContractTerminalCommandRunDetail>, ApiError> {
    let run = state
        .terminal_service
        .get_command_run(&command_run_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("command run not found", "COMMAND_RUN_NOT_FOUND"))?;
    Ok(Json(terminal_command_run_detail_to_contract(run)))
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
    patch,
    path = "/v1/terminals/{terminal_id}/title",
    params(("terminal_id" = String, Path, description = "Terminal ID")),
    request_body = UpdateTerminalTitleRequest,
    responses(
        (status = 200, description = "Terminal title updated", body = ContractTerminalRecord),
        (status = 400, description = "Invalid title", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Terminal not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "terminals"
)]
pub async fn update_terminal_title(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Json(request): Json<UpdateTerminalTitleRequest>,
) -> Result<impl IntoResponse, ApiError> {
    assert_terminal_mutable(&state, &terminal_id).await?;
    let title = validate_terminal_title(request.title)?;
    let record = state
        .terminal_service
        .update_terminal_title(&terminal_id, title)
        .await
        .map_err(|e| ApiError::not_found(e.to_string(), "TERMINAL_NOT_FOUND"))?;
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
        purpose: terminal_purpose_to_contract(record.purpose),
        cwd: record.cwd,
        status: terminal_status_to_contract(record.status),
        exit_code: record.exit_code,
        created_at: record.created_at,
        updated_at: record.updated_at,
        command_run: record
            .command_run
            .map(terminal_command_run_summary_to_contract),
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

fn terminal_purpose_to_contract(purpose: InternalTerminalPurpose) -> ContractTerminalPurpose {
    match purpose {
        InternalTerminalPurpose::General => ContractTerminalPurpose::General,
        InternalTerminalPurpose::Run => ContractTerminalPurpose::Run,
        InternalTerminalPurpose::Setup => ContractTerminalPurpose::Setup,
    }
}

fn terminal_purpose_to_internal(purpose: ContractTerminalPurpose) -> InternalTerminalPurpose {
    match purpose {
        ContractTerminalPurpose::General => InternalTerminalPurpose::General,
        ContractTerminalPurpose::Run => InternalTerminalPurpose::Run,
        ContractTerminalPurpose::Setup => InternalTerminalPurpose::Setup,
    }
}

fn terminal_command_run_summary_to_contract(
    record: InternalTerminalCommandRunRecord,
) -> ContractTerminalCommandRunSummary {
    ContractTerminalCommandRunSummary {
        id: record.id,
        terminal_id: record.terminal_id,
        workspace_id: record.workspace_id,
        purpose: terminal_purpose_to_contract(record.purpose),
        command: record.command,
        status: terminal_command_status_to_contract(record.status),
        exit_code: record.exit_code,
        started_at: record.started_at,
        completed_at: record.completed_at,
        duration_ms: record.duration_ms,
        output_truncated: record.output_truncated,
    }
}

fn terminal_command_run_detail_to_contract(
    record: InternalTerminalCommandRunRecord,
) -> ContractTerminalCommandRunDetail {
    ContractTerminalCommandRunDetail {
        summary: terminal_command_run_summary_to_contract(record.clone()),
        output_mode: terminal_command_output_mode_to_contract(record.output_mode),
        stdout: record.stdout,
        stderr: record.stderr,
        combined_output: record.combined_output,
    }
}

fn terminal_command_status_to_contract(
    status: InternalTerminalCommandRunStatus,
) -> ContractTerminalCommandRunStatus {
    match status {
        InternalTerminalCommandRunStatus::Queued => ContractTerminalCommandRunStatus::Queued,
        InternalTerminalCommandRunStatus::Running => ContractTerminalCommandRunStatus::Running,
        InternalTerminalCommandRunStatus::Succeeded => ContractTerminalCommandRunStatus::Succeeded,
        InternalTerminalCommandRunStatus::Failed => ContractTerminalCommandRunStatus::Failed,
        InternalTerminalCommandRunStatus::Interrupted => {
            ContractTerminalCommandRunStatus::Interrupted
        }
        InternalTerminalCommandRunStatus::TimedOut => ContractTerminalCommandRunStatus::TimedOut,
    }
}

fn terminal_command_output_mode_to_contract(
    mode: InternalTerminalCommandOutputMode,
) -> ContractTerminalCommandOutputMode {
    match mode {
        InternalTerminalCommandOutputMode::Separate => ContractTerminalCommandOutputMode::Separate,
        InternalTerminalCommandOutputMode::Combined => ContractTerminalCommandOutputMode::Combined,
    }
}

fn map_terminal_command_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    if message.contains("terminal not found") {
        ApiError::not_found(message, "TERMINAL_NOT_FOUND")
    } else if message.contains("unsupported_terminal_shell") {
        ApiError::bad_request("unsupported terminal shell", "UNSUPPORTED_TERMINAL_SHELL")
    } else if message.contains("terminal command already running") {
        ApiError::conflict(message, "TERMINAL_COMMAND_ALREADY_RUNNING")
    } else {
        ApiError::bad_request(message, "TERMINAL_COMMAND_FAILED")
    }
}

fn validate_terminal_title(title: String) -> Result<String, ApiError> {
    let trimmed = title.trim().to_string();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request(
            "terminal title cannot be empty",
            "INVALID_TERMINAL_TITLE",
        ));
    }
    if trimmed.chars().count() > MAX_TERMINAL_TITLE_CHARS {
        return Err(ApiError::bad_request(
            format!("terminal title cannot exceed {MAX_TERMINAL_TITLE_CHARS} characters"),
            "INVALID_TERMINAL_TITLE",
        ));
    }
    Ok(trimmed)
}
