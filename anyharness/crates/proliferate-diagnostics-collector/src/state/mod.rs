mod health;
mod ingest;
mod lifecycle;
mod query;

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

use proliferate_diagnostics_protocol::v1::sequence::LifecycleSequenceValidatorV1;
use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ComponentV1, GapReasonV1, GapV1, HealthStatusV1, PressureV1,
    ProducerHealthV1, ProducerRecordV1, RecordClassV1, RejectionReasonV1, SchemaVersionV1,
};
use tokio::sync::{broadcast, Semaphore};

use crate::config::CollectorConfig;
use crate::export::ExporterHandle;

pub use ingest::IngestResult;
pub(crate) use ingest::{IngestCandidate, PreparedRecord};
pub(crate) use query::ExportSnapshot;

/// Who authored a record reaching the accept path. Producer records carry
/// stable per-record rejection reasons back to their submitter, while the
/// collector's own bookkeeping has no submitter to reject: it must always find
/// room so a saturated lifecycle table costs a counted gap instead of a
/// fabricated request failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecordOrigin {
    Producer,
    Collector,
}

#[derive(Debug)]
pub enum CoreError {
    InvalidConfig(&'static str),
    Serialization,
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfig(message) => formatter.write_str(message),
            Self::Serialization => formatter.write_str("collector record serialization failed"),
        }
    }
}

impl std::error::Error for CoreError {}

#[derive(Clone)]
pub(crate) struct StoredRecord {
    pub(crate) cursor: u64,
    pub(crate) version: SchemaVersionV1,
    pub(crate) record_class: RecordClassV1,
    pub(crate) component: ComponentV1,
    pub(crate) encoded: Arc<[u8]>,
}

impl StoredRecord {
    pub(crate) fn decode(&self) -> Result<CollectorAcceptedRecordV1, CoreError> {
        serde_json::from_slice(&self.encoded).map_err(|_| CoreError::Serialization)
    }
}

pub(crate) struct LifecycleTracker {
    pub(crate) validator: LifecycleSequenceValidatorV1,
    pub(crate) open: bool,
    pub(crate) producer_boot_id: String,
    pub(crate) start_record: Option<ProducerRecordV1>,
}

pub(crate) struct ProducerState {
    pub(crate) health: ProducerHealthV1,
}

#[derive(Default)]
pub(crate) struct Counters {
    pub(crate) evictions_by_class: BTreeMap<RecordClassV1, u64>,
    pub(crate) evictions_by_component: BTreeMap<ComponentV1, u64>,
    pub(crate) evictions_by_reason: BTreeMap<GapReasonV1, u64>,
    pub(crate) rejections_by_reason: BTreeMap<RejectionReasonV1, u64>,
    pub(crate) rejected_records: u64,
    pub(crate) oversized_records: u64,
    pub(crate) duplicate_terminals: u64,
    pub(crate) conflicting_terminals: u64,
    pub(crate) tail_reader_drops: u64,
    pub(crate) lifecycle_displacements: u64,
    pub(crate) dropped_collector_records: u64,
}

pub(crate) struct Inner {
    pub(crate) status: HealthStatusV1,
    pub(crate) next_order: u64,
    pub(crate) collector_sequence: u64,
    pub(crate) records: VecDeque<StoredRecord>,
    pub(crate) retained_bytes: u64,
    pub(crate) evicted_through_cursor: Option<u64>,
    pub(crate) newest_accepted_cursor: Option<u64>,
    pub(crate) lifecycle: BTreeMap<String, LifecycleTracker>,
    pub(crate) lifecycle_order: VecDeque<String>,
    pub(crate) producers: BTreeMap<(ComponentV1, String), ProducerState>,
    pub(crate) gaps: VecDeque<GapV1>,
    pub(crate) counters: Counters,
    pub(crate) boot_operation_id: String,
    pub(crate) shutdown_operation_id: Option<String>,
    pub(crate) shutdown_finished: bool,
}

pub struct CollectorCore {
    pub(crate) inner: Mutex<Inner>,
    pub(crate) boot_id: String,
    pub(crate) release: String,
    pub(crate) environment: String,
    pub(crate) limits: crate::config::RuntimeLimits,
    pub(crate) tail_tx: broadcast::Sender<Arc<[u8]>>,
    pub(crate) tail_slots: Arc<Semaphore>,
    pub(crate) export_slots: Arc<Semaphore>,
    /// OTLP fan-out. Present in every build; what it may export is the
    /// compile-time `EXPORT_POLICY` (`export/policy.rs`), which limits a
    /// customer build to the lifecycle record class.
    pub(crate) exporter: ExporterHandle,
}

impl CollectorCore {
    pub fn new(config: &CollectorConfig) -> Result<Arc<Self>, CoreError> {
        config
            .runtime_limits
            .validate()
            .map_err(CoreError::InvalidConfig)?;
        if config.release.is_empty()
            || config.release.len() > 128
            || config.environment.is_empty()
            || config.environment.len() > 128
        {
            return Err(CoreError::InvalidConfig(
                "release and environment must be 1-128 bytes",
            ));
        }
        // An install id is optional, but a present one must be a bounded
        // printable label. It is stamped on every exported record, so an
        // unbounded or control-character value would be an unbounded,
        // unescaped field on the wire.
        if let Some(install_id) = config.install_id.as_deref() {
            if install_id.is_empty()
                || install_id.len() > 128
                || !install_id.bytes().all(|byte| byte.is_ascii_graphic())
            {
                return Err(CoreError::InvalidConfig(
                    "install id must be 1-128 printable ASCII bytes",
                ));
            }
        }
        // Same domain as the install id, for the same reason: it is stamped
        // on every exported record.
        if let Some(user_id) = config.user_id.as_deref() {
            if user_id.is_empty()
                || user_id.len() > 128
                || !user_id.bytes().all(|byte| byte.is_ascii_graphic())
            {
                return Err(CoreError::InvalidConfig(
                    "user id must be 1-128 printable ASCII bytes",
                ));
            }
        }
        let boot_id = format!("collector-{}", uuid::Uuid::new_v4());
        let boot_operation_id = format!("collector-boot-{}", uuid::Uuid::new_v4());
        let (tail_tx, _) = broadcast::channel(config.runtime_limits.tail_queue_frames);
        let core = Arc::new(Self {
            inner: Mutex::new(Inner {
                status: HealthStatusV1::Starting,
                next_order: 1,
                collector_sequence: 1,
                records: VecDeque::new(),
                retained_bytes: 0,
                evicted_through_cursor: None,
                newest_accepted_cursor: None,
                lifecycle: BTreeMap::new(),
                lifecycle_order: VecDeque::new(),
                producers: BTreeMap::new(),
                gaps: VecDeque::new(),
                counters: Counters::default(),
                boot_operation_id: boot_operation_id.clone(),
                shutdown_operation_id: None,
                shutdown_finished: false,
            }),
            boot_id,
            release: config.release.clone(),
            environment: config.environment.clone(),
            limits: config.runtime_limits.clone(),
            tail_tx,
            tail_slots: Arc::new(Semaphore::new(config.runtime_limits.tail_readers)),
            export_slots: Arc::new(Semaphore::new(config.runtime_limits.concurrent_exports)),
            exporter: ExporterHandle::from_environment(
                config.install_id.clone(),
                config.user_id.clone(),
            ),
        });
        {
            let mut inner = core.lock();
            let record = core.collector_lifecycle_record(
                &mut inner,
                "collector.boot",
                &boot_operation_id,
                None,
                None,
            );
            core.emit_collector_record_locked(&mut inner, record);
        }
        Ok(core)
    }

    pub fn boot_id(&self) -> &str {
        &self.boot_id
    }

    /// Starts the export task inside the collector runtime. It is a no-op in
    /// any build with no destination configured.
    pub fn spawn_exporter(&self) {
        self.exporter.spawn();
    }

    /// Gives the exporter one bounded final flush. Never a shutdown gate, and
    /// a no-op in any build with no destination configured.
    pub async fn shutdown_exporter(&self) {
        self.exporter.shutdown().await;
    }

    pub fn mark_ready(&self) {
        let mut inner = self.lock();
        if inner.status != HealthStatusV1::Starting {
            return;
        }
        let operation_id = inner.boot_operation_id.clone();
        let record = self.collector_lifecycle_record(
            &mut inner,
            "collector.boot",
            &operation_id,
            Some(proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1::Succeeded),
            None,
        );
        self.emit_collector_record_locked(&mut inner, record);
        inner.status = HealthStatusV1::Ready;
    }

    pub fn pressure(&self) -> PressureV1 {
        let inner = self.lock();
        self.pressure_locked(&inner)
    }

    pub fn newest_cursor(&self) -> Option<u64> {
        self.lock().newest_accepted_cursor
    }

    pub(crate) fn accepting_ingest(&self) -> bool {
        self.lock().status == HealthStatusV1::Ready
    }

    pub(crate) fn subscribe_tail(&self) -> broadcast::Receiver<Arc<[u8]>> {
        self.tail_tx.subscribe()
    }

    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn pressure_locked(&self, inner: &Inner) -> PressureV1 {
        let percentage = inner
            .retained_bytes
            .saturating_mul(100)
            .checked_div(self.limits.retained_bytes)
            .unwrap_or(100);
        match percentage {
            0..=69 => PressureV1::Normal,
            70..=89 => PressureV1::Elevated,
            _ => PressureV1::Critical,
        }
    }

    pub(crate) fn push_gap_locked(&self, inner: &mut Inner, gap: GapV1) {
        if inner.gaps.len() == self.limits.recorded_gaps {
            inner.gaps.pop_front();
        }
        inner.gaps.push_back(gap);
    }
}

#[cfg(test)]
mod install_id_tests {
    use super::*;

    fn config(install_id: Option<&str>) -> CollectorConfig {
        let mut config = CollectorConfig::standalone("install-id-test-capability");
        config.install_id = install_id.map(str::to_owned);
        config
    }

    #[test]
    fn an_absent_install_id_is_accepted_because_a_host_may_have_none() {
        assert!(CollectorCore::new(&config(None)).is_ok());
    }

    #[test]
    fn a_bounded_printable_install_id_is_accepted() {
        assert!(CollectorCore::new(&config(Some("2f6b1c8e-install"))).is_ok());
        assert!(CollectorCore::new(&config(Some(&"x".repeat(128)))).is_ok());
    }

    /// The install id is stamped on every exported record, so an empty,
    /// oversized, or control-character value would put an unbounded or
    /// unescaped field on the wire. Startup refuses it rather than sanitizing
    /// it, because a silently rewritten identity is worse than no identity.
    #[test]
    fn an_empty_oversized_or_unprintable_install_id_is_refused() {
        for rejected in [
            "",
            &"x".repeat(129),
            "has space",
            "has\nnewline",
            "non-ascii-é",
        ] {
            assert!(
                CollectorCore::new(&config(Some(rejected))).is_err(),
                "install id {rejected:?} must be refused"
            );
        }
    }
}
