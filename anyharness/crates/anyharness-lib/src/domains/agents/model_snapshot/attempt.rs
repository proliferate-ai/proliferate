//! One probe attempt, from admitted to persisted.
//!
//! A second `impl` block in its own file, so the reconciler above holds only the
//! DECIDING (gate, coalescing, pokes) and this holds only the DOING (slot admission,
//! the two concurrency waits, the runner call, and the two persisted outcomes).
//!
//! The asymmetry between the outcomes is deliberate and lives here: a success
//! rewrites the entry whole and clears the ladder, while a failure updates
//! `lastAttempt` and NOTHING else — so the last good model list keeps serving with its
//! original `probedAt`. A failed refresh must never destroy truth.

use chrono::{DateTime, Utc};

use super::backoff::jittered_backoff_seconds;
use super::detail::redact_and_truncate;
use super::document::{
    install_identity_of, write_entry, AttemptOutcome, SnapshotAttempt, SnapshotEntry,
};
use super::entry::entry_from_snapshot;
use super::fingerprint;
use super::probe::ProbeRequest;
use super::{ContextRuntimeState, ContextSlot, ModelSnapshotService, PokeReason, RefreshError, status};

impl ModelSnapshotService {
// -----------------------------------------------------------------------
    // One attempt, start to persisted finish.
    // -----------------------------------------------------------------------

    pub(super) async fn run_attempt(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
        slot: &ContextSlot,
        reason: PokeReason,
    ) -> Result<SnapshotEntry, RefreshError> {
        let material = self.material(harness_kind, auth_context_id)?;
        let fingerprint = fingerprint::fingerprint(&material);
        // Kept for the failure path: a harness's stderr can quote back the
        // credential it was handed, and that text becomes `lastAttempt.detail` on a
        // document a UI renders. See `redact_and_truncate`.
        let credential_digests: Vec<String> = material
            .env_value_digests
            .iter()
            .map(|(_, digest)| digest.clone())
            .collect();
        // One state read serves the gate, the plan lookup and the scratch's
        // revision-keyed dirs, so they cannot land on different revisions.
        let plan = self
            .plan_producer
            .resolve_gateway_models(harness_kind, material.state_revision);
        // Captured BEFORE the spawn, from the manifest: what the entry records must
        // be what the gate will later compare against.
        let install_identity = install_identity_of(&self.runtime_home, harness_kind);

        // Queued BEFORE the two waits, so the status surface never reports `idle`
        // for an attempt that is genuinely pending on a slot.
        self.set_live_state(slot, status::LiveState::Queued);
        let harness_gate = self.harness_gate(harness_kind);
        let _harness_permit = harness_gate.lock().await;
        let _permit = self
            .probe_semaphore
            .acquire()
            .await
            .expect("probe semaphore closed");

        self.set_live_state(slot, status::LiveState::Running);
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
        self.set_live_state(slot, status::LiveState::Idle);

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
                self.record_success(slot, now);
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
                let detail = redact_and_truncate(&error.detail(), &credential_digests);
                // A failed refresh must never destroy truth: it updates
                // `lastAttempt` and nothing else, so the last good lists keep
                // serving with their original `probedAt`.
                self.record_failure(
                    harness_kind,
                    auth_context_id,
                    &mut slot.state.lock().expect("slot poisoned"),
                    now,
                );
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

    /// A SUCCESS: stamp the completed-attempt floor and clear the backoff ladder.
    /// Failures go through `record_failure`, which stamps the same floor and ARMS
    /// the ladder — so there is no shared "did it fail?" parameter to get wrong.
    fn record_success(&self, slot: &ContextSlot, now: DateTime<Utc>) {
        let mut state = slot.state.lock().expect("model snapshot slot poisoned");
        state.last_completed_at = Some(now);
        state.consecutive_failures = 0;
        state.next_attempt_at = None;
    }

    /// 1m → 2m → 4m … capped at `backoff_max`, each delay spread by a deterministic
    /// ±20% offset so many contexts failing on one cause (a provider outage, an
    /// expired org key) do not retry in lockstep and re-create the burst.
    ///
    /// The offset is a pure function of the SLOT KEY and the attempt number, not of
    /// a clock or an RNG. That is what keeps the schedule reproducible: T-24 asserts
    /// the 1m/2m sequence within a window that the jitter cannot escape, and a
    /// randomized offset would make that assertion flaky rather than exact.
    fn record_failure(
        &self,
        harness_kind: &str,
        auth_context_id: &str,
        state: &mut ContextRuntimeState,
        now: DateTime<Utc>,
    ) {
        state.last_completed_at = Some(now);
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        let attempt = state.consecutive_failures;
        let exponent = attempt.saturating_sub(1).min(16);
        let raw = self
            .config
            .backoff_base
            .saturating_mul(2u32.saturating_pow(exponent));
        let capped = raw.min(self.config.backoff_max).as_secs().max(1);
        let delay = jittered_backoff_seconds(harness_kind, auth_context_id, attempt, capped);
        state.next_attempt_at = Some(now + chrono::Duration::seconds(delay));
    }
}
