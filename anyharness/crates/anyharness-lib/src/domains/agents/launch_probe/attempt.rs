//! One admitted override-free probe attempt and its durable state transition.

use std::sync::Arc;
use std::time::Instant;

use chrono::{DateTime, Utc};

use super::backoff::jittered_backoff_seconds;
use super::live_state::LiveStateGuard;
use super::probe::{ProbeError, ProbeRequest};
use super::{HarnessRuntimeState, HarnessSlot, LaunchProbeService, PokeReason, RefreshError};
use crate::observability::lifecycle;

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
                let committed = service
                    .record_failure(&started, &Utc::now().to_rfc3339(), "materialization_failed")
                    .map_err(|write_error| RefreshError::Persistence(write_error.to_string()))?;
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
                return Err(error.into());
            }
        };
        // The probe's provider call is the one model request the runtime makes
        // itself; every exit below closes this guard with a listed outcome.
        // Deliberately begun only after materialization: an exit above this
        // line never attempted a provider request, so it emits no
        // `model.request` record at all (the SLI counts requests, not
        // attempts to assemble one).
        let model_request = lifecycle::begin_model_request(harness_kind, material.route_label());
        let plan_producer = self.plan_producer.clone();
        let plan_harness = harness_kind.to_string();
        let plan_revision = material.state_revision;
        let plan = tokio::task::spawn_blocking(move || {
            plan_producer.resolve_gateway_models_blocking(&plan_harness, plan_revision)
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
                        model_request.terminal(
                            lifecycle::model_request_outcome(failure_code),
                            lifecycle::model_request_classification(failure_code),
                        );
                        let committed = service
                            .record_failure(&started, &now.to_rfc3339(), failure_code)
                            .map_err(|write_error| {
                                RefreshError::Persistence(write_error.to_string())
                            })?;
                        self.record_failure(
                            harness_kind,
                            &mut slot.state.lock().expect("slot poisoned"),
                            now,
                        );
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
                model_request.succeeded();
                let committed = service
                    .record_success(&started, &options, &now.to_rfc3339())
                    .map_err(|error| RefreshError::Persistence(error.to_string()))?;
                self.record_success(slot, now);
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
                model_request.terminal(
                    lifecycle::model_request_outcome(failure_code),
                    lifecycle::model_request_classification(failure_code),
                );
                let committed = service
                    .record_failure(&started, &now.to_rfc3339(), failure_code)
                    .map_err(|write_error| RefreshError::Persistence(write_error.to_string()))?;
                self.record_failure(
                    harness_kind,
                    &mut slot.state.lock().expect("slot poisoned"),
                    now,
                );
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

    fn record_failure(
        &self,
        harness_kind: &str,
        state: &mut HarnessRuntimeState,
        now: DateTime<Utc>,
    ) {
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
        state.next_attempt_at = Some(now + chrono::Duration::seconds(delay));
    }
}
