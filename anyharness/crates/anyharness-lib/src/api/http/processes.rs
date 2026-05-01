use anyharness_contract::v1::processes::{RunCommandRequest, RunCommandResponse};
use axum::extract::{Path, State};
use axum::Json;

use crate::api::http::access::assert_workspace_mutable;
use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::processes::types::{ProcessServiceError, RunProcessRequest, RunProcessResult};
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/processes/run",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = RunCommandRequest,
    responses(
        (status = 200, description = "Command completed", body = RunCommandResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 400, description = "Invalid command request", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Command execution failed", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "processes"
)]
pub async fn run_command(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<RunCommandRequest>,
) -> Result<Json<RunCommandResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::ProcessRun)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let ws = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("workspace not found: {workspace_id}"),
                "WORKSPACE_NOT_FOUND",
            )
        })?;

    let result = state
        .process_service
        .run_command(
            std::path::Path::new(&ws.path),
            run_command_request_to_internal(request),
        )
        .await
        .map_err(map_process_error)?;

    Ok(Json(run_command_response_to_contract(result)))
}

fn run_command_request_to_internal(request: RunCommandRequest) -> RunProcessRequest {
    RunProcessRequest {
        command: request.command,
        cwd: request.cwd,
        timeout_ms: request.timeout_ms,
        max_output_bytes: request.max_output_bytes,
    }
}

fn run_command_response_to_contract(result: RunProcessResult) -> RunCommandResponse {
    RunCommandResponse {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
    }
}

fn map_process_error(error: ProcessServiceError) -> ApiError {
    match error {
        ProcessServiceError::EmptyCommand => {
            ApiError::bad_request("command cannot be empty", "EMPTY_COMMAND")
        }
        ProcessServiceError::CwdEscape => {
            ApiError::bad_request("cwd must be within the workspace boundary", "CWD_ESCAPE")
        }
        ProcessServiceError::CommandFailed(message) => {
            ApiError::internal(format!("command failed: {message}"))
        }
        ProcessServiceError::TimedOut => ApiError::internal("command timed out"),
    }
}
