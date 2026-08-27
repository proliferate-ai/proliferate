//! Fakes for the engine's seams, so single-flight/backoff/poke logic is tested
//! without a registry, a real install, or a network.
//!
//! Mirrors how `pr_status_cache` injects `BranchPrFetcher`: the fake counts
//! invocations, can block on a barrier, can fail, and can hang past a timeout —
//! the behaviors the engine's brakes are defined against.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::domains::agents::installer::manifest::{record_entries, ManifestArtifact};
use crate::domains::agents::live_ports::{ProbeAttestation, ProbeModelEntry, ProbeSnapshot};
use crate::domains::agents::route_auth::{GatewayModelPlan, GatewayModelResolve};

use super::probe::{ProbeError, ProbeRequest, ProbeRunner, COMPOSED_AUTH_CONTEXT_LABEL};
use super::targets::ProbeTargets;

/// A self-cleaning temp runtime home.
pub(crate) struct TempRuntimeHome {
    path: PathBuf,
}

impl TempRuntimeHome {
    pub(crate) fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-launch-options-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp runtime home");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn write_state_json(&self, value: &serde_json::Value) {
        let path = crate::domains::agents::route_auth::state::state_file_path(&self.path);
        std::fs::create_dir_all(path.parent().expect("state parent")).expect("create agent-auth");
        std::fs::write(&path, serde_json::to_vec_pretty(value).expect("serialize"))
            .expect("write state");
    }

    /// Record an `agent_process` manifest artifact — the install identity the
    /// observation records as provenance.
    pub(crate) fn write_manifest(
        &self,
        harness_kind: &str,
        version: Option<&str>,
        sha256: Option<&str>,
        source: &str,
    ) {
        record_entries(
            &self.path,
            harness_kind,
            vec![ManifestArtifact {
                role: "agent_process".to_string(),
                version: version.map(str::to_string),
                sha256: sha256.map(str::to_string),
                source: source.to_string(),
                installed_at: "2026-07-26T00:00:00Z".to_string(),
                path: self
                    .path
                    .join("agents")
                    .join(harness_kind)
                    .join("bin")
                    .display()
                    .to_string(),
            }],
        )
        .expect("write manifest");
    }
}

impl Drop for TempRuntimeHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// A gateway state document with one gateway source for each named harness.
pub(crate) fn gateway_state(sequence: i64, harnesses: &[(&str, &str)]) -> serde_json::Value {
    serde_json::json!({
        "version": 2,
        "sequence": sequence,
        "harnesses": harnesses
            .iter()
            .map(|(kind, key)| serde_json::json!({
                "harness_kind": kind,
                "sources": [{
                    "kind": "gateway",
                    "base_url": "https://gw.example",
                    "key": key,
                }],
            }))
            .collect::<Vec<_>>(),
    })
}

/// Fixed targets: which harnesses the engine may probe, decided by the test
/// rather than by the machine.
pub(crate) struct FixedTargets {
    pub(crate) harnesses: Vec<String>,
    pub(crate) installed: Vec<String>,
    /// Harnesses no AUTOMATIC poke may probe — the fake's stand-in for the
    /// production manual-refresh-only list.
    pub(crate) manual_refresh_only: Vec<String>,
}

impl FixedTargets {
    pub(crate) fn single(harness: &str) -> Self {
        Self {
            harnesses: vec![harness.to_string()],
            installed: vec![harness.to_string()],
            manual_refresh_only: Vec::new(),
        }
    }
}

impl ProbeTargets for FixedTargets {
    fn auto_harnesses(&self) -> Vec<String> {
        self.harnesses
            .iter()
            .filter(|kind| self.allows_automatic_probe(kind))
            .cloned()
            .collect()
    }

    fn allows_automatic_probe(&self, harness_kind: &str) -> bool {
        !self
            .manual_refresh_only
            .iter()
            .any(|kind| kind == harness_kind)
    }

    fn is_installed(&self, harness_kind: &str) -> bool {
        self.installed.iter().any(|kind| kind == harness_kind)
    }
}

/// A plan producer that counts fetches and honors invalidation, so plan-continuity
/// and forced-refresh memo behavior are assertable without a gateway.
pub(crate) struct CountingPlanProducer {
    pub(crate) models: Mutex<Vec<String>>,
    pub(crate) fetch_count: AtomicUsize,
    /// Simulates a memo: cleared by `invalidate_gateway_plan`.
    memo: Mutex<BTreeMap<String, Vec<String>>>,
    pub(crate) fetch_fails: Mutex<bool>,
}

impl CountingPlanProducer {
    pub(crate) fn new(models: Vec<&str>) -> Self {
        Self {
            models: Mutex::new(models.into_iter().map(str::to_string).collect()),
            fetch_count: AtomicUsize::new(0),
            memo: Mutex::new(BTreeMap::new()),
            fetch_fails: Mutex::new(false),
        }
    }

    pub(crate) fn fetches(&self) -> usize {
        self.fetch_count.load(Ordering::SeqCst)
    }
}

impl CountingPlanProducer {
    fn resolve_live(&self, harness_kind: &str) -> GatewayModelPlan {
        let mut memo = self.memo.lock().expect("memo poisoned");
        let fetch_fails = *self.fetch_fails.lock().expect("flag poisoned");
        let models = memo
            .entry(harness_kind.to_string())
            .or_insert_with(|| {
                self.fetch_count.fetch_add(1, Ordering::SeqCst);
                if fetch_fails {
                    Vec::new()
                } else {
                    self.models.lock().expect("models poisoned").clone()
                }
            })
            .clone();
        GatewayModelPlan { models }
    }
}

impl GatewayModelResolve for CountingPlanProducer {
    fn resolve_gateway_models(&self, harness_kind: &str, _sequence: i64) -> GatewayModelPlan {
        self.resolve_live(harness_kind)
    }

    fn invalidate_gateway_plan(&self, harness_kind: &str) {
        self.memo
            .lock()
            .expect("memo poisoned")
            .remove(harness_kind);
    }

    fn resolve_gateway_models_blocking(
        &self,
        harness_kind: &str,
        _sequence: i64,
    ) -> GatewayModelPlan {
        self.resolve_live(harness_kind)
    }
}

/// What one fake probe attempt should do.
#[derive(Debug, Clone)]
pub(crate) enum FakeBehavior {
    Ok,
    Fail(String),
    /// Fast-fail as a spawn failure — the harness binary could not be started.
    Spawn(String),
    /// Sleep this long before answering — used with a paused clock to exercise the
    /// timeout path deterministically.
    Sleep(Duration),
}

/// Counts invocations, records overlap, and can gate on a barrier so N concurrent
/// callers provably queue behind ONE attempt.
pub(crate) struct FakeRunner {
    pub(crate) invocations: AtomicUsize,
    pub(crate) in_flight: AtomicUsize,
    pub(crate) max_in_flight: AtomicUsize,
    pub(crate) behavior: Mutex<FakeBehavior>,
    pub(crate) models: Mutex<Vec<String>>,
    pub(crate) release: Mutex<Option<tokio::sync::watch::Receiver<bool>>>,
    pub(crate) observed_plan_models: Mutex<Vec<Vec<String>>>,
}

impl FakeRunner {
    pub(crate) fn new() -> Self {
        Self {
            invocations: AtomicUsize::new(0),
            in_flight: AtomicUsize::new(0),
            max_in_flight: AtomicUsize::new(0),
            behavior: Mutex::new(FakeBehavior::Ok),
            models: Mutex::new(vec!["m-1".to_string(), "m-2".to_string()]),
            release: Mutex::new(None),
            observed_plan_models: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn gated() -> (Arc<Self>, tokio::sync::watch::Sender<bool>) {
        let (tx, rx) = tokio::sync::watch::channel(false);
        let runner = Arc::new(Self::new());
        *runner.release.lock().expect("release poisoned") = Some(rx);
        (runner, tx)
    }

    pub(crate) fn count(&self) -> usize {
        self.invocations.load(Ordering::SeqCst)
    }

    pub(crate) fn peak_concurrency(&self) -> usize {
        self.max_in_flight.load(Ordering::SeqCst)
    }

    pub(crate) fn set_behavior(&self, behavior: FakeBehavior) {
        *self.behavior.lock().expect("behavior poisoned") = behavior;
    }
}

#[async_trait::async_trait]
impl ProbeRunner for FakeRunner {
    async fn run(&self, request: ProbeRequest) -> Result<ProbeSnapshot, ProbeError> {
        self.invocations.fetch_add(1, Ordering::SeqCst);
        let now = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_in_flight.fetch_max(now, Ordering::SeqCst);
        self.observed_plan_models
            .lock()
            .expect("plan models poisoned")
            .push(request.plan.models.clone());

        // Materialize for real, exactly as the production runner does, and hold the
        // guard for this frame's lifetime.
        //
        // Without this the fake writes no scratch at all, and every "no scratch
        // outlived the attempt" assertion in the suite is vacuous — it would pass
        // against a runner that leaked every root. Doing the real phase-B write makes
        // those assertions able to fail, and it exercises the seam the fake is
        // standing in front of rather than around it.
        let materialized = crate::domains::agents::route_auth::materialize_for_probe(
            &request.runtime_home,
            &request.harness_kind,
            &request.material,
            &request.plan,
        )
        .map_err(|error| ProbeError::Failed {
            detail: format!("fake runner could not materialize: {error}"),
        })?;

        let behavior = self.behavior.lock().expect("behavior poisoned").clone();
        let release = self.release.lock().expect("release poisoned").clone();
        if let Some(mut release) = release {
            while !*release.borrow_and_update() {
                if release.changed().await.is_err() {
                    break;
                }
            }
        }
        let outcome = match behavior {
            FakeBehavior::Ok => Ok(snapshot(
                &request.harness_kind,
                &self.models.lock().expect("models poisoned"),
            )),
            FakeBehavior::Fail(detail) => Err(ProbeError::Failed { detail }),
            FakeBehavior::Spawn(detail) => Err(ProbeError::Spawn { detail }),
            FakeBehavior::Sleep(duration) => {
                match tokio::time::timeout(request.per_probe_timeout, tokio::time::sleep(duration))
                    .await
                {
                    Ok(()) => Ok(snapshot(
                        &request.harness_kind,
                        &self.models.lock().expect("models poisoned"),
                    )),
                    Err(_) => Err(ProbeError::Timeout),
                }
            }
        };
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
        // Dropped here rather than earlier, so the scratch outlives the "probe" — the
        // same ordering the production runner guarantees around its child.
        drop(materialized);
        outcome
    }
}

pub(crate) fn snapshot(harness_kind: &str, models: &[String]) -> ProbeSnapshot {
    ProbeSnapshot {
        probed_at: "2026-07-26T00:00:00Z".to_string(),
        agent_kind: harness_kind.to_string(),
        auth_context: COMPOSED_AUTH_CONTEXT_LABEL.to_string(),
        attestation: Some(ProbeAttestation {
            name: harness_kind.to_string(),
            version: "9.9.9".to_string(),
            title: None,
        }),
        model_source: "modelConfigOption".to_string(),
        native_cli: None,
        trials: Vec::new(),
        prompt_result: None,
        current_model_id: models.first().cloned(),
        current_mode_id: Some("build".to_string()),
        modes: serde_json::json!({
            "currentModeId": "build",
            "availableModes": [
                { "id": "build", "name": "Build" },
                { "id": "plan", "name": "Plan" }
            ]
        }),
        baseline_config_options: serde_json::json!([]),
        models: models
            .iter()
            .map(|id| ProbeModelEntry {
                model_id: id.clone(),
                name: id.clone(),
                description: None,
                config_options: None,
            })
            .collect(),
        warnings: Vec::new(),
    }
}

/// Wait until `condition` holds, or fail after a generous bound.
///
/// Every poke is a fire-and-forget `tokio::spawn`, so a test that wants to observe its
/// effect has to wait for another task. A fixed `yield_now` loop does NOT do that: on
/// a multi-thread runtime the spawned task may be on another worker, so yielding N
/// times guarantees nothing about its progress — the count only ever happens to be
/// enough on a fast, idle machine.
///
/// The bound is deliberately far larger than the work (which is microseconds against a
/// fake runner): a real failure fails the assertion inside `condition` at the call
/// site, and only a genuinely stuck engine reaches the timeout.
pub(crate) async fn wait_until(label: &str, mut condition: impl FnMut() -> bool) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for: {label}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}
