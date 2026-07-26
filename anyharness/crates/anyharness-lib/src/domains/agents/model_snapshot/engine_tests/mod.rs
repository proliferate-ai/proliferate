//! The engine suite: shared fixtures live here, and the assertions are grouped
//! into sibling files by the property they pin.
//!
//! Coalescing, per-harness serialization, the concurrency cap,
//! idempotence, the completed-attempt floor, backoff, the forced-refresh
//! fingerprint re-check, the not-installed filter, plan continuity, the
//! single-runtime lock, and cleanup on failure and timeout.
//!
//! Real filesystem (the document and `state.json` ARE state), fake runner and fake
//! plan producer (a real probe would spawn a harness and hit a network).

// Shared by the sibling assertion files through `use super::*`; not every one of
// them uses every name.
#[allow(unused_imports)]
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

#[allow(unused_imports)]
use super::document::{read_document, AttemptOutcome};
#[allow(unused_imports)]
use super::probe::ProbeError;
#[allow(unused_imports)]
use super::test_support::{
    env_context, gateway_context, gateway_state, CountingPlanProducer, FakeBehavior, FakeRunner,
    FixedTargets, TempRuntimeHome,
};
#[allow(unused_imports)]
use super::{ModelSnapshotService, PokeReason, ProbeEngineConfig, ProbeEngineMode, RefreshError};

fn test_config() -> ProbeEngineConfig {
    ProbeEngineConfig {
        per_probe_timeout: Duration::from_secs(30),
        model_switch_timeout: Duration::from_secs(1),
        min_reprobe_interval: Duration::from_secs(60),
        ttl_base: Duration::from_secs(24 * 3600),
        ttl_jitter_span: Duration::from_secs(6 * 3600),
        backoff_base: Duration::from_secs(60),
        backoff_max: Duration::from_secs(6 * 3600),
        max_concurrent_probes: 1,
        sweep_age_multiplier: 3,
    }
}

/// A one-harness engine over a real temp home with a gateway document and a
/// manifest, wired to a counting fake runner.
fn engine(
    home: &TempRuntimeHome,
    harness: &str,
    contexts: Vec<crate::domains::agents::catalog::schema::AgentCatalogAuthContext>,
    config: ProbeEngineConfig,
) -> (Arc<ModelSnapshotService>, Arc<FakeRunner>, Arc<CountingPlanProducer>) {
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(
        vec!["m-1", "m-2", "m-3"],
        vec!["seed-1"],
    ));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan.clone(),
        Arc::new(FixedTargets::single(harness, contexts)),
        runner.clone(),
        config,
    ));
    (service, runner, plan)
}

fn seeded_home(prefix: &str, harness: &str) -> TempRuntimeHome {
    let home = TempRuntimeHome::new(prefix);
    home.write_state_json(&gateway_state(3, &[(harness, "sk-vk")]));
    home.write_manifest(harness, Some("1.0.0"), Some("sha-1"), "pinned_archive");
    home
}

mod concurrency_tests;
mod degraded_tests;
mod lifecycle_tests;
mod refresh_tests;
mod throttling_tests;
