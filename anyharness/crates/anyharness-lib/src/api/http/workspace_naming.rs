use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::Value;

use super::error::ApiError;
use super::product_mcp;
use crate::app::AppState;
use crate::sessions::workspace_naming::mcp::definition::ROUTE_SLUG;

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
    product_mcp::dispatch_product_mcp(
        &state,
        &workspace_id,
        &session_id,
        ROUTE_SLUG,
        headers,
        body,
    )
    .await
}
