//! Routes for native integrations: list one harness's discovered integrations
//! with the user's selections, and flip one selection. Both answer from the
//! `NativeIntegrationsService`; the wire shapes are the contract's.
//! Spec: `specs/systems/harnesses/native-integrations.md`, "Settings surface".

use anyharness_contract::v1::{
    NativeIntegrationSelectionRequest, NativeIntegrationsResponse, ProblemDetails,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::registry::descriptor;

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}/native-integrations",
    params(("kind" = String, Path, description = "Harness kind identifier")),
    responses(
        (status = 200, description = "Discovered native integrations with selections", body = NativeIntegrationsResponse),
        (status = 404, description = "Unknown harness kind", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn list_native_integrations(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<NativeIntegrationsResponse>, ApiError> {
    let kind = validate_kind(&kind)?;
    let response = state
        .native_integrations_service
        .list(&kind)
        .map_err(|error| ApiError::internal(format!("native-integrations read failed: {error}")))?;
    Ok(Json(response))
}

#[utoipa::path(
    put,
    path = "/v1/agents/{kind}/native-integrations/{id}",
    params(
        ("kind" = String, Path, description = "Harness kind identifier"),
        ("id" = String, Path, description = "Integration id (`bundle:<name>` or `mcp:<server-name>`)"),
    ),
    request_body = NativeIntegrationSelectionRequest,
    responses(
        (status = 200, description = "Selection applied; the refreshed listing", body = NativeIntegrationsResponse),
        (status = 404, description = "Unknown harness kind", body = ProblemDetails),
    ),
    tag = "agents"
)]
pub async fn set_native_integration_selection(
    State(state): State<AppState>,
    Path((kind, id)): Path<(String, String)>,
    Json(request): Json<NativeIntegrationSelectionRequest>,
) -> Result<Json<NativeIntegrationsResponse>, ApiError> {
    let kind = validate_kind(&kind)?;
    validate_integration_id(&id)?;
    let response = state
        .native_integrations_service
        .set_enabled(&kind, &id, request.enabled)
        .map_err(|error| {
            ApiError::internal(format!("native-integrations write failed: {error}"))
        })?;
    Ok(Json(response))
}

fn validate_kind(kind: &str) -> Result<AgentKind, ApiError> {
    let unknown = || {
        ApiError::not_found(
            format!("unknown agent kind '{kind}'"),
            "NATIVE_INTEGRATIONS_UNKNOWN_AGENT",
        )
    };
    descriptor(kind).ok_or_else(unknown)?;
    AgentKind::parse(kind).ok_or_else(unknown)
}

/// Ids are `bundle:<name>` or `mcp:<server-name>`; the prefix is checked here
/// so a stray path segment cannot become a selection row.
fn validate_integration_id(id: &str) -> Result<(), ApiError> {
    let well_formed = id.len() <= 256
        && (id
            .strip_prefix("bundle:")
            .or_else(|| id.strip_prefix("mcp:")))
        .is_some_and(|name| !name.is_empty());
    if well_formed {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "id must be 'bundle:<name>' or 'mcp:<server-name>'",
            "NATIVE_INTEGRATIONS_INVALID_ID",
        ))
    }
}
