use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::types::{PullRequestState, PullRequestSummary};
use super::*;

fn test_config() -> PrStatusCacheConfig {
    PrStatusCacheConfig {
        min_refresh: Duration::from_millis(200),
        refresh_floor: Duration::from_millis(50),
        not_installed_ttl: Duration::from_millis(300),
        auth_required_ttl: Duration::from_millis(300),
        failure_backoff: Duration::from_millis(300),
    }
}

fn summary(branch: &str, number: u64) -> PullRequestSummary {
    PullRequestSummary {
        number,
        title: format!("PR for {branch}"),
        url: format!("https://github.com/acme/widgets/pull/{number}"),
        state: PullRequestState::Open,
        draft: false,
        head_branch: branch.to_string(),
        base_branch: "main".to_string(),
        checks: None,
        review_decision: None,
    }
}

/// Scripted fetcher: counts calls, optionally fails, optionally blocks
/// until released (for dedupe/concurrency tests).
struct FakeFetcher {
    calls: AtomicUsize,
    fail_with: Mutex<Option<fn() -> GhError>>,
    concurrent: AtomicUsize,
    max_concurrent: AtomicUsize,
    delay: Duration,
}

impl FakeFetcher {
    fn new() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            fail_with: Mutex::new(None),
            concurrent: AtomicUsize::new(0),
            max_concurrent: AtomicUsize::new(0),
            delay: Duration::ZERO,
        }
    }

    fn with_delay(delay: Duration) -> Self {
        Self {
            delay,
            ..Self::new()
        }
    }

    fn set_failure(&self, failure: Option<fn() -> GhError>) {
        *self.fail_with.lock().expect("fail_with poisoned") = failure;
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl BranchPrFetcher for FakeFetcher {
    fn resolve_repo(&self, _repo_root: &Path) -> Result<GithubRepo, GhError> {
        Ok(GithubRepo {
            owner: "acme".to_string(),
            name: "widgets".to_string(),
        })
    }

    fn fetch_branch_prs(
        &self,
        _repo_root: &Path,
        _repo: &GithubRepo,
        branches: &[String],
    ) -> Result<Vec<BranchPullRequestStatus>, GhError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let live = self.concurrent.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_concurrent.fetch_max(live, Ordering::SeqCst);
        if !self.delay.is_zero() {
            std::thread::sleep(self.delay);
        }
        self.concurrent.fetch_sub(1, Ordering::SeqCst);

        if let Some(make_error) = *self.fail_with.lock().expect("fail_with poisoned") {
            return Err(make_error());
        }
        Ok(branches
            .iter()
            .map(|branch| BranchPullRequestStatus {
                head_branch: branch.clone(),
                pull_request: Some(summary(branch, 42)),
            })
            .collect())
    }
}

fn cache_with(fetcher: Arc<FakeFetcher>) -> PrStatusCache {
    PrStatusCache::with_fetcher(fetcher, test_config())
}

fn branches(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| name.to_string()).collect()
}

#[tokio::test]
async fn cold_cache_fetches_and_throttled_calls_reuse_it() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    let first = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect("first fetch");
    assert_eq!(first.entries.len(), 1);
    assert_eq!(first.entries[0].head_branch, "feat-x");
    assert!(!first.fetched_at.is_empty());
    assert_eq!(fetcher.calls(), 1);

    // Inside the throttle window: cached, no new probe.
    let second = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect("throttled read");
    assert_eq!(second.fetched_at, first.fetched_at);
    assert_eq!(fetcher.calls(), 1);
}

#[tokio::test]
async fn refresh_has_a_floor_then_refetches() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect("first fetch");
    assert_eq!(fetcher.calls(), 1);

    // refresh=1 inside the 50ms floor: still cached.
    cache
        .get_statuses("/repo/a", branches(&["feat-x"]), true)
        .await
        .expect("floored refresh");
    assert_eq!(fetcher.calls(), 1);

    // refresh=1 past the floor but inside min_refresh: refetches.
    tokio::time::sleep(Duration::from_millis(80)).await;
    cache
        .get_statuses("/repo/a", branches(&["feat-x"]), true)
        .await
        .expect("refresh past floor");
    assert_eq!(fetcher.calls(), 2);

    // refresh=0 at the same age: throttled.
    cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect("throttled read");
    assert_eq!(fetcher.calls(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_cold_callers_dedupe_onto_one_fetch() {
    let fetcher = Arc::new(FakeFetcher::with_delay(Duration::from_millis(50)));
    let cache = Arc::new(cache_with(fetcher.clone()));

    let mut handles = Vec::new();
    for _ in 0..4 {
        let cache = cache.clone();
        handles.push(tokio::spawn(async move {
            cache
                .get_statuses("/repo/a", branches(&["feat-x"]), false)
                .await
                .expect("deduped fetch")
        }));
    }
    let mut fetched_ats = Vec::new();
    for handle in handles {
        fetched_ats.push(handle.await.expect("join").fetched_at);
    }

    assert_eq!(fetcher.calls(), 1, "cold callers must share one probe");
    assert!(fetched_ats.windows(2).all(|pair| pair[0] == pair[1]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn global_semaphore_caps_concurrent_probes_at_two() {
    let fetcher = Arc::new(FakeFetcher::with_delay(Duration::from_millis(40)));
    let cache = Arc::new(cache_with(fetcher.clone()));

    let mut handles = Vec::new();
    for index in 0..5 {
        let cache = cache.clone();
        handles.push(tokio::spawn(async move {
            cache
                .get_statuses(&format!("/repo/{index}"), branches(&["feat-x"]), false)
                .await
                .expect("fetch")
        }));
    }
    for handle in handles {
        handle.await.expect("join");
    }

    assert_eq!(fetcher.calls(), 5);
    assert!(
        fetcher.max_concurrent.load(Ordering::SeqCst) <= 2,
        "gh probes must be capped at 2, saw {}",
        fetcher.max_concurrent.load(Ordering::SeqCst)
    );
}

#[tokio::test]
async fn transient_failure_serves_stale_with_original_fetched_at() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    let good = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect("first fetch");

    fetcher.set_failure(Some(|| GhError::CommandFailed("rate limited".into())));
    tokio::time::sleep(Duration::from_millis(80)).await;

    let stale = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), true)
        .await
        .expect("stale served on transient failure");
    assert_eq!(stale.fetched_at, good.fetched_at);
    assert_eq!(stale.entries.len(), 1);
    assert_eq!(fetcher.calls(), 2);

    // Inside the failure backoff: stale keeps being served, no probe.
    let stale_again = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), true)
        .await
        .expect("stale from negative cache");
    assert_eq!(stale_again.fetched_at, good.fetched_at);
    assert_eq!(fetcher.calls(), 2);
}

#[tokio::test]
async fn auth_failure_surfaces_even_with_stale_data() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect("first fetch");

    fetcher.set_failure(Some(|| {
        GhError::AuthRequired("please run gh auth login".into())
    }));
    tokio::time::sleep(Duration::from_millis(80)).await;

    let error = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), true)
        .await
        .expect_err("auth failures must surface");
    assert!(matches!(error, HostingServiceError::GhAuthRequired(_)));

    // Negative-cached: repeated calls do not spawn more probes.
    let error = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect_err("auth failure from negative cache");
    assert!(matches!(error, HostingServiceError::GhAuthRequired(_)));
    assert_eq!(fetcher.calls(), 2);
}

#[tokio::test]
async fn not_installed_is_negative_cached_but_reprobed_on_refresh() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    fetcher.set_failure(Some(|| GhError::NotInstalled));
    let error = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect_err("not installed");
    assert!(matches!(error, HostingServiceError::GhNotInstalled));
    assert_eq!(fetcher.calls(), 1);

    // refresh=0 inside the TTL: served from the negative cache.
    let error = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect_err("negative cached");
    assert!(matches!(error, HostingServiceError::GhNotInstalled));
    assert_eq!(fetcher.calls(), 1);

    // refresh=1: re-probes (user may have installed gh mid-session).
    fetcher.set_failure(None);
    let recovered = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), true)
        .await
        .expect("recovered after install");
    assert_eq!(recovered.entries.len(), 1);
    assert_eq!(fetcher.calls(), 2);
}

#[tokio::test]
async fn unsupported_remote_surfaces_and_backs_off() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    fetcher.set_failure(Some(|| {
        GhError::UnsupportedRemote("origin remote is not a github.com repository".into())
    }));
    let error = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect_err("unsupported remote");
    assert!(matches!(error, HostingServiceError::RemoteUnsupported(_)));
    assert_eq!(fetcher.calls(), 1);

    let error = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), true)
        .await
        .expect_err("backed off");
    assert!(matches!(error, HostingServiceError::RemoteUnsupported(_)));
    assert_eq!(fetcher.calls(), 1);
}

#[tokio::test]
async fn empty_branch_set_short_circuits_without_probing() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    let result = cache
        .get_statuses("/repo/a", Vec::new(), true)
        .await
        .expect("empty branches");
    assert!(result.entries.is_empty());
    assert_eq!(fetcher.calls(), 0);
}

#[tokio::test]
async fn upsert_publishes_into_warm_cache_inside_throttle_window() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    cache
        .get_statuses("/repo/a", branches(&["feat-x", "feat-y"]), false)
        .await
        .expect("first fetch");
    assert_eq!(fetcher.calls(), 1);

    cache.upsert_branch_pr("/repo/a", summary("feat-y", 99));

    let served = cache
        .get_statuses("/repo/a", branches(&["feat-x", "feat-y"]), true)
        .await
        .expect("served from upserted cache");
    assert_eq!(fetcher.calls(), 1, "upsert must be served without a probe");
    let entry = served
        .entries
        .iter()
        .find(|entry| entry.head_branch == "feat-y")
        .expect("feat-y entry");
    assert_eq!(entry.pull_request.as_ref().expect("upserted PR").number, 99);
}

#[tokio::test]
async fn upsert_into_cold_cache_creates_the_entry() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    cache.upsert_branch_pr("/repo/a", summary("feat-z", 7));

    let served = cache
        .get_statuses("/repo/a", branches(&["feat-z"]), false)
        .await
        .expect("served from upsert");
    assert_eq!(fetcher.calls(), 0);
    assert_eq!(served.entries.len(), 1);
    assert_eq!(
        served.entries[0]
            .pull_request
            .as_ref()
            .expect("upserted PR")
            .number,
        7
    );
}

#[tokio::test]
async fn upsert_clears_negative_cache() {
    let fetcher = Arc::new(FakeFetcher::new());
    let cache = cache_with(fetcher.clone());

    fetcher.set_failure(Some(|| GhError::AuthRequired("expired".into())));
    cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect_err("auth failure");

    // Publish succeeded out-of-band: the failure is stale.
    cache.upsert_branch_pr("/repo/a", summary("feat-x", 12));
    let served = cache
        .get_statuses("/repo/a", branches(&["feat-x"]), false)
        .await
        .expect("served after upsert cleared the failure");
    assert_eq!(
        served.entries[0]
            .pull_request
            .as_ref()
            .expect("upserted PR")
            .number,
        12
    );
}
