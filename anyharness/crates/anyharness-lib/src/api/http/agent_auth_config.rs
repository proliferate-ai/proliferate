use anyharness_contract::v1::{
    AgentAuthConfigStatusResponse, ApplyAgentAuthConfigRequest, ApplyAgentAuthConfigResponse,
};
use axum::{extract::State, Json};

use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::auth::{
    AgentAuthConfigApplyOutcome, AgentAuthConfigInput, AgentAuthConfigStatus,
};

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
        .apply_config(agent_auth_config_input(request))
        .map_err(|error| ApiError::bad_request(error.to_string(), "agent_auth_config_invalid"))?;
    Ok(Json(agent_auth_config_apply_response(response)))
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
    Ok(Json(agent_auth_config_status_response(response)))
}

fn agent_auth_config_input(request: ApplyAgentAuthConfigRequest) -> AgentAuthConfigInput {
    AgentAuthConfigInput {
        external_auth_scope: request.external_auth_scope,
        revision: request.revision,
        selections: request.selections,
    }
}

fn agent_auth_config_apply_response(
    outcome: AgentAuthConfigApplyOutcome,
) -> ApplyAgentAuthConfigResponse {
    ApplyAgentAuthConfigResponse {
        applied: outcome.applied,
        revision: outcome.revision,
        selection_count: outcome.selection_count,
        no_selection_kinds: outcome.no_selection_kinds,
        status: outcome.status,
    }
}

fn agent_auth_config_status_response(
    status: AgentAuthConfigStatus,
) -> AgentAuthConfigStatusResponse {
    AgentAuthConfigStatusResponse {
        external_auth_scope: status.external_auth_scope,
        revision: status.revision,
        status: status.status,
        selections: status.selections,
    }
}
