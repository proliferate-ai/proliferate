//! The gateway model PLAN producer: what the proxy serves, fetched live and
//! memoized, so a launch can write a harness's explicit models map.
//!
//! This is materialization input, never observation. model-catalog.md, "Probe
//! mechanics" keeps exactly one `GET /v1/models` fetch alive through the snapshot
//! cutover, and names its single job: *"harnesses whose gateway config enumerates
//! models explicitly (opencode's provider models map) need the proxy's list to
//! write that config before any spawn… That fetch belongs to agent-auth's route
//! materialization (the `GatewayModelPlan` seam) … and never writes the snapshot"*.
//!
//! **Why the seed list cannot be the answer.** `render_opencode_gateway` writes the
//! plan's model ids into `opencode.json`, and the probe then observes whatever that
//! file configured. Degrade the plan to `gatewayPolicy.seedModels` and the
//! observation becomes a tautology — the probe "discovers" precisely the four ids
//! the launch just wrote — so a model added on the gateway is undiscoverable
//! forever. The seed list therefore survives only as a FLOOR that keeps a launch
//! renderable (`render_opencode_gateway` hard-fails on an empty models map), and an
//! entry produced over that floor carries [`SEED_FALLBACK_WARNING`] so the
//! observation is not mistaken for a discovery.
//!
//! **Why the memo, and why in memory.** The predecessor cached fetch results in the
//! `gateway_model_probe` sqlite table keyed on `state.json`'s GLOBAL revision, which
//! made any harness's key rotation invalidate every harness's cached list. The memo
//! here is keyed per (harness, base URL) with its own short TTL, holds no
//! credential, and needs no migration when the table goes. A restart costs one
//! fetch.
//!
//! **Why a launch never waits on it.** `resolve_gateway_models` is sync (it is
//! called from `render_profile`'s synchronous path), so a fetch can only happen by
//! blocking a thread. A launch that blocked on an unreachable gateway would stall
//! the spawn — the property the fetch's own 10s timeout bounds but cannot remove. So
//! the fetch runs only through [`GatewayModelResolve::resolve_gateway_models_blocking`],
//! which only the probe engine calls (from a `spawn_blocking` thread); the launch
//! path reads the memo and takes the floor on a miss.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::gateway_probe::probe_gateway_models;
use super::gateway_resolver::native_default_model;
use super::schema::{AgentCatalogGatewayPolicy, AgentCatalogModel};
use super::sync::CatalogSyncService;
use crate::domains::agents::route_auth::state::SOURCE_KIND_GATEWAY;
use crate::domains::agents::route_auth::{load_state_file, GatewayModelPlan, GatewayModelResolve};

/// The gateway auth-context id the catalog uses for gateway-route curation.
const GATEWAY_CONTEXT_ID: &str = "gateway";

/// How long a fetched model list stays usable before the next allowed fetch
/// re-asks. Five minutes per the design of record: long enough that a burst of
/// pokes across one harness's contexts asks once, short enough that a model added
/// on the gateway shows up without a restart.
pub const DEFAULT_PLAN_FETCH_TTL: Duration = Duration::from_secs(5 * 60);

/// Recorded on a snapshot entry whose plan came from the seed floor rather than a
/// live fetch. The picker still gets a launchable list; this says the observation
/// behind it cannot be read as a discovery of the gateway's model set.
pub const SEED_FALLBACK_WARNING: &str = "gateway model plan fell back to seed models";

/// A memoized list plus when it was fetched.
struct MemoEntry {
    models: Vec<String>,
    fetched_at: Instant,
}

/// Produces [`GatewayModelPlan`]s from the active catalog plus a memoized live
/// `GET /v1/models`.
pub struct GatewayModelPlanner {
    catalog_sync: Arc<CatalogSyncService>,
    runtime_home: std::path::PathBuf,
    /// Keyed by (harness kind, base URL). The base URL is part of the key because
    /// pointing a harness at a different proxy is a different model set; the KEY
    /// itself deliberately is not, since a rotated key serving the same proxy serves
    /// the same models and re-fetching on rotation would be pure latency.
    memo: Mutex<HashMap<(String, String), MemoEntry>>,
    fetch_ttl: Duration,
    fetcher: Arc<dyn GatewayModelFetch>,
}

/// The `GET /v1/models` call, behind a seam so the planner's memo, TTL and floor
/// are testable without a network.
#[async_trait::async_trait]
pub trait GatewayModelFetch: Send + Sync {
    async fn fetch(&self, base_url: &str, key: &str) -> Result<Vec<String>, String>;
}

/// Production: the surviving tolerant fetch with its own 10s timeout.
pub struct HttpGatewayModelFetch;

#[async_trait::async_trait]
impl GatewayModelFetch for HttpGatewayModelFetch {
    async fn fetch(&self, base_url: &str, key: &str) -> Result<Vec<String>, String> {
        probe_gateway_models(base_url, key)
            .await
            .map_err(|error| error.to_string())
    }
}

impl GatewayModelPlanner {
    pub fn new(catalog_sync: Arc<CatalogSyncService>, runtime_home: std::path::PathBuf) -> Self {
        Self::with_parts(
            catalog_sync,
            runtime_home,
            Arc::new(HttpGatewayModelFetch),
            DEFAULT_PLAN_FETCH_TTL,
        )
    }

    pub fn with_parts(
        catalog_sync: Arc<CatalogSyncService>,
        runtime_home: std::path::PathBuf,
        fetcher: Arc<dyn GatewayModelFetch>,
        fetch_ttl: Duration,
    ) -> Self {
        Self {
            catalog_sync,
            runtime_home,
            memo: Mutex::new(HashMap::new()),
            fetch_ttl,
            fetcher,
        }
    }

    /// The bundled catalog's model rows for a harness kind (empty when the harness
    /// is unknown). The HTTP layer joins these onto resolved ids to enrich a
    /// gateway-models response; the render plane still consumes plain ids, so the
    /// join stays at the transport boundary.
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

    /// Every agent's model rows across the whole catalog. Gateway model IDENTITY is
    /// provider truth, so when the own-harness catalog misses, another harness's row
    /// can still supply displayName/description.
    pub fn catalog_models_all(&self) -> Vec<AgentCatalogModel> {
        self.catalog_sync
            .active()
            .document
            .agents
            .iter()
            .flat_map(|agent| agent.session.models.clone())
            .collect()
    }

    /// Drop the memo for a harness so the next permitted resolve genuinely re-asks
    /// the gateway. Every base URL for the harness is dropped: the caller pressed
    /// Refresh about the harness, not about a URL.
    pub fn invalidate(&self, harness_kind: &str) {
        self.memo
            .lock()
            .expect("gateway plan memo poisoned")
            .retain(|(kind, _), _| kind != harness_kind);
    }

    fn resolve(
        &self,
        harness_kind: &str,
        _revision: i64,
        allow_blocking_fetch: bool,
    ) -> (GatewayModelPlan, bool) {
        let (policy, default_model, native_default_model) = self.policy_and_default(harness_kind);
        let small_fast_model = policy.roles.get("small_fast").cloned();
        let credentials = self.gateway_credentials(harness_kind);

        let (raw_models, used_seed_floor) = match credentials {
            Some((base_url, key)) => {
                match self.models_for(harness_kind, &base_url, &key, allow_blocking_fetch) {
                    Some(models) if !models.is_empty() => (models, false),
                    // A reachable gateway serving nothing, an unreachable one, or a
                    // caller that may not block: all take the floor, and all are
                    // honest about it.
                    _ => (policy.seed_models.clone(), true),
                }
            }
            // No gateway source at all. There is nothing to fetch and nothing to be
            // wrong about — the seed list is simply the catalog's own answer, so this
            // is NOT a fallback worth warning on.
            None => (policy.seed_models.clone(), false),
        };

        (
            GatewayModelPlan {
                default_model,
                native_default_model,
                small_fast_model,
                models: raw_models,
            },
            used_seed_floor,
        )
    }

    /// The memoized list for (harness, base URL), fetching when the caller allows it
    /// and the memo is absent or past its TTL. `None` means "no usable list" and the
    /// caller takes the floor.
    fn models_for(
        &self,
        harness_kind: &str,
        base_url: &str,
        key: &str,
        allow_blocking_fetch: bool,
    ) -> Option<Vec<String>> {
        let memo_key = (harness_kind.to_string(), base_url.to_string());
        {
            let memo = self.memo.lock().expect("gateway plan memo poisoned");
            if let Some(entry) = memo.get(&memo_key) {
                if entry.fetched_at.elapsed() < self.fetch_ttl {
                    return Some(entry.models.clone());
                }
            }
        }
        if !allow_blocking_fetch {
            // A launch never waits on the network. An EXPIRED memo is still better
            // than the floor here: it was really observed from this proxy, where the
            // floor is a curated guess.
            let memo = self.memo.lock().expect("gateway plan memo poisoned");
            return memo.get(&memo_key).map(|entry| entry.models.clone());
        }

        let fetched = block_on_fetch(self.fetcher.clone(), base_url, key);
        match fetched {
            Ok(models) if !models.is_empty() => {
                let mut memo = self.memo.lock().expect("gateway plan memo poisoned");
                memo.insert(
                    memo_key,
                    MemoEntry {
                        models: models.clone(),
                        fetched_at: Instant::now(),
                    },
                );
                Some(models)
            }
            Ok(_) => {
                tracing::warn!(
                    harness = harness_kind,
                    "gateway served an empty model list; using the seed floor"
                );
                None
            }
            Err(error) => {
                tracing::warn!(
                    harness = harness_kind,
                    %error,
                    "gateway model fetch failed; using the seed floor"
                );
                None
            }
        }
    }

    /// The catalog's gateway policy plus the gateway/native default models.
    fn policy_and_default(
        &self,
        harness_kind: &str,
    ) -> (AgentCatalogGatewayPolicy, Option<String>, Option<String>) {
        let active = self.catalog_sync.active();
        let Some(agent) = active
            .document
            .agents
            .iter()
            .find(|agent| agent.kind == harness_kind)
        else {
            return (AgentCatalogGatewayPolicy::default(), None, None);
        };
        let policy = agent.session.gateway_policy.clone().unwrap_or_default();
        let default_model = agent.session.defaults.get(GATEWAY_CONTEXT_ID).cloned();
        let native_default_model = native_default_model(&agent.session.defaults);
        (policy, default_model, native_default_model)
    }

    /// The gateway (base_url, key) for a harness from the current state file, if a
    /// gateway source exists. Absent harness and present-but-empty are the same
    /// answer: nothing to plan a fetch against. Fail-closed refusal is the launch
    /// path's job, not the planner's.
    fn gateway_credentials(&self, harness_kind: &str) -> Option<(String, String)> {
        let state = load_state_file(&self.runtime_home).ok().flatten()?;
        let source = state
            .sources_for(harness_kind)
            .unwrap_or_default()
            .iter()
            .find(|source| source.kind == SOURCE_KIND_GATEWAY)?;
        let base_url = source
            .base_url
            .clone()
            .filter(|url| !url.trim().is_empty())?;
        let key = source.key.clone().filter(|key| !key.trim().is_empty())?;
        Some((base_url, key))
    }
}

/// Drive one async fetch to completion from a sync frame.
///
/// The fetch gets its own thread with its own current-thread runtime rather than a
/// `Handle::current().block_on` in place, and that is a correctness requirement
/// rather than tidiness: `block_on` panics when called from inside a runtime
/// worker, and this code is reached from a `spawn_blocking` thread — which belongs
/// to a runtime. The fetch's own 10s timeout bounds the join.
fn block_on_fetch(
    fetcher: Arc<dyn GatewayModelFetch>,
    base_url: &str,
    key: &str,
) -> Result<Vec<String>, String> {
    let base_url = base_url.to_string();
    let key = key.to_string();
    std::thread::scope(|scope| {
        scope
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|error| format!("failed to build the fetch runtime: {error}"))?;
                runtime.block_on(fetcher.fetch(&base_url, &key))
            })
            .join()
            .unwrap_or_else(|_| Err("the gateway model fetch thread panicked".to_string()))
    })
}

impl GatewayModelResolve for GatewayModelPlanner {
    /// The LAUNCH path: memo only, never a fetch. See the module note.
    fn resolve_gateway_models(&self, harness_kind: &str, revision: i64) -> GatewayModelPlan {
        self.resolve(harness_kind, revision, false).0
    }

    fn invalidate_gateway_plan(&self, harness_kind: &str) {
        self.invalidate(harness_kind);
    }

    /// The PROBE path: may fetch, and reports when it fell back to the floor.
    fn resolve_gateway_models_blocking(
        &self,
        harness_kind: &str,
        revision: i64,
    ) -> (GatewayModelPlan, bool) {
        self.resolve(harness_kind, revision, true)
    }
}
