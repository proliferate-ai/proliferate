use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::Value;

use super::error::ApiError;
use crate::app::AppState;
use crate::sessions::workspace_naming::mcp::handle_json_rpc;

pub async fn get_workspace_naming_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_workspace_naming_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let capability_header = headers
        .get(
            state
                .workspace_naming_session_hooks
                .capability_header_name(),
        )
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::unauthorized(
                "Missing workspace naming capability token.",
                "WORKSPACE_NAMING_MCP_UNAUTHORIZED",
            )
        })?;
    let is_valid = state
        .workspace_naming_session_hooks
        .validate_capability_token(capability_header, &workspace_id, &session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if !is_valid {
        return Err(ApiError::unauthorized(
            "Invalid workspace naming capability token.",
            "WORKSPACE_NAMING_MCP_UNAUTHORIZED",
        ));
    }

    let response = handle_json_rpc(
        state.workspace_runtime.as_ref(),
        state.workspace_access_gate.as_ref(),
        state.session_service.store(),
        &workspace_id,
        &session_id,
        body,
    )
    .await
    .map_err(|error| {
        ApiError::bad_request(error.to_string(), "WORKSPACE_NAMING_MCP_REQUEST_INVALID")
    })?;

    match response {
        Some(payload) => Ok((StatusCode::OK, Json(payload)).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}
