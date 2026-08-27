//! The planner's memo, its TTL, and the launch/probe asymmetry.
//!
//! Real filesystem for `state.json` (the credentials ARE state) and a counting
//! fetcher for `GET /v1/models`, so every property is exercised without a network.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::gateway_plan::{GatewayModelFetch, GatewayModelPlanner, DEFAULT_PLAN_FETCH_TTL};
use super::GatewayModelResolve;

/// A self-cleaning temp runtime home carrying one gateway `state.json`.
struct TempHome {
    path: std::path::PathBuf,
}

impl TempHome {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-gateway-plan-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
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
        let path = super::state::state_file_path(&self.path);
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
    GatewayModelPlanner::with_parts(home.path.clone(), fetcher, ttl)
}

/// The headline property: a probe is planned from the exact live gateway list.
///
/// `render_opencode_gateway` writes the plan's ids into the config, and the probe
/// reads back whatever that config declared. The independent live fetch prevents
/// route materialization from manufacturing the observation it later records.
#[test]
fn a_probe_plan_carries_the_exact_live_gateway_list() {
    let home = TempHome::new("live-list");
    home.write_gateway_state("opencode", "https://gw.example", "sk-virtual");
    let fetcher = Arc::new(CountingFetch::new(&[
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "gpt-5.2",
        "a-model-the-catalog-has-never-heard-of",
    ]));
    let planner = build_planner(&home, fetcher.clone(), DEFAULT_PLAN_FETCH_TTL);

    let plan = planner.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(
        plan.models,
        vec![
            "claude-sonnet-4-5",
            "claude-haiku-4-5",
            "gpt-5.2",
            "a-model-the-catalog-has-never-heard-of"
        ],
        "the full live list passes through untouched, including an id the \
         catalog does not know, which is the whole point"
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
        let plan = planner.resolve_gateway_models_blocking("opencode", 3);
        assert_eq!(plan.models, vec!["m-1", "m-2"]);
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
    let path = super::state::state_file_path(&home.path);
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

/// A failed or empty fetch produces no executable model rows and is never cached.
#[test]
fn a_failed_or_empty_fetch_produces_no_model_plan() {
    let home = TempHome::new("fetch-failure");
    home.write_gateway_state("opencode", "https://gw.example", "sk-virtual");

    let failing = Arc::new(CountingFetch::new(&[]));
    *failing.fails.lock().expect("flag") = true;
    let planner_failing = build_planner(&home, failing.clone(), DEFAULT_PLAN_FETCH_TTL);
    let plan = planner_failing.resolve_gateway_models_blocking("opencode", 3);
    assert!(plan.models.is_empty());

    // A reachable gateway serving nothing is the same answer, and for the same
    // reason: there is nothing to render and nothing was discovered.
    let empty = Arc::new(CountingFetch::new(&[]));
    let planner_empty = build_planner(&home, empty, DEFAULT_PLAN_FETCH_TTL);
    let plan = planner_empty.resolve_gateway_models_blocking("opencode", 3);
    assert!(plan.models.is_empty());

    // A failed fetch is never memoized: the next attempt must be free to succeed.
    planner_failing.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(
        failing.calls(),
        2,
        "a failure must not be cached as if it were an answer"
    );
}

/// A harness with no gateway source has no gateway model plan.
#[test]
fn a_harness_with_no_gateway_source_has_no_model_plan() {
    let home = TempHome::new("no-gateway");
    // A state file that mentions the harness with no sources at all.
    let state = serde_json::json!({
        "version": 2,
        "revision": 1,
        "harnesses": [{ "harness_kind": "opencode", "sources": [] }],
    });
    let path = super::state::state_file_path(&home.path);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("create agent-auth");
    std::fs::write(&path, serde_json::to_vec_pretty(&state).expect("serialize")).expect("write");

    let fetcher = Arc::new(CountingFetch::new(&["never-asked"]));
    let planner = build_planner(&home, fetcher.clone(), DEFAULT_PLAN_FETCH_TTL);

    let plan = planner.resolve_gateway_models_blocking("opencode", 1);
    assert_eq!(fetcher.calls(), 0, "no credentials, no fetch");
    assert!(plan.models.is_empty());
}

/// **A launch never waits on the network.** The launch path reads only the memo;
/// only the probe path may fetch.
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

    // Cold memo: the launch has no plan rather than blocking or seeding.
    let cold = planner.resolve_gateway_models("opencode", 3);
    assert_eq!(fetcher.calls(), 0, "a launch must not fetch");
    assert!(cold.models.is_empty());

    // A probe warms it; the next launch gets the live list, still without fetching.
    planner.resolve_gateway_models_blocking("opencode", 3);
    assert_eq!(fetcher.calls(), 1);
    let warm = planner.resolve_gateway_models("opencode", 3);
    assert_eq!(warm.models, vec!["live-1", "live-2"]);
    assert_eq!(
        fetcher.calls(),
        1,
        "the launch read the memo, it did not refresh it"
    );
}

/// An expired memo remains exact target evidence on the launch path.
#[test]
fn an_expired_memo_remains_available_to_a_nonblocking_launch() {
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
        "a stale exact observation remains usable when launch may not block"
    );
    assert_eq!(fetcher.calls(), 1);
}

/// The planner passes every live row through without provider filtering.
#[test]
fn a_claude_plan_preserves_the_live_list_without_static_roles() {
    let home = TempHome::new("claude-roles");
    home.write_gateway_state("claude", "https://gw.example", "sk-virtual");
    let fetcher = Arc::new(CountingFetch::new(&[
        "claude-sonnet-4-5",
        "gpt-5.2",
        "grok-4",
    ]));
    let planner = build_planner(&home, fetcher, DEFAULT_PLAN_FETCH_TTL);

    let plan = planner.resolve_gateway_models_blocking("claude", 3);
    assert_eq!(
        plan.models,
        vec!["claude-sonnet-4-5", "gpt-5.2", "grok-4"],
        "no client-side provider filter narrows the live list anymore"
    );
}
