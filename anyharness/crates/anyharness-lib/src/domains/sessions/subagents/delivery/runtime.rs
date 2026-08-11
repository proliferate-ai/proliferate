use std::sync::Weak;
use std::time::Duration;

use tokio::sync::mpsc;

use super::{CompletionDeliveryRecord, CompletionDeliveryStore};
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::store::SessionStore;

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const LEASE_DURATION_SECONDS: i64 = 30;
const MAX_DELIVERIES_PER_PASS: usize = 64;

pub struct CompletionDeliveryWorker {
    delivery_store: CompletionDeliveryStore,
    session_store: SessionStore,
    session_runtime: Weak<SessionRuntime>,
}

impl CompletionDeliveryWorker {
    pub fn spawn(
        delivery_store: CompletionDeliveryStore,
        session_store: SessionStore,
        session_runtime: Weak<SessionRuntime>,
        nudge_rx: mpsc::UnboundedReceiver<()>,
    ) {
        tokio::spawn(
            Self {
                delivery_store,
                session_store,
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
                let next_attempt = retry_at(delivery.attempt_count);
                let error_code = "delivery_attempt_failed";
                let now = chrono::Utc::now().to_rfc3339();
                let _ = self.delivery_store.retry_later(
                    &delivery.delivery_id,
                    &lease_token,
                    error_code,
                    &now,
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

    async fn process_claimed(
        &self,
        delivery: &CompletionDeliveryRecord,
        lease_token: &str,
    ) -> anyhow::Result<()> {
        let prompt_id = delivery.prompt_id();
        if let Some((turn_id, _)) = self
            .session_store
            .find_completed_user_prompt_turn(&delivery.parent_session_id, &prompt_id)?
        {
            let now = chrono::Utc::now().to_rfc3339();
            self.delivery_store.mark_delivered(
                &delivery.delivery_id,
                lease_token,
                &turn_id,
                &now,
            )?;
            log_delivered(delivery, &now);
            return Ok(());
        }

        let payload = PromptPayload::text(delivery.notification_text.clone()).with_provenance(
            PromptProvenance::SubagentWake {
                session_link_id: delivery.session_link_id.clone(),
                completion_id: delivery.delivery_id.clone(),
                label: delivery.label.clone(),
            },
        );
        let pending = match self
            .session_store
            .find_pending_prompt_by_id(&delivery.parent_session_id, &prompt_id)?
        {
            Some(record) => record,
            None => {
                self.session_store
                    .insert_pending_prompt_payload_once(
                        &delivery.parent_session_id,
                        &payload,
                        &prompt_id,
                    )?
                    .0
            }
        };
        let now = chrono::Utc::now();
        let next_attempt = (now + chrono::Duration::from_std(POLL_INTERVAL)?).to_rfc3339();
        if !self.delivery_store.mark_enqueued(
            &delivery.delivery_id,
            lease_token,
            pending.seq,
            &now.to_rfc3339(),
            &next_attempt,
        )? {
            return Ok(());
        }

        let Some(session_runtime) = self.session_runtime.upgrade() else {
            anyhow::bail!("session_runtime_unavailable");
        };
        session_runtime
            .activate_durable_prompt_consumer(
                &delivery.parent_session_id,
                pending.prompt_payload(),
                pending.seq,
            )
            .await;

        if let Some((turn_id, _)) = self
            .session_store
            .find_completed_user_prompt_turn(&delivery.parent_session_id, &prompt_id)?
        {
            let delivered_at = chrono::Utc::now().to_rfc3339();
            self.delivery_store.mark_delivered_from_parent_turn(
                &delivery.parent_session_id,
                &prompt_id,
                &turn_id,
                &delivered_at,
            )?;
            log_delivered(delivery, &delivered_at);
        }
        Ok(())
    }
}

fn retry_at(attempt_count: i64) -> String {
    let exponent = attempt_count.clamp(0, 6) as u32;
    let seconds = 1_i64.checked_shl(exponent).unwrap_or(60).min(60);
    (chrono::Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339()
}

fn error_chain_class(error: &anyhow::Error) -> &'static str {
    if error.downcast_ref::<rusqlite::Error>().is_some() {
        "sqlite"
    } else {
        "runtime"
    }
}

fn log_delivered(delivery: &CompletionDeliveryRecord, delivered_at: &str) {
    let queue_age_ms = timestamp_age_ms(&delivery.created_at, delivered_at);
    let delivery_latency_ms = timestamp_age_ms(&delivery.created_at, delivered_at);
    tracing::info!(
        delivery_id = %delivery.delivery_id,
        attempt_count = delivery.attempt_count,
        result_class = "delivered",
        queue_age_ms,
        delivery_latency_ms,
        "completion delivery visible in parent transcript"
    );
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
