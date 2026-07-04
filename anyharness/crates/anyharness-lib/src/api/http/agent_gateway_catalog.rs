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

use anyharness_contract::v1::{ModelCatalogStatus, ModelEffort};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::catalog::gateway_resolver::{
    normalize_model_family, provider_for_model, GatewayModelSource,
};
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
    /// The permission/agent modes the model supports (`controls.mode.values`);
    /// absent when the model has no mode control or is probe-only (contract §5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<Vec<String>>,
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
/// Falls back to `reasoning_effort` for codex models.
pub(crate) fn model_effort(model: &AgentCatalogModel) -> Option<ModelEffort> {
    model
        .controls
        .get("effort")
        .or_else(|| model.controls.get("reasoning_effort"))
        .map(|control| ModelEffort {
            values: control.values.clone(),
            default: control.observed_value.clone(),
        })
}

/// The permission/agent modes joined from a catalog model (`controls.mode`), if
/// it declares that control (contract §5).
pub(crate) fn model_modes(model: &AgentCatalogModel) -> Option<Vec<String>> {
    model
        .controls
        .get("mode")
        .map(|control| control.values.clone())
}

/// Resolve the bundled catalog row for a resolved gateway id (contract §5).
/// Tries an exact id match first, then falls back to a FAMILY-key match (see
/// [`normalize_model_family`]). When several catalog entries share the family
/// key, prefer the non-`[1m]` entry, then the longest (most-specific) id, then
/// a lexical tiebreak — deterministic regardless of catalog ordering.
fn resolve_catalog_match<'a>(
    id: &str,
    catalog_models: &'a [AgentCatalogModel],
) -> Option<&'a AgentCatalogModel> {
    if let Some(model) = catalog_models.iter().find(|model| model.id == id) {
        return Some(model);
    }
    let key = normalize_model_family(id);
    catalog_models
        .iter()
        .filter(|model| normalize_model_family(&model.id) == key)
        .max_by(|a, b| {
            let a_non_1m = !a.id.ends_with("[1m]");
            let b_non_1m = !b.id.ends_with("[1m]");
            a_non_1m
                .cmp(&b_non_1m)
                .then_with(|| a.id.len().cmp(&b.id.len()))
                .then_with(|| a.id.cmp(&b.id))
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
            modes: model_modes(model),
        },
        None => GatewayModelEntry {
            id,
            display_name: None,
            description: None,
            provider,
            status: None,
            effort: None,
            fast_mode: None,
            modes: None,
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
    let models = plan
        .models
        .into_iter()
        .map(|id| {
            let catalog = resolve_catalog_match(&id, &catalog_models);
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
        controls.insert(
            "mode".to_string(),
            AgentCatalogModelControl {
                values: vec![
                    "default".to_string(),
                    "acceptEdits".to_string(),
                    "plan".to_string(),
                ],
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
        assert_eq!(
            entry.modes,
            Some(vec![
                "default".to_string(),
                "acceptEdits".to_string(),
                "plan".to_string()
            ])
        );
    }

    #[test]
    fn model_without_effort_or_fast_mode_omits_them() {
        let mut model = catalog_model("claude-sonnet-4-5");
        model.controls.clear();
        let entry = enrich_model("claude-sonnet-4-5".to_string(), Some(&model));

        assert!(entry.effort.is_none());
        assert_eq!(entry.fast_mode, Some(false));
        assert!(entry.modes.is_none());
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

    // --- The family-key join (contract §5, `resolve_catalog_match`), exercised
    // with the REAL claude catalog + gateway id sets. ---

    /// The catalog's real claude opus-4-8 entries (three ids sharing a family
    /// key) plus the drifted sonnet/opus-4-6 entries that DON'T bridge today.
    fn claude_catalog() -> Vec<AgentCatalogModel> {
        [
            "sonnet",
            "opus[1m]",
            "us.anthropic.claude-sonnet-4-6",
            "us.anthropic.claude-sonnet-4-6[1m]",
            "us.anthropic.claude-opus-4-6-v1[1m]",
            "claude-opus-4-8",
            "us.anthropic.claude-opus-4-8",
            "us.anthropic.claude-opus-4-8[1m]",
        ]
        .into_iter()
        .map(catalog_model)
        .collect()
    }

    #[test]
    fn exact_id_wins_over_family() {
        let models = claude_catalog();
        let hit = resolve_catalog_match("claude-opus-4-8", &models).expect("match");
        // Exact id match, even though bedrock opus-4-8 variants share its family.
        assert_eq!(hit.id, "claude-opus-4-8");
    }

    #[test]
    fn dated_gateway_id_family_joins_preferring_non_1m_most_specific() {
        let models = claude_catalog();
        // No exact id: the dated gateway id family-matches the three opus-4-8
        // catalog entries; prefer non-[1m], then the longest/most-specific id.
        let hit = resolve_catalog_match("claude-opus-4-8-20260101", &models).expect("match");
        assert_eq!(hit.id, "us.anthropic.claude-opus-4-8");
    }

    #[test]
    fn drifted_gateway_ids_stay_sparse_today() {
        let models = claude_catalog();
        // Real config.yaml gateway ids: catalog moved to 4-6/4-8, gateway serves
        // 4-5 and a bedrock-`-v1` 4-6 — none bridge, so enrichment is sparse.
        assert!(resolve_catalog_match("claude-sonnet-4-5", &models).is_none());
        assert!(resolve_catalog_match("claude-sonnet-4-5-20250929", &models).is_none());
        assert!(resolve_catalog_match("claude-haiku-4-5", &models).is_none());
        assert!(resolve_catalog_match("claude-opus-4-6-20260205", &models).is_none());
    }

    #[test]
    fn codex_model_with_reasoning_effort_enriches_effort() {
        // Codex models use "reasoning_effort" key — verify the fallback works.
        let mut controls = BTreeMap::new();
        controls.insert(
            "reasoning_effort".to_string(),
            AgentCatalogModelControl {
                values: vec![
                    "low".to_string(),
                    "medium".to_string(),
                    "high".to_string(),
                    "xhigh".to_string(),
                ],
                default: None,
                observed_value: Some("medium".to_string()),
            },
        );
        let model = AgentCatalogModel {
            id: "codex-model".to_string(),
            display_name: "Codex Model".to_string(),
            description: None,
            aliases: vec![],
            family: None,
            availability: AgentCatalogAvailability {
                any_of: vec!["codex-api".to_string()],
            },
            default_visible: true,
            controls,
            status: DomainModelCatalogStatus::Active,
            provenance: None,
        };

        let effort = model_effort(&model).expect("effort should be present");
        assert_eq!(effort.values, vec!["low", "medium", "high", "xhigh"]);
        assert_eq!(effort.default.as_deref(), Some("medium"));

        // Also test enrichment via enrich_model
        let entry = enrich_model("codex-model".to_string(), Some(&model));
        assert!(entry.effort.is_some());
        assert_eq!(entry.effort.unwrap().values, vec!["low", "medium", "high", "xhigh"]);
    }

    #[test]
    fn claude_model_with_effort_still_works() {
        // Claude models use "effort" key — verify it still works.
        let model = catalog_model("claude-sonnet-4-5");
        let effort = model_effort(&model).expect("effort should be present");
        assert_eq!(effort.values, vec!["low", "medium", "high"]);
        assert_eq!(effort.default.as_deref(), Some("medium"));
    }
}
