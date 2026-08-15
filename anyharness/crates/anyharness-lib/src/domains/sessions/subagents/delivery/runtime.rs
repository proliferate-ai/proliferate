use std::sync::Weak;
use std::time::Duration;

use tokio::sync::mpsc;

use super::{CompletionDeliveryRecord, CompletionDeliveryState, CompletionDeliveryStore};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::runtime_event::{RuntimeInjectedSessionEvent, SubagentTurnCompletion};
use crate::domains::sessions::store::completion_deliveries::enqueue::ClaimedDeliveryEnqueueOutcome;

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const LEASE_DURATION_SECONDS: i64 = 30;
const MAX_DELIVERIES_PER_PASS: usize = 64;
/// Dead-letter cap: after this many attempts a permanently failing delivery is
/// retired to a terminal `failed` state instead of being retried forever.
const MAX_DELIVERY_ATTEMPTS: i64 = 20;

pub struct CompletionDeliveryWorker {
    delivery_store: CompletionDeliveryStore,
    session_runtime: Weak<SessionRuntime>,
}

impl CompletionDeliveryWorker {
    pub fn spawn(
        delivery_store: CompletionDeliveryStore,
        session_runtime: Weak<SessionRuntime>,
        nudge_rx: mpsc::UnboundedReceiver<()>,
    ) {
        tokio::spawn(
            Self {
                delivery_store,
                session_runtime,
            }
            .run(nudge_rx),
        );
    }

    async fn run(self, mut nudge_rx: mpsc::UnboundedReceiver<()>) {
        self.process_available().await;
        loop {
            tokio::select! {
                signal = nudge_rx.recv() => {
                    if signal.is_none() {
                        return;
                    }
                }
                _ = tokio::time::sleep(POLL_INTERVAL) => {}
            }
            self.process_available().await;
        }
    }

    async fn process_available(&self) {
        if let Err(error) = self.repair_retired_subagent_turns().await {
            tracing::warn!(
                result_class = "subagent_turn_repair_failed",
                error_class = error_chain_class(&error),
                "retired subagent turn repair deferred"
            );
        }
        for _ in 0..MAX_DELIVERIES_PER_PASS {
            let now = chrono::Utc::now();
            let lease_expires = now + chrono::Duration::seconds(LEASE_DURATION_SECONDS);
            let lease_token = uuid::Uuid::new_v4().to_string();
            let delivery = match self.delivery_store.claim_next_due(
                &now.to_rfc3339(),
                &lease_expires.to_rfc3339(),
                &lease_token,
            ) {
                Ok(Some(delivery)) => delivery,
                Ok(None) => return,
                Err(_) => {
                    tracing::warn!(
                        failure_code = "delivery_claim_failed",
                        result_class = "claim_failed",
                        "completion delivery claim failed"
                    );
                    return;
                }
            };
            if let Err(error) = self.process_claimed(&delivery, &lease_token).await {
                let error_code = "delivery_attempt_failed";
                let now = chrono::Utc::now();
                if dead_letter_threshold_reached(delivery.attempt_count) {
                    let _ = self.delivery_store.dead_letter(
                        &delivery.delivery_id,
                        &lease_token,
                        error_code,
                        &now.to_rfc3339(),
                    );
                    tracing::warn!(
                        delivery_id = %delivery.delivery_id,
                        attempt_count = delivery.attempt_count,
                        result_class = "dead_letter",
                        error_code,
                        error_class = error_chain_class(&error),
                        "completion delivery retired after exhausting the attempt cap"
                    );
                } else {
                    let next_attempt = retry_at(&now, delivery.attempt_count);
                    let _ = self.delivery_store.retry_later(
                        &delivery.delivery_id,
                        &lease_token,
                        error_code,
                        &now.to_rfc3339(),
                        &next_attempt,
                    );
                    tracing::warn!(
                        delivery_id = %delivery.delivery_id,
                        attempt_count = delivery.attempt_count,
                        result_class = "retry",
                        error_code,
                        error_class = error_chain_class(&error),
                        "completion delivery attempt deferred"
                    );
                }
            }
        }
    }

    async fn repair_retired_subagent_turns(&self) -> anyhow::Result<u32> {
        let Some(runtime) = self.session_runtime.upgrade() else {
            return Ok(0);
        };
        runtime
            .repair_retired_subagent_turns(MAX_DELIVERIES_PER_PASS)
            .await
    }

    async fn process_claimed(
        &self,
        delivery: &CompletionDeliveryRecord,
        lease_token: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now();
        // Persist recovery timing before the best-effort activation. Every
        // unresolved acknowledgement path therefore converges through the
        // same capped backoff instead of the one-second poll cadence.
        let next_attempt = retry_at(&now, delivery.attempt_count);
        let claimed_state = delivery.state;
        let (delivery, pending) = match self.delivery_store.enqueue_claimed_canonical(
            &delivery.delivery_id,
            lease_token,
            &now.to_rfc3339(),
            &next_attempt,
        )? {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                delivery, pending, ..
            } => (delivery, pending),
            ClaimedDeliveryEnqueueOutcome::AlreadyVisible { delivery, .. } => {
                log_delivered(&delivery, &now.to_rfc3339());
                log_delivery_skipped(
                    &delivery.delivery_id,
                    &delivery.parent_session_id,
                    "already_visible",
                );
                return Ok(());
            }
            ClaimedDeliveryEnqueueOutcome::Stale => {
                log_delivery_skipped(&delivery.delivery_id, &delivery.parent_session_id, "stale");
                return Ok(());
            }
        };

        let Some(session_runtime) = self.session_runtime.upgrade() else {
            anyhow::bail!("session_runtime_unavailable");
        };
        // Pending -> Enqueued is the one delivery transition that happens
        // exactly once: state only moves forward, the lease serializes
        // competing claims, and the canonical prompt insert commits in the
        // same transaction as the state change. Injecting the parent-visible
        // completion event here therefore yields exactly one event per
        // delivery, ordered ahead of the wake turn the parent admits from the
        // queued prompt.
        if claimed_state == CompletionDeliveryState::Pending {
            inject_completion_event(&session_runtime, &delivery).await;
        }
        session_runtime
            .activate_durable_prompt_consumer(
                &delivery.parent_session_id,
                pending.prompt_payload(),
                pending.seq,
            )
            .await;
        Ok(())
    }
}

fn dead_letter_threshold_reached(attempt_count: i64) -> bool {
    attempt_count >= MAX_DELIVERY_ATTEMPTS
}

/// Publish the completion metadata the parent transcript indexes for wake
/// receipts and roster invalidation.
///
/// Injection is best effort on purpose: the delivery is already committed as
/// Enqueued, so failing the attempt would only defer the parent's wake prompt
/// without ever re-running this once-per-delivery transition.
async fn inject_completion_event(
    session_runtime: &SessionRuntime,
    delivery: &CompletionDeliveryRecord,
) {
    let completion = SubagentTurnCompletion {
        completion_id: delivery.completion_id.clone(),
        session_link_id: delivery.session_link_id.clone(),
        parent_session_id: delivery.parent_session_id.clone(),
        child_session_id: delivery.child_session_id.clone(),
        child_turn_id: delivery.child_turn_id.clone(),
        child_last_event_seq: delivery.child_last_event_seq,
        outcome: delivery.outcome,
        label: delivery.label.clone(),
    };
    match session_runtime
        .emit_runtime_event(
            &delivery.parent_session_id,
            RuntimeInjectedSessionEvent::subagent_turn_completed(completion),
        )
        .await
    {
        Ok(envelope) => tracing::info!(
            target: "anyharness.subagent.turn_completed",
            child_session_id = %delivery.child_session_id,
            parent_session_id = %delivery.parent_session_id,
            completion_id = %delivery.completion_id,
            delivery_id = %delivery.delivery_id,
            outcome = delivery.outcome.as_str(),
            parent_event_seq = envelope.seq,
            "subagent: child turn completion delivered to parent"
        ),
        Err(error) => tracing::warn!(
            target: "anyharness.subagent.turn_completion_injection_failed",
            delivery_id = %delivery.delivery_id,
            parent_session_id = %delivery.parent_session_id,
            child_session_id = %delivery.child_session_id,
            result_class = "completion_event_injection_failed",
            error = %error,
            "subagent completion event was not injected into the parent transcript"
        ),
    }
}

fn retry_at(now: &chrono::DateTime<chrono::Utc>, attempt_count: i64) -> String {
    let seconds = retry_delay_seconds(attempt_count);
    (*now + chrono::Duration::seconds(seconds)).to_rfc3339()
}

fn retry_delay_seconds(attempt_count: i64) -> i64 {
    let exponent = attempt_count.clamp(0, 6) as u32;
    1_i64.checked_shl(exponent).unwrap_or(60).min(60)
}

fn error_chain_class(error: &anyhow::Error) -> &'static str {
    if error.downcast_ref::<rusqlite::Error>().is_some() {
        "sqlite"
    } else {
        "runtime"
    }
}

/// Claim-time short circuits. Both return Ok(()) without enqueueing, so
/// without this record a lease race and a stale delivery look identical to a
/// delivery that never ran.
fn log_delivery_skipped(delivery_id: &str, session_id: &str, reason: &'static str) {
    tracing::debug!(
        target: "anyharness.subagent.delivery_skipped",
        delivery_id = %delivery_id,
        session_id = %session_id,
        reason,
        "completion delivery skipped at claim"
    );
}

fn log_delivered(delivery: &CompletionDeliveryRecord, delivered_at: &str) {
    let (queue_age_ms, delivery_latency_ms) = delivery_timing_ms(delivery, delivered_at);
    tracing::info!(
        delivery_id = %delivery.delivery_id,
        attempt_count = delivery.attempt_count,
        result_class = "delivered",
        queue_age_ms,
        delivery_latency_ms,
        "completion delivery visible in parent transcript"
    );
}

fn delivery_timing_ms(delivery: &CompletionDeliveryRecord, delivered_at: &str) -> (i64, i64) {
    let queue_started_at = delivery
        .enqueued_at
        .as_deref()
        .unwrap_or(&delivery.created_at);
    (
        timestamp_age_ms(queue_started_at, delivered_at),
        timestamp_age_ms(&delivery.created_at, delivered_at),
    )
}

fn timestamp_age_ms(start: &str, end: &str) -> i64 {
    let Ok(start) = chrono::DateTime::parse_from_rfc3339(start) else {
        return 0;
    };
    let Ok(end) = chrono::DateTime::parse_from_rfc3339(end) else {
        return 0;
    };
    (end - start).num_milliseconds().max(0)
}

#[cfg(test)]
#[path = "runtime/tests.rs"]
mod tests;
