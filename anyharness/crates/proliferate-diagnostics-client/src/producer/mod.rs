use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::time::Instant as TokioInstant;

use proliferate_diagnostics_protocol::v1::{limits::MAX_SAFE_INTEGER, types::ProducerRecordV1};

use crate::{
    bridge::activation::{BundledDesktopDiagnosticsBootstrap, InitialCollectorState},
    fallback::{FallbackReason, FallbackWriter},
    tracing_layer::DiagnosticsTracingLayer,
    DiagnosticsComponent, DiagnosticsInstallation, EmitDisposition, InstallError,
};

mod admission;
#[cfg(unix)]
mod bridge_runtime;
mod emit;
mod fallback_runtime;
pub(crate) mod record;
pub(crate) mod status;
pub(crate) mod transport;
mod worker;

#[cfg(all(test, unix))]
#[path = "tests_fallback_deadline.rs"]
mod tests_fallback_deadline;
#[cfg(test)]
#[path = "tests_filter.rs"]
mod tests_filter;
#[cfg(all(test, unix))]
#[path = "tests_generation.rs"]
mod tests_generation;
#[cfg(test)]
#[path = "tests_loss.rs"]
mod tests_loss;
#[cfg(test)]
#[path = "tests_queue.rs"]
mod tests_queue;
#[cfg(test)]
#[path = "tests_receipt.rs"]
mod tests_receipt;
#[cfg(test)]
#[path = "tests_sequence.rs"]
mod tests_sequence;
#[cfg(test)]
#[path = "tests_status.rs"]
mod tests_status;
#[cfg(test)]
#[path = "tests_support.rs"]
mod tests_support;
#[cfg(test)]
#[path = "tests_terminal.rs"]
mod tests_terminal;
#[cfg(test)]
#[path = "tests_transport.rs"]
mod tests_transport;

use admission::{LossSnapshot, PendingLossRange};
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
    fallback: Arc<fallback_runtime::FallbackController>,
    notify: tokio::sync::Notify,
}

pub(crate) struct ResidentRecord {
    record: ProducerRecordV1,
    serialized_bytes: usize,
    protected: bool,
    is_loss_summary: bool,
    fallback_reason: Option<FallbackReason>,
    admitted_at: Instant,
}

pub(crate) struct ResidentAccounting {
    producer_sequence: u64,
    is_loss_summary: bool,
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
    parent_shutdown_observed: bool,
    parent_flush_observed: bool,
    terminal_deadline: Option<TokioInstant>,
    parent_flush_snapshot: Option<ProducerStatusSnapshot>,
    delivery_fence_eligible: bool,
    dropped: BoundedLossCounters,
    last_failure: Option<ProducerFailureClassification>,
    fallback_routed: u64,
    pending_loss: BoundedLossCounters,
    pending_loss_total: u64,
    pending_loss_range: PendingLossRange,
    open_loss_snapshot: Option<LossSnapshot>,
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
        // No inherited descriptors: no bridge thread, no fallback authority.
        #[cfg(debug_assertions)]
        BundledDesktopDiagnosticsBootstrap::DevEnv(bootstrap) => {
            (bootstrap.initial_state, None, None, None)
        }
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
        #[cfg(debug_assertions)]
        BundledDesktopDiagnosticsBootstrap::DevEnv(bootstrap) => {
            (bootstrap.initial_state, None, None)
        }
    };
    if degraded.is_some() {
        eprintln!("[desktop-diagnostics] bundled bootstrap degraded");
    }
    let fallback =
        fallback_handle.and_then(|handle| FallbackWriter::from_directory(component, handle).ok());
    // Ownership of the Desktop bridge remains authoritative bundled mode, so
    // the caller still suppresses legacy broad logging. With neither usable
    // collector nor validated fallback authority, however, a degraded
    // bootstrap must not create a producer boot, queue, timer, HTTP client,
    // bridge thread, tracing layer, or worker task.
    if degraded.is_some() && fallback.is_none() {
        return Err(InstallError::BootstrapInvalid);
    }
    let producer_boot_id = uuid::Uuid::new_v4().to_string();
    let factory = RecordFactory::new(component, release, environment, producer_boot_id.clone())
        .map_err(|_| InstallError::BootstrapInvalid)?;
    let collector = match initial_state {
        InitialCollectorState::Ready(generation) => {
            CollectorAvailability::Ready(Arc::new(generation))
        }
        InitialCollectorState::Unavailable { generation, .. } => {
            CollectorAvailability::Unavailable { generation }
        }
    };
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
            parent_shutdown_observed: false,
            parent_flush_observed: false,
            terminal_deadline: None,
            parent_flush_snapshot: None,
            delivery_fence_eligible: true,
            dropped: BoundedLossCounters::default(),
            last_failure: None,
            fallback_routed: 0,
            pending_loss: BoundedLossCounters::default(),
            pending_loss_total: 0,
            pending_loss_range: PendingLossRange::Empty,
            open_loss_snapshot: None,
        }),
        fallback: Arc::new(fallback_runtime::FallbackController::new(fallback)),
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
        self.inner.try_emit_inner(input, false)
    }

    pub fn status_snapshot(&self) -> ProducerStatusSnapshot {
        self.inner.snapshot()
    }
}

impl DiagnosticsProducerGuard {
    pub(crate) async fn shutdown_inner(mut self, deadline: Duration) -> ProducerStatusSnapshot {
        let absolute_deadline = self.inner.begin_guard_shutdown(deadline);
        self.inner.notify.notify_one();
        if let Some(join) = self.join.take() {
            loop {
                if join.is_finished() {
                    let _ = join.await;
                    break;
                }
                let Some(deadline) = self.inner.guard_deadline(absolute_deadline) else {
                    // The parent signal owns shutdown but carries no clock.
                    // Do not invent a new wait while a flush/terminal frame
                    // crossing this return can still win on the bridge.
                    join.abort();
                    self.inner.expire_resident_on_shutdown_timeout();
                    break;
                };
                let remaining = deadline.saturating_duration_since(TokioInstant::now());
                if remaining.is_zero() {
                    join.abort();
                    self.inner.expire_resident_on_shutdown_timeout();
                    break;
                }
                tokio::time::sleep(remaining.min(Duration::from_millis(5))).await;
            }
        }
        let snapshot = self
            .inner
            .parent_flush_snapshot()
            .unwrap_or_else(|| self.inner.snapshot());
        #[cfg(unix)]
        if !self.inner.parent_flush_observed() {
            if let Some(bridge) = self.bridge.as_mut() {
                if absolute_deadline > tokio::time::Instant::now() {
                    bridge.send_terminal_until(absolute_deadline).await;
                }
            }
        }
        snapshot
    }
}

impl Drop for DiagnosticsProducerGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.terminal = true;
        }
        self.inner.notify.notify_one();
        #[cfg(unix)]
        if let Some(bridge) = self.bridge.as_mut() {
            bridge.stop();
        }
    }
}

impl ProducerInner {
    pub(crate) fn snapshot(&self) -> ProducerStatusSnapshot {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        // Cached atomics keep terminal status coherent without blocking on disk I/O.
        let fallback_status = self.fallback.status();
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
            fallback_active: fallback_status.active,
            fallback_bytes: fallback_status.bytes,
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
    pub(crate) fn arm_parent_shutdown(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.terminal = true;
        state.parent_shutdown_observed = true;
        // A natural guard may already have installed its independent budget.
        // The parent signal transfers clock ownership immediately; dispatch
        // pauses until the request supplies the parent's remaining window.
        state.terminal_deadline = None;
        drop(state);
        self.notify.notify_one();
    }

    /// Permanent bridge loss: no newer generation can arrive, so the sentinel
    /// latches unavailable. Queued records retain routing until worker drain.
    #[cfg(unix)]
    pub(crate) fn mark_bridge_lost(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if matches!(
            &state.collector,
            CollectorAvailability::Unavailable { generation } if *generation == MAX_SAFE_INTEGER
        ) {
            return;
        }
        state.collector = CollectorAvailability::Unavailable {
            generation: MAX_SAFE_INTEGER,
        };
        if !state.in_flight.is_empty() {
            state.delivery_fence_eligible = false;
        }
        drop(state);
        self.notify.notify_one();
    }

    /// Waits for residency to drain within the deadline. Records still
    /// resident afterwards are not losses: they either keep draining, ride the
    /// terminal teardown, or are counted by the shutdown-timeout discard.
    #[cfg(unix)]
    pub(crate) async fn flush_until(&self, deadline: Duration) -> ProducerStatusSnapshot {
        self.begin_parent_flush(deadline);
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
        let absolute_deadline = self.terminal_deadline().unwrap_or_else(TokioInstant::now);
        if tokio::time::timeout_at(absolute_deadline, wait)
            .await
            .is_err()
        {
            self.expire_resident_on_shutdown_timeout();
        }
        let snapshot = self.snapshot();
        self.finish_parent_flush(snapshot.clone());
        snapshot
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

    fn begin_guard_shutdown(&self, deadline: Duration) -> TokioInstant {
        let now = TokioInstant::now();
        let proposed = now + deadline;
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.terminal = true;
        if state.parent_shutdown_observed {
            state.terminal_deadline.unwrap_or(now)
        } else {
            let absolute = state
                .terminal_deadline
                .map_or(proposed, |current| current.min(proposed));
            state.terminal_deadline = Some(absolute);
            absolute
        }
    }

    #[cfg(unix)]
    pub(crate) fn begin_parent_flush(&self, remaining: Duration) {
        let proposed = TokioInstant::now() + remaining;
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.terminal = true;
        state.parent_shutdown_observed = true;
        state.parent_flush_observed = true;
        state.terminal_deadline = Some(
            state
                .terminal_deadline
                .map_or(proposed, |current| current.min(proposed)),
        );
    }

    fn terminal_deadline(&self) -> Option<TokioInstant> {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .terminal_deadline
    }

    #[cfg(unix)]
    fn finish_parent_flush(&self, snapshot: ProducerStatusSnapshot) {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .parent_flush_snapshot = Some(snapshot);
    }

    fn parent_flush_snapshot(&self) -> Option<ProducerStatusSnapshot> {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .parent_flush_snapshot
            .clone()
    }

    fn parent_flush_observed(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .parent_flush_observed
    }

    fn guard_deadline(&self, natural_deadline: TokioInstant) -> Option<TokioInstant> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.parent_shutdown_observed {
            state.terminal_deadline
        } else {
            Some(
                state
                    .terminal_deadline
                    .map_or(natural_deadline, |deadline| deadline.min(natural_deadline)),
            )
        }
    }
}
