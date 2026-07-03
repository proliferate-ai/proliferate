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

use std::collections::HashMap;

use anyharness_contract::v1::{ModelCatalogStatus, ModelEffort};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::catalog::gateway_resolver::{provider_for_model, GatewayModelSource};
use crate::domains::agents::catalog::schema::AgentCatalogModel;
use crate::domains::agents::model::ModelCatalogStatus as DomainModelCatalogStatus;
use crate::domains::agents::route_auth::load_state_file;
use crate::domains::agents::route_auth::state::SOURCE_KIND_GATEWAY;

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
}

/// Map the runtime-owned lifecycle status to the wire enum (identical variants).
pub(crate) fn map_model_status(status: DomainModelCatalogStatus) -> ModelCatalogStatus {
    match status {
        DomainModelCatalogStatus::Candidate => ModelCatalogStatus::Candidate,
        DomainModelCatalogStatus::Active => ModelCatalogStatus::Active,
        DomainModelCatalogStatus::Deprecated => ModelCatalogStatus::Deprecated,
        DomainModelCatalogStatus::Hidden => ModelCatalogStatus::Hidden,
    }
}

/// The effort control joined from a catalog model, if it declares one.
pub(crate) fn model_effort(model: &AgentCatalogModel) -> Option<ModelEffort> {
    model.controls.get("effort").map(|control| ModelEffort {
        values: control.values.clone(),
        default: control.observed_value.clone(),
    })
}

/// Enrich a resolved gateway model id by joining the bundled catalog row.
/// Catalog-known → full object; probe-only → `{ id, provider? }`.
fn enrich_model(id: String, catalog: Option<&AgentCatalogModel>) -> GatewayModelEntry {
    let provider = provider_for_model(&id).map(str::to_string);
    match catalog {
        Some(model) => GatewayModelEntry {
            id,
            display_name: Some(model.display_name.clone()),
            description: model.description.clone(),
            provider,
            status: Some(map_model_status(model.status)),
            effort: model_effort(model),
            fast_mode: Some(model.controls.contains_key("fast_mode")),
        },
        None => GatewayModelEntry {
            id,
            display_name: None,
            description: None,
            provider,
            status: None,
            effort: None,
            fast_mode: None,
        },
    }
}

/// Resolved gateway model plan for the local surface.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GatewayModelsResponse {
    /// The resolved, provider-filtered models — each id enriched with the
    /// bundled catalog row (or bare `{ id, provider? }` for probe-only ids).
    pub models: Vec<GatewayModelEntry>,
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
    let catalog_models = state.gateway_model_resolver.catalog_models(&kind);
    let lookup: HashMap<&str, &AgentCatalogModel> = catalog_models
        .iter()
        .map(|model| (model.id.as_str(), model))
        .collect();
    let models = plan
        .models
        .into_iter()
        .map(|id| {
            let catalog = lookup.get(id.as_str()).copied();
            enrich_model(id, catalog)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::{
        AgentCatalogAvailability, AgentCatalogModelControl,
    };
    use std::collections::BTreeMap;

    /// A catalog model with an effort control (values + observed default) and a
    /// fast_mode control — the shape the table's enriched row needs.
    fn catalog_model(id: &str) -> AgentCatalogModel {
        let mut controls = BTreeMap::new();
        controls.insert(
            "effort".to_string(),
            AgentCatalogModelControl {
                values: vec![
                    "low".to_string(),
                    "medium".to_string(),
                    "high".to_string(),
                ],
                default: None,
                observed_value: Some("medium".to_string()),
            },
        );
        controls.insert(
            "fast_mode".to_string(),
            AgentCatalogModelControl {
                values: vec!["on".to_string(), "off".to_string()],
                default: None,
                observed_value: None,
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

    #[test]
    fn catalog_known_model_is_fully_enriched() {
        let model = catalog_model("claude-sonnet-4-5");
        let entry = enrich_model("claude-sonnet-4-5".to_string(), Some(&model));

        assert_eq!(entry.id, "claude-sonnet-4-5");
        assert_eq!(entry.display_name.as_deref(), Some("Claude Sonnet 4.5"));
        assert_eq!(entry.description.as_deref(), Some("Balanced coding model"));
        assert_eq!(entry.provider.as_deref(), Some("anthropic"));
        assert!(matches!(entry.status, Some(ModelCatalogStatus::Active)));
        let effort = entry.effort.expect("effort");
        assert_eq!(effort.values, vec!["low", "medium", "high"]);
        assert_eq!(effort.default.as_deref(), Some("medium"));
        assert_eq!(entry.fast_mode, Some(true));
    }

    #[test]
    fn model_without_effort_or_fast_mode_omits_them() {
        let mut model = catalog_model("claude-sonnet-4-5");
        model.controls.clear();
        let entry = enrich_model("claude-sonnet-4-5".to_string(), Some(&model));

        assert!(entry.effort.is_none());
        assert_eq!(entry.fast_mode, Some(false));
        // Catalog-known rows still carry display metadata + status.
        assert_eq!(entry.display_name.as_deref(), Some("Claude Sonnet 4.5"));
        assert!(entry.status.is_some());
    }

    #[test]
    fn probe_only_matched_id_is_sparse_with_provider() {
        // Not in the catalog (proxy serves it, catalog doesn't know it).
        let entry = enrich_model("claude-future-9".to_string(), None);

        assert_eq!(entry.id, "claude-future-9");
        assert_eq!(entry.provider.as_deref(), Some("anthropic"));
        assert!(entry.display_name.is_none());
        assert!(entry.description.is_none());
        assert!(entry.status.is_none());
        assert!(entry.effort.is_none());
        assert!(entry.fast_mode.is_none());
    }

    #[test]
    fn probe_only_unmatched_id_omits_provider() {
        let entry = enrich_model("mystery-model".to_string(), None);

        assert_eq!(entry.id, "mystery-model");
        assert!(entry.provider.is_none());
        assert!(entry.display_name.is_none());
    }
}
