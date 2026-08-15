//! The machine model snapshot: probe on events, persist, serve.
//!
//! `ModelSnapshotService` is the domain's public face. Its rule is the one
//! model-catalog.md states: **one composed observation per harness, refreshed by
//! events.** A poke probes — there is no staleness gate, no fingerprint, and no
//! TTL deciding whether to; the closed event set (startup pass, auth-apply,
//! install completed, login-terminal exit, manual refresh) is the whole freshness
//! model, and the engine's only jobs beyond running the probe are the lifecycle
//! guards that protect live sessions and the machine:
//!
//! - [`probe`] runs one attempt on a thread that owns its child and its scratch,
//! - [`document`] is the wire schema plus atomic read/write (one per harness),
//! - [`entry`] projects a raw `ProbeSnapshot` into the document (pure),
//! - [`targets`] answers which harnesses may be probed (and holds cursor's
//!   manual-refresh-only carve-out),
//! - [`lock`] enforces one engine per runtime home,
//! - [`status`] projects the polled status surface (pure),
//! - [`detail`] makes a harness's own error text safe to persist (pure),
//! - [`backoff`] spreads the failure-retry window (pure),
//! - [`attempt`] executes one admitted attempt and persists its outcome,
//! - [`universe`] serves the observation to launch validation,
//! - this file is the reconciler: single-flight, the pokes, and the brakes.
//!
//! **The brakes**, each stopping a different runaway:
//! 1. single-flight per harness — concurrent triggers coalesce onto one in-flight
//!    probe; queued counts as in-flight, and losers observe the winner's document;
//! 2. exponential backoff on failure, so a hard-down harness is not hammered by a
//!    burst of events;
//! 3. a machine-wide semaphore of 1, because every probe is a real harness
//!    process.

mod attempt;
mod backoff;
pub mod config;
mod detail;
pub mod document;
mod entry;
mod reads;
pub mod lock;
pub mod probe;
pub mod status;
pub mod targets;
pub mod trial;
pub mod universe;

#[cfg(test)]
mod engine_tests;
#[cfg(test)]
mod runner_tests;
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
use document::ModelSnapshotDocument;
use probe::ProbeRunner;
use targets::ProbeTargets;
use trial::Tier1TrialEngine;

/// The engine's live, in-memory view of one harness.
///
/// Not persisted, deliberately: a restart costs at most one extra attempt, the
/// same tradeoff the spec already accepts for the Worker's upload state. Persisting
/// backoff would mean a machine could boot already-throttled with no way for a user
/// to tell why.
#[derive(Debug)]
struct HarnessRuntimeState {
    /// What a polling surface is told. `Queued` is set the moment an attempt is
    /// admitted to this slot — BEFORE it waits on the single-flight gate and the
    /// machine-wide semaphore — so a probe that is genuinely pending never reports
    /// `idle`. At `max_concurrent_probes = 1` that wait is the common case, not an
    /// edge one.
    live: status::LiveState,
    consecutive_failures: u32,
    next_attempt_at: Option<DateTime<Utc>>,
}

impl Default for HarnessRuntimeState {
    fn default() -> Self {
        Self {
            live: status::LiveState::Idle,
            consecutive_failures: 0,
            next_attempt_at: None,
        }
    }
}

struct HarnessSlot {
    /// Serializes attempts for this harness — the single-flight gate. Coalescing
    /// callers re-check the document after acquiring: the previous holder usually
    /// probed for them, which is the whole coalescing mechanism.
    attempt_gate: tokio::sync::Mutex<()>,
    state: Mutex<HarnessRuntimeState>,
}

/// RAII guard over one [`HarnessSlot`]'s live state, for the lifetime of a single
/// attempt (F-036).
///
/// Before this guard, `run_attempt` set `Queued`/`Running`/`Idle` as three bare
/// statements straddling await points (the single-flight gate, the machine-wide
/// semaphore, and the probe itself). Dropping the caller's future anywhere
/// between the first write and the last — a client that disconnects mid
/// `refresh_now`, a task that gets aborted — skipped the final `Idle` write and
/// left the slot pinned at `Queued` or `Running` forever, because the in-flight
/// check treats both as in-flight and refuses every subsequent poke for that
/// harness. A wedge like that is invisible from the status surface too: it reads
/// a plausible `queued`/`running` forever.
///
/// The fix mirrors two guards this module already has: `ProbeScratch` removes its
/// scratch root on `Drop`, and the `CancellationToken` guard in `probe.rs` fires
/// cancellation on `Drop`. Both make their piece of attempt state correct by
/// construction, covering return, `?`, panic and future-drop alike.
struct LiveStateGuard {
    slot: Arc<HarnessSlot>,
}

impl LiveStateGuard {
    /// Admits the attempt: sets `Queued` immediately, BEFORE the single-flight
    /// gate and the machine-wide semaphore, so a probe that is genuinely pending
    /// never reports `idle`.
    fn admit(slot: Arc<HarnessSlot>) -> Self {
        let guard = Self { slot };
        guard.set(status::LiveState::Queued);
        guard
    }

    /// The attempt cleared both concurrency waits and is now inside the probe
    /// itself.
    fn running(&self) {
        self.set(status::LiveState::Running);
    }

    fn set(&self, live: status::LiveState) {
        self.slot
            .state
            .lock()
            .expect("model snapshot slot poisoned")
            .live = live;
    }
}

impl Drop for LiveStateGuard {
    fn drop(&mut self) {
        // Every exit out of `run_attempt` lands here: the success return, the
        // failure return, an early `?`, a panic unwinding through the frame, or —
        // the case F-036 proved reachable — the whole future being dropped
        // without any of `run_attempt`'s own code running again.
        self.set(status::LiveState::Idle);
    }
}

pub struct ModelSnapshotService {
    runtime_home: PathBuf,
    /// `None` ⇒ read-only mode: serve the document, never probe, never sweep.
    engine_lock: Option<lock::ProbeEngineLock>,
    slots: Mutex<HashMap<String, Arc<HarnessSlot>>>,
    probe_semaphore: Arc<tokio::sync::Semaphore>,
    plan_producer: Arc<dyn GatewayModelResolve>,
    targets: Arc<dyn ProbeTargets>,
    runner: Arc<dyn ProbeRunner>,
    /// The tier-1 credential trial engine (ADR FR-2). Fired off the same pokes as
    /// the probe; a no-op unless `config.tier1_trial_enabled`.
    trial: Arc<Tier1TrialEngine>,
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
        let trial = Arc::new(Tier1TrialEngine::new(
            config.tier1_trial_enabled,
            runtime_home.clone(),
        ));
        let service = Self {
            runtime_home,
            engine_lock,
            slots: Mutex::new(HashMap::new()),
            probe_semaphore: Arc::new(tokio::sync::Semaphore::new(
                config.max_concurrent_probes.max(1),
            )),
            plan_producer,
            targets,
            runner,
            trial,
            config,
        };
        // The orphan sweep, live from the moment ownership is decided.
        //
        // The thread-owned guard and the cancellation token cover every path where
        // SOME code of ours runs. A SIGKILL or a power loss runs none of it — and an
        // abandoned scratch is not merely wasted bytes: a native-codex probe
        // materializes a COPY OF THE USER'S OWN `~/.codex/auth.json` inside it,
        // because relocating `CODEX_HOME` relocates where codex looks for its login.
        // That is real plaintext credential material sitting under the runtime home
        // with nothing to reclaim it.
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
    // blocks the operation that raised it, and no poke site is anything but one
    // of the closed event set (see `PokeReason`).
    // -----------------------------------------------------------------------

    /// Poke every eligible (installed, non-excluded) harness — the unconditional
    /// whole-machine pass. Deliberately bookkeeping-free: no comparison decides
    /// whether to probe, because the comparison machinery cost more in complexity
    /// than the handful of background spawns it saved.
    pub fn poke_all(self: Arc<Self>, reason: PokeReason) {
        if !self.is_owner() {
            return;
        }
        for harness in self.targets.auto_harnesses() {
            self.clone().poke_harness(&harness, reason);
        }
    }

    /// Poke one harness.
    ///
    /// **The single chokepoint for the manual-refresh-only law.** Every poke site
    /// funnels through here — `poke_all` and `poke_harnesses` both delegate — so an
    /// excluded harness is unreachable by an automatic poke no matter which site
    /// raised it. Enforcing it at the call sites instead is exactly the bug this
    /// shape prevents: the exclusion previously lived only in the whole-machine
    /// enumeration, so the pokes that name a harness directly bypassed it and
    /// spawned `cursor-agent` unattended.
    pub fn poke_harness(self: Arc<Self>, harness_kind: &str, reason: PokeReason) {
        if !self.is_owner() {
            return;
        }
        if !reason.is_user_initiated() && !self.targets.allows_automatic_probe(harness_kind) {
            tracing::debug!(
                harness = harness_kind,
                reason = reason.as_str(),
                "skipping an automatic probe for a manual-refresh-only harness"
            );
            return;
        }
        if !self.targets.is_installed(harness_kind) {
            // `probe_agent` bails without an install; recording a failed attempt
            // here would render as a probe error for a harness that simply is not
            // there yet.
            return;
        }
        // The tier-1 trial rides the SAME event, single-flight and gated by its
        // own flag; it never spawns a harness, so it runs alongside the probe
        // rather than instead of it.
        self.trial.poke(harness_kind);
        let engine = self.clone();
        let harness = harness_kind.to_string();
        tokio::spawn(async move {
            engine.probe_on_event(&harness, reason).await;
        });
    }

    /// Poke one harness through an OPTIONAL engine handle — the shape every automatic
    /// call site has, since each of them holds `Option<Arc<ModelSnapshotService>>`
    /// (`None` means this build's pokes are suppressed, never "probe anyway").
    ///
    /// A named function rather than an `if let` repeated at the sites, so a test can
    /// drive the exact code those sites run. Asserting a handler's status code proves
    /// only that the poke did not break the response; asserting through here proves the
    /// poke reached the engine and named the right harness.
    pub fn poke_optional(engine: &Option<Arc<Self>>, harness_kind: &str, reason: PokeReason) {
        if let Some(engine) = engine.clone() {
            engine.poke_harness(harness_kind, reason);
        }
    }

    /// [`ModelSnapshotService::poke_optional`]'s whole-machine sibling.
    pub fn poke_all_optional(engine: &Option<Arc<Self>>, reason: PokeReason) {
        if let Some(engine) = engine.clone() {
            engine.poke_all(reason);
        }
    }

    /// [`ModelSnapshotService::poke_optional`] for a named set of harnesses.
    pub fn poke_harnesses_optional(
        engine: &Option<Arc<Self>>,
        harness_kinds: &[String],
        reason: PokeReason,
    ) {
        if let Some(engine) = engine.clone() {
            engine.poke_harnesses(harness_kinds, reason);
        }
    }

    /// Poke exactly the harnesses an applied auth document names.
    pub fn poke_harnesses(self: Arc<Self>, harness_kinds: &[String], reason: PokeReason) {
        if !self.is_owner() {
            return;
        }
        for harness in harness_kinds {
            self.clone().poke_harness(harness, reason);
        }
    }

    /// One event-driven attempt. The coalescing proof lives here: take the
    /// single-flight gate, then check whether an attempt that STARTED AFTER this
    /// poke already answered it, and only then take a semaphore permit and probe.
    /// N simultaneous pokes for one harness produce exactly one spawn; the losers
    /// observe the winner's document.
    ///
    /// Deliberately queueing rather than skipping on in-flight: an event that
    /// lands while a probe of the PREVIOUS auth world is mid-flight must still
    /// produce a probe of the new one, or the event chain's guarantee — "the
    /// observation was probed after the last applied auth change" — silently
    /// breaks. The winner's document coalesces this poke only when the winner's
    /// attempt postdates it.
    async fn probe_on_event(&self, harness_kind: &str, reason: PokeReason) {
        if !self.is_owner() {
            return;
        }
        let poked_at = Utc::now();
        let slot = self.slot(harness_kind);
        let _attempt_gate = slot.attempt_gate.lock().await;
        // The coalesce: the previous holder usually probed for this poke already.
        // Failed attempts count too — N pokes racing a failing probe coalesce
        // onto its one failure rather than each retrying it.
        if attempt_covers(self.document_last_attempt_at(harness_kind), poked_at) {
            return;
        }
        if !self.backoff_admits(&slot, Utc::now()) {
            return;
        }
        if let Err(error) = self.run_attempt(harness_kind, &slot, reason).await {
            // Automatic pokes swallow errors (the document's `lastAttempt` carries
            // them); only a user-initiated refresh surfaces them.
            tracing::debug!(
                harness = harness_kind,
                reason = reason.as_str(),
                %error,
                "model snapshot probe attempt failed"
            );
        }
    }

    /// Force a probe: skip the failure backoff, but still take the single-flight
    /// gate so a user mashing Refresh coalesces instead of stacking spawns.
    ///
    /// A coalesced winner is adopted only when its SUCCESSFUL observation landed
    /// after this request was made — "refreshed just now" must never label a
    /// result that predates the press.
    pub async fn refresh_now(
        &self,
        harness_kind: &str,
    ) -> Result<ModelSnapshotDocument, RefreshError> {
        if !self.is_owner() {
            return Err(RefreshError::NotOwner);
        }
        if !self.targets.is_installed(harness_kind) {
            return Err(RefreshError::NotInstalled(harness_kind.to_string()));
        }
        // A manual refresh re-runs the tier-1 trial too, so a just-pasted or
        // just-rotated credential's verdict refreshes with the model list.
        self.trial.poke(harness_kind);
        let requested_at = Utc::now();
        // So pressing Refresh after adding a model on the gateway genuinely
        // re-asks `/v1/models` rather than reusing a memoized plan.
        self.plan_producer.invalidate_gateway_plan(harness_kind);

        let slot = self.slot(harness_kind);
        let _attempt_gate = slot.attempt_gate.lock().await;

        if let Some(document) = self.document(harness_kind) {
            if attempt_covers(Some(document.probed_at.clone()), requested_at) {
                return Ok(document);
            }
        }
        self.run_attempt(harness_kind, &slot, PokeReason::Manual)
            .await
    }

    // -----------------------------------------------------------------------
    // Admission: the failure backoff. NOT a freshness gate — freshness is
    // event-driven, and an admitted poke probes.
    // -----------------------------------------------------------------------

    /// The failure ladder: a hard-down harness is not re-spawned by every event
    /// inside the window. A manual refresh bypasses this (it never calls here),
    /// and the window is armed by failures only — a success arms nothing.
    fn backoff_admits(&self, slot: &HarnessSlot, now: DateTime<Utc>) -> bool {
        let state = slot.state.lock().expect("model snapshot slot poisoned");
        match state.next_attempt_at {
            Some(next_attempt_at) => now >= next_attempt_at,
            None => true,
        }
    }

    /// The most recent attempt timestamp of ANY outcome, off the document.
    /// Failure timestamps count too: N pokes racing a failing probe must
    /// coalesce onto the one failed attempt, not each retry it.
    fn document_last_attempt_at(&self, harness_kind: &str) -> Option<String> {
        self.document(harness_kind)
            .map(|document| document.last_attempt.at)
    }

    fn material(&self, harness_kind: &str) -> Result<route_auth::ProbeAuthMaterial, RouteAuthError> {
        route_auth::probe_auth_material(&self.runtime_home, harness_kind)
    }

    fn slot(&self, harness_kind: &str) -> Arc<HarnessSlot> {
        let mut slots = self.slots.lock().expect("model snapshot slots poisoned");
        slots
            .entry(harness_kind.to_string())
            .or_insert_with(|| {
                Arc::new(HarnessSlot {
                    attempt_gate: tokio::sync::Mutex::new(()),
                    state: Mutex::new(HarnessRuntimeState::default()),
                })
            })
            .clone()
    }

    /// Deterministic ±20% spread over a backoff delay, keyed on (harness,
    /// attempt). Exposed on the impl only so tests can pin it; the arithmetic is
    /// a free function in `backoff.rs`.
    #[cfg(test)]
    pub(crate) fn test_jittered_backoff(harness_kind: &str, attempt: u32, base_seconds: u64) -> i64 {
        backoff::jittered_backoff_seconds(harness_kind, attempt, base_seconds)
    }

    /// Admit an attempt to `slot`'s live state, RAII-style: `Queued` immediately,
    /// `Idle` on `Drop` — regardless of which of `run_attempt`'s exits runs,
    /// including a future dropped mid-probe (F-036). See [`LiveStateGuard`].
    fn admit_attempt(&self, slot: Arc<HarnessSlot>) -> LiveStateGuard {
        LiveStateGuard::admit(slot)
    }
}

/// Does an attempt stamped `attempt_at` cover a poke made at `poked_at`?
fn attempt_covers(attempt_at: Option<String>, poked_at: DateTime<Utc>) -> bool {
    attempt_at
        .and_then(|at| DateTime::parse_from_rfc3339(&at).ok())
        .map(|at| at.with_timezone(&Utc) >= poked_at)
        .unwrap_or(false)
}
