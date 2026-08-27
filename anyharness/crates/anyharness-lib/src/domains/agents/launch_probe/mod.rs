//! The event-driven scheduler for target-observed harness launch options.
//!
//! `LaunchProbeService` is the domain's public face: **one composed observation
//! per harness, refreshed by events.** A poke probes — there is no staleness
//! gate, no fingerprint, and no
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
//! - [`live_state`] holds one slot's live phase and the RAII guard over it,
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
mod live_state;
mod phase;
use phase::abandoned_attempt_after;
pub use phase::{LivePhaseReading, ProbePhase};
pub mod lock;
pub mod probe;
pub mod targets;

#[cfg(test)]
mod contradiction_tests;
#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
mod runner_tests;
#[cfg(test)]
pub(crate) mod test_support;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};

use crate::domains::agents::route_auth::{self, GatewayModelResolve, RouteAuthError};

pub use config::{PokeReason, ProbeEngineConfig, ProbeEngineMode, RefreshError};
use live_state::{HarnessRuntimeState, LiveState, LiveStateGuard};
use probe::ProbeRunner;
use targets::ProbeTargets;

struct HarnessSlot {
    /// Serializes attempts for this harness — the single-flight gate. Coalescing
    /// callers re-check the document after acquiring: the previous holder usually
    /// probed for them, which is the whole coalescing mechanism.
    attempt_gate: tokio::sync::Mutex<()>,
    state: Mutex<HarnessRuntimeState>,
}

pub struct LaunchProbeService {
    runtime_home: PathBuf,
    /// `None` ⇒ read-only mode: serve the document, never probe, never sweep.
    engine_lock: Option<lock::ProbeEngineLock>,
    slots: Mutex<HashMap<String, Arc<HarnessSlot>>>,
    probe_semaphore: Arc<tokio::sync::Semaphore>,
    plan_producer: Arc<dyn GatewayModelResolve>,
    targets: Arc<dyn ProbeTargets>,
    runner: Arc<dyn ProbeRunner>,
    config: ProbeEngineConfig,
    /// How long a durable `probing` row may be believed before it is treated as
    /// abandoned. Computed once: the registry's size cannot change at runtime, and
    /// a read must not pay for an install scan.
    abandoned_attempt_after: chrono::Duration,
    /// Has this owner dispatched its startup pass yet? Until it has, an empty slot
    /// map means "nothing has run YET", not "nothing will".
    startup_pass_dispatched: AtomicBool,
    /// When this engine was constructed, so the pre-startup grace above is bounded
    /// by wall clock and not only by a pass that might never arrive.
    started_at: DateTime<Utc>,
    /// Atomic cutover sink/read owner. The probe scheduler remains here only
    /// until the module rename is complete; executable launch truth is written
    /// exclusively through this service.
    launch_options:
        Option<Arc<crate::domains::agents::launch_options::HarnessLaunchOptionsService>>,
    /// Weak self-handle, bound once after `Arc` construction ([`Self::bind_self`]),
    /// so `record_failure`'s one-shot backoff-expiry timer can re-enter the poke
    /// path (`poke_harness` needs `Arc<Self>`, and the failure site only has
    /// `&self`). Unbound — an engine a test constructed without calling
    /// `bind_self` — means no timer is armed and a lapsed backoff waits for the
    /// next external poke, the pre-recovery behavior.
    self_handle: std::sync::OnceLock<std::sync::Weak<LaunchProbeService>>,
    /// The status-document service's probe-evidence intake: attempt admission
    /// marks the harness's document stale, completion writes the verdict.
    /// Event-pushed from here rather than polled from there, so the document
    /// can never claim a probe state the engine doesn't hold.
    agent_status: Option<Arc<crate::domains::agents::status::AgentStatusService>>,
}

impl LaunchProbeService {
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
        let abandoned_attempt_after = abandoned_attempt_after(&config);
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
            config,
            abandoned_attempt_after,
            startup_pass_dispatched: AtomicBool::new(false),
            started_at: Utc::now(),
            launch_options: None,
            self_handle: std::sync::OnceLock::new(),
            agent_status: None,
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

    pub fn with_launch_options(
        mut self,
        launch_options: Arc<crate::domains::agents::launch_options::HarnessLaunchOptionsService>,
    ) -> Self {
        self.launch_options = Some(launch_options);
        self
    }

    pub fn with_agent_status(
        mut self,
        agent_status: Arc<crate::domains::agents::status::AgentStatusService>,
    ) -> Self {
        self.agent_status = Some(agent_status);
        self
    }

    /// Bind the engine's own `Arc` so failure-armed backoff-expiry timers can
    /// poke back into it. Called once at wiring (and by tests that exercise
    /// the self-recovery); a second call is a no-op.
    pub fn bind_self(self: &Arc<Self>) {
        let _ = self.self_handle.set(Arc::downgrade(self));
    }

    /// Probe evidence intake (spec §3 flow 4, the serve-stale semantics): the
    /// document goes stale the moment an attempt is admitted — queued counts —
    /// and the last observation stays visible while the re-probe runs.
    fn notify_probe_admitted(&self, harness_kind: &str) {
        if let Some(agent_status) = self.agent_status.as_ref() {
            agent_status.probe_admitted(harness_kind);
        }
    }

    pub(super) fn notify_probe_verified(&self, harness_kind: &str, at: DateTime<Utc>) {
        if let Some(agent_status) = self.agent_status.as_ref() {
            agent_status.probe_verified(harness_kind, at);
        }
    }

    pub(super) fn notify_probe_failed(&self, harness_kind: &str, at: DateTime<Utc>) {
        if let Some(agent_status) = self.agent_status.as_ref() {
            agent_status.probe_failed(harness_kind, at);
        }
    }

    /// Arm the self-recovery for a failed attempt (spec §3 flow 4: the event
    /// set contains its own recovery). One-shot: sleeps until the armed
    /// `next_attempt_at`, then pokes `BackoffExpired` — but only if the slot
    /// still carries EXACTLY the captured instant. A newer failure re-armed a
    /// later timer (which took its own copy), and a success cleared the window
    /// entirely; in both cases this timer is stale and dies silently. The
    /// ordinary coalescing and backoff admission downstream do the rest.
    fn arm_backoff_expiry(
        &self,
        harness_kind: &str,
        slot: Arc<HarnessSlot>,
        next_attempt_at: DateTime<Utc>,
    ) {
        let Some(weak) = self.self_handle.get().cloned() else {
            return;
        };
        let harness = harness_kind.to_string();
        tokio::spawn(async move {
            // Sleep in a loop: chrono→std truncation can wake a hair early,
            // and an early poke would be REFUSED by `backoff_admits` — killing
            // the one recovery this timer exists to deliver.
            loop {
                let now = Utc::now();
                if now >= next_attempt_at {
                    break;
                }
                let wait = (next_attempt_at - now)
                    .to_std()
                    .unwrap_or(std::time::Duration::from_millis(1));
                tokio::time::sleep(wait.max(std::time::Duration::from_millis(1))).await;
            }
            let still_armed = slot
                .state
                .lock()
                .expect("launch probe slot poisoned")
                .next_attempt_at
                == Some(next_attempt_at);
            if !still_armed {
                return;
            }
            let Some(engine) = weak.upgrade() else {
                return;
            };
            engine.poke_harness(&harness, PokeReason::BackoffExpired);
        });
    }

    pub fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }

    /// The slot read both phase surfaces share. An unknown harness has no slot
    /// and therefore no attempt: `Idle`.
    fn live_phase(&self, harness_kind: &str, now: DateTime<Utc>) -> (ProbePhase, Option<String>) {
        let slots = self.slots.lock().expect("launch probe slots poisoned");
        let Some(slot) = slots.get(harness_kind) else {
            return (ProbePhase::Idle, None);
        };
        let state = slot.state.lock().expect("launch probe slot poisoned");
        match state.live {
            LiveState::Queued => (ProbePhase::Queued, None),
            LiveState::Running => (ProbePhase::Running, None),
            LiveState::Idle => match state.next_attempt_at {
                Some(next) if next > now => (ProbePhase::Backoff, Some(next.to_rfc3339())),
                _ => (ProbePhase::Idle, None),
            },
        }
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
        if reason == PokeReason::Startup {
            self.mark_startup_pass_dispatched();
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
        if !reason.allows_manual_refresh_only_harness()
            && !self.targets.allows_automatic_probe(harness_kind)
        {
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
        let engine = self.clone();
        let harness = harness_kind.to_string();
        tokio::spawn(async move {
            engine.probe_on_event(&harness, reason).await;
        });
    }

    /// Poke one harness through an OPTIONAL engine handle — the shape every automatic
    /// call site has, since each of them holds `Option<Arc<LaunchProbeService>>`
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

    /// [`LaunchProbeService::poke_optional`]'s whole-machine sibling.
    pub fn poke_all_optional(engine: &Option<Arc<Self>>, reason: PokeReason) {
        if let Some(engine) = engine.clone() {
            engine.poke_all(reason);
        }
    }

    /// [`LaunchProbeService::poke_optional`] for a named set of harnesses.
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
        // Admitted BEFORE the gate wait, which is what `LiveStateGuard` has always
        // claimed and is the common case at `max_concurrent_probes = 1`. The same
        // event that moves the auth basis is the one that invalidates the client's
        // cache, so a slot that reads `idle` across this wait stops its polling for
        // good. Every exit below drops the guard, including a coalesce return and
        // this future being abandoned mid-wait.
        let live_state = self.admit_attempt(slot.clone());
        self.notify_probe_admitted(harness_kind);
        let _attempt_gate = slot.attempt_gate.lock().await;
        // The coalesce: the previous holder usually probed for this poke already.
        // Failed attempts count too — N pokes racing a failing probe coalesce
        // onto its one failure rather than each retrying it.
        if attempt_covers(
            slot.state
                .lock()
                .expect("probe slot poisoned")
                .last_attempt_at,
            poked_at,
        ) {
            return;
        }
        if !self.backoff_admits(&slot, Utc::now()) {
            return;
        }
        if let Err(error) = self
            .run_attempt(harness_kind, &slot, reason, live_state)
            .await
        {
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
    pub async fn refresh_now(&self, harness_kind: &str) -> Result<(), RefreshError> {
        if !self.is_owner() {
            return Err(RefreshError::NotOwner);
        }
        if !self.targets.is_installed(harness_kind) {
            return Err(RefreshError::NotInstalled(harness_kind.to_string()));
        }
        // So pressing Refresh after adding a model on the gateway genuinely
        // re-asks `/v1/models` rather than reusing a memoized plan.
        self.plan_producer.invalidate_gateway_plan(harness_kind);

        let slot = self.slot(harness_kind);
        let live_state = self.admit_attempt(slot.clone());
        self.notify_probe_admitted(harness_kind);
        let _attempt_gate = slot.attempt_gate.lock().await;

        self.run_attempt(harness_kind, &slot, PokeReason::Manual, live_state)
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

    fn material(
        &self,
        harness_kind: &str,
    ) -> Result<route_auth::ProbeAuthMaterial, RouteAuthError> {
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
    pub(crate) fn test_jittered_backoff(
        harness_kind: &str,
        attempt: u32,
        base_seconds: u64,
    ) -> i64 {
        backoff::jittered_backoff_seconds(harness_kind, attempt, base_seconds)
    }

    /// Admit an attempt to `slot`'s live state, RAII-style: `Queued` immediately,
    /// and back to `Idle` when the LAST admitted attempt lets go — regardless of
    /// which exit runs, including a future dropped mid-probe (F-036) or abandoned
    /// while queued on the gate. See [`LiveStateGuard`].
    fn admit_attempt(&self, slot: Arc<HarnessSlot>) -> LiveStateGuard {
        LiveStateGuard::admit(slot)
    }
}

/// Does an attempt stamped `attempt_at` cover a poke made at `poked_at`?
fn attempt_covers(attempt_at: Option<DateTime<Utc>>, poked_at: DateTime<Utc>) -> bool {
    attempt_at.map(|at| at >= poked_at).unwrap_or(false)
}
