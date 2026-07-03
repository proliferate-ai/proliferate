//! Runtime gateway-catalog transport handlers (spec §2/§5).
//!
//! - `GET  /v1/agents/{kind}/catalog/gateway-models` returns the RUNTIME's
//!   resolved gateway model plan for the local surface (probe-or-seed), so the
//!   desktop All-Models tab can read what this runtime can actually reach for
//!   the gateway route instead of the cloud catalog.
//! - `POST /v1/agents/{kind}/catalog/refresh-gateway` re-probes the gateway
//!   now (the desktop Refresh button) and records the result.
//!
//! Both derive the credential revision from the local `state.json` and probe
//! the gateway directly (no harness process spawned).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::catalog::gateway_resolver::GatewayModelSource;
use crate::domains::agents::route_auth::load_state_file;
use crate::domains::agents::route_auth::state::SOURCE_KIND_GATEWAY;

/// Resolved gateway model plan for the local surface.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GatewayModelsResponse {
    /// The resolved, provider-filtered model ids (probe rows or catalog seed).
    pub models: Vec<String>,
    /// `"seed"` (no probe yet) or `"probe"` (a live probe supplied the list).
    pub source: String,
    /// When a probe supplied the list (RFC3339); absent for seed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probed_at: Option<String>,
}

/// Result of a manual gateway refresh.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefreshGatewayResponse {
    /// The freshly probed model ids (unfiltered — exactly what the gateway
    /// returned; the resolver applies provider filtering when building plans).
    pub models: Vec<String>,
    /// The probe timestamp (RFC3339).
    pub probed_at: String,
}

fn current_revision(state: &AppState) -> i64 {
    load_state_file(&state.runtime_home)
        .ok()
        .flatten()
        .map(|document| document.revision)
        .unwrap_or(0)
}

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}/catalog/gateway-models",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 200, description = "Resolved gateway model plan (probe or seed)", body = GatewayModelsResponse),
    ),
    tag = "catalogs"
)]
pub async fn get_gateway_models(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<GatewayModelsResponse>, ApiError> {
    let revision = current_revision(&state);
    let (plan, source) = state
        .gateway_model_resolver
        .resolve_with_source(&kind, revision);
    let (source, probed_at) = match source {
        GatewayModelSource::Seed => ("seed".to_string(), None),
        GatewayModelSource::Probe { probed_at } => ("probe".to_string(), Some(probed_at)),
    };
    Ok(Json(GatewayModelsResponse {
        models: plan.models,
        source,
        probed_at,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/catalog/refresh-gateway",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 200, description = "Gateway re-probed and recorded", body = RefreshGatewayResponse),
        (status = 400, description = "No gateway selection for this harness", body = anyharness_contract::v1::ProblemDetails),
        (status = 502, description = "Gateway probe failed", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "catalogs"
)]
pub async fn refresh_gateway_models(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<RefreshGatewayResponse>, ApiError> {
    let Some(document) = load_state_file(&state.runtime_home)
        .map_err(|error| ApiError::internal(error.to_string()))?
    else {
        return Err(ApiError::bad_request(
            "no agent-auth state on this runtime; nothing to probe",
            "GATEWAY_REFRESH_NO_STATE",
        ));
    };
    let revision = document.revision;
    let sources = document.sources_for(&kind);
    let source = sources
        .iter()
        .find(|source| source.kind == SOURCE_KIND_GATEWAY)
        .ok_or_else(|| {
            ApiError::bad_request(
                format!("no gateway route source for harness '{kind}'"),
                "GATEWAY_REFRESH_NO_SELECTION",
            )
        })?;
    let base_url = source
        .base_url
        .clone()
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| {
            ApiError::bad_request(
                format!("gateway source for '{kind}' is missing baseUrl"),
                "GATEWAY_REFRESH_INCOMPLETE",
            )
        })?;
    let key = source
        .key
        .clone()
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| {
            ApiError::bad_request(
                format!("gateway source for '{kind}' is missing a key"),
                "GATEWAY_REFRESH_INCOMPLETE",
            )
        })?;

    let models = state
        .gateway_model_resolver
        .refresh_now(&kind, revision, &base_url, &key)
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                "gateway model probe failed",
                Some(error.to_string()),
                Some("GATEWAY_REFRESH_PROBE_FAILED"),
            )
        })?;

    Ok(Json(RefreshGatewayResponse {
        models,
        probed_at: chrono::Utc::now().to_rfc3339(),
    }))
}
