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
use super::schema::{AgentCatalogGatewayPolicy, AgentCatalogModel};
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

/// Model-id -> provider-id prefix/family matcher. The long-term home is
/// provider-tagged catalog model entries; until then this tiny table maps the
/// known gateway model id patterns to their provider id. Used both to filter a
/// probed/seed list by `gatewayPolicy.providers` and to tag enriched
/// gateway-model / launch-option rows with a provider. Returns `None` when no
/// family matches (the caller omits `provider`).
pub fn provider_for_model(model_id: &str) -> Option<&'static str> {
    if model_id.starts_with("claude-") {
        Some("anthropic")
    } else if model_id.starts_with("gpt-") || model_id.starts_with('o') {
        Some("openai")
    } else if model_id.starts_with("grok-") {
        Some("xai")
    } else {
        None
    }
}

/// Normalize a model id to a conservative FAMILY key for the enrichment join
/// (contract §5). Catalog ids and gateway ids share almost no exact ids
/// (catalog: `sonnet`, `us.anthropic.claude-sonnet-4-6[1m]`; gateway:
/// `claude-sonnet-4-5`, `claude-opus-4-6-20260205`), so the enrichment falls
/// back to matching on this key. It strips, in order:
///   1. the `us.anthropic.` / `global.anthropic.` vendor prefix,
///   2. a trailing `[1m]` context-window suffix,
///   3. a trailing bedrock `-vN:M` version suffix (colon-bearing only — a bare
///      `-vN` is deliberately NOT a version suffix),
///   4. a trailing `-YYYYMMDD` release date,
/// and lowercases the result. Pure CLI selectors (`default`, `sonnet`, `opus`,
/// `haiku`) normalize to themselves, which never equals a real gateway model id
/// family — so they stay unbridged by design (no guessy displayName matching).
pub fn normalize_model_family(model_id: &str) -> String {
    let mut s = model_id.trim();
    for prefix in ["us.anthropic.", "global.anthropic."] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest;
            break;
        }
    }
    let mut s = s.to_ascii_lowercase();
    if let Some(rest) = s.strip_suffix("[1m]") {
        s = rest.to_string();
    }
    s = strip_bedrock_version_suffix(&s);
    s = strip_release_date_suffix(&s);
    s
}

/// Strip a trailing bedrock `-vN:M` version suffix (e.g. `-v1:0`). A bare `-vN`
/// (no colon) is left intact — the catalog uses `claude-opus-4-6-v1` as a
/// distinct family from `claude-opus-4-6`.
fn strip_bedrock_version_suffix(s: &str) -> String {
    let Some(idx) = s.rfind("-v") else {
        return s.to_string();
    };
    let tail = &s[idx + 2..];
    let Some((n, m)) = tail.split_once(':') else {
        return s.to_string();
    };
    if !n.is_empty()
        && n.bytes().all(|b| b.is_ascii_digit())
        && !m.is_empty()
        && m.bytes().all(|b| b.is_ascii_digit())
    {
        s[..idx].to_string()
    } else {
        s.to_string()
    }
}

/// Strip a trailing `-YYYYMMDD` release date (dash + exactly 8 ASCII digits).
fn strip_release_date_suffix(s: &str) -> String {
    let Some(idx) = s.rfind('-') else {
        return s.to_string();
    };
    let tail = &s[idx + 1..];
    if tail.len() == 8 && tail.bytes().all(|b| b.is_ascii_digit()) {
        s[..idx].to_string()
    } else {
        s.to_string()
    }
}

/// Does `provider` serve `model_id`? A provider not in the family table (or a
/// model matching no family) matches nothing.
fn model_matches_provider(provider: &str, model_id: &str) -> bool {
    provider_for_model(model_id) == Some(provider)
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

    /// The bundled catalog's model rows for a harness kind (empty when the
    /// harness is unknown). The HTTP layer joins these onto the resolved
    /// gateway model ids to enrich the gateway-models response — the render
    /// plane still consumes plain ids, so the join lives at the transport
    /// boundary, not in [`GatewayModelPlan`].
    pub fn catalog_models(&self, harness_kind: &str) -> Vec<AgentCatalogModel> {
        self.catalog_sync
            .active()
            .document
            .agents
            .iter()
            .find(|agent| agent.kind == harness_kind)
            .map(|agent| agent.session.models.clone())
            .unwrap_or_default()
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

    // --- normalize_model_family (contract §5), exercised with the REAL id sets
    // from catalogs/agents/catalog.json (catalog) and server/litellm/config.yaml
    // (gateway). ---

    #[test]
    fn normalize_strips_vendor_prefix_bracket_version_and_date() {
        // Vendor prefix + [1m] window suffix (catalog).
        assert_eq!(
            normalize_model_family("us.anthropic.claude-sonnet-4-6[1m]"),
            "claude-sonnet-4-6"
        );
        assert_eq!(
            normalize_model_family("global.anthropic.claude-fable-5"),
            "claude-fable-5"
        );
        // Bedrock version + date (catalog).
        assert_eq!(
            normalize_model_family("us.anthropic.claude-opus-4-1-20250805-v1:0"),
            "claude-opus-4-1"
        );
        // Trailing release dates (gateway / config.yaml).
        assert_eq!(
            normalize_model_family("claude-sonnet-4-5-20250929"),
            "claude-sonnet-4-5"
        );
        assert_eq!(
            normalize_model_family("claude-haiku-4-5-20251001"),
            "claude-haiku-4-5"
        );
        assert_eq!(
            normalize_model_family("claude-opus-4-6-20260205"),
            "claude-opus-4-6"
        );
        // Pure CLI selectors normalize to themselves.
        assert_eq!(normalize_model_family("opus[1m]"), "opus");
        assert_eq!(normalize_model_family("sonnet"), "sonnet");
        assert_eq!(normalize_model_family("default"), "default");
    }

    #[test]
    fn bare_dash_v_is_not_a_version_suffix() {
        // The catalog's bedrock opus-4-6 entry carries a bare `-v1` (no colon),
        // which is a DISTINCT family from a plain `claude-opus-4-6`.
        assert_eq!(
            normalize_model_family("us.anthropic.claude-opus-4-6-v1[1m]"),
            "claude-opus-4-6-v1"
        );
    }

    #[test]
    fn sonnet_4_6_catalog_does_not_match_sonnet_4_5_gateway() {
        // The headline real-data hazard: catalog moved to 4-6 while the gateway
        // config still serves 4-5, so these must NOT bridge.
        assert_ne!(
            normalize_model_family("us.anthropic.claude-sonnet-4-6[1m]"),
            normalize_model_family("claude-sonnet-4-5")
        );
    }

    #[test]
    fn opus_4_6_dated_gateway_family_key() {
        // The dated gateway id normalizes to the plain family; it would bridge
        // to a catalog `claude-opus-4-6` entry IF one existed. Today the closest
        // catalog entry is a bedrock `-v1[1m]` variant, which normalizes
        // distinctly, so opus-4-6 stays unbridged.
        assert_eq!(
            normalize_model_family("claude-opus-4-6-20260205"),
            "claude-opus-4-6"
        );
        assert_ne!(
            normalize_model_family("claude-opus-4-6-20260205"),
            normalize_model_family("us.anthropic.claude-opus-4-6-v1[1m]")
        );
    }

    #[test]
    fn pure_selectors_never_match_a_gateway_id() {
        // Selector families never collide with a real gateway model id family.
        assert_ne!(
            normalize_model_family("sonnet"),
            normalize_model_family("claude-sonnet-4-5")
        );
        assert_ne!(
            normalize_model_family("opus"),
            normalize_model_family("claude-opus-4-6-20260205")
        );
    }

    #[test]
    fn dated_opus_4_8_bridges_to_bedrock_family() {
        // A genuine positive: the catalog's opus-4-8 entries and a dated gateway
        // opus-4-8 id share a family key.
        assert_eq!(
            normalize_model_family("us.anthropic.claude-opus-4-8[1m]"),
            normalize_model_family("us.anthropic.claude-opus-4-8")
        );
        assert_eq!(
            normalize_model_family("claude-opus-4-8-20260101"),
            "claude-opus-4-8"
        );
        assert_eq!(
            normalize_model_family("claude-opus-4-8-20260101"),
            normalize_model_family("us.anthropic.claude-opus-4-8[1m]")
        );
    }
}
