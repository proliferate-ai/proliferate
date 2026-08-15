//! The tier-1 credential trial (ADR FR-2): an instant, key-scoped credential
//! check that fires off the SAME `PokeReason` events as the probe and is single
//! flight, but never spawns a harness. Where the probe answers "what would a
//! session show", the trial answers only "does this credential still work, right
//! now" — a ~1s network call whose verdict feeds `derive_agent_auth_state`
//! (green `Tier1Trial` evidence with an age, or the `Expired` terminal on a
//! 401/403) so a surface can show Authenticated/Expired before the full probe
//! lands.
//!
//! Scope is deliberately narrow and conservative:
//!
//! - **Gateway sources** are trialled: a `GET {base_url}/v1/models` with the
//!   harness's own virtual key reuses the surviving key-scoped fetch machinery
//!   ([`super::super::catalog::gateway_probe::probe_gateway_models`]). A 2xx is
//!   green; a 401/403 is expired; anything else is inconclusive and records
//!   nothing (the credential stays at its heuristic strength).
//! - **Pasted api_key and native CLI logins** get NO trial here. A native login
//!   would need an unattended spawn (the keychain-prompt hazard the probe
//!   already excludes cursor for), and a pasted key has no verifiably free
//!   provider endpoint wired yet, so both stay heuristic/unverified rather than
//!   guessed. Adding a free per-provider check (e.g. an Anthropic
//!   count-tokens-style call) is a later, additive step behind the same flag.
//!
//! The whole engine is gated by [`ProbeEngineConfig::tier1_trial_enabled`]; off,
//! [`Tier1TrialEngine::poke`] is a no-op and no network call is ever made.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};

use crate::domains::agents::auth_state::Tier1TrialFact;
use crate::domains::agents::catalog::gateway_probe::{probe_gateway_models, GatewayProbeError};
use crate::domains::agents::route_auth::load_state_file;
use crate::domains::agents::route_auth::state::SOURCE_KIND_GATEWAY;

/// What a single credential check saw. `Inconclusive` is not a verdict — an
/// unreachable gateway or a surprising status says nothing about the credential,
/// so the engine records nothing and the credential keeps its heuristic strength.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tier1TrialCheck {
    Green,
    Expired,
    Inconclusive(String),
}

/// A recorded trial verdict plus when it was observed and a fingerprint of the
/// CREDENTIAL it verified. The fingerprint is what makes a verdict honest across
/// a key rotation: a check against a different key carries a different
/// fingerprint, and the engine invalidates a stored verdict whose fingerprint no
/// longer matches the current credential rather than letting a green stand for a
/// key that is gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tier1TrialResult {
    pub verdict: Tier1TrialVerdict,
    pub at: DateTime<Utc>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier1TrialVerdict {
    Green,
    Expired,
}

impl Tier1TrialResult {
    /// Fold this recorded verdict into the dependency-free
    /// [`Tier1TrialFact`] the auth-state derivation consumes, computing the
    /// green evidence age against `now`.
    pub fn to_fact(&self, now: DateTime<Utc>) -> Tier1TrialFact {
        match self.verdict {
            Tier1TrialVerdict::Green => Tier1TrialFact::Green {
                age_seconds: now.signed_duration_since(self.at).num_seconds().max(0),
            },
            Tier1TrialVerdict::Expired => Tier1TrialFact::Expired,
        }
    }
}

/// The credential check, behind a seam so the engine's flag, single-flight, and
/// verdict mapping are testable without a network.
#[async_trait::async_trait]
pub trait Tier1TrialProbe: Send + Sync {
    async fn check(&self, base_url: &str, key: &str) -> Tier1TrialCheck;
}

/// Production: the surviving tolerant `GET /v1/models` fetch, classified into a
/// verdict. A 2xx (any body) is green — the key was accepted; a 401/403 is
/// expired; everything else is inconclusive.
pub struct HttpTier1TrialProbe;

#[async_trait::async_trait]
impl Tier1TrialProbe for HttpTier1TrialProbe {
    async fn check(&self, base_url: &str, key: &str) -> Tier1TrialCheck {
        match probe_gateway_models(base_url, key).await {
            Ok(_) => Tier1TrialCheck::Green,
            Err(GatewayProbeError::Status { status }) if status == 401 || status == 403 => {
                Tier1TrialCheck::Expired
            }
            Err(error) => Tier1TrialCheck::Inconclusive(error.to_string()),
        }
    }
}

/// The tier-1 trial engine. One per runtime home, held by
/// [`super::ModelSnapshotService`].
pub struct Tier1TrialEngine {
    enabled: bool,
    runtime_home: PathBuf,
    probe: Arc<dyn Tier1TrialProbe>,
    results: Mutex<HashMap<String, Tier1TrialResult>>,
    /// Single-flight: a harness already being trialled coalesces onto the
    /// in-flight check instead of stacking a second network call.
    in_flight: Mutex<HashSet<String>>,
}

impl Tier1TrialEngine {
    pub fn new(enabled: bool, runtime_home: PathBuf) -> Self {
        Self::with_probe(enabled, runtime_home, Arc::new(HttpTier1TrialProbe))
    }

    pub fn with_probe(
        enabled: bool,
        runtime_home: PathBuf,
        probe: Arc<dyn Tier1TrialProbe>,
    ) -> Self {
        Self {
            enabled,
            runtime_home,
            probe,
            results: Mutex::new(HashMap::new()),
            in_flight: Mutex::new(HashSet::new()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// The last recorded verdict for a harness, if any.
    pub fn result(&self, harness_kind: &str) -> Option<Tier1TrialResult> {
        self.results
            .lock()
            .expect("tier-1 trial results poisoned")
            .get(harness_kind)
            .cloned()
    }

    /// Forget any stored verdict for a harness. Called when the harness no longer
    /// has a gateway source (the source was switched away), so a stale gateway
    /// green cannot linger in the map and be folded onto whatever credential is
    /// now filling the slot.
    fn clear(&self, harness_kind: &str) {
        self.results
            .lock()
            .expect("tier-1 trial results poisoned")
            .remove(harness_kind);
    }

    /// Fire a trial for a harness off an event. A no-op when the flag is off or a
    /// trial for it is already in flight. When the harness has NO gateway source,
    /// this is not merely a skip: any prior verdict is cleared, because a verdict
    /// about a credential that is no longer configured is worse than none.
    /// Fire-and-forget: the caller (the same poke site as the probe) never waits.
    pub fn poke(self: &Arc<Self>, harness_kind: &str) {
        if !self.enabled {
            return;
        }
        let Some((base_url, key)) = self.gateway_credentials(harness_kind) else {
            // The source switched away from the gateway (or there never was one):
            // drop any stale gateway verdict so it cannot outlive its credential.
            self.clear(harness_kind);
            return;
        };
        {
            let mut in_flight = self.in_flight.lock().expect("tier-1 trial in-flight poisoned");
            if !in_flight.insert(harness_kind.to_string()) {
                return;
            }
        }
        let engine = self.clone();
        let harness = harness_kind.to_string();
        tokio::spawn(async move {
            // The guard frees the single-flight slot on EVERY exit — normal
            // return, an early return, or a panic unwinding through the task — so
            // a panicking trial self-heals instead of wedging the harness's slot
            // shut forever.
            let _in_flight = InFlightGuard {
                engine: engine.clone(),
                harness: harness.clone(),
            };
            engine.run_trial(&harness, base_url, key).await;
        });
    }

    /// Run one trial and record a conclusive verdict, fingerprinted by the
    /// credential it verified. Exposed for tests, which drive it directly to
    /// assert the verdict mapping and the rotation invalidation without the spawn.
    pub async fn run_trial(&self, harness_kind: &str, base_url: String, key: String) {
        let fingerprint = credential_fingerprint(&base_url, &key);
        // A key rotation (a different fingerprint) invalidates any prior verdict
        // UP FRONT, before we even know the new outcome: the old verdict was about
        // a key that is no longer configured. So a rotated key followed by an
        // inconclusive recheck leaves nothing standing, never the stale green.
        {
            let mut results = self.results.lock().expect("tier-1 trial results poisoned");
            if results
                .get(harness_kind)
                .is_some_and(|prior| prior.fingerprint != fingerprint)
            {
                results.remove(harness_kind);
            }
        }
        let check = self.probe.check(&base_url, &key).await;
        let verdict = match check {
            Tier1TrialCheck::Green => Tier1TrialVerdict::Green,
            Tier1TrialCheck::Expired => Tier1TrialVerdict::Expired,
            Tier1TrialCheck::Inconclusive(detail) => {
                tracing::debug!(
                    harness = harness_kind,
                    detail,
                    "tier-1 trial inconclusive; recording nothing"
                );
                return;
            }
        };
        self.results
            .lock()
            .expect("tier-1 trial results poisoned")
            .insert(
                harness_kind.to_string(),
                Tier1TrialResult {
                    verdict,
                    at: Utc::now(),
                    fingerprint,
                },
            );
    }

    /// The credential the last verdict verified, if any — exposed for tests that
    /// assert a rotation replaced the fingerprint.
    #[cfg(test)]
    pub(crate) fn result_fingerprint(&self, harness_kind: &str) -> Option<String> {
        self.result(harness_kind).map(|result| result.fingerprint)
    }

    /// The gateway (base_url, key) for a harness from the current state file, if a
    /// gateway source exists. Mirrors the render plane's own lookup
    /// (`gateway_plan::GatewayModelPlanner::gateway_credentials`); a missing state
    /// file or a source without both fields is simply "nothing to trial".
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

/// Frees a harness's single-flight slot on drop, so a panicking trial task never
/// wedges the slot shut. Mirrors the `LiveStateGuard`/`ProbeScratch` guards the
/// probe engine already uses to make in-flight state correct by construction.
struct InFlightGuard {
    engine: Arc<Tier1TrialEngine>,
    harness: String,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        self.engine
            .in_flight
            .lock()
            .expect("tier-1 trial in-flight poisoned")
            .remove(&self.harness);
    }
}

/// A stable, opaque fingerprint of the credential a verdict verified. In-memory
/// only (never persisted, never logged), so a plain hash of base URL + key is
/// enough: two checks against the same (proxy, key) collapse to one verdict, and
/// a rotated key produces a different value that invalidates the old verdict.
fn credential_fingerprint(base_url: &str, key: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    base_url.hash(&mut hasher);
    0u8.hash(&mut hasher);
    key.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
#[path = "trial_tests.rs"]
mod tests;
