use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use proliferate_diagnostics_protocol::v1::{
    limits::MAX_SAFE_INTEGER,
    types::{ProducerRecordV1, SeverityV1},
};

use crate::{
    bridge::activation::{BundledDesktopDiagnosticsBootstrap, InitialCollectorState},
    fallback::{FallbackReason, FallbackWriter},
    tracing_layer::DiagnosticsTracingLayer,
    DiagnosticsComponent, DiagnosticsInstallation, EmitDisposition, InstallError,
};

mod admission;
#[cfg(unix)]
mod bridge_runtime;
pub(crate) mod record;
pub(crate) mod status;
pub(crate) mod transport;
mod worker;

use record::RecordFactory;
use status::{
    BoundedLossCounters, ProducerCollectorState, ProducerFailureClassification,
    ProducerStatusSnapshot,
};

pub(crate) const TOTAL_RECORD_LIMIT: usize = 256;
pub(crate) const TOTAL_BYTE_LIMIT: usize = 1_048_576;
pub(crate) const ORDINARY_RECORD_LIMIT: usize = 224;
pub(crate) const ORDINARY_BYTE_LIMIT: usize = 917_504;
pub(crate) const MAX_BATCH_RECORDS: usize = 64;
pub(crate) const MAX_BATCH_BODY_BYTES: usize = 262_144;
pub(crate) const FLUSH_INTERVAL: Duration = Duration::from_millis(50);
pub(crate) const PRESSURE_INTERVAL: Duration = Duration::from_secs(1);
pub(crate) const CIRCUIT_INTERVAL: Duration = Duration::from_secs(1);

pub type DropClassification = ProducerFailureClassification;

#[derive(Clone)]
pub struct DiagnosticsProducerHandle {
    inner: Arc<ProducerInner>,
}

pub struct DiagnosticsProducerGuard {
    inner: Arc<ProducerInner>,
    join: Option<tokio::task::JoinHandle<()>>,
    #[cfg(unix)]
    bridge: Option<bridge_runtime::BridgeRuntime>,
}

pub(crate) struct ProducerInner {
    component: DiagnosticsComponent,
    producer_boot_id: String,
    factory: RecordFactory,
    state: Mutex<AdmissionState>,
    fallback: Mutex<Option<FallbackWriter>>,
    notify: tokio::sync::Notify,
}

pub(crate) struct ResidentRecord {
    record: ProducerRecordV1,
    serialized_bytes: usize,
    protected: bool,
    fallback_reason: Option<FallbackReason>,
    admitted_at: Instant,
}

pub(crate) struct ResidentAccounting {
    serialized_bytes: usize,
}

pub(crate) struct AdmissionState {
    queue: VecDeque<ResidentRecord>,
    in_flight: Vec<ResidentAccounting>,
    resident_bytes: usize,
    ordinary_records: usize,
    ordinary_bytes: usize,
    next_sequence: Option<u64>,
    last_assigned_sequence: Option<u64>,
    collector: CollectorAvailability,
    pressure: PressureSuppression,
    terminal: bool,
    delivery_fence_eligible: bool,
    dropped: BoundedLossCounters,
    last_failure: Option<ProducerFailureClassification>,
    fallback_routed: u64,
}

pub(crate) enum CollectorAvailability {
    Ready(Arc<crate::bridge::activation::CollectorGenerationHandle>),
    Unavailable {
        generation: u64,
    },
    Cooldown {
        generation: Arc<crate::bridge::activation::CollectorGenerationHandle>,
        until: Instant,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum PressureSuppression {
    Normal,
    Elevated { until: Instant, probe_used: bool },
    Critical { until: Instant, probe_used: bool },
}

pub(crate) fn install(
    component: DiagnosticsComponent,
    activation: BundledDesktopDiagnosticsBootstrap,
    release: &str,
    environment: &str,
) -> Result<DiagnosticsInstallation, InstallError> {
    let producer_boot_id = uuid::Uuid::new_v4().to_string();
    let factory = RecordFactory::new(component, release, environment, producer_boot_id.clone())
        .map_err(|_| InstallError::BootstrapInvalid)?;
    #[cfg(unix)]
    let (initial_state, fallback_handle, degraded, platform_channels) = match activation {
        BundledDesktopDiagnosticsBootstrap::Ready(bootstrap) => (
            bootstrap.initial_state,
            bootstrap.fallback,
            None,
            Some((bootstrap.bridge, bootstrap.shutdown)),
        ),
        BundledDesktopDiagnosticsBootstrap::Degraded(bootstrap) => (
            InitialCollectorState::Unavailable {
                generation: 0,
                classification:
                    crate::bridge::activation::UnavailableClassification::HandoffUnavailable,
            },
            bootstrap.fallback,
            Some(bootstrap.classification),
            bootstrap.bridge.zip(bootstrap.shutdown),
        ),
    };
    #[cfg(not(unix))]
    let (initial_state, fallback_handle, degraded) = match activation {
        BundledDesktopDiagnosticsBootstrap::Ready(bootstrap) => {
            (bootstrap.initial_state, bootstrap.fallback, None)
        }
        BundledDesktopDiagnosticsBootstrap::Degraded(bootstrap) => (
            InitialCollectorState::Unavailable {
                generation: 0,
                classification:
                    crate::bridge::activation::UnavailableClassification::HandoffUnavailable,
            },
            bootstrap.fallback,
            Some(bootstrap.classification),
        ),
    };
    if degraded.is_some() {
        eprintln!("[desktop-diagnostics] bundled bootstrap degraded");
    }
    let collector = match initial_state {
        InitialCollectorState::Ready(generation) => {
            CollectorAvailability::Ready(Arc::new(generation))
        }
        InitialCollectorState::Unavailable { generation, .. } => {
            CollectorAvailability::Unavailable { generation }
        }
    };
    let fallback =
        fallback_handle.and_then(|handle| FallbackWriter::from_directory(component, handle).ok());
    let inner = Arc::new(ProducerInner {
        component,
        producer_boot_id,
        factory,
        state: Mutex::new(AdmissionState {
            queue: VecDeque::new(),
            in_flight: Vec::new(),
            resident_bytes: 0,
            ordinary_records: 0,
            ordinary_bytes: 0,
            next_sequence: Some(1),
            last_assigned_sequence: None,
            collector,
            pressure: PressureSuppression::Normal,
            terminal: false,
            delivery_fence_eligible: true,
            dropped: BoundedLossCounters::default(),
            last_failure: None,
            fallback_routed: 0,
        }),
        fallback: Mutex::new(fallback),
        notify: tokio::sync::Notify::new(),
    });
    let runtime =
        tokio::runtime::Handle::try_current().map_err(|_| InstallError::WorkerUnavailable)?;
    #[cfg(unix)]
    let bridge = platform_channels
        .map(|(bridge, shutdown)| {
            bridge_runtime::BridgeRuntime::start(
                Arc::clone(&inner),
                bridge,
                shutdown,
                runtime.clone(),
            )
        })
        .transpose()
        .map_err(|_| InstallError::WorkerUnavailable)?;
    let join = runtime.spawn(worker::run(Arc::clone(&inner)));
    let handle = DiagnosticsProducerHandle {
        inner: Arc::clone(&inner),
    };
    Ok(DiagnosticsInstallation {
        layer: DiagnosticsTracingLayer::new(handle.clone()),
        handle,
        guard: DiagnosticsProducerGuard {
            inner,
            join: Some(join),
            #[cfg(unix)]
            bridge,
        },
    })
}

impl DiagnosticsProducerHandle {
    pub(crate) fn component(&self) -> DiagnosticsComponent {
        self.inner.component
    }

    pub(crate) fn try_emit(&self, input: crate::DetailedDiagnosticInput) -> EmitDisposition {
        let prepared = match self.inner.factory.prepare(input) {
            Ok(prepared) => prepared,
            Err(()) => {
                self.inner
                    .record_loss(ProducerFailureClassification::FilterInvalid);
                return EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid);
            }
        };
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.terminal {
            return EmitDisposition::Inactive;
        }
        let Some(sequence) = state.next_sequence else {
            state.record_loss(ProducerFailureClassification::SequenceExhausted);
            return EmitDisposition::Dropped(ProducerFailureClassification::SequenceExhausted);
        };
        let record = match self.inner.factory.build(&prepared, sequence) {
            Ok(record) => record,
            Err(()) => {
                state.record_loss(ProducerFailureClassification::FilterInvalid);
                return EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid);
            }
        };
        state.last_assigned_sequence = Some(sequence);
        state.next_sequence = sequence
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER);
        let protected = matches!(record.severity, SeverityV1::Warn | SeverityV1::Error)
            || record.detailed.as_ref().is_some_and(|detail| {
                matches!(
                    detail.kind,
                    proliferate_diagnostics_protocol::v1::types::DetailedKindV1::LossSummary
                )
            });
        if state.pressure_suppresses(record.severity, Instant::now(), protected) {
            state.record_loss(ProducerFailureClassification::Pressure);
            return EmitDisposition::Dropped(ProducerFailureClassification::Pressure);
        }
        let serialized_bytes = match serde_json::to_vec(&record) {
            Ok(value) => value.len(),
            Err(_) => {
                state.record_loss(ProducerFailureClassification::FilterInvalid);
                return EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid);
            }
        };
        let fallback_reason = state.route_for_current_collector();
        if let Err(reason) = state.make_capacity(serialized_bytes, protected) {
            state.record_loss(reason);
            return EmitDisposition::Dropped(reason);
        }
        state.resident_bytes += serialized_bytes;
        if !protected {
            state.ordinary_records += 1;
            state.ordinary_bytes += serialized_bytes;
        }
        state.queue.push_back(ResidentRecord {
            record,
            serialized_bytes,
            protected,
            fallback_reason,
            admitted_at: Instant::now(),
        });
        drop(state);
        self.inner.notify.notify_one();
        EmitDisposition::Admitted
    }

    pub fn status_snapshot(&self) -> ProducerStatusSnapshot {
        self.inner.snapshot()
    }
}

impl DiagnosticsProducerGuard {
    pub(crate) async fn shutdown_inner(mut self, deadline: Duration) -> ProducerStatusSnapshot {
        let absolute_deadline = tokio::time::Instant::now() + deadline;
        {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.terminal = true;
            for record in &mut state.queue {
                record.fallback_reason = Some(FallbackReason::FinalTeardown);
            }
        }
        self.inner.notify.notify_one();
        if let Some(mut join) = self.join.take() {
            let remaining =
                absolute_deadline.saturating_duration_since(tokio::time::Instant::now());
            if tokio::time::timeout(remaining, &mut join).await.is_err() {
                join.abort();
                self.inner
                    .record_loss(ProducerFailureClassification::ShutdownTimeout);
            }
        }
        let snapshot = self.inner.snapshot();
        #[cfg(unix)]
        if let Some(bridge) = self.bridge.as_mut() {
            let remaining =
                absolute_deadline.saturating_duration_since(tokio::time::Instant::now());
            bridge.send_terminal(remaining);
        }
        snapshot
    }
}

impl Drop for DiagnosticsProducerGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.terminal = true;
            for record in &mut state.queue {
                record.fallback_reason = Some(FallbackReason::FinalTeardown);
            }
        }
        self.inner.notify.notify_one();
        #[cfg(unix)]
        if let Some(bridge) = self.bridge.as_mut() {
            bridge.stop();
        }
    }
}

impl ProducerInner {
    pub(crate) fn record_loss(&self, reason: ProducerFailureClassification) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.record_loss(reason);
    }

    pub(crate) fn snapshot(&self) -> ProducerStatusSnapshot {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let fallback = self
            .fallback
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let fallback_status = fallback.as_ref().map(FallbackWriter::current_status);
        ProducerStatusSnapshot {
            component: self.component.protocol_component(),
            producer_boot_id: self.producer_boot_id.clone(),
            last_assigned_sequence: state.last_assigned_sequence,
            next_sequence: state.next_sequence,
            collector_state: match &state.collector {
                CollectorAvailability::Ready(generation) => ProducerCollectorState::Ready {
                    collector_boot_id: generation.collector_boot_id.clone(),
                    generation_number: generation.generation,
                },
                CollectorAvailability::Unavailable { .. } => ProducerCollectorState::Unavailable,
                CollectorAvailability::Cooldown { .. } => ProducerCollectorState::Cooldown,
            },
            resident_records: u16::try_from(state.queue.len() + state.in_flight.len())
                .unwrap_or(u16::MAX),
            resident_bytes: u32::try_from(state.resident_bytes).unwrap_or(u32::MAX),
            in_flight: !state.in_flight.is_empty(),
            fallback_active: fallback_status.is_some_and(|status| status.active),
            fallback_bytes: fallback_status.map_or(0, |status| status.bytes),
            fallback_write_failures: state.dropped.fallback_write_failed,
            dropped_by_reason: state.dropped.clone(),
            fallback_routed: state.fallback_routed,
            delivery_fence_eligible: state.delivery_fence_eligible,
            last_failure: state.last_failure,
        }
    }

    #[cfg(unix)]
    pub(crate) fn replace_generation(
        &self,
        generation: crate::bridge::activation::CollectorGenerationHandle,
    ) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let current = match &state.collector {
            CollectorAvailability::Ready(current)
            | CollectorAvailability::Cooldown {
                generation: current,
                ..
            } => current.generation,
            CollectorAvailability::Unavailable { generation } => *generation,
        };
        if generation.generation <= current {
            return;
        }
        for record in &mut state.queue {
            record.fallback_reason = Some(FallbackReason::GenerationChanged);
        }
        if !state.in_flight.is_empty() {
            state.delivery_fence_eligible = false;
        }
        state.collector = CollectorAvailability::Ready(Arc::new(generation));
        drop(state);
        self.notify.notify_one();
    }

    #[cfg(unix)]
    pub(crate) fn mark_generation_unavailable(&self, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let current = match &state.collector {
            CollectorAvailability::Ready(current)
            | CollectorAvailability::Cooldown {
                generation: current,
                ..
            } => current.generation,
            CollectorAvailability::Unavailable { generation } => *generation,
        };
        if generation <= current {
            return;
        }
        for record in &mut state.queue {
            record.fallback_reason = Some(FallbackReason::GenerationChanged);
        }
        state.collector = CollectorAvailability::Unavailable { generation };
        if !state.in_flight.is_empty() {
            state.delivery_fence_eligible = false;
        }
        drop(state);
        self.notify.notify_one();
    }

    #[cfg(unix)]
    pub(crate) fn arm_terminal(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.terminal = true;
        for record in &mut state.queue {
            record.fallback_reason = Some(FallbackReason::FinalTeardown);
        }
        drop(state);
        self.notify.notify_one();
    }

    #[cfg(unix)]
    pub(crate) async fn flush_until(&self, deadline: Duration) -> ProducerStatusSnapshot {
        self.notify.notify_one();
        let wait = async {
            loop {
                let empty = {
                    let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
                    state.queue.is_empty() && state.in_flight.is_empty()
                };
                if empty {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        if tokio::time::timeout(deadline, wait).await.is_err() {
            self.record_loss(ProducerFailureClassification::ShutdownTimeout);
        }
        self.snapshot()
    }

    #[cfg(unix)]
    pub(crate) fn delivery_fence(&self) -> Option<crate::bridge::wire::DeliveryFence> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if !state.delivery_fence_eligible || !state.queue.is_empty() || !state.in_flight.is_empty()
        {
            return None;
        }
        let CollectorAvailability::Ready(generation) = &state.collector else {
            return None;
        };
        Some(crate::bridge::wire::DeliveryFence {
            producer_boot_id: self.producer_boot_id.clone(),
            collector_boot_id: generation.collector_boot_id.clone(),
            generation: generation.generation,
            last_assigned_sequence: state.last_assigned_sequence,
        })
    }
}
