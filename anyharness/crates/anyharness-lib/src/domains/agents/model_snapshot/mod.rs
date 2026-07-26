//! The machine model snapshot: probe, decide, persist, serve.
//!
//! `ModelSnapshotService` is the domain's public face. Its rule is the one
//! model-catalog.md states: for every (installed harness, active auth context), if
//! the document has no fresh entry — missing, or stale by the staleness rules —
//! probe it in the background and write the entry. Fresh entries are never
//! re-probed; running it twice does nothing twice.
//!
//! Module split follows the domain's pure-policy/effectful-apply convention:
//!
//! - [`staleness`] decides (pure, injected `now`),
//! - [`fingerprint`] digests phase-A material (pure),
//! - [`document`] is the wire schema plus atomic read/write,
//! - [`probe`] runs one attempt on a thread that owns its child and its scratch,
//! - [`targets`] answers which pairs may be probed (and holds cursor's carve-out),
//! - [`lock`] enforces one engine per runtime home,
//! - [`status`] projects the polled status surface (pure),
//! - [`detail`] makes a harness's own error text safe to persist (pure),
//! - [`backoff`] spreads the retry ladder (pure),
//! - [`attempt`] executes one admitted attempt and persists its outcome,
//! - [`universe`] projects fresh entries into the launch-validation universe,
//! - this file is the reconciler: the gate, the coalescing, and the pokes.
//!
//! **Four independent brakes**, because each stops a different runaway:
//! 1. the staleness gate — nothing re-probes a fresh entry;
//! 2. a 60s completed-attempt floor per key — the structural defense, which bounds
//!    the damage of a mis-stated gate rule to one probe per minute instead of one
//!    per poke (a rule WAS mis-stated once; see `staleness.rs`);
//! 3. exponential backoff on failure, so a hard-down provider is not hammered;
//! 4. per-harness serialization plus a machine-wide semaphore of 1, because every
//!    probe is a real harness process.

mod attempt;
mod backoff;
pub mod config;
mod detail;
pub mod document;
mod entry;
pub mod fingerprint;
mod reads;
pub mod lock;
pub mod probe;
pub mod staleness;
pub mod status;
pub mod targets;
pub mod universe;

#[cfg(test)]
mod engine_tests;
#[cfg(test)]
mod runner_tests;
#[cfg(test)]
mod staleness_tests;
#[cfg(test)]
mod universe_tests;
#[cfg(test)]
mod wiring_tests;
#[cfg(test)]
pub(crate) mod test_support;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};

use crate::domains::agents::route_auth::{self, GatewayModelResolve, RouteAuthError};

pub use config::{PokeReason, ProbeEngineConfig, ProbeEngineMode, RefreshError};
use document::{install_identity_of, SnapshotEntry};
use probe::ProbeRunner;
use staleness::Freshness;
use targets::ProbeTargets;

/// The engine's live, in-memory view of one (harness, context).
///
/// Not persisted, deliberately: a restart costs at most one extra attempt, the
/// same tradeoff the spec already accepts for the Worker's upload state. Persisting
/// backoff would mean a machine could boot already-throttled with no way for a user
/// to tell why.
#[derive(Debug)]
struct ContextRuntimeState {
    /// What a polling surface is told. `Queued` is set the moment an attempt is
    /// admitted to this slot — BEFORE it waits on the per-harness gate and the
    /// machine-wide semaphore — so a probe that is genuinely pending never reports
    /// `idle`. At `max_concurrent_probes = 1` that wait is the common case, not an
    /// edge one.
    live: status::LiveState,
    consecutive_failures: u32,
    next_attempt_at: Option<DateTime<Utc>>,
    last_completed_at: Option<DateTime<Utc>>,
}

impl Default for ContextRuntimeState {
    fn default() -> Self {
        Self {
            live: status::LiveState::Idle,
            consecutive_failures: 0,
            next_attempt_at: None,
            last_completed_at: None,
        }
    }
}

struct ContextSlot {
    /// Serializes attempts for this key. Coalescing callers re-check the gate
    /// after acquiring — the previous holder usually made the entry fresh for
    /// them, which is the whole coalescing mechanism.
    attempt_gate: tokio::sync::Mutex<()>,
    state: Mutex<ContextRuntimeState>,
}

pub struct ModelSnapshotService {
    runtime_home: PathBuf,
    /// `None` ⇒ read-only mode: serve the document, never probe, never sweep.
    engine_lock: Option<lock::ProbeEngineLock>,
    slots: Mutex<HashMap<(String, String), Arc<ContextSlot>>>,
    /// "Probes for one harness run serially" (model-catalog.md).
    harness_gates: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    probe_semaphore: Arc<tokio::sync::Semaphore>,
    plan_producer: Arc<dyn GatewayModelResolve>,
    targets: Arc<dyn ProbeTargets>,
    runner: Arc<dyn ProbeRunner>,
    config: ProbeEngineConfig,
}

impl ModelSnapshotService {
    pub fn new(
        runtime_home: PathBuf,
        plan_producer: Arc<dyn GatewayModelResolve>,
        targets: Arc<dyn ProbeTargets>,
    ) -> Self {
        Self::with_parts(
            runtime_home,
            plan_producer,
            targets,
            Arc::new(probe::AcpProbeRunner),
            ProbeEngineConfig::default(),
        )
    }

    pub fn with_parts(
        runtime_home: PathBuf,
        plan_producer: Arc<dyn GatewayModelResolve>,
        targets: Arc<dyn ProbeTargets>,
        runner: Arc<dyn ProbeRunner>,
        config: ProbeEngineConfig,
    ) -> Self {
        let engine_lock = lock::ProbeEngineLock::try_acquire(&runtime_home);
        let service = Self {
            runtime_home,
            engine_lock,
            slots: Mutex::new(HashMap::new()),
            harness_gates: Mutex::new(HashMap::new()),
            probe_semaphore: Arc::new(tokio::sync::Semaphore::new(
                config.max_concurrent_probes.max(1),
            )),
            plan_producer,
            targets,
            runner,
            config,
        };
        // Layer 3 of the cleanup story, live from the moment ownership is decided.
        //
        // Layers 1 and 2 (the thread-owned guard, and cancellation through the
        // token) cover every path where SOME code of ours runs. A SIGKILL or a power
        // loss runs none of it — and an abandoned scratch is not merely wasted
        // bytes: a native-codex probe materializes a COPY OF THE USER'S OWN
        // `~/.codex/auth.json` inside it, because relocating `CODEX_HOME` relocates
        // where codex looks for its login. That is real plaintext credential
        // material sitting under the runtime home with nothing to reclaim it.
        //
        // Sweeping here rather than only from a later startup pass means the
        // reclamation exists as soon as an engine exists. It is safe to do
        // synchronously: it lists one directory and is gated on both a dead pid and
        // an age older than three probe timeouts, and it is owner-only, so a
        // read-only sidecar can never delete the owner's in-flight scratch.
        service.sweep_orphan_scratch();
        service
    }

    pub fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }

    pub fn mode(&self) -> ProbeEngineMode {
        match self.engine_lock {
            Some(_) => ProbeEngineMode::Owner,
            None => ProbeEngineMode::ReadOnly,
        }
    }

    fn is_owner(&self) -> bool {
        self.engine_lock.is_some()
    }

    /// Reclaim scratch roots abandoned by a process that died without running any
    /// guard. Owner only: a read-only runtime must never delete the owner's
    /// in-flight scratch — that is the data-loss case the lock exists for.
    pub fn sweep_orphan_scratch(&self) {
        if !self.is_owner() {
            return;
        }
        let max_age = self
            .config
            .per_probe_timeout
            .saturating_mul(self.config.sweep_age_multiplier.max(1));
        let removed = route_auth::sweep_probe_scratch(&self.runtime_home, max_age);
        if !removed.is_empty() {
            tracing::info!(
                count = removed.len(),
                "removed abandoned model-snapshot probe scratch roots"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Pokes. Every one is fire-and-forget and returns immediately; no poke ever
    // blocks the operation that raised it.
    // -----------------------------------------------------------------------

    /// Poke every eligible (installed, non-excluded harness × active context).
    pub fn poke_all(self: Arc<Self>, reason: PokeReason) {
        if !self.is_owner() {
            return;
        }
        for harness in self.targets.auto_harnesses() {
            self.clone().poke_harness(&harness, reason);
        }
    }

    /// Poke one harness's active contexts.
    pub fn poke_harness(self: Arc<Self>, harness_kind: &str, reason: PokeReason) {
        if !self.is_owner() {
            return;
        }
        if !self.targets.is_installed(harness_kind) {
            // `probe_agent` bails without an install; recording a failed attempt
            // here would render as a probe error for a harness that simply is not
            // there yet.
            return;
        }
        for context in self.targets.active_contexts(harness_kind) {
            let engine = self.clone();
            let harness = harness_kind.to_string();
            tokio::spawn(async move {
                engine.probe_if_stale(&harness, &context, reason).await;
            });
        }
    }

    /// Poke exactly the harnesses an applied auth document names. The FINGERPRINT
    /// gate, not the handler, then decides which actually re-probe.
    pub fn poke_harnesses(self: Arc<Self>, harness_kinds: &[String], reason: PokeReason) {
        for harness in harness_kinds {
            self.clone().poke_harness(harness, reason);
        }
    }

    /// One gated attempt. The coalescing proof lives here: evaluate the gate with
    /// phase A only (no writes), take the per-key gate, RE-evaluate, and only then
    /// serialize per harness, take a semaphore permit, and probe. N simultaneous
    /// pokes for one key produce exactly one spawn; the losers observe the winner's
    /// entry.
    async fn probe_if_stale(&self, harness_kind: &str, auth_context_id: &str, reason: PokeReason) {
        if !self.is_owner() {
            return;
        }
        let slot = self.slot(harness_kind, auth_context_id);
        if !self.gate_admits(harness_kind, auth_context_id, &slot, Utc::now()) {
            return;
        }
        let _attempt_gate = slot.attempt_gate.lock().await;
        // The coalesce: the previous holder usually made this entry fresh.
        if !self.gate_admits(harness_kind, auth_context_id, &slot, Utc::now()) {
            return;
        }
        if let Err(error) = self
            .run_attempt(harness_kind, auth_context_id, &slot, reason)
            .await
        {
            // Automatic pokes swallow errors (the entry's `lastAttempt` carries
            // them); only a user-initiated refresh surfaces them.
            tracing::debug!(
                harness = harness_kind,
                context = auth_context_id,
                reason = reason.as_str(),
                %error,
                "model snapshot probe attempt failed"
            );
        }
    }

    /// Force a probe: skip the staleness gate, the backoff window and the
    /// completed-attempt floor, but still take every concurrency gate so a user
    /// mashing Refresh coalesces instead of stacking spawns.
    ///
    /// **Why the fingerprint is captured BEFORE queueing.** A user presses Refresh
    /// *because* their key just changed. Coalescing them onto an in-flight probe
    /// that materialized the PREVIOUS credential, then labelling that result
    /// "refreshed just now", is a lie the UI cannot detect. So we adopt a
    /// coalesced winner only when it observed the same credential we were asked
    /// about AND finished after we asked. Two refreshes straddling a rotation
    /// therefore produce two spawns, which is the correct answer.
    pub async fn refresh_now(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
    ) -> Result<SnapshotEntry, RefreshError> {
        if !self.is_owner() {
            return Err(RefreshError::NotOwner);
        }
        if !self.targets.is_installed(harness_kind) {
            return Err(RefreshError::NotInstalled(harness_kind.to_string()));
        }
        let contexts = self.targets.active_contexts(harness_kind);
        if !contexts.iter().any(|context| context == auth_context_id) {
            return Err(RefreshError::UnknownContext {
                harness_kind: harness_kind.to_string(),
                auth_context_id: auth_context_id.to_string(),
            });
        }

        let requested_at = Utc::now();
        let fingerprint_at_request = self
            .material(harness_kind, auth_context_id)
            .map(|material| fingerprint::fingerprint(&material))?;
        // So pressing Refresh after adding a model on the gateway genuinely
        // re-asks `/v1/models` rather than reusing a memoized plan.
        self.plan_producer
            .invalidate_gateway_plan(harness_kind);

        let slot = self.slot(harness_kind, auth_context_id);
        let _attempt_gate = slot.attempt_gate.lock().await;

        if let Some(entry) = self.entry(harness_kind, auth_context_id) {
            let covers_this_request = entry.auth_fingerprint == fingerprint_at_request
                && DateTime::parse_from_rfc3339(&entry.probed_at)
                    .map(|probed_at| probed_at.with_timezone(&Utc) >= requested_at)
                    .unwrap_or(false);
            if covers_this_request {
                return Ok(entry);
            }
        }
        self.run_attempt(harness_kind, auth_context_id, &slot, PokeReason::Manual)
            .await
    }

    // -----------------------------------------------------------------------
    // The gate.
    // -----------------------------------------------------------------------

    /// Read-only: no scratch dir, no `FileSpec`, no plaintext on disk. Called on
    /// EVERY evaluation, which is why it must stay cheap — a startup pass over an
    /// all-fresh machine's 17 contexts performs 17 state reads and zero writes.
    fn gate_admits(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
        slot: &ContextSlot,
        now: DateTime<Utc>,
    ) -> bool {
        {
            let state = slot.state.lock().expect("model snapshot slot poisoned");
            // Queued counts as in-flight: a second poke must coalesce onto the
            // attempt already waiting for a slot, not queue a duplicate behind it.
            if matches!(
                state.live,
                status::LiveState::Queued | status::LiveState::Running
            ) {
                return false;
            }
            // The structural floor, applied BEFORE the staleness rules so it holds
            // no matter what those rules answer.
            if let Some(completed_at) = state.last_completed_at {
                if now.signed_duration_since(completed_at).num_seconds()
                    < self.config.min_reprobe_interval.as_secs() as i64
                {
                    return false;
                }
            }
            if let Some(next_attempt_at) = state.next_attempt_at {
                if now < next_attempt_at {
                    return false;
                }
            }
        }
        let Ok(material) = self.material(harness_kind, auth_context_id) else {
            // An unresolvable context (a selection the machine cannot honor) is
            // not a probe candidate. `refresh_now` still surfaces the error to the
            // user who asked.
            return false;
        };
        let freshness = staleness::evaluate(
            self.entry(harness_kind, auth_context_id).as_ref(),
            install_identity_of(&self.runtime_home, harness_kind).as_ref(),
            &fingerprint::fingerprint(&material),
            now,
            staleness::ttl_for_entry_with(
                harness_kind,
                auth_context_id,
                self.config.ttl_base,
                self.config.ttl_jitter_span,
            ),
        );
        matches!(freshness, Freshness::Stale(_))
    }

    fn material(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
    ) -> Result<route_auth::ProbeAuthMaterial, RouteAuthError> {
        route_auth::probe_auth_material(
            &self.runtime_home,
            harness_kind,
            auth_context_id,
            &self.targets.catalog_contexts(harness_kind),
        )
    }

    fn slot(&self, harness_kind: &str, auth_context_id: &str) -> Arc<ContextSlot> {
        let mut slots = self.slots.lock().expect("model snapshot slots poisoned");
        slots
            .entry((harness_kind.to_string(), auth_context_id.to_string()))
            .or_insert_with(|| {
                Arc::new(ContextSlot {
                    attempt_gate: tokio::sync::Mutex::new(()),
                    state: Mutex::new(ContextRuntimeState::default()),
                })
            })
            .clone()
    }

    /// Deterministic ±20% spread over a backoff delay, keyed on (harness, context,
    /// attempt). Exposed on the impl only so tests can pin it; the arithmetic is a
    /// free function below.
    #[cfg(test)]
    pub(crate) fn test_jittered_backoff(
        harness_kind: &str,
        auth_context_id: &str,
        attempt: u32,
        base_seconds: u64,
    ) -> i64 {
        backoff::jittered_backoff_seconds(harness_kind, auth_context_id, attempt, base_seconds)
    }

    /// Set the live state, so a polling surface can tell "waiting for a slot" from
    /// "a harness process is running" from "nothing is happening".
    fn set_live_state(&self, slot: &ContextSlot, live: status::LiveState) {
        slot.state
            .lock()
            .expect("model snapshot slot poisoned")
            .live = live;
    }

    fn harness_gate(&self, harness_kind: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut gates = self
            .harness_gates
            .lock()
            .expect("model snapshot harness gates poisoned");
        gates
            .entry(harness_kind.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }
}
