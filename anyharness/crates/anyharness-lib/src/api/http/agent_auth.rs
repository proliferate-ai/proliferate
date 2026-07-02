//! Agent-auth state transport handler: the desktop (which owns the cloud
//! session) fetches the local-surface state document from the control plane
//! (`GET /agent-gateway/state?surface=local`) and pushes it here verbatim;
//! the body is the state.json contract (`route_auth/state.rs`). The runtime
//! persists it atomically (0600) at `<runtime_home>/agent-auth/state.json`,
//! where every session launch reads it fresh.

use anyharness_contract::v1::ApplyAgentAuthStateResponse;
use axum::{body::Bytes, extract::State, Json};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::route_auth::{apply_state_file, AgentAuthState, RouteAuthError};

#[utoipa::path(
    put,
    path = "/v1/agent-auth/state",
    request_body(
        content = String,
        description = "Agent-auth state document (the state.json contract)",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "State persisted", body = ApplyAgentAuthStateResponse),
        (status = 400, description = "Payload rejected; persisted state unchanged", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Stale revision; persisted state unchanged", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "agent-auth"
)]
pub async fn put_agent_auth_state(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<ApplyAgentAuthStateResponse>, ApiError> {
    let document: AgentAuthState = serde_json::from_slice(&body).map_err(|error| {
        ApiError::bad_request(
            format!("agent-auth state payload rejected: {error}"),
            "AGENT_AUTH_STATE_REJECTED",
        )
    })?;
    if document.revision < 0 {
        return Err(ApiError::bad_request(
            "agent-auth state revision must be >= 0",
            "AGENT_AUTH_STATE_REJECTED",
        ));
    }
    apply_state_file(&state.runtime_home, &document).map_err(map_route_auth_error)?;
    Ok(Json(ApplyAgentAuthStateResponse {
        applied: true,
        revision: document.revision,
    }))
}

fn map_route_auth_error(error: RouteAuthError) -> ApiError {
    match error {
        RouteAuthError::StaleStateRevision { .. } => {
            ApiError::conflict(error.to_string(), error.code())
        }
        _ => ApiError::internal(error.to_string()),
    }
}
