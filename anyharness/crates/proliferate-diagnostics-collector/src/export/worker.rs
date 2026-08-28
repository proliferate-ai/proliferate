//! The bounded best-effort export task.
//!
//! Everything the task owns is finite: a fixed-capacity queue that drops on
//! overflow instead of growing, a fixed batch shape, a fixed retry count, and a
//! cooldown that stops calling a destination that keeps failing. There is no
//! disk outbox, replay queue, or exactly-once protocol, and no path from a
//! provider failure back into ingestion, retention, or any product operation.

use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ExporterHealthV1, ExporterStateV1,
};
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio::time::Instant;

use super::classification::{ExportFailure, LastFailure};
use super::otlp;
use super::target::ExportTarget;

/// Records held between flushes. An overflowing queue drops the newest record
/// rather than applying back pressure to the accepting ingest path.
pub(super) const QUEUE_RECORDS: usize = 512;
/// Matches the contract's own per-batch record cap.
pub(super) const BATCH_RECORDS: usize = 128;
pub(super) const BATCH_BYTES: usize = 512 * 1024;
/// How long a partially filled batch waits for more records.
const LINGER: Duration = Duration::from_millis(250);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// One attempt plus this many retries. Total wall time per batch is therefore
/// bounded by three request timeouts plus the backoff.
const RETRY_BACKOFF: [Duration; 2] = [Duration::from_millis(250), Duration::from_secs(1)];
const COOLDOWN_AFTER_FAILED_BATCHES: u32 = 5;
const COOLDOWN: Duration = Duration::from_secs(30);
/// The bounded final flush a stopping collector allows the exporter.
pub(super) const SHUTDOWN_FLUSH: Duration = Duration::from_secs(1);

const STATE_DISABLED: u8 = 0;
const STATE_READY: u8 = 1;
const STATE_DEGRADED: u8 = 2;

/// Lock-free counters so `/v1/health` never waits on the export task.
pub(super) struct ExporterMetrics {
    state: AtomicU8,
    dropped_records: AtomicU64,
    last_failure: LastFailure,
}

impl Default for ExporterMetrics {
    fn default() -> Self {
        Self {
            state: AtomicU8::new(STATE_DISABLED),
            dropped_records: AtomicU64::new(0),
            last_failure: LastFailure::default(),
        }
    }
}

impl ExporterMetrics {
    pub(super) fn mark_ready(&self) {
        self.state.store(STATE_READY, Ordering::Relaxed);
    }

    pub(super) fn mark_degraded(&self, failure: ExportFailure) {
        self.state.store(STATE_DEGRADED, Ordering::Relaxed);
        self.last_failure.set(failure);
    }

    pub(super) fn note_dropped(&self, records: u64) {
        self.dropped_records.fetch_add(records, Ordering::Relaxed);
    }

    fn note_success(&self) {
        self.state.store(STATE_READY, Ordering::Relaxed);
        self.last_failure.clear();
    }

    pub(super) fn health(&self) -> ExporterHealthV1 {
        ExporterHealthV1 {
            state: match self.state.load(Ordering::Relaxed) {
                STATE_READY => ExporterStateV1::Ready,
                STATE_DEGRADED => ExporterStateV1::Degraded,
                _ => ExporterStateV1::Disabled,
            },
            dropped_records: self.dropped_records.load(Ordering::Relaxed),
            last_error_classification: self
                .last_failure
                .get()
                .map(|classification| classification.to_owned()),
        }
    }
}

pub(super) struct Worker {
    receiver: mpsc::Receiver<Arc<[u8]>>,
    target: ExportTarget,
    metrics: Arc<ExporterMetrics>,
    install_id: Option<String>,
    consecutive_failures: u32,
    cooldown_until: Option<Instant>,
}

impl Worker {
    pub(super) fn new(
        receiver: mpsc::Receiver<Arc<[u8]>>,
        target: ExportTarget,
        metrics: Arc<ExporterMetrics>,
        install_id: Option<String>,
    ) -> Self {
        Self {
            receiver,
            target,
            metrics,
            install_id,
            consecutive_failures: 0,
            cooldown_until: None,
        }
    }

    pub(super) async fn run(mut self, mut stop: watch::Receiver<bool>) {
        let Ok(client) = reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build() else {
            // No HTTP client means no export path. Say so in health and keep
            // draining so the accepting ingest path never sees a full queue.
            self.metrics.mark_degraded(ExportFailure::Request);
            while let Some(_dropped) = self.receiver.recv().await {
                self.metrics.note_dropped(1);
            }
            return;
        };
        self.metrics.mark_ready();
        loop {
            let mut batch = Vec::new();
            let stopping = self.fill_batch(&mut batch, &mut stop).await;
            if !batch.is_empty() {
                self.deliver(&client, batch).await;
            }
            if stopping {
                return;
            }
        }
    }

    /// Collects one bounded batch. Returns `true` when the collector is
    /// stopping or the producing side is gone.
    async fn fill_batch(
        &mut self,
        batch: &mut Vec<Arc<[u8]>>,
        stop: &mut watch::Receiver<bool>,
    ) -> bool {
        let first = tokio::select! {
            biased;
            _ = stop.changed() => None,
            record = self.receiver.recv() => record,
        };
        let Some(first) = first else {
            // Bounded drain so a stopping collector still flushes what it has.
            while batch.len() < BATCH_RECORDS {
                let Ok(record) = self.receiver.try_recv() else {
                    break;
                };
                batch.push(record);
            }
            return true;
        };
        let mut bytes = first.len();
        batch.push(first);
        let deadline = Instant::now() + LINGER;
        while batch.len() < BATCH_RECORDS && bytes < BATCH_BYTES {
            match tokio::time::timeout_at(deadline, self.receiver.recv()).await {
                Ok(Some(record)) => {
                    bytes += record.len();
                    batch.push(record);
                }
                Ok(None) => return true,
                Err(_) => break,
            }
        }
        false
    }

    async fn deliver(&mut self, client: &reqwest::Client, batch: Vec<Arc<[u8]>>) {
        if self
            .cooldown_until
            .is_some_and(|until| Instant::now() < until)
        {
            self.metrics.note_dropped(batch.len() as u64);
            return;
        }
        self.cooldown_until = None;

        let mut records = Vec::with_capacity(batch.len());
        let mut undecodable = 0_u64;
        for encoded in &batch {
            match serde_json::from_slice::<CollectorAcceptedRecordV1>(encoded) {
                Ok(record) => records.push(record),
                Err(_) => undecodable += 1,
            }
        }
        if undecodable > 0 {
            self.metrics.note_dropped(undecodable);
            self.metrics.mark_degraded(ExportFailure::Encode);
        }
        if records.is_empty() {
            return;
        }
        let (payload, refused) = otlp::encode_batch(self.install_id.as_deref(), &records);
        if refused > 0 {
            self.metrics.note_dropped(refused);
        }
        let exported = records.len() as u64 - refused;
        if exported == 0 {
            return;
        }
        match self.post(client, &payload).await {
            Ok(()) => {
                self.consecutive_failures = 0;
                self.metrics.note_success();
            }
            Err(failure) => {
                self.metrics.note_dropped(exported);
                self.metrics.mark_degraded(failure);
                self.consecutive_failures = self.consecutive_failures.saturating_add(1);
                if self.consecutive_failures >= COOLDOWN_AFTER_FAILED_BATCHES {
                    self.consecutive_failures = 0;
                    self.cooldown_until = Some(Instant::now() + COOLDOWN);
                }
            }
        }
    }

    async fn post(&self, client: &reqwest::Client, payload: &Value) -> Result<(), ExportFailure> {
        let body = serde_json::to_vec(payload).map_err(|_| ExportFailure::Encode)?;
        let mut retry = 0_usize;
        loop {
            match self.attempt(client, &body).await {
                Ok(()) => return Ok(()),
                Err(failure) => {
                    if retry == RETRY_BACKOFF.len() || !is_retryable(failure) {
                        return Err(failure);
                    }
                    tokio::time::sleep(RETRY_BACKOFF[retry]).await;
                    retry += 1;
                }
            }
        }
    }

    async fn attempt(&self, client: &reqwest::Client, body: &[u8]) -> Result<(), ExportFailure> {
        let mut request = client
            .post(self.target.logs_url.clone())
            .header("content-type", "application/json")
            .body(body.to_vec());
        for (name, value) in &self.target.headers {
            request = request.header(name.as_str(), value.as_str());
        }
        match request.send().await {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) if response.status().is_client_error() => {
                Err(ExportFailure::HttpClientError)
            }
            Ok(_) => Err(ExportFailure::HttpServerError),
            Err(error) if error.is_timeout() => Err(ExportFailure::Timeout),
            Err(error) if error.is_connect() => Err(ExportFailure::Connect),
            Err(_) => Err(ExportFailure::Request),
        }
    }
}

/// A rejected payload is never retried; only transport and destination-side
/// faults are.
const fn is_retryable(failure: ExportFailure) -> bool {
    matches!(
        failure,
        ExportFailure::Connect | ExportFailure::Timeout | ExportFailure::HttpServerError
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use proliferate_diagnostics_protocol::v1::types::ExporterStateV1;

    #[test]
    fn metrics_start_disabled_and_neutral() {
        let health = ExporterMetrics::default().health();
        assert_eq!(health.state, ExporterStateV1::Disabled);
        assert_eq!(health.dropped_records, 0);
        assert_eq!(health.last_error_classification, None);
    }

    #[test]
    fn degrading_publishes_a_fixed_classification_that_a_success_clears() {
        let metrics = ExporterMetrics::default();
        metrics.mark_ready();
        metrics.mark_degraded(ExportFailure::HttpServerError);
        metrics.note_dropped(7);
        let health = metrics.health();
        assert_eq!(health.state, ExporterStateV1::Degraded);
        assert_eq!(health.dropped_records, 7);
        assert_eq!(
            health.last_error_classification.as_deref(),
            Some("http_server_error")
        );
        metrics.note_success();
        let health = metrics.health();
        assert_eq!(health.state, ExporterStateV1::Ready);
        assert_eq!(health.last_error_classification, None);
        assert_eq!(health.dropped_records, 7, "drop counts never rewind");
    }

    #[test]
    fn only_transport_and_destination_faults_are_retried() {
        assert!(is_retryable(ExportFailure::Connect));
        assert!(is_retryable(ExportFailure::Timeout));
        assert!(is_retryable(ExportFailure::HttpServerError));
        assert!(!is_retryable(ExportFailure::HttpClientError));
        assert!(!is_retryable(ExportFailure::Encode));
        assert!(!is_retryable(ExportFailure::InvalidConfiguration));
        assert!(!is_retryable(ExportFailure::Request));
    }
}
