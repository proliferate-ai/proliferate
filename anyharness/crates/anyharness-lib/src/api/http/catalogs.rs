//! Catalogs read handler. The runtime binary is the only catalog transport
//! (agent-distribution.md, "Convergence"), so there is nothing to push here —
//! the one route is read-only observability: which catalog version is this
//! runtime process serving. Provenance lives in
//! `domains/agents/catalog/sync.rs`.

use anyharness_contract::v1::AgentCatalogVersionResponse;
use axum::{extract::State, Json};

use crate::app::AppState;
use crate::domains::agents::catalog::sync::CatalogSource;

#[utoipa::path(
    get,
    path = "/v1/catalogs/agents/version",
    responses(
        (status = 200, description = "Active agent catalog version and source", body = AgentCatalogVersionResponse),
    ),
    tag = "catalogs"
)]
pub async fn get_agent_catalog_version(
    State(state): State<AppState>,
) -> Json<AgentCatalogVersionResponse> {
    let active = state.catalog_sync_service.active();
    Json(AgentCatalogVersionResponse {
        catalog_version: active.version,
        source: catalog_source_label(active.source).to_owned(),
    })
}

fn catalog_source_label(source: CatalogSource) -> &'static str {
    match source {
        CatalogSource::Bundled => "bundled",
    }
}
