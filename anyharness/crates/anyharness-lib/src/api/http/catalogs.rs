//! Catalogs transport handler: the worker (which owns cloud credentials and
//! the heartbeat) fetches the agent catalog from the cloud and pushes the
//! raw document here; the body is the catalog JSON as fetched, the optional
//! `ETag` request header forwards the cloud response's ETag. Sync semantics
//! live in `domains/agents/catalog/sync.rs`.

use anyharness_contract::v1::ApplyAgentCatalogResponse;
use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap},
    Json,
};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::catalog::sync::SyncOutcome;

#[utoipa::path(
    put,
    path = "/v1/catalogs/agents",
    request_body(
        content = String,
        description = "Raw agent catalog JSON document (schema v1 or v2)",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "Catalog accepted (applied or already current)", body = ApplyAgentCatalogResponse),
        (status = 400, description = "Catalog payload rejected; active catalog unchanged", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "catalogs"
)]
pub async fn apply_agent_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ApplyAgentCatalogResponse>, ApiError> {
    let outcome = state
        .catalog_sync_service
        .apply_fetched(&body, catalog_etag(&headers))?;
    Ok(Json(apply_agent_catalog_response(outcome)))
}

fn catalog_etag(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn apply_agent_catalog_response(outcome: SyncOutcome) -> ApplyAgentCatalogResponse {
    match outcome {
        SyncOutcome::Applied {
            from_version,
            to_version,
        } => ApplyAgentCatalogResponse {
            applied: true,
            from_version: Some(from_version),
            to_version: Some(to_version),
        },
        SyncOutcome::AlreadyCurrent => ApplyAgentCatalogResponse {
            applied: false,
            from_version: None,
            to_version: None,
        },
    }
}
