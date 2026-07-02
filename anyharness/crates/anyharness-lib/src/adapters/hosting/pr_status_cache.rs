//! Per-repo-root cache for branch-scoped pull-request statuses.
//!
//! Semantics (see the workspace PR-status design):
//! - keyed by canonical repo-root path;
//! - min-refresh throttle of 60s (`refresh=0`), honored `refresh=1` with a
//!   10s floor;
//! - cold cache: the first request per key awaits the in-flight fetch (which
//!   runs in `spawn_blocking`); concurrent cold callers await the same fetch
//!   via a per-key gate — an empty-entries 200 is never fabricated before the
//!   first real fetch completes. Warm callers inside the throttle window get
//!   the cached value immediately;
//! - serve-stale: the last-good result is retained on error with its
//!   original `fetched_at`; transient command failures serve it, while
//!   actionable availability states (gh missing, auth required, unsupported
//!   remote) surface as errors so clients can show them;
//! - negative caching: `NotInstalled` has a 10 min TTL (re-probed on
//!   `refresh=1`), `AuthRequired` 60s, `CommandFailed`/`UnsupportedRemote`
//!   15 min backoff;
//! - a global semaphore caps concurrent gh spawns at 2 across all keys;
//! - `upsert_branch_pr` lets the create-PR path publish the fresh PR into
//!   the cache so publish is served inside the throttle window and never
//!   flaps back to "no PR".

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::github_cli::{self, GhError, GithubRepo};
use super::types::{
    BranchPullRequestStatus, HostingServiceError, PullRequestSummary, RepoPullRequestStatusesResult,
};

/// Max concurrent gh spawns across all repo roots.
const MAX_CONCURRENT_GH_PROBES: usize = 2;

/// Source of resolved repos and branch PR statuses. Production uses the
/// GitHub CLI; tests inject fakes so throttle/dedupe logic never touches the
/// network.
pub trait BranchPrFetcher: Send + Sync {
    fn resolve_repo(&self, repo_root: &Path) -> Result<GithubRepo, GhError>;
    fn fetch_branch_prs(
        &self,
        repo_root: &Path,
        repo: &GithubRepo,
        branches: &[String],
    ) -> Result<Vec<BranchPullRequestStatus>, GhError>;
}

struct GhCliFetcher;

impl BranchPrFetcher for GhCliFetcher {
    fn resolve_repo(&self, repo_root: &Path) -> Result<GithubRepo, GhError> {
        github_cli::resolve_github_repo(repo_root)
    }

    fn fetch_branch_prs(
        &self,
        repo_root: &Path,
        repo: &GithubRepo,
        branches: &[String],
    ) -> Result<Vec<BranchPullRequestStatus>, GhError> {
        github_cli::fetch_branch_prs(repo_root, repo, branches)
    }
}

#[derive(Debug, Clone)]
pub struct PrStatusCacheConfig {
    /// Throttle window for `refresh=0` requests.
    pub min_refresh: Duration,
    /// Throttle floor for `refresh=1` requests.
    pub refresh_floor: Duration,
    /// Negative-cache TTL for "gh not installed" (user may install gh
    /// mid-session; also re-probed on `refresh=1`).
    pub not_installed_ttl: Duration,
    /// Negative-cache TTL for "gh auth required".
    pub auth_required_ttl: Duration,
    /// Backoff for command failures and unsupported remotes.
    pub failure_backoff: Duration,
}

impl Default for PrStatusCacheConfig {
    fn default() -> Self {
        Self {
            min_refresh: Duration::from_secs(60),
            refresh_floor: Duration::from_secs(10),
            not_installed_ttl: Duration::from_secs(600),
            auth_required_ttl: Duration::from_secs(60),
            failure_backoff: Duration::from_secs(900),
        }
    }
}

#[derive(Debug, Clone)]
enum FailureKind {
    NotInstalled,
    AuthRequired(String),
    RemoteUnsupported(String),
    CommandFailed(String),
}

impl FailureKind {
    fn from_gh_error(error: GhError) -> Self {
        match error {
            GhError::NotInstalled => Self::NotInstalled,
            GhError::AuthRequired(message) => Self::AuthRequired(message),
            GhError::UnsupportedRemote(message) => Self::RemoteUnsupported(message),
            GhError::NoPrFound => {
                Self::CommandFailed("unexpected NoPrFound from branch PR fetch".to_string())
            }
            GhError::CommandFailed(message) => Self::CommandFailed(message),
        }
    }

    fn to_service_error(&self) -> HostingServiceError {
        match self {
            Self::NotInstalled => HostingServiceError::GhNotInstalled,
            Self::AuthRequired(message) => HostingServiceError::GhAuthRequired(message.clone()),
            Self::RemoteUnsupported(message) => {
                HostingServiceError::RemoteUnsupported(message.clone())
            }
            Self::CommandFailed(message) => {
                HostingServiceError::PullRequestViewFailed(message.clone())
            }
        }
    }
}

struct CachedStatuses {
    result: RepoPullRequestStatusesResult,
    fetched_at_instant: Instant,
}

struct CachedFailure {
    kind: FailureKind,
    at: Instant,
}

#[derive(Default)]
struct SlotState {
    /// Owner/name resolution cached per key alongside the statuses.
    resolved_repo: Option<GithubRepo>,
    last_good: Option<CachedStatuses>,
    last_error: Option<CachedFailure>,
}

struct RepoSlot {
    /// Serializes fetches per key: cold and post-throttle callers queue here
    /// and re-check the state after acquiring, so concurrent callers dedupe
    /// onto one gh probe.
    fetch_gate: tokio::sync::Mutex<()>,
    state: Mutex<SlotState>,
}

pub struct PrStatusCache {
    slots: Mutex<HashMap<String, Arc<RepoSlot>>>,
    gh_semaphore: Arc<tokio::sync::Semaphore>,
    fetcher: Arc<dyn BranchPrFetcher>,
    config: PrStatusCacheConfig,
}

impl Default for PrStatusCache {
    fn default() -> Self {
        Self::new()
    }
}

impl PrStatusCache {
    pub fn new() -> Self {
        Self::with_fetcher(Arc::new(GhCliFetcher), PrStatusCacheConfig::default())
    }

    pub fn with_fetcher(fetcher: Arc<dyn BranchPrFetcher>, config: PrStatusCacheConfig) -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
            gh_semaphore: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_GH_PROBES)),
            fetcher,
            config,
        }
    }

    /// Branch-scoped PR statuses for a repo root, throttled and deduped as
    /// per the module docs. `branches` is the caller-derived set of active
    /// head branches; an empty set short-circuits to an empty result without
    /// touching gh (and without disturbing cached data).
    pub async fn get_statuses(
        &self,
        repo_root_path: &str,
        branches: Vec<String>,
        refresh: bool,
    ) -> Result<RepoPullRequestStatusesResult, HostingServiceError> {
        if branches.is_empty() {
            return Ok(RepoPullRequestStatusesResult {
                entries: Vec::new(),
                fetched_at: now_rfc3339(),
            });
        }

        let key = canonical_key(repo_root_path);
        let slot = self.slot(&key);

        if let Some(outcome) = self.cached_outcome(&slot, refresh) {
            return outcome;
        }

        // In-flight dedupe + cold-cache await: queue behind any ongoing
        // fetch for this key, then re-check — the previous holder usually
        // refreshed the cache for us.
        let _gate = slot.fetch_gate.lock().await;
        if let Some(outcome) = self.cached_outcome(&slot, refresh) {
            return outcome;
        }

        let _permit = self
            .gh_semaphore
            .acquire()
            .await
            .expect("gh probe semaphore closed");

        let fetcher = self.fetcher.clone();
        let repo_root = PathBuf::from(&key);
        let resolved_repo = slot
            .state
            .lock()
            .expect("pr status slot poisoned")
            .resolved_repo
            .clone();
        let fetch_branches = branches.clone();
        let fetch_result = tokio::task::spawn_blocking(move || {
            let repo = match resolved_repo {
                Some(repo) => repo,
                None => fetcher.resolve_repo(&repo_root)?,
            };
            let entries = fetcher.fetch_branch_prs(&repo_root, &repo, &fetch_branches)?;
            Ok::<_, GhError>((repo, entries))
        })
        .await
        .map_err(|e| {
            HostingServiceError::PullRequestViewFailed(format!("branch PR fetch task failed: {e}"))
        })?;

        let mut state = slot.state.lock().expect("pr status slot poisoned");
        match fetch_result {
            Ok((repo, entries)) => {
                state.resolved_repo = Some(repo);
                let result = RepoPullRequestStatusesResult {
                    entries,
                    fetched_at: now_rfc3339(),
                };
                state.last_good = Some(CachedStatuses {
                    result: result.clone(),
                    fetched_at_instant: Instant::now(),
                });
                state.last_error = None;
                Ok(result)
            }
            Err(gh_error) => {
                let kind = FailureKind::from_gh_error(gh_error);
                state.last_error = Some(CachedFailure {
                    kind: kind.clone(),
                    at: Instant::now(),
                });
                failure_outcome(&kind, state.last_good.as_ref())
            }
        }
    }

    /// Upsert a just-created (or just-read-back) PR into the cache so the
    /// publish flow is served inside the throttle window and never flaps
    /// open → none → open. Called by the create-PR path on success.
    pub fn upsert_branch_pr(&self, repo_root_path: &str, summary: PullRequestSummary) {
        if summary.head_branch.is_empty() {
            return;
        }
        let key = canonical_key(repo_root_path);
        let slot = self.slot(&key);
        let mut state = slot.state.lock().expect("pr status slot poisoned");

        let head_branch = summary.head_branch.clone();
        let entry = BranchPullRequestStatus {
            head_branch: head_branch.clone(),
            pull_request: Some(summary),
        };
        let now = now_rfc3339();
        match state.last_good.as_mut() {
            Some(good) => {
                match good
                    .result
                    .entries
                    .iter_mut()
                    .find(|existing| existing.head_branch == head_branch)
                {
                    Some(existing) => *existing = entry,
                    None => good.result.entries.push(entry),
                }
                good.result.fetched_at = now;
                good.fetched_at_instant = Instant::now();
            }
            None => {
                state.last_good = Some(CachedStatuses {
                    result: RepoPullRequestStatusesResult {
                        entries: vec![entry],
                        fetched_at: now,
                    },
                    fetched_at_instant: Instant::now(),
                });
            }
        }
        // A PR was just created against this remote: any cached failure is
        // no longer representative.
        state.last_error = None;
    }

    fn slot(&self, key: &str) -> Arc<RepoSlot> {
        let mut slots = self.slots.lock().expect("pr status slots poisoned");
        slots
            .entry(key.to_string())
            .or_insert_with(|| {
                Arc::new(RepoSlot {
                    fetch_gate: tokio::sync::Mutex::new(()),
                    state: Mutex::new(SlotState::default()),
                })
            })
            .clone()
    }

    /// The throttled/negative-cached outcome, if the current state answers
    /// this request without a fetch.
    fn cached_outcome(
        &self,
        slot: &RepoSlot,
        refresh: bool,
    ) -> Option<Result<RepoPullRequestStatusesResult, HostingServiceError>> {
        let state = slot.state.lock().expect("pr status slot poisoned");

        // `last_error` is cleared on every success, so when present it is
        // always the newest knowledge about this repo root — it takes
        // precedence over a last_good still inside its throttle window
        // (otherwise availability would flap between polls).
        if let Some(failure) = &state.last_error {
            let reprobe_not_installed =
                refresh && matches!(failure.kind, FailureKind::NotInstalled);
            if !reprobe_not_installed && failure.at.elapsed() < self.failure_ttl(&failure.kind) {
                return Some(failure_outcome(&failure.kind, state.last_good.as_ref()));
            }
            // Failure TTL expired (or a refresh re-probes gh): fetch again.
            return None;
        }

        let throttle = if refresh {
            self.config.refresh_floor
        } else {
            self.config.min_refresh
        };
        if let Some(good) = &state.last_good {
            if good.fetched_at_instant.elapsed() < throttle {
                return Some(Ok(good.result.clone()));
            }
        }

        None
    }

    fn failure_ttl(&self, kind: &FailureKind) -> Duration {
        match kind {
            FailureKind::NotInstalled => self.config.not_installed_ttl,
            FailureKind::AuthRequired(_) => self.config.auth_required_ttl,
            FailureKind::RemoteUnsupported(_) | FailureKind::CommandFailed(_) => {
                self.config.failure_backoff
            }
        }
    }
}

/// Transient command failures serve the retained last-good result (original
/// `fetched_at`); actionable availability states surface as errors.
fn failure_outcome(
    kind: &FailureKind,
    last_good: Option<&CachedStatuses>,
) -> Result<RepoPullRequestStatusesResult, HostingServiceError> {
    match (kind, last_good) {
        (FailureKind::CommandFailed(_), Some(good)) => Ok(good.result.clone()),
        _ => Err(kind.to_service_error()),
    }
}

fn canonical_key(repo_root_path: &str) -> String {
    std::fs::canonicalize(repo_root_path)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| repo_root_path.to_string())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
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
}
