use anyharness_contract::v1::{
    AgentAuthConfigStatusResponse, ApplyAgentAuthConfigRequest, ApplyAgentAuthConfigResponse,
};
use axum::{extract::State, Json};

use crate::api::http::error::ApiError;
use crate::app::AppState;

#[utoipa::path(
    put,
    path = "/v1/agents/auth-config",
    tag = "agents",
    request_body = ApplyAgentAuthConfigRequest,
    responses(
        (status = 200, description = "Agent auth config applied", body = ApplyAgentAuthConfigResponse)
    )
)]
pub async fn apply_agent_auth_config(
    State(state): State<AppState>,
    Json(request): Json<ApplyAgentAuthConfigRequest>,
) -> Result<Json<ApplyAgentAuthConfigResponse>, ApiError> {
    let response = state
        .agent_auth_config_service
        .apply_config(request)
        .map_err(|error| ApiError::bad_request(error.to_string(), "agent_auth_config_invalid"))?;
    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/v1/agents/auth-config/status",
    tag = "agents",
    responses(
        (status = 200, description = "Redacted agent auth config status", body = AgentAuthConfigStatusResponse)
    )
)]
pub async fn get_agent_auth_config_status(
    State(state): State<AppState>,
) -> Result<Json<AgentAuthConfigStatusResponse>, ApiError> {
    let response = state
        .agent_auth_config_service
        .status()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(response))
}
