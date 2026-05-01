use anyharness_contract::v1::{
    AdvanceReplaySessionResponse, CreateReplaySessionRequest, CreateReplaySessionResponse,
    ExportReplayRecordingRequest, ExportReplayRecordingResponse, ListReplayRecordingsResponse,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::error::ApiError;
use crate::app::AppState;
use crate::sessions::replay::ReplayError;
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[utoipa::path(
    get,
    path = "/v1/replay/recordings",
    responses(
        (status = 200, description = "Available replay recordings", body = ListReplayRecordingsResponse),
        (status = 400, description = "Replay is disabled or misconfigured", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "replay"
)]
pub async fn list_replay_recordings(
    State(state): State<AppState>,
) -> Result<Json<ListReplayRecordingsResponse>, ApiError> {
    let recordings = state
        .session_runtime
        .list_replay_recordings()
        .map_err(map_replay_error)?;
    Ok(Json(ListReplayRecordingsResponse { recordings }))
}

#[utoipa::path(
    post,
    path = "/v1/replay/recordings",
    request_body = ExportReplayRecordingRequest,
    responses(
        (status = 200, description = "Exported replay recording", body = ExportReplayRecordingResponse),
        (status = 400, description = "Invalid recording export request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Recording already exists", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "replay"
)]
pub async fn export_replay_recording(
    State(state): State<AppState>,
    Json(req): Json<ExportReplayRecordingRequest>,
) -> Result<Json<ExportReplayRecordingResponse>, ApiError> {
    let recording = state
        .session_runtime
        .export_replay_recording(&req.session_id, req.name)
        .map_err(map_replay_error)?;
    Ok(Json(ExportReplayRecordingResponse { recording }))
}

#[utoipa::path(
    post,
    path = "/v1/replay/sessions",
    request_body = CreateReplaySessionRequest,
    responses(
        (status = 200, description = "Created replay session", body = CreateReplaySessionResponse),
        (status = 400, description = "Invalid replay session request", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Workspace or recording not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "replay"
)]
pub async fn create_replay_session(
    State(state): State<AppState>,
    Json(req): Json<CreateReplaySessionRequest>,
) -> Result<Json<CreateReplaySessionResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&req.workspace_id, WorkspaceOperationKind::SessionStart)
        .await;
    let record = state
        .session_runtime
        .create_and_start_replay_session(&req.workspace_id, &req.recording_id, req.speed)
        .await
        .map_err(map_replay_error)?;
    let session = state
        .session_runtime
        .session_to_contract(&record)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(CreateReplaySessionResponse { session }))
}

#[utoipa::path(
    post,
    path = "/v1/replay/sessions/{session_id}/advance",
    params(("session_id" = String, Path, description = "Replay session ID")),
    responses(
        (status = 200, description = "Advanced replay session", body = AdvanceReplaySessionResponse),
        (status = 400, description = "Replay is disabled or not paused", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Replay session is not live", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "replay"
)]
pub async fn advance_replay_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<AdvanceReplaySessionResponse>, ApiError> {
    state
        .session_runtime
        .advance_replay_session(&session_id)
        .await
        .map_err(map_replay_error)?;
    Ok(Json(AdvanceReplaySessionResponse { advanced: true }))
}

fn map_replay_error(error: ReplayError) -> ApiError {
    match error {
        ReplayError::Disabled => {
            ApiError::bad_request("session replay is disabled", "REPLAY_DISABLED")
        }
        ReplayError::RecordingNotFound(id) => ApiError::not_found(
            format!("recording not found: {id}"),
            "REPLAY_RECORDING_NOT_FOUND",
        ),
        ReplayError::InvalidRecordingId(detail) => ApiError::bad_request(
            format!("invalid recording id: {detail}"),
            "INVALID_REPLAY_RECORDING_ID",
        ),
        ReplayError::InvalidRecordingName(detail) => ApiError::bad_request(
            format!("invalid recording name: {detail}"),
            "INVALID_REPLAY_RECORDING_NAME",
        ),
        ReplayError::RecordingExists(id) => ApiError::conflict(
            format!("recording already exists: {id}"),
            "REPLAY_RECORDING_EXISTS",
        ),
        ReplayError::EmptyRecording => {
            ApiError::bad_request("recording is empty", "EMPTY_REPLAY_RECORDING")
        }
        ReplayError::RecordingTooLarge => {
            ApiError::bad_request("recording is too large", "REPLAY_RECORDING_TOO_LARGE")
        }
        ReplayError::InvalidJson(detail) => ApiError::bad_request(
            format!("recording JSON is invalid: {detail}"),
            "INVALID_REPLAY_JSON",
        ),
        ReplayError::InvalidTimestamp { seq, timestamp } => ApiError::bad_request(
            format!("recording timestamp is invalid at seq {seq}: {timestamp}"),
            "INVALID_REPLAY_TIMESTAMP",
        ),
        ReplayError::SessionNotFound(id) => {
            ApiError::not_found(format!("session not found: {id}"), "SESSION_NOT_FOUND")
        }
        ReplayError::SessionHasNoEvents(id) => ApiError::bad_request(
            format!("session has no events: {id}"),
            "SESSION_HAS_NO_EVENTS",
        ),
        ReplayError::WorkspaceNotFound(id) => {
            ApiError::not_found(format!("workspace not found: {id}"), "WORKSPACE_NOT_FOUND")
        }
        ReplayError::SessionNotLive(id) => ApiError::not_found(
            format!("replay session is not live: {id}"),
            "REPLAY_SESSION_NOT_LIVE",
        ),
        ReplayError::InvalidSpeed => {
            ApiError::bad_request("invalid replay speed", "INVALID_REPLAY_SPEED")
        }
        ReplayError::Internal(error) => ApiError::internal(error.to_string()),
    }
}
