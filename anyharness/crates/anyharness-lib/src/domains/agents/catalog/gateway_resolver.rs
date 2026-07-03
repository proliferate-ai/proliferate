//! Catalog-resolved gateway model plans (spec §3).
//!
//! Turns "(harness, revision)" into a [`GatewayModelPlan`] the render plane
//! consumes directly. The plan's model list is the latest probe rows for the
//! revision (else the catalog's `gatewayPolicy.seedModels`), filtered by the
//! harness's `gatewayPolicy.providers`; the default/small-fast pins come from
//! `session.defaults["gateway"]` / `gatewayPolicy.roles`. This is where the
//! model-id constants that used to live in the render layer now come from —
//! all as catalog data, never code.

use std::path::Path;
use std::sync::Arc;

use super::gateway_probe::{probe_gateway_models, GatewayProbeStore};
use super::schema::AgentCatalogGatewayPolicy;
use super::sync::CatalogSyncService;
use crate::domains::agents::route_auth::state::SOURCE_KIND_GATEWAY;
use crate::domains::agents::route_auth::{load_state_file, GatewayModelPlan, GatewayModelResolve};

/// The gateway model context key the catalog uses for gateway-route curation
/// (matches the `gateway` auth-context id and `defaults["gateway"]`).
const GATEWAY_CONTEXT_ID: &str = "gateway";

/// Where a resolved model list came from — surfaced by the desktop All-Models
/// tab as the freshness line ("seed" vs "probed <time>").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayModelSource {
    /// No probe row for the revision yet: the catalog seed list is in effect.
    Seed,
    /// A live probe supplied the list at `probed_at` (RFC3339).
    Probe { probed_at: String },
}

/// Provider-id -> model-id prefix/family matcher. The long-term home is
/// provider-tagged catalog model entries; until then this tiny table maps the
/// known gateway provider ids to their id patterns so `gatewayPolicy.providers`
/// can filter a probed/seed list. A provider not in the table matches nothing.
fn model_matches_provider(provider: &str, model_id: &str) -> bool {
    match provider {
        "anthropic" => model_id.starts_with("claude-"),
        "openai" => model_id.starts_with("gpt-") || model_id.starts_with('o'),
        "xai" => model_id.starts_with("grok-"),
        _ => false,
    }
}

/// Filter `models` to those served by any of `providers`. Empty `providers`
/// means "all" — no filtering (opencode/grok).
fn filter_by_providers(models: Vec<String>, providers: &[String]) -> Vec<String> {
    if providers.is_empty() {
        return models;
    }
    models
        .into_iter()
        .filter(|model| {
            providers
                .iter()
                .any(|provider| model_matches_provider(provider, model))
        })
        .collect()
}

/// Resolves gateway model plans from the active catalog + the probe store, and
/// (lazily) schedules background probes. Holds the probe store and a catalog
/// snapshot source; cheap to clone.
#[derive(Clone)]
pub struct GatewayModelResolver {
    catalog_sync: Arc<CatalogSyncService>,
    probe_store: GatewayProbeStore,
}

impl GatewayModelResolver {
    pub fn new(catalog_sync: Arc<CatalogSyncService>, probe_store: GatewayProbeStore) -> Self {
        Self {
            catalog_sync,
            probe_store,
        }
    }

    pub fn probe_store(&self) -> &GatewayProbeStore {
        &self.probe_store
    }

    /// The catalog's gateway policy + default model for a harness, if the
    /// harness is gateway-capable.
    fn policy_and_default(
        &self,
        harness_kind: &str,
    ) -> (AgentCatalogGatewayPolicy, Option<String>) {
        let active = self.catalog_sync.active();
        let Some(agent) = active
            .document
            .agents
            .iter()
            .find(|agent| agent.kind == harness_kind)
        else {
            return (AgentCatalogGatewayPolicy::default(), None);
        };
        let policy = agent.session.gateway_policy.clone().unwrap_or_default();
        let default_model = agent.session.defaults.get(GATEWAY_CONTEXT_ID).cloned();
        (policy, default_model)
    }

    /// Resolve the plan AND its freshness source (for the desktop All-Models
    /// tab). `resolve_gateway_models` is the render-facing thin wrapper.
    pub fn resolve_with_source(
        &self,
        harness_kind: &str,
        revision: i64,
    ) -> (GatewayModelPlan, GatewayModelSource) {
        let (policy, default_model) = self.policy_and_default(harness_kind);
        let small_fast_model = policy.roles.get("small_fast").cloned();

        let (raw_models, source) = match self.probe_store.latest(harness_kind, revision) {
            Ok(Some(row)) => (
                row.models,
                GatewayModelSource::Probe {
                    probed_at: row.probed_at,
                },
            ),
            Ok(None) => (policy.seed_models.clone(), GatewayModelSource::Seed),
            Err(error) => {
                tracing::warn!(
                    harness = harness_kind,
                    revision,
                    %error,
                    "gateway probe store read failed; falling back to seed models"
                );
                (policy.seed_models.clone(), GatewayModelSource::Seed)
            }
        };

        let models = filter_by_providers(raw_models, &policy.providers);
        (
            GatewayModelPlan {
                default_model,
                small_fast_model,
                models,
            },
            source,
        )
    }

    /// The gateway (base_url, key) for a harness from the current state file,
    /// if a gateway source exists.
    fn gateway_credentials(
        &self,
        harness_kind: &str,
        runtime_home: &Path,
    ) -> Option<(String, String)> {
        let state = load_state_file(runtime_home).ok().flatten()?;
        let source = state
            .sources_for(harness_kind)
            .iter()
            .find(|source| source.kind == SOURCE_KIND_GATEWAY)?;
        let base_url = source
            .base_url
            .clone()
            .filter(|url| !url.trim().is_empty())?;
        let key = source.key.clone().filter(|key| !key.trim().is_empty())?;
        Some((base_url, key))
    }

    /// Probe now and record the result, returning the probed model list. Used
    /// by the manual refresh endpoint (spec §2b), which surfaces probe errors.
    pub async fn refresh_now(
        &self,
        harness_kind: &str,
        revision: i64,
        base_url: &str,
        key: &str,
    ) -> Result<Vec<String>, super::gateway_probe::GatewayProbeError> {
        let models = probe_gateway_models(base_url, key).await?;
        let probed_at = chrono::Utc::now().to_rfc3339();
        if let Err(error) = self
            .probe_store
            .record(harness_kind, revision, &models, &probed_at)
        {
            tracing::warn!(harness = harness_kind, revision, %error, "failed to record gateway probe");
        } else {
            tracing::info!(
                harness = harness_kind,
                revision,
                model_count = models.len(),
                "recorded gateway model probe"
            );
        }
        Ok(models)
    }

    /// Probe now and record (spec §2a/§2c). Best-effort: probe failures are
    /// logged and swallowed so a slow/unreachable gateway never surfaces as a
    /// launch or apply error.
    pub async fn probe_and_record(
        &self,
        harness_kind: &str,
        revision: i64,
        base_url: &str,
        key: &str,
    ) {
        if let Err(error) = self.refresh_now(harness_kind, revision, base_url, key).await {
            tracing::warn!(harness = harness_kind, revision, %error, "gateway model probe failed");
        }
    }
}

impl GatewayModelResolve for GatewayModelResolver {
    fn resolve_gateway_models(&self, harness_kind: &str, revision: i64) -> GatewayModelPlan {
        self.resolve_with_source(harness_kind, revision).0
    }

    fn schedule_launch_probe_if_stale(&self, harness_kind: &str, runtime_home: &Path) {
        // Only schedule when a gateway source exists and no probe row is
        // present for the current revision (spec §2c). Never blocks the launch.
        let Some((base_url, key)) = self.gateway_credentials(harness_kind, runtime_home) else {
            return;
        };
        let state_revision = load_state_file(runtime_home)
            .ok()
            .flatten()
            .map(|state| state.revision)
            .unwrap_or(0);
        match self.probe_store.latest(harness_kind, state_revision) {
            Ok(Some(_)) => return, // fresh enough for this revision
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(harness = harness_kind, %error, "gateway probe staleness check failed");
                return;
            }
        }
        let resolver = self.clone();
        let harness = harness_kind.to_string();
        tokio::spawn(async move {
            resolver
                .probe_and_record(&harness, state_revision, &base_url, &key)
                .await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_matcher_covers_known_families() {
        assert!(model_matches_provider("anthropic", "claude-sonnet-4-5"));
        assert!(!model_matches_provider("anthropic", "gpt-5.5"));
        assert!(model_matches_provider("openai", "gpt-5.5"));
        assert!(model_matches_provider("openai", "o3"));
        assert!(model_matches_provider("xai", "grok-4"));
        assert!(!model_matches_provider("unknown", "claude-sonnet-4-5"));
    }

    #[test]
    fn empty_providers_means_all() {
        let models = vec!["claude-sonnet-4-5".to_string(), "gpt-5.5".to_string()];
        assert_eq!(filter_by_providers(models.clone(), &[]), models);
    }

    #[test]
    fn providers_filter_to_the_compat_group() {
        let models = vec![
            "claude-sonnet-4-5".to_string(),
            "gpt-5.5".to_string(),
            "grok-4".to_string(),
        ];
        let filtered =
            filter_by_providers(models, &["anthropic".to_string(), "openai".to_string()]);
        assert_eq!(filtered, vec!["claude-sonnet-4-5", "gpt-5.5"]);
    }
}
