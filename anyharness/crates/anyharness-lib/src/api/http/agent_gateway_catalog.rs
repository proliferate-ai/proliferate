//! Runtime gateway-catalog transport handlers (spec §2/§5), backed by the
//! machine model-snapshot (A9 §3 route backend swap).
//!
//! - `GET  /v1/agents/{kind}/catalog/gateway-models` returns the RUNTIME's
//!   resolved gateway model list for the local surface, so the desktop
//!   All-Models tab can read what this runtime can actually reach for the
//!   gateway route instead of the cloud catalog. It is a thin read over the
//!   harness's composed `model_snapshot` document (`document::read_document`)
//!   plus the projection enrichment join — no probing happens here.
//! - `POST /v1/agents/{kind}/catalog/refresh-gateway` re-probes the harness
//!   now (the desktop Refresh button). It is a poke of the same forced
//!   re-probe `POST /v1/agents/{kind}/model-snapshot/refresh` runs, kept as
//!   its own URL because the desktop All-Models tab and C3's refresh path
//!   still consume the legacy route shape (ruling: keep the URLs, replace the
//!   backend).
//!
//! Both URLs are legacy-shaped on purpose (ruling §3): the resolver chain
//! that used to back them (`gateway_resolver.rs`/`gateway_probe.rs`'s sqlite
//! store) is deleted, but deleting the ROUTE would break the desktop UI that
//! still calls it. `GET /v1/agents/{kind}/model-snapshot` is the general
//! per-harness status surface; this module is the catalog-enriched projection
//! of that same composed document, shaped for the All-Models table this route
//! has always fed.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

use anyharness_contract::v1::{ModelCatalogStatus, ModelEffort};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::catalog::projection::{self, EnrichedModel};
use crate::domains::agents::model::ModelCatalogStatus as DomainModelCatalogStatus;

/// One enriched gateway model row (spec §1). Catalog-known ids carry the joined
/// display metadata; probe-only ids (the proxy serves it but the bundled
/// catalog doesn't know it) emit just `{ id, provider? }`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GatewayModelEntry {
    /// The gateway model id (always present — the render plane keys on this).
    pub id: String,
    /// Catalog display name; absent for probe-only ids.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Catalog description; absent when the catalog omits one or for probe-only ids.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Provider id from the id-prefix matcher (`claude-*`→anthropic, …); absent
    /// when no family matches.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Catalog lifecycle status; absent for probe-only ids.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ModelCatalogStatus>,
    /// The thinking/effort control (`values` + observed `default`); absent when
    /// the model has no effort control or is probe-only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<ModelEffort>,
    /// Whether the model carries a `fast_mode` control; absent for probe-only ids.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fast_mode: Option<bool>,
    /// The permission/agent modes the model supports (`controls.mode.values`);
    /// absent when the model has no mode control or is probe-only (contract §5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<Vec<String>>,
}

/// Map the runtime-owned lifecycle status to the wire enum (identical variants).
fn map_model_status(status: DomainModelCatalogStatus) -> ModelCatalogStatus {
    match status {
        DomainModelCatalogStatus::Candidate => ModelCatalogStatus::Candidate,
        DomainModelCatalogStatus::Active => ModelCatalogStatus::Active,
        DomainModelCatalogStatus::Deprecated => ModelCatalogStatus::Deprecated,
        DomainModelCatalogStatus::Hidden => ModelCatalogStatus::Hidden,
    }
}

/// Wire-shape a [`projection::EnrichedModel`] into this route's response row.
fn to_wire(model: EnrichedModel) -> GatewayModelEntry {
    GatewayModelEntry {
        id: model.id,
        display_name: model.display_name,
        description: model.description,
        provider: model.provider,
        status: model.status.map(map_model_status),
        effort: model.effort.map(|effort| ModelEffort {
            values: effort.values,
            default: effort.default,
        }),
        fast_mode: model.fast_mode,
        modes: model.modes,
    }
}

/// Resolved gateway model plan for the local surface.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GatewayModelsResponse {
    /// The resolved gateway models — each id enriched with the bundled
    /// catalog row (or bare `{ id, provider? }` for probe-only ids). No
    /// client-side provider filtering is applied; server-side access groups
    /// (once B1 lands) own scoping.
    pub models: Vec<GatewayModelEntry>,
    /// `"seed"` (no snapshot entry yet) or `"probe"` (a snapshot observation
    /// supplied the list).
    pub source: String,
    /// When a probe supplied the list (RFC3339); absent for seed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probed_at: Option<String>,
}

/// Result of a manual gateway refresh.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefreshGatewayResponse {
    /// The freshly probed model ids — exactly what the snapshot entry now
    /// carries for the gateway context, with no client-side provider
    /// filtering applied anywhere downstream.
    pub models: Vec<String>,
    /// The probe timestamp (RFC3339).
    pub probed_at: String,
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
    super::agent_model_snapshot::ensure_path_safe_identifier(&kind, "kind")?;
    // One composed observation per harness: for a gateway-routed harness the
    // observation IS the gateway-reachable menu (probe env == launch env), so
    // this legacy gateway-scoped route serves the composed document until the
    // C-track cutover deletes it.
    let document = state.model_snapshot_service.document(&kind);

    let (raw_models, source, probed_at) = match document {
        Some(document) => (
            document.models.into_iter().map(|model| model.id).collect(),
            "probe".to_string(),
            Some(document.probed_at),
        ),
        None => {
            // No snapshot entry yet: the catalog's seedModels floor is the
            // honest pre-probe answer (same floor `GatewayModelPlanner` renders
            // into a launch), not an empty table.
            let seed_models = state
                .catalog_sync_service
                .active()
                .document
                .agents
                .iter()
                .find(|agent| agent.kind == kind)
                .and_then(|agent| agent.session.gateway_policy.clone())
                .map(|policy| policy.seed_models)
                .unwrap_or_default();
            (seed_models, "seed".to_string(), None)
        }
    };

    let catalog_models = state
        .catalog_sync_service
        .active()
        .document
        .agents
        .iter()
        .find(|agent| agent.kind == kind)
        .map(|agent| agent.session.models.clone())
        .unwrap_or_default();
    let all_catalog_models: Vec<_> = state
        .catalog_sync_service
        .active()
        .document
        .agents
        .iter()
        .flat_map(|agent| agent.session.models.clone())
        .collect();

    let models = raw_models
        .into_iter()
        .map(|id| {
            let own_match = projection::resolve_catalog_match(&id, &catalog_models);
            let foreign_match = if own_match.is_none() {
                projection::resolve_catalog_match(&id, &all_catalog_models)
            } else {
                None
            };
            to_wire(projection::enrich_model(id, own_match, foreign_match))
        })
        .collect();

    Ok(Json(GatewayModelsResponse {
        models,
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
        (status = 404, description = "Unknown agent kind or no gateway route active", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "This runtime does not own the probe engine, or its local auth config is unusable", body = anyharness_contract::v1::ProblemDetails),
        (status = 502, description = "Gateway probe failed", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "catalogs"
)]
pub async fn refresh_gateway_models(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<RefreshGatewayResponse>, ApiError> {
    super::agent_model_snapshot::ensure_path_safe_identifier(&kind, "kind")?;
    // A poke of the same forced re-probe the model-snapshot refresh route runs —
    // the simplest honest shape per ruling §3 (mirror, not fork, the
    // manual-refresh seam). One composed observation; no context scoping.
    let document = state
        .model_snapshot_service
        .refresh_now(&kind)
        .await
        .map_err(super::agent_model_snapshot::refresh_error)?;

    Ok(Json(RefreshGatewayResponse {
        models: document.models.into_iter().map(|model| model.id).collect(),
        probed_at: document.probed_at,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::{
        AgentCatalogAvailability, AgentCatalogModel, AgentCatalogModelControl,
    };
    use std::collections::BTreeMap;

    fn catalog_model(id: &str) -> AgentCatalogModel {
        let mut controls = BTreeMap::new();
        controls.insert(
            "effort".to_string(),
            AgentCatalogModelControl {
                values: vec!["low".to_string(), "medium".to_string(), "high".to_string()],
                default: None,
                observed_value: Some("medium".to_string()),
            },
        );
        AgentCatalogModel {
            id: id.to_string(),
            display_name: "Claude Sonnet 4.5".to_string(),
            description: Some("Balanced coding model".to_string()),
            aliases: vec![],
            family: None,
            availability: AgentCatalogAvailability {
                any_of: vec!["anthropic-api".to_string()],
            },
            default_visible: true,
            controls,
            status: DomainModelCatalogStatus::Active,
            provenance: None,
        }
    }

    /// The wire mapping preserves identity + status + effort exactly as the
    /// projection module computed them — this route adds no logic of its own
    /// beyond the snapshot-vs-seed source selection.
    #[test]
    fn to_wire_preserves_enrichment() {
        let model = catalog_model("claude-sonnet-4-5");
        let enriched =
            projection::enrich_model("claude-sonnet-4-5".to_string(), Some(&model), None);
        let wire = to_wire(enriched);

        assert_eq!(wire.id, "claude-sonnet-4-5");
        assert_eq!(wire.display_name.as_deref(), Some("Claude Sonnet 4.5"));
        assert_eq!(wire.provider.as_deref(), Some("anthropic"));
        assert!(matches!(wire.status, Some(ModelCatalogStatus::Active)));
        let effort = wire.effort.expect("effort");
        assert_eq!(effort.values, vec!["low", "medium", "high"]);
        assert_eq!(effort.default.as_deref(), Some("medium"));
    }

    /// A probe-only id (proxy serves it, catalog doesn't know it) stays sparse
    /// on the wire — no display name, no status, provider only when the
    /// prefix matcher recognizes it.
    #[test]
    fn to_wire_probe_only_id_is_sparse() {
        let enriched = projection::enrich_model("claude-future-9".to_string(), None, None);
        let wire = to_wire(enriched);

        assert_eq!(wire.id, "claude-future-9");
        assert_eq!(wire.provider.as_deref(), Some("anthropic"));
        assert!(wire.display_name.is_none());
        assert!(wire.status.is_none());
        assert!(wire.effort.is_none());
    }
}
