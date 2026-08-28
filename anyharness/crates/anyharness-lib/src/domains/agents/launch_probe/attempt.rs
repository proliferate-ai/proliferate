//! One admitted override-free probe attempt and its durable state transition.

use std::sync::Arc;
use std::time::Instant;

use chrono::{DateTime, Utc};

use super::backoff::jittered_backoff_seconds;
use super::live_state::LiveStateGuard;
use super::probe::{ProbeError, ProbeRequest};
use super::{HarnessSlot, LaunchProbeService, PokeReason, RefreshError};

impl LaunchProbeService {
    pub(super) async fn run_attempt(
        &self,
        harness_kind: &str,
        slot: &Arc<HarnessSlot>,
        reason: PokeReason,
        // Admitted by the CALLER, before it queued on the single-flight gate, so the
        // slot never reports `idle` across that wait. Owned here so every exit out
        // of this function still releases it.
        mut live_state: LiveStateGuard,
    ) -> Result<(), RefreshError> {
        let attempt_started_at = Instant::now();
        let service = self.launch_options.as_ref().ok_or_else(|| {
            RefreshError::Persistence("launch-options store is not configured".to_string())
        })?;
        let started = service
            .begin_probe(harness_kind, &Utc::now().to_rfc3339())
            .map_err(|error| RefreshError::Persistence(error.to_string()))?;
        let material = match self.material(harness_kind) {
            Ok(material) => material,
            Err(error) => {
                // ONE timestamp for the durable row, the slot's failure record
                // and the document, so `probe.at` and the recorded failure time
                // cannot disagree by a scheduling hiccup.
                let now = Utc::now();
                let committed = service
                    .record_failure(&started, &now.to_rfc3339(), "materialization_failed")
                    .map_err(|write_error| RefreshError::Persistence(write_error.to_string()))?;
                // Record the failure on the slot, exactly like the other two
                // failure arms. Without it this arm defeated BOTH brakes and the
                // self-recovery: `last_attempt_at` was never stamped, so
                // `attempt_covers(None, poked_at)` is always false and N
                // simultaneous pokes each ran a full attempt instead of
                // coalescing; and `next_attempt_at` was never armed, so no
                // `BackoffExpired` timer existed and the event set stopped
                // containing its own recovery. The trigger is ordinary: a
                // present-but-empty harness entry (exhausted gateway budget,
                // revoked seat) resolves to `SelectionMissing` and lands here.
                self.record_failure(harness_kind, slot, now);
                tracing::info!(
                    harness = harness_kind,
                    harness_basis_revision = %started.basis_revision,
                    source_revision = started.revision + 1,
                    result_code = if committed { "failed" } else { "stale_discarded" },
                    failure_code = "materialization_failed",
                    duration_ms = attempt_started_at.elapsed().as_millis(),
                    event = "agent.launch_options_probe.completed",
                    "launch-options probe materialization failed"
                );
                self.notify_probe_failed(harness_kind, now);
                return Err(error.into());
            }
        };
        let plan_producer = self.plan_producer.clone();
        let plan_harness = harness_kind.to_string();
        let plan_sequence = material.state_sequence;
        let plan = tokio::task::spawn_blocking(move || {
            plan_producer.resolve_gateway_models_blocking(&plan_harness, plan_sequence)
        })
        .await
        .unwrap_or_default();

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
            })
            .await;
        let now = Utc::now();

        match outcome {
            Ok(snapshot) => {
                let options = match crate::domains::agents::launch_options::HarnessLaunchOptionsService::options_from_probe(
                    &snapshot,
                ) {
                    Ok(options) => options,
                    Err(_) => {
                        let error = ProbeError::ModelControlsIncomplete;
                        let failure_code = error.code();
                        let committed = service
                            .record_failure(&started, &now.to_rfc3339(), failure_code)
                            .map_err(|write_error| {
                                RefreshError::Persistence(write_error.to_string())
                            })?;
                        self.record_failure(harness_kind, slot, now);
                        self.notify_probe_failed(harness_kind, now);
                        tracing::info!(
                            harness = harness_kind,
                            harness_basis_revision = %started.basis_revision,
                            event = "agent.launch_options_probe.completed",
                            result_code = if committed { "failed" } else { "stale_discarded" },
                            failure_code,
                            duration_ms = attempt_started_at.elapsed().as_millis(),
                            "launch-options probe produced an incomplete model-control matrix"
                        );
                        return Err(RefreshError::Probe(error));
                    }
                };
                let committed = service
                    .record_success(&started, &options, &now.to_rfc3339())
                    .map_err(|error| RefreshError::Persistence(error.to_string()))?;
                self.record_success(slot, now);
                self.notify_probe_verified(harness_kind, now);
                tracing::info!(
                    harness = harness_kind,
                    harness_basis_revision = %started.basis_revision,
                    source_revision = started.revision + 1,
                    model_count = options.models.len(),
                    control_count = options.controls.len(),
                    model_control_scope_count = options.model_controls.len(),
                    reason = reason.as_str(),
                    duration_ms = attempt_started_at.elapsed().as_millis(),
                    event = "agent.launch_options_probe.completed",
                    result_code = if committed { "observed" } else { "stale_discarded" },
                    "launch-options probe completed"
                );
                Ok(())
            }
            Err(error) => {
                let failure_code = error.code();
                let committed = service
                    .record_failure(&started, &now.to_rfc3339(), failure_code)
                    .map_err(|write_error| RefreshError::Persistence(write_error.to_string()))?;
                self.record_failure(harness_kind, slot, now);
                self.notify_probe_failed(harness_kind, now);
                tracing::info!(
                    harness = harness_kind,
                    harness_basis_revision = %started.basis_revision,
                    event = "agent.launch_options_probe.completed",
                    result_code = if committed { "failed" } else { "stale_discarded" },
                    failure_code,
                    duration_ms = attempt_started_at.elapsed().as_millis(),
                    "launch-options probe failed"
                );
                Err(RefreshError::Probe(error))
            }
        }
    }

    fn record_success(&self, slot: &HarnessSlot, now: DateTime<Utc>) {
        let mut state = slot
            .state
            .lock()
            .expect("launch-options probe slot poisoned");
        state.consecutive_failures = 0;
        state.next_attempt_at = None;
        state.last_attempt_at = Some(now);
    }

    fn record_failure(&self, harness_kind: &str, slot: &Arc<HarnessSlot>, now: DateTime<Utc>) {
        let next_attempt_at = {
            let mut state = slot
                .state
                .lock()
                .expect("launch-options probe slot poisoned");
            state.last_attempt_at = Some(now);
            state.consecutive_failures = state.consecutive_failures.saturating_add(1);
            let attempt = state.consecutive_failures;
            let exponent = attempt.saturating_sub(1).min(16);
            let raw = self
                .config
                .backoff_base
                .saturating_mul(2u32.saturating_pow(exponent));
            let capped = raw.min(self.config.backoff_max).as_secs().max(1);
            let delay = jittered_backoff_seconds(harness_kind, attempt, capped);
            let next_attempt_at = now + chrono::Duration::seconds(delay);
            state.next_attempt_at = Some(next_attempt_at);
            next_attempt_at
        };
        // The self-recovery: when the window lapses, the engine pokes itself
        // (`PokeReason::BackoffExpired`) instead of waiting for a human.
        self.arm_backoff_expiry(harness_kind, slot.clone(), next_attempt_at);
    }
}
