//! The planner's memo, its TTL, its floor, and the launch/probe asymmetry.
//!
//! Real filesystem for `state.json` (the credentials ARE state) and a counting
//! fetcher for `GET /v1/models`, so every property is exercised without a network.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::gateway_plan::{
    GatewayModelFetch, GatewayModelPlanner, DEFAULT_PLAN_FETCH_TTL, SEED_FALLBACK_WARNING,
};
use super::sync::CatalogSyncService;
use crate::domains::agents::route_auth::GatewayModelResolve;

/// A self-cleaning temp runtime home carrying one gateway `state.json`.
struct TempHome {
    path: std::path::PathBuf,
}

impl TempHome {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir()
            .join(format!("anyharness-gateway-plan-{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp home");
        Self { path }
    }

    fn write_gateway_state(&self, harness_kind: &str, base_url: &str, key: &str) {
        let state = serde_json::json!({
            "version": 2,
            "revision": 3,
            "harnesses": [{
                "harness_kind": harness_kind,
                "sources": [{
                    "kind": "gateway",
                    "base_url": base_url,
                    "key": key,
                }],
            }],
        });
        let path = crate::domains::agents::route_auth::state::state_file_path(&self.path);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("create agent-auth");
        std::fs::write(&path, serde_json::to_vec_pretty(&state).expect("serialize"))
            .expect("write state");
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Counts calls and records the (base_url, key) it was asked with, so both the memo
/// and the credential plumbing are assertable.
struct CountingFetch {
    models: Mutex<Vec<String>>,
    calls: AtomicUsize,
    seen: Mutex<Vec<(String, String)>>,
    fails: Mutex<bool>,
}

impl CountingFetch {
    fn new(models: &[&str]) -> Self {
        Self {
            models: Mutex::new(models.iter().map(|id| id.to_string()).collect()),
            calls: AtomicUsize::new(0),
            seen: Mutex::new(Vec::new()),
            fails: Mutex::new(false),
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

#[async_trait::async_trait]
impl GatewayModelFetch for CountingFetch {
    async fn fetch(&self, base_url: &str, key: &str) -> Result<Vec<String>, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.seen
            .lock()
            .expect("seen poisoned")
            .push((base_url.to_string(), key.to_string()));
        if *self.fails.lock().expect("flag poisoned") {
            return Err("gateway unreachable".to_string());
        }
        Ok(self.models.lock().expect("models poisoned").clone())
    }
}

fn build_planner(
    home: &TempHome,
    fetcher: Arc<CountingFetch>,
    ttl: Duration,
) -> GatewayModelPlanner {
    GatewayModelPlanner::with_parts(
        Arc::new(CatalogSyncService::from_bundled()),
        home.path.clone(),
        fetcher,
        ttl,
    )
}

/// The headline property: a probe is planned from the LIVE list, not from the seed
/// ids it would otherwise write into `opencode.json` and then "observe".
///
/// The tautology this prevents is why the fetch survived the snapshot cutover at all:
/// `render_opencode_gateway` writes the plan's ids into the config, and the probe reads
/// back whatever that config declared. With the floor as the plan, a model added on the
/// gateway is undiscoverable forever.
#[test]
fn a_probe_plan_carries_the_live_gateway_list_not_the_seed_floor() {
    let home = TempHome::new("live-list");
    home.write_gateway_state("opencode", "https://gw.example", "sk-virtual");
    let fetcher = Arc::new(CountingFetch::new(&[
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "gpt-5.2",
        "a-model-the-catalog-has-never-heard-of",
    ]));
    let planner = build_planner(&home, fetcher.clone(), DEFAULT_PLAN_FETCH_TTL);

    let (plan, used_floor) = planner.resolve_gateway_models_blocking("opencode", 3);

    assert!(!used_floor, "a successful fetch is not a floor");
    assert_eq!(
        plan.models,
        vec![
            "claude-sonnet-4-5",
            "claude-haiku-4-5",
            "gpt-5.2",
            "a-model-the-catalog-has-never-heard-of"
        ],
        "opencode declares no gatewayPolicy.providers, so nothing is filtered — \
         including an id the catalog does not know, which is the whole point"
    );
    // The fetch really was handed this harness's own gateway credentials.
    assert_eq!(
        fetcher.seen.lock().expect("seen").as_slice(),
        &[("https://gw.example".to_string(), "sk-virtual".to_string())]
    );
}

/// The memo: one fetch serves a burst of resolves, and it expires.
///
/// The burst is the real shape — a startup pass pokes every context of a harness, and
/// each attempt resolves a plan. Without the memo that is one `GET /v1/models` per
/// context per pass.
#[test]
fn the_plan_is_memoized_until_its_ttl_expires() {
    let home = TempHome::new("memo");
    home.write_gateway_state("opencode", "https://gw.example", "sk-virtual");
    let fetcher = Arc::new(CountingFetch::new(&["m-1", "m-2"]));
    let planner = build_planner(&home, fetcher.clone(), Duration::from_secs(300));

    for _ in 0..5 {
        let (plan, used_floor) = planner.resolve_gateway_models_blocking("opencode", 3);
        assert_eq!(plan.models, vec!["m-1", "m-2"]);
        assert!(!used_floor);
    }
    assert_eq!(fetcher.calls(), 1, "five resolves, one fetch");

    // A zero TTL is the expiry boundary made observable without sleeping: every
    // resolve is immediately past it.
    let expiring = build_planner(&home, fetcher.clone(), Duration::ZERO);
    expiring.resolve_gateway_models_blocking("opencode", 3);
    expiring.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(
        fetcher.calls(),
        3,
        "an expired memo must re-ask rather than serve a stale list forever"
    );
}

/// A forced refresh drops the memo, so pressing Refresh after adding a model on the
/// gateway genuinely re-asks. Other harnesses' memos survive: the user asked about one.
#[test]
fn invalidation_refetches_the_named_harness_only() {
    let home = TempHome::new("invalidate");
    let state = serde_json::json!({
        "version": 2,
        "revision": 3,
        "harnesses": [
            { "harness_kind": "opencode", "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "sk-a" }] },
            { "harness_kind": "grok", "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "sk-b" }] },
        ],
    });
    let path = crate::domains::agents::route_auth::state::state_file_path(&home.path);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("create agent-auth");
    std::fs::write(&path, serde_json::to_vec_pretty(&state).expect("serialize")).expect("write");

    let fetcher = Arc::new(CountingFetch::new(&["grok-4", "grok-4-fast"]));
    let planner = build_planner(&home, fetcher.clone(), Duration::from_secs(300));

    planner.resolve_gateway_models_blocking("opencode", 3);
    planner.resolve_gateway_models_blocking("grok", 3);
    assert_eq!(fetcher.calls(), 2, "one fetch per harness");

    planner.invalidate_gateway_plan("opencode");
    planner.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(fetcher.calls(), 3, "the invalidated harness re-asks");
    planner.resolve_gateway_models_blocking("grok", 3);
    assert_eq!(
        fetcher.calls(),
        3,
        "an unrelated harness's memo must survive someone else's Refresh"
    );
}

/// The seed list is a WARNED FLOOR, not a silent substitute.
///
/// Both halves matter. The list must be non-empty or `render_opencode_gateway`
/// hard-fails `SelectionIncomplete` and the launch dies; and the flag must be set or a
/// tautological observation gets recorded as the gateway's model set. An empty 200
/// response is treated the same as an error for exactly the same reason.
#[test]
fn a_failed_or_empty_fetch_falls_back_to_a_warned_seed_floor() {
    let home = TempHome::new("floor");
    home.write_gateway_state("opencode", "https://gw.example", "sk-virtual");

    let failing = Arc::new(CountingFetch::new(&[]));
    *failing.fails.lock().expect("flag") = true;
    let planner_failing = build_planner(&home, failing.clone(), DEFAULT_PLAN_FETCH_TTL);
    let (plan, used_floor) = planner_failing.resolve_gateway_models_blocking("opencode", 3);
    assert!(used_floor, "an unreachable gateway must report the floor");
    assert!(
        !plan.models.is_empty(),
        "the floor must keep the launch renderable: an empty models map hard-fails \
         the opencode gateway recipe"
    );
    // The floor is the catalog's own seed list.
    let seeds = super::bundled::bundled_agent_catalog_document()
        .agents
        .iter()
        .find(|agent| agent.kind == "opencode")
        .and_then(|agent| agent.session.gateway_policy.clone())
        .map(|policy| policy.seed_models)
        .expect("opencode seed models");
    assert_eq!(plan.models, seeds);

    // A reachable gateway serving nothing is the same answer, and for the same
    // reason: there is nothing to render and nothing was discovered.
    let empty = Arc::new(CountingFetch::new(&[]));
    let planner_empty = build_planner(&home, empty, DEFAULT_PLAN_FETCH_TTL);
    let (_, used_floor) = planner_empty.resolve_gateway_models_blocking("opencode", 3);
    assert!(used_floor, "an empty 200 is not a discovery either");

    // A failed fetch is never memoized: the next attempt must be free to succeed.
    planner_failing.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(
        failing.calls(),
        2,
        "a failure must not be cached as if it were an answer"
    );
}

/// A harness with NO gateway source at all takes the seed list WITHOUT the warning.
///
/// There is nothing to fetch and nothing to be wrong about — the catalog's list is
/// simply the answer. Warning here would put a "fell back" note on every entry of a
/// machine that never enrolled, which is noise a UI would have to learn to ignore.
#[test]
fn a_harness_with_no_gateway_source_is_not_a_fallback() {
    let home = TempHome::new("no-gateway");
    // A state file that mentions the harness with no sources at all.
    let state = serde_json::json!({
        "version": 2,
        "revision": 1,
        "harnesses": [{ "harness_kind": "opencode", "sources": [] }],
    });
    let path = crate::domains::agents::route_auth::state::state_file_path(&home.path);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("create agent-auth");
    std::fs::write(&path, serde_json::to_vec_pretty(&state).expect("serialize")).expect("write");

    let fetcher = Arc::new(CountingFetch::new(&["never-asked"]));
    let planner = build_planner(&home, fetcher.clone(), DEFAULT_PLAN_FETCH_TTL);

    let (plan, used_floor) = planner.resolve_gateway_models_blocking("opencode", 1);
    assert_eq!(fetcher.calls(), 0, "no credentials, no fetch");
    assert!(!used_floor);
    assert!(!plan.models.is_empty());
}

/// **A launch never waits on the network.** The launch path reads the memo and takes
/// the floor on a miss; only the probe path may fetch.
///
/// This is the property `probe_gateway_models`' own 10s timeout bounds but cannot
/// provide: a launch is a synchronous render on the spawn path, so a fetch there is a
/// stall the user watches. The second half is the compensation — once a probe has
/// warmed the memo, the launch gets the live list for free.
#[test]
fn the_launch_path_reads_the_memo_and_never_fetches() {
    let home = TempHome::new("launch-path");
    home.write_gateway_state("opencode", "https://gw.example", "sk-virtual");
    let fetcher = Arc::new(CountingFetch::new(&["live-1", "live-2"]));
    let planner = build_planner(&home, fetcher.clone(), Duration::from_secs(300));

    // Cold memo: the launch takes the floor rather than blocking.
    let cold = planner.resolve_gateway_models("opencode", 3);
    assert_eq!(fetcher.calls(), 0, "a launch must not fetch");
    assert!(!cold.models.is_empty(), "and must still be renderable");
    assert!(!cold.models.contains(&"live-1".to_string()));

    // A probe warms it; the next launch gets the live list, still without fetching.
    planner.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(fetcher.calls(), 1);
    let warm = planner.resolve_gateway_models("opencode", 3);
    assert_eq!(warm.models, vec!["live-1", "live-2"]);
    assert_eq!(fetcher.calls(), 1, "the launch read the memo, it did not refresh it");
}

/// An EXPIRED memo still beats the floor on the launch path.
///
/// It was really observed from this proxy, where the floor is a curated guess that can
/// only ever be a subset. The launch may not refresh it, so serving the last real
/// observation is strictly the better of the two answers available without blocking.
#[test]
fn an_expired_memo_still_beats_the_floor_for_a_launch() {
    let home = TempHome::new("expired-memo");
    home.write_gateway_state("opencode", "https://gw.example", "sk-virtual");
    let fetcher = Arc::new(CountingFetch::new(&["live-1", "live-2"]));
    let planner = build_planner(&home, fetcher.clone(), Duration::ZERO);

    planner.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(fetcher.calls(), 1);

    // TTL zero: the memo is expired the instant it is written.
    let plan = planner.resolve_gateway_models("opencode", 3);
    assert_eq!(
        plan.models,
        vec!["live-1", "live-2"],
        "a stale real observation beats a curated guess when we may not block"
    );
    assert_eq!(fetcher.calls(), 1);
}

/// `gatewayPolicy.providers` filtering is preserved: claude's gateway plan keeps only
/// anthropic-family ids even when the proxy serves more.
#[test]
fn provider_filtering_is_preserved_for_a_scoped_harness() {
    let home = TempHome::new("providers");
    home.write_gateway_state("claude", "https://gw.example", "sk-virtual");
    let fetcher = Arc::new(CountingFetch::new(&[
        "claude-sonnet-4-5",
        "gpt-5.2",
        "grok-4",
    ]));
    let planner = build_planner(&home, fetcher, DEFAULT_PLAN_FETCH_TTL);

    let (plan, used_floor) = planner.resolve_gateway_models_blocking("claude", 3);
    assert!(!used_floor);
    assert_eq!(
        plan.models,
        vec!["claude-sonnet-4-5"],
        "claude declares providers: [anthropic], so the proxy's other families drop"
    );
    // And the curated pins still ride along from the catalog.
    assert!(plan.small_fast_model.is_some(), "claude's small_fast role pin");
    assert!(plan.default_model.is_some(), "the gateway default model");
}

/// The seed-floor warning string is the one the entry records, asserted here so the
/// planner and the entry projection cannot drift apart silently.
#[test]
fn the_seed_fallback_warning_is_a_shared_constant() {
    assert_eq!(
        SEED_FALLBACK_WARNING,
        "gateway model plan fell back to seed models"
    );
}
