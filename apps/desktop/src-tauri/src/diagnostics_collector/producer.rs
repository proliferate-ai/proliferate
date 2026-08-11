use std::collections::VecDeque;
use std::fmt;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use proliferate_diagnostics_protocol::v1::limits::{
    CURRENT_SCHEMA_VERSION, MAX_BATCH_BYTES, MAX_BATCH_RECORDS, MAX_MESSAGE_BYTES,
};
use proliferate_diagnostics_protocol::v1::types::{
    CanonicalLifecycleV1, ComponentV1, DetailedDiagnosticV1, DetailedKindV1, IngestBatchV1,
    LifecycleFinalizerV1, LifecyclePhaseV1, PrivacyClassificationV1, ProducerRecordV1,
    RecordClassV1, RedactionClassificationV1, SeverityV1, SourceV1, TerminalOutcomeV1,
};
use proliferate_diagnostics_protocol::v1::validation::validate_producer_record;
use tokio::sync::Notify;

use super::client::CollectorHttpClient;
use super::fallback::{sanitize_native_diagnostic_text, FallbackDiagnosticsWriter};

pub(crate) const PRODUCER_QUEUE_MAX_BYTES: usize = 1_048_576;
pub(crate) const PRODUCER_QUEUE_MAX_RECORDS: usize = 256;
pub(crate) const PRODUCER_LIFECYCLE_RESERVED_BYTES: usize = 131_072;
pub(crate) const PRODUCER_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);
pub(crate) const MAX_INGEST_RETRIES_PER_GENERATION: u8 = 3;
pub(crate) const INGEST_RETRY_DELAY: Duration = Duration::from_millis(50);

pub(crate) const PR3_LIFECYCLE_NAMES: [&str; 8] = [
    "desktop.collector.start",
    "desktop.collector.restart",
    "desktop.collector.stop",
    "desktop.anyharness_process.start",
    "desktop.anyharness_process.restart",
    "desktop.anyharness_process.stop",
    "desktop.worker_process.start",
    "desktop.worker_process.stop",
];

pub(crate) const PR3_CLASSIFICATIONS: [&str; 16] = [
    "unsupported_target",
    "binary_missing",
    "binary_invalid",
    "spawn_failed",
    "endpoint_unavailable",
    "readiness_timeout",
    "authentication_failed",
    "schema_incompatible",
    "boot_id_mismatch",
    "health_unavailable",
    "child_exited",
    "child_inspection_failed",
    "restart_exhausted",
    "shutdown_armed",
    "shutdown_timeout",
    "shutdown_failed",
];

/// Safe, protocol-bounded correlation received from an owning native call
/// site. Later lifecycle slices can preserve causal identity without gaining
/// access to collector credentials or changing this producer's sequencing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LifecycleCorrelation {
    pub(crate) parent_operation_id: Option<String>,
    pub(crate) trace_id: Option<String>,
    pub(crate) workspace_id: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) item_id: Option<String>,
    pub(crate) request_id: Option<String>,
    pub(crate) target_id: Option<String>,
    pub(crate) prompt_id: Option<String>,
    pub(crate) workflow_id: Option<String>,
}

#[derive(Clone)]
pub(crate) struct TauriDiagnosticsProducer {
    inner: Arc<ProducerInner>,
}

struct ProducerInner {
    state: Mutex<ProducerState>,
    notify: Notify,
    fallback: FallbackDiagnosticsWriter,
    producer_boot_id: String,
    release: String,
    environment: String,
    closed: AtomicBool,
}

struct ProducerState {
    next_sequence: u64,
    queued: VecDeque<QueuedRecord>,
    queued_bytes: usize,
    detail_bytes: usize,
    in_flight_records: usize,
    in_flight_bytes: usize,
    in_flight_detail_bytes: usize,
    dropped_detail: u64,
    dropped_lifecycle: u64,
    client: Option<Arc<CollectorHttpClient>>,
    generation: u64,
    pump_started: bool,
}

struct QueuedRecord {
    record: ProducerRecordV1,
    bytes: usize,
    lifecycle: bool,
    attempts: u8,
}

impl fmt::Debug for TauriDiagnosticsProducer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (queued_records, queued_bytes, ready) = self
            .inner
            .state
            .lock()
            .map(|state| {
                (
                    state.queued.len().saturating_add(state.in_flight_records),
                    state.queued_bytes.saturating_add(state.in_flight_bytes),
                    state.client.is_some(),
                )
            })
            .unwrap_or_default();
        formatter
            .debug_struct("TauriDiagnosticsProducer")
            .field("producer_boot_id", &self.inner.producer_boot_id)
            .field("queued_records", &queued_records)
            .field("queued_bytes", &queued_bytes)
            .field("collector_ready", &ready)
            .finish()
    }
}

impl TauriDiagnosticsProducer {
    pub(crate) fn new(
        fallback: FallbackDiagnosticsWriter,
        release: String,
        environment: String,
    ) -> Self {
        Self {
            inner: Arc::new(ProducerInner {
                state: Mutex::new(ProducerState {
                    next_sequence: 1,
                    queued: VecDeque::new(),
                    queued_bytes: 0,
                    detail_bytes: 0,
                    in_flight_records: 0,
                    in_flight_bytes: 0,
                    in_flight_detail_bytes: 0,
                    dropped_detail: 0,
                    dropped_lifecycle: 0,
                    client: None,
                    generation: 0,
                    pump_started: false,
                }),
                notify: Notify::new(),
                fallback,
                producer_boot_id: uuid::Uuid::new_v4().to_string(),
                release,
                environment,
                closed: AtomicBool::new(false),
            }),
        }
    }

    pub(crate) fn start_pump(&self) {
        let should_start = self
            .inner
            .state
            .lock()
            .map(|mut state| {
                if state.pump_started {
                    false
                } else {
                    state.pump_started = true;
                    true
                }
            })
            .unwrap_or(false);
        if should_start {
            let producer = self.clone();
            tokio::spawn(async move { producer.pump().await });
            self.inner.notify.notify_one();
        }
    }

    pub(crate) fn set_ready_client(
        &self,
        generation: u64,
        client: Option<Arc<CollectorHttpClient>>,
    ) {
        if let Ok(mut state) = self.inner.state.lock() {
            if generation < state.generation {
                return;
            }
            state.generation = generation;
            state.client = client;
            self.inner.fallback.set_active(state.client.is_none());
        }
        self.inner.notify.notify_one();
    }

    pub(crate) fn detailed(&self, severity: SeverityV1, name: &str, message: &str) {
        if self.inner.closed.load(Ordering::Acquire) {
            self.inner.fallback.note_drop(1);
            return;
        }
        let message = truncate_utf8(&sanitize_native_diagnostic_text(message), MAX_MESSAGE_BYTES);
        let record = self.next_record(
            name,
            severity,
            RecordClassV1::Detailed,
            None,
            Some(DetailedDiagnosticV1 {
                kind: DetailedKindV1::Log,
                message: Some(message),
                stream: None,
                dropped_count: None,
                milestone: None,
            }),
            None,
        );
        if let Some(record) = record {
            self.enqueue(record, false);
        }
    }

    pub(crate) fn begin_lifecycle(&self, name: &'static str) -> LifecycleOperation {
        self.begin_lifecycle_with_correlation(name, LifecycleCorrelation::default())
    }

    pub(crate) fn begin_lifecycle_with_correlation(
        &self,
        name: &'static str,
        correlation: LifecycleCorrelation,
    ) -> LifecycleOperation {
        debug_assert!(PR3_LIFECYCLE_NAMES.contains(&name));
        let operation_id = uuid::Uuid::new_v4().to_string();
        if self.inner.closed.load(Ordering::Acquire) {
            self.inner.fallback.note_drop(1);
            return LifecycleOperation::new(self.clone(), name, operation_id, correlation, true);
        }
        let record = self.next_record_with_operation(
            name,
            &operation_id,
            SeverityV1::Info,
            RecordClassV1::Lifecycle,
            None,
            None,
            &correlation,
            Some(CanonicalLifecycleV1 {
                phase: LifecyclePhaseV1::Started,
                outcome: None,
                finalizer: LifecycleFinalizerV1::Producer,
                model: None,
                plugin: None,
            }),
        );
        if let Some(record) = record {
            self.enqueue(record, true);
        }
        LifecycleOperation::new(self.clone(), name, operation_id, correlation, false)
    }

    pub(crate) fn make_writer(&self) -> DiagnosticsMakeWriter {
        DiagnosticsMakeWriter::new(self.clone())
    }

    pub(crate) async fn drain(&self, deadline: Duration) -> bool {
        let wait = async {
            loop {
                let empty = self
                    .inner
                    .state
                    .lock()
                    .map(|state| state.queued.is_empty() && state.in_flight_records == 0)
                    .unwrap_or(false);
                if empty {
                    return true;
                }
                self.inner.notify.notify_one();
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::time::timeout(deadline, wait).await.unwrap_or(false)
    }

    pub(crate) fn close(&self) {
        self.inner.closed.store(true, Ordering::Release);
        self.inner.notify.notify_one();
    }

    #[cfg(test)]
    fn queue_snapshot(&self) -> (usize, usize, u64, u64) {
        self.inner
            .state
            .lock()
            .map(|state| {
                (
                    state.queued.len().saturating_add(state.in_flight_records),
                    state.queued_bytes.saturating_add(state.in_flight_bytes),
                    state.dropped_detail,
                    state.dropped_lifecycle,
                )
            })
            .unwrap_or_default()
    }

    fn next_record(
        &self,
        name: &str,
        severity: SeverityV1,
        record_class: RecordClassV1,
        error_classification: Option<String>,
        detailed: Option<DetailedDiagnosticV1>,
        lifecycle: Option<CanonicalLifecycleV1>,
    ) -> Option<ProducerRecordV1> {
        let operation_id = uuid::Uuid::new_v4().to_string();
        self.next_record_with_operation(
            name,
            &operation_id,
            severity,
            record_class,
            error_classification,
            detailed,
            &LifecycleCorrelation::default(),
            lifecycle,
        )
    }

    fn next_record_with_operation(
        &self,
        name: &str,
        operation_id: &str,
        severity: SeverityV1,
        record_class: RecordClassV1,
        error_classification: Option<String>,
        detailed: Option<DetailedDiagnosticV1>,
        correlation: &LifecycleCorrelation,
        lifecycle: Option<CanonicalLifecycleV1>,
    ) -> Option<ProducerRecordV1> {
        let sequence = self.inner.state.lock().ok().map(|mut state| {
            let value = state.next_sequence;
            state.next_sequence = state.next_sequence.saturating_add(1);
            value
        })?;
        let privacy = if record_class == RecordClassV1::Lifecycle {
            PrivacyClassificationV1::Operational
        } else {
            PrivacyClassificationV1::CustomerContent
        };
        let record = ProducerRecordV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            source_timestamp: Utc::now().to_rfc3339(),
            producer_sequence: sequence,
            producer_boot_id: self.inner.producer_boot_id.clone(),
            component: ComponentV1::DesktopTauri,
            source: SourceV1::Tauri,
            release: self.inner.release.clone(),
            environment: self.inner.environment.clone(),
            operation_id: operation_id.to_string(),
            parent_operation_id: correlation.parent_operation_id.clone(),
            trace_id: correlation.trace_id.clone(),
            workspace_id: correlation.workspace_id.clone(),
            session_id: correlation.session_id.clone(),
            turn_id: correlation.turn_id.clone(),
            item_id: correlation.item_id.clone(),
            request_id: correlation.request_id.clone(),
            target_id: correlation.target_id.clone(),
            prompt_id: correlation.prompt_id.clone(),
            workflow_id: correlation.workflow_id.clone(),
            name: name.to_string(),
            severity,
            arguments: Vec::new(),
            error_classification,
            record_class,
            privacy,
            redaction: RedactionClassificationV1::Structural,
            detailed,
            lifecycle,
        };
        validate_producer_record(&record).is_ok().then_some(record)
    }

    fn enqueue(&self, record: ProducerRecordV1, lifecycle: bool) {
        let encoded = match serde_json::to_string(&record) {
            Ok(encoded) => encoded,
            Err(_) => {
                self.inner.fallback.note_drop(1);
                return;
            }
        };
        let bytes = encoded.len().saturating_add(1);
        let (write_fallback, queued, evicted) = if let Ok(mut state) = self.inner.state.lock() {
            let write_fallback = state.client.is_none();
            let mut evicted = 0_u64;
            if lifecycle {
                while !fits(&state, bytes) && drop_oldest_detail(&mut state) {
                    evicted = evicted.saturating_add(1);
                }
                if !fits(&state, bytes) {
                    state.dropped_lifecycle = state.dropped_lifecycle.saturating_add(1);
                    evicted = evicted.saturating_add(1);
                    (write_fallback, false, evicted)
                } else {
                    push_back(&mut state, record, bytes, true);
                    (write_fallback, true, evicted)
                }
            } else {
                let detail_limit = PRODUCER_QUEUE_MAX_BYTES - PRODUCER_LIFECYCLE_RESERVED_BYTES;
                while (state
                    .detail_bytes
                    .saturating_add(state.in_flight_detail_bytes)
                    .saturating_add(bytes)
                    > detail_limit
                    || !fits(&state, bytes))
                    && drop_oldest_detail(&mut state)
                {
                    evicted = evicted.saturating_add(1);
                }
                if state
                    .detail_bytes
                    .saturating_add(state.in_flight_detail_bytes)
                    .saturating_add(bytes)
                    > detail_limit
                    || !fits(&state, bytes)
                {
                    state.dropped_detail = state.dropped_detail.saturating_add(1);
                    evicted = evicted.saturating_add(1);
                    (write_fallback, false, evicted)
                } else {
                    push_back(&mut state, record, bytes, false);
                    (write_fallback, true, evicted)
                }
            }
        } else {
            self.inner.fallback.note_drop(1);
            return;
        };
        self.inner.fallback.note_drop(evicted);
        if write_fallback {
            let _ = self.inner.fallback.record(&encoded);
        }
        if queued {
            self.inner.notify.notify_one();
        }
    }

    async fn pump(self) {
        loop {
            self.inner.notify.notified().await;
            loop {
                let (client, generation, batch) = {
                    let mut state = match self.inner.state.lock() {
                        Ok(state) => state,
                        Err(_) => return,
                    };
                    let Some(client) = state.client.clone() else {
                        break;
                    };
                    if state.queued.is_empty() {
                        break;
                    }
                    let mut batch = Vec::new();
                    let mut batch_bytes = 128_usize;
                    while batch.len() < MAX_BATCH_RECORDS {
                        let Some(next) = state.queued.front() else {
                            break;
                        };
                        if !batch.is_empty()
                            && batch_bytes.saturating_add(next.bytes) > MAX_BATCH_BYTES
                        {
                            break;
                        }
                        let Some(item) = state.queued.pop_front() else {
                            break;
                        };
                        batch_bytes = batch_bytes.saturating_add(item.bytes);
                        state.queued_bytes = state.queued_bytes.saturating_sub(item.bytes);
                        if !item.lifecycle {
                            state.detail_bytes = state.detail_bytes.saturating_sub(item.bytes);
                        }
                        state.in_flight_records = state.in_flight_records.saturating_add(1);
                        state.in_flight_bytes = state.in_flight_bytes.saturating_add(item.bytes);
                        if !item.lifecycle {
                            state.in_flight_detail_bytes =
                                state.in_flight_detail_bytes.saturating_add(item.bytes);
                        }
                        batch.push(item);
                    }
                    (client, state.generation, batch)
                };
                let request = IngestBatchV1 {
                    schema_version: CURRENT_SCHEMA_VERSION,
                    records: batch.iter().map(|item| item.record.clone()).collect(),
                };
                match client.ingest(&request).await {
                    Ok(receipt) => {
                        let mut rejected = 0_u64;
                        if let Ok(mut state) = self.inner.state.lock() {
                            finish_in_flight(&mut state, &batch);
                            for rejection in receipt.rejections {
                                if let Some(item) = batch.get(usize::from(rejection.index)) {
                                    if item.lifecycle {
                                        state.dropped_lifecycle =
                                            state.dropped_lifecycle.saturating_add(1);
                                    } else {
                                        state.dropped_detail =
                                            state.dropped_detail.saturating_add(1);
                                    }
                                    rejected = rejected.saturating_add(1);
                                }
                            }
                        }
                        self.inner.fallback.note_drop(rejected);
                        self.inner.notify.notify_waiters();
                    }
                    Err(_) => {
                        let mut lost = 0_u64;
                        let mut retry_pending = false;
                        if let Ok(mut state) = self.inner.state.lock() {
                            finish_in_flight(&mut state, &batch);
                            let same_generation = state.generation == generation;
                            for mut item in batch.into_iter().rev() {
                                if same_generation {
                                    item.attempts = item.attempts.saturating_add(1);
                                } else {
                                    item.attempts = 0;
                                }
                                if item.attempts > MAX_INGEST_RETRIES_PER_GENERATION {
                                    if item.lifecycle {
                                        state.dropped_lifecycle =
                                            state.dropped_lifecycle.saturating_add(1);
                                    } else {
                                        state.dropped_detail =
                                            state.dropped_detail.saturating_add(1);
                                    }
                                    lost = lost.saturating_add(1);
                                } else {
                                    retry_pending = true;
                                    lost = lost
                                        .saturating_add(requeue_front_bounded(&mut state, item));
                                }
                            }
                        } else {
                            lost = batch.len() as u64;
                        }
                        self.inner.fallback.note_drop(lost);
                        if retry_pending {
                            tokio::time::sleep(INGEST_RETRY_DELAY).await;
                        }
                        continue;
                    }
                }
            }
            if self.inner.closed.load(Ordering::Acquire) {
                let empty = self
                    .inner
                    .state
                    .lock()
                    .map(|state| state.queued.is_empty())
                    .unwrap_or(true);
                if empty {
                    return;
                }
            }
        }
    }
}

#[path = "producer/lifecycle.rs"]
pub(crate) mod lifecycle;
#[path = "producer/queue.rs"]
mod queue;
use lifecycle::{DiagnosticsMakeWriter, LifecycleOperation};
use queue::{
    drop_oldest_detail, finish_in_flight, fits, push_back, requeue_front_bounded, truncate_utf8,
};
#[cfg(test)]
#[path = "producer_tests.rs"]
mod tests;
