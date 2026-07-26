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
//! - this file is the reconciler: gate, coalescing, serialization, backoff, floor.
//!
//! **Four independent brakes**, because each stops a different runaway:
//! 1. the staleness gate — nothing re-probes a fresh entry;
//! 2. a 60s completed-attempt floor per key — the structural defense, which bounds
//!    the damage of a mis-stated gate rule to one probe per minute instead of one
//!    per poke (a rule WAS mis-stated once; see `staleness.rs`);
//! 3. exponential backoff on failure, so a hard-down provider is not hammered;
//! 4. per-harness serialization plus a machine-wide semaphore of 1, because every
//!    probe is a real harness process.

pub mod config;
pub mod document;
mod entry;
mod reads;
pub mod fingerprint;
pub mod lock;
pub mod probe;
pub mod staleness;
pub mod status;
pub mod targets;

#[cfg(test)]
mod engine_tests;
#[cfg(test)]
mod runner_tests;
#[cfg(test)]
mod staleness_tests;
#[cfg(test)]
pub(crate) mod test_support;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};

use crate::domains::agents::route_auth::{self, GatewayModelResolve, RouteAuthError};

pub use config::{PokeReason, ProbeEngineConfig, ProbeEngineMode, RefreshError};
use document::{install_identity_of, write_entry, AttemptOutcome, SnapshotAttempt, SnapshotEntry};
use entry::entry_from_snapshot;
use probe::{ProbeRequest, ProbeRunner};
use staleness::Freshness;
use targets::ProbeTargets;

/// The engine's live, in-memory view of one (harness, context).
///
/// Not persisted, deliberately: a restart costs at most one extra attempt, the
/// same tradeoff the spec already accepts for the Worker's upload state. Persisting
/// backoff would mean a machine could boot already-throttled with no way for a user
/// to tell why.
#[derive(Debug, Default)]
struct ContextRuntimeState {
    running: bool,
    consecutive_failures: u32,
    next_attempt_at: Option<DateTime<Utc>>,
    last_completed_at: Option<DateTime<Utc>>,
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
        Self {
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
        }
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
            if state.running {
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

    // -----------------------------------------------------------------------
    // One attempt, start to persisted finish.
    // -----------------------------------------------------------------------

    async fn run_attempt(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
        slot: &ContextSlot,
        reason: PokeReason,
    ) -> Result<SnapshotEntry, RefreshError> {
        let material = self.material(harness_kind, auth_context_id)?;
        let fingerprint = fingerprint::fingerprint(&material);
        // One state read serves the gate, the plan lookup and the scratch's
        // revision-keyed dirs, so they cannot land on different revisions.
        let plan = self
            .plan_producer
            .resolve_gateway_models(harness_kind, material.state_revision);
        // Captured BEFORE the spawn, from the manifest: what the entry records must
        // be what the gate will later compare against.
        let install_identity = install_identity_of(&self.runtime_home, harness_kind);

        let harness_gate = self.harness_gate(harness_kind);
        let _harness_permit = harness_gate.lock().await;
        let _permit = self
            .probe_semaphore
            .acquire()
            .await
            .expect("probe semaphore closed");

        self.mark_running(slot, true);
        let outcome = self
            .runner
            .run(ProbeRequest {
                harness_kind: harness_kind.to_string(),
                auth_context_id: auth_context_id.to_string(),
                material,
                plan,
                runtime_home: self.runtime_home.clone(),
                per_probe_timeout: self.config.per_probe_timeout,
                model_switch_timeout: self.config.model_switch_timeout,
            })
            .await;
        self.mark_running(slot, false);

        let now = Utc::now();
        match outcome {
            Ok(snapshot) => {
                let entry = entry_from_snapshot(snapshot, fingerprint, install_identity, now);
                if let Err(error) =
                    write_entry(&self.runtime_home, harness_kind, auth_context_id, entry.clone())
                {
                    tracing::warn!(
                        harness = harness_kind,
                        context = auth_context_id,
                        %error,
                        "failed to persist the model snapshot entry"
                    );
                }
                self.record_completion(slot, now, None);
                tracing::info!(
                    harness = harness_kind,
                    context = auth_context_id,
                    reason = reason.as_str(),
                    model_count = entry.models.len(),
                    mode_count = entry.modes.len(),
                    "recorded a model snapshot entry"
                );
                Ok(entry)
            }
            Err(error) => {
                let detail = error.detail();
                // A failed refresh must never destroy truth: it updates
                // `lastAttempt` and nothing else, so the last good lists keep
                // serving with their original `probedAt`.
                self.record_failure(&mut *slot.state.lock().expect("slot poisoned"), now);
                if let Err(write_error) =
                    self.record_failed_attempt(harness_kind, auth_context_id, &detail, now)
                {
                    tracing::warn!(
                        harness = harness_kind,
                        context = auth_context_id,
                        %write_error,
                        "failed to persist the failed model snapshot attempt"
                    );
                }
                Err(RefreshError::Probe(error))
            }
        }
    }

    /// Update ONLY `lastAttempt` on the existing entry. When no entry exists there
    /// is nothing to annotate — writing a models-less entry would make the picker
    /// believe the harness advertises nothing, which is worse than absence (absence
    /// falls back to the shipped catalog).
    fn record_failed_attempt(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
        detail: &str,
        now: DateTime<Utc>,
    ) -> std::io::Result<()> {
        let Some(mut entry) = self.entry(harness_kind, auth_context_id) else {
            return Ok(());
        };
        entry.last_attempt = SnapshotAttempt {
            at: now.to_rfc3339(),
            outcome: AttemptOutcome::Failed,
            detail: Some(detail.to_string()),
        };
        write_entry(&self.runtime_home, harness_kind, auth_context_id, entry)
    }

    fn mark_running(&self, slot: &ContextSlot, running: bool) {
        slot.state
            .lock()
            .expect("model snapshot slot poisoned")
            .running = running;
    }

    fn record_completion(&self, slot: &ContextSlot, now: DateTime<Utc>, failure: Option<()>) {
        let mut state = slot.state.lock().expect("model snapshot slot poisoned");
        state.last_completed_at = Some(now);
        if failure.is_none() {
            state.consecutive_failures = 0;
            state.next_attempt_at = None;
        }
    }

    /// 1m → 2m → 4m … capped, with ±20% jitter so many failing contexts do not
    /// retry in lockstep. Jitter is derived from the attempt count rather than a
    /// clock, keeping the schedule reproducible in tests.
    fn record_failure(&self, state: &mut ContextRuntimeState, now: DateTime<Utc>) {
        state.last_completed_at = Some(now);
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        let exponent = state.consecutive_failures.saturating_sub(1).min(16);
        let raw = self
            .config
            .backoff_base
            .saturating_mul(2u32.saturating_pow(exponent));
        let capped = raw.min(self.config.backoff_max);
        state.next_attempt_at =
            Some(now + chrono::Duration::seconds(capped.as_secs().max(1) as i64));
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
