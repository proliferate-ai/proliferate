//! Fakes for the engine's seams, so gate/coalescing/backoff logic is tested
//! without a registry, a catalog document, a real install, or a network.
//!
//! Mirrors how `pr_status_cache` injects `BranchPrFetcher`: the fake counts
//! invocations, can block on a barrier, can fail, and can hang past a timeout —
//! the four behaviors the engine's brakes are defined against.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::domains::agents::catalog::schema::{AgentCatalogAuthContext, AgentCatalogAuthSignal};
use crate::domains::agents::installer::manifest::{record_entries, ManifestArtifact};
use crate::domains::agents::route_auth::{GatewayModelPlan, GatewayModelResolve};
use crate::live::sessions::probe::{ProbeModelEntry, ProbeSnapshot};

use super::probe::{ProbeError, ProbeRequest, ProbeRunner};
use super::targets::ProbeTargets;

/// A self-cleaning temp runtime home.
pub(crate) struct TempRuntimeHome {
    path: PathBuf,
}

impl TempRuntimeHome {
    pub(crate) fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-model-snapshot-{prefix}-{}",
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

    /// Record an `agent_process` manifest artifact, the staleness baseline.
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
                path: self.path.join("agents").join(harness_kind).join("bin").display().to_string(),
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
pub(crate) fn gateway_state(revision: i64, harnesses: &[(&str, &str)]) -> serde_json::Value {
    serde_json::json!({
        "version": 2,
        "revision": revision,
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

/// The catalog's `gateway` context shape.
pub(crate) fn gateway_context() -> AgentCatalogAuthContext {
    AgentCatalogAuthContext {
        id: "gateway".to_string(),
        auth_slot_id: Some("gateway".to_string()),
        description: None,
        signals: Some(AgentCatalogAuthSignal::Route("gateway".to_string())),
    }
}

pub(crate) fn env_context(id: &str, slot: &str, vars: &[&str]) -> AgentCatalogAuthContext {
    AgentCatalogAuthContext {
        id: id.to_string(),
        auth_slot_id: Some(slot.to_string()),
        description: None,
        signals: Some(AgentCatalogAuthSignal::AnyOf(
            vars.iter()
                .map(|var| AgentCatalogAuthSignal::Env(var.to_string()))
                .collect(),
        )),
    }
}

/// Fixed targets: what the engine may probe, decided by the test rather than by
/// the machine.
pub(crate) struct FixedTargets {
    pub(crate) harnesses: Vec<String>,
    pub(crate) contexts: BTreeMap<String, Vec<String>>,
    pub(crate) catalog_contexts: BTreeMap<String, Vec<AgentCatalogAuthContext>>,
    pub(crate) installed: Vec<String>,
}

impl FixedTargets {
    pub(crate) fn single(harness: &str, contexts: Vec<AgentCatalogAuthContext>) -> Self {
        let ids: Vec<String> = contexts.iter().map(|context| context.id.clone()).collect();
        Self {
            harnesses: vec![harness.to_string()],
            contexts: BTreeMap::from([(harness.to_string(), ids)]),
            catalog_contexts: BTreeMap::from([(harness.to_string(), contexts)]),
            installed: vec![harness.to_string()],
        }
    }
}

impl ProbeTargets for FixedTargets {
    fn auto_harnesses(&self) -> Vec<String> {
        self.harnesses.clone()
    }

    fn active_contexts(&self, harness_kind: &str) -> Vec<String> {
        self.contexts.get(harness_kind).cloned().unwrap_or_default()
    }

    fn is_installed(&self, harness_kind: &str) -> bool {
        self.installed.iter().any(|kind| kind == harness_kind)
    }

    fn catalog_contexts(&self, harness_kind: &str) -> Vec<AgentCatalogAuthContext> {
        self.catalog_contexts
            .get(harness_kind)
            .cloned()
            .unwrap_or_default()
    }
}

/// A plan producer that counts fetches and honors invalidation, so plan-continuity
/// and forced-refresh memo behavior are assertable without a gateway.
pub(crate) struct CountingPlanProducer {
    pub(crate) models: Mutex<Vec<String>>,
    pub(crate) seed_models: Vec<String>,
    pub(crate) fetch_count: AtomicUsize,
    /// Simulates a memo: cleared by `invalidate_gateway_plan`.
    memo: Mutex<BTreeMap<String, Vec<String>>>,
    pub(crate) fetch_fails: Mutex<bool>,
}

impl CountingPlanProducer {
    pub(crate) fn new(models: Vec<&str>, seed_models: Vec<&str>) -> Self {
        Self {
            models: Mutex::new(models.into_iter().map(str::to_string).collect()),
            seed_models: seed_models.into_iter().map(str::to_string).collect(),
            fetch_count: AtomicUsize::new(0),
            memo: Mutex::new(BTreeMap::new()),
            fetch_fails: Mutex::new(false),
        }
    }

    pub(crate) fn fetches(&self) -> usize {
        self.fetch_count.load(Ordering::SeqCst)
    }
}

impl GatewayModelResolve for CountingPlanProducer {
    fn resolve_gateway_models(&self, harness_kind: &str, _revision: i64) -> GatewayModelPlan {
        let mut memo = self.memo.lock().expect("memo poisoned");
        let models = memo
            .entry(harness_kind.to_string())
            .or_insert_with(|| {
                self.fetch_count.fetch_add(1, Ordering::SeqCst);
                if *self.fetch_fails.lock().expect("flag poisoned") {
                    self.seed_models.clone()
                } else {
                    self.models.lock().expect("models poisoned").clone()
                }
            })
            .clone();
        GatewayModelPlan {
            default_model: Some("model-default".to_string()),
            native_default_model: Some("model-native".to_string()),
            small_fast_model: Some("model-small".to_string()),
            models,
        }
    }

    fn invalidate_gateway_plan(&self, harness_kind: &str) {
        self.memo
            .lock()
            .expect("memo poisoned")
            .remove(harness_kind);
    }
}

/// What one fake probe attempt should do.
#[derive(Debug, Clone)]
pub(crate) enum FakeBehavior {
    Ok,
    Fail(String),
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
                &request.auth_context_id,
                &self.models.lock().expect("models poisoned"),
            )),
            FakeBehavior::Fail(detail) => Err(ProbeError::Failed { detail }),
            FakeBehavior::Sleep(duration) => {
                match tokio::time::timeout(request.per_probe_timeout, tokio::time::sleep(duration))
                    .await
                {
                    Ok(()) => Ok(snapshot(
                        &request.harness_kind,
                        &request.auth_context_id,
                        &self.models.lock().expect("models poisoned"),
                    )),
                    Err(_) => Err(ProbeError::Timeout),
                }
            }
        };
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
        outcome
    }
}

pub(crate) fn snapshot(harness_kind: &str, auth_context: &str, models: &[String]) -> ProbeSnapshot {
    ProbeSnapshot {
        probed_at: "2026-07-26T00:00:00Z".to_string(),
        agent_kind: harness_kind.to_string(),
        auth_context: auth_context.to_string(),
        attestation: Some(crate::live::sessions::probe::ProbeAttestation {
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
