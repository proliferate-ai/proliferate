//! One probe attempt, from admitted to persisted.
//!
//! A second `impl` block in its own file, so the reconciler above holds only the
//! DECIDING (single-flight, coalescing, pokes) and this holds only the DOING (slot
//! admission, the concurrency waits, the runner call, and the two persisted
//! outcomes).
//!
//! The asymmetry between the outcomes is deliberate and lives here: a success
//! rewrites the document whole, while a failure updates `lastAttempt` and NOTHING
//! else — so the last good model list keeps serving with its original `probedAt`.
//! A failed refresh must never destroy truth.

use std::sync::Arc;

use chrono::{DateTime, Utc};

use super::backoff::jittered_backoff_seconds;
use super::detail::redact_and_truncate;
use super::document::{
    install_identity_of, write_document, AttemptOutcome, ModelSnapshotDocument, SnapshotAttempt,
};
use super::entry::document_from_snapshot;
use super::probe::ProbeRequest;
use super::{HarnessRuntimeState, HarnessSlot, ModelSnapshotService, PokeReason, RefreshError};

impl ModelSnapshotService {
    // -----------------------------------------------------------------------
    // One attempt, start to persisted finish. The caller holds the harness's
    // single-flight gate.
    // -----------------------------------------------------------------------

    pub(super) async fn run_attempt(
        &self,
        harness_kind: &str,
        slot: &Arc<HarnessSlot>,
        reason: PokeReason,
    ) -> Result<ModelSnapshotDocument, RefreshError> {
        let material = self.material(harness_kind)?;
        // Kept for the failure path: a harness's stderr can quote back the
        // credential it was handed, and that text becomes `lastAttempt.detail` on a
        // document a UI renders. See `redact_and_truncate`.
        let credential_digests = material.env_value_digests.clone();
        // One state read serves the plan lookup, the scratch's revision-keyed dirs
        // and the document's `stateRevision` provenance, so they cannot land on
        // different revisions.
        //
        // The BLOCKING resolve, on a blocking thread: a probe is about to spawn a
        // whole harness, so waiting for the model list it will then observe is the
        // right trade — and it is the only way an opencode gateway probe observes
        // anything but the ids its own config was just written with. `used_seed_floor`
        // rides along to the document as a warning (see `document_from_snapshot`).
        let plan_producer = self.plan_producer.clone();
        let plan_harness = harness_kind.to_string();
        let plan_revision = material.state_revision;
        let state_revision = material.state_revision;
        let (plan, used_seed_floor) = tokio::task::spawn_blocking(move || {
            plan_producer.resolve_gateway_models_blocking(&plan_harness, plan_revision)
        })
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(
                harness = harness_kind,
                %error,
                "gateway model plan task failed; probing with an empty plan"
            );
            (Default::default(), true)
        });
        // Captured BEFORE the spawn, from the manifest: the document records the
        // install that answered.
        let install_identity = install_identity_of(&self.runtime_home, harness_kind);

        // The guard owns the slot's live state for the rest of this function's
        // life: `Queued` from construction, `Idle` on drop, no matter which exit
        // this attempt takes — including the future being dropped out from under
        // it, which is exactly what a disconnecting `refresh_now` caller does
        // (F-036). Constructed BEFORE the semaphore wait, so the status surface
        // never reports `idle` for an attempt that is genuinely pending on a slot.
        let live_state = self.admit_attempt(slot.clone());
        let _permit = self
            .probe_semaphore
            .acquire()
            .await
            .expect("probe semaphore closed");

        live_state.running();
        let outcome = self
            .runner
            .run(ProbeRequest {
                harness_kind: harness_kind.to_string(),
                material,
                plan,
                runtime_home: self.runtime_home.clone(),
                per_probe_timeout: self.config.per_probe_timeout,
                model_switch_timeout: self.config.model_switch_timeout,
            })
            .await;
        // No explicit Idle write: `live_state` drops at the end of this scope on
        // every path below, and its `Drop` is what sets `Idle`.

        let now = Utc::now();
        match outcome {
            Ok(snapshot) => {
                let document = document_from_snapshot(
                    snapshot,
                    harness_kind,
                    install_identity,
                    state_revision,
                    used_seed_floor,
                    now,
                );
                if let Err(error) = write_document(&self.runtime_home, harness_kind, &document) {
                    tracing::warn!(
                        harness = harness_kind,
                        %error,
                        "failed to persist the model snapshot document"
                    );
                }
                self.record_success(slot);
                tracing::info!(
                    harness = harness_kind,
                    reason = reason.as_str(),
                    model_count = document.models.len(),
                    mode_count = document.modes.len(),
                    "recorded a model snapshot observation"
                );
                Ok(document)
            }
            Err(error) => {
                let detail = redact_and_truncate(&error.detail(), &credential_digests);
                // A failed refresh must never destroy truth: it updates
                // `lastAttempt` and nothing else, so the last good lists keep
                // serving with their original `probedAt`.
                self.record_failure(
                    harness_kind,
                    &mut slot.state.lock().expect("slot poisoned"),
                    now,
                );
                if let Err(write_error) = self.record_failed_attempt(harness_kind, &detail, now) {
                    tracing::warn!(
                        harness = harness_kind,
                        %write_error,
                        "failed to persist the failed model snapshot attempt"
                    );
                }
                Err(RefreshError::Probe(error))
            }
        }
    }

    /// Update ONLY `lastAttempt` on the existing document. When no document exists
    /// there is nothing to annotate — writing a models-less document would make the
    /// picker believe the harness advertises nothing, which is worse than absence
    /// (absence falls back to the shipped catalog's seed).
    fn record_failed_attempt(
        &self,
        harness_kind: &str,
        detail: &str,
        now: DateTime<Utc>,
    ) -> std::io::Result<()> {
        let Some(mut document) = self.document(harness_kind) else {
            return Ok(());
        };
        document.last_attempt = SnapshotAttempt {
            at: now.to_rfc3339(),
            outcome: AttemptOutcome::Failed,
            detail: Some(detail.to_string()),
        };
        write_document(&self.runtime_home, harness_kind, &document)
    }

    /// A SUCCESS clears the backoff ladder. Failures go through `record_failure`,
    /// which ARMS it — so there is no shared "did it fail?" parameter to get wrong.
    fn record_success(&self, slot: &HarnessSlot) {
        let mut state = slot.state.lock().expect("model snapshot slot poisoned");
        state.consecutive_failures = 0;
        state.next_attempt_at = None;
    }

    /// 1m → 2m → 4m … capped at `backoff_max`, each delay spread by a deterministic
    /// ±20% offset so many harnesses failing on one cause (a provider outage, an
    /// expired org key) do not retry in lockstep and re-create the burst.
    ///
    /// The offset is a pure function of the harness kind and the attempt number,
    /// not of a clock or an RNG. That is what keeps the schedule reproducible: the
    /// backoff test asserts the 1m/2m sequence within a window the jitter cannot
    /// escape, and a randomized offset would make that assertion flaky.
    fn record_failure(
        &self,
        harness_kind: &str,
        state: &mut HarnessRuntimeState,
        now: DateTime<Utc>,
    ) {
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        let attempt = state.consecutive_failures;
        let exponent = attempt.saturating_sub(1).min(16);
        let raw = self
            .config
            .backoff_base
            .saturating_mul(2u32.saturating_pow(exponent));
        let capped = raw.min(self.config.backoff_max).as_secs().max(1);
        let delay = jittered_backoff_seconds(harness_kind, attempt, capped);
        state.next_attempt_at = Some(now + chrono::Duration::seconds(delay));
    }
}
