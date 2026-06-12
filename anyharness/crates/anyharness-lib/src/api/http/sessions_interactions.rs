use anyharness_contract::v1::{InteractionDecision, ResolveInteractionRequest};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, HeaderValue},
    Extension, Json,
};

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use super::sessions_errors::map_resolve_interaction_error;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::sessions::runtime::{
    InteractionPermissionDecision, ResolutionRequest,
};

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/interactions/{request_id}/resolve",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("request_id" = String, Path, description = "Interaction request ID"),
    ),
    request_body = anyharness_contract::v1::ResolveInteractionRequest,
    responses(
        (status = 200, description = "Interaction resolved"),
        (status = 400, description = "Invalid interaction resolution", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn resolve_interaction(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, request_id)): Path<(String, String)>,
    Json(req): Json<ResolveInteractionRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let resolution = resolve_interaction_input(req);

    state
        .session_runtime
        .resolve_interaction_request(&session_id, &request_id, resolution)
        .await
        .map_err(map_resolve_interaction_error)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[utoipa::path(
    post,
    path = "/v1/sessions/{session_id}/interactions/{request_id}/mcp-url/reveal",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("request_id" = String, Path, description = "Interaction request ID"),
    ),
    responses(
        (status = 200, description = "MCP elicitation URL revealed", body = anyharness_contract::v1::McpElicitationUrlRevealResponse),
        (status = 400, description = "Invalid interaction kind", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn reveal_mcp_elicitation_url(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((session_id, request_id)): Path<(String, String)>,
) -> Result<
    (
        HeaderMap,
        Json<anyharness_contract::v1::McpElicitationUrlRevealResponse>,
    ),
    ApiError,
> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let reveal = state
        .session_runtime
        .reveal_mcp_elicitation_url(&session_id, &request_id)
        .await
        .map_err(map_resolve_interaction_error)?;

    let mut headers = HeaderMap::new();
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    Ok((
        headers,
        Json(anyharness_contract::v1::McpElicitationUrlRevealResponse { url: reveal.url }),
    ))
}

fn resolve_interaction_input(request: ResolveInteractionRequest) -> ResolutionRequest {
    match request {
        ResolveInteractionRequest::Selected { option_id } => {
            ResolutionRequest::OptionId(option_id)
        }
        ResolveInteractionRequest::Decision {
            decision: InteractionDecision::Allow,
        } => ResolutionRequest::Decision(InteractionPermissionDecision::Allow),
        ResolveInteractionRequest::Decision {
            decision: InteractionDecision::Deny,
        } => ResolutionRequest::Decision(InteractionPermissionDecision::Deny),
        ResolveInteractionRequest::Submitted { answers } => {
            ResolutionRequest::Submitted { answers }
        }
        ResolveInteractionRequest::Accepted { fields } => {
            ResolutionRequest::Accepted { fields }
        }
        ResolveInteractionRequest::Declined => ResolutionRequest::Declined,
        ResolveInteractionRequest::Cancelled => ResolutionRequest::Cancelled,
        ResolveInteractionRequest::Dismissed => ResolutionRequest::Dismissed,
    }
}
