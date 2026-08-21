//! Bridge-free producer scaffolding, deterministic inputs, and a hand-served
//! loopback collector. State is built directly so queue, receipt, and status
//! behavior can be observed without reserved descriptors or a Desktop parent.

#![allow(dead_code)]

use std::{
    borrow::Cow,
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};

use proliferate_diagnostics_protocol::v1::types::{
    DetailedKindV1, IngestBatchV1, ProducerRecordV1, SeverityV1,
};

use super::{
    admission::PendingLossRange, record::RecordFactory, status::BoundedLossCounters,
    AdmissionState, CollectorAvailability, PressureSuppression, ProducerInner,
};
use crate::{
    DetailedDiagnosticInput, DiagnosticCorrelation, DiagnosticPrivacy, DiagnosticsComponent,
    EmitDisposition,
};

pub(super) const TEST_RELEASE: &str = "anyharness@0.0.0-test";
pub(super) const TEST_ENVIRONMENT: &str = "local";
pub(super) const TEST_CAPABILITY: &str = "test-capability-0001";
pub(super) const TEST_COLLECTOR_BOOT: &str = "collector-boot-0001";

/// A producer whose collector is permanently unavailable: emissions stay
/// resident (or route to the given fallback) and no request is ever built.
pub(super) fn unavailable_producer() -> Arc<ProducerInner> {
    producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Unavailable { generation: 0 },
        None,
    )
}

/// A producer whose collector is ready but whose loopback port has no
/// listener. Used where admission must behave as collector-healthy while no
/// background worker is running to dispatch a request.
pub(super) async fn ready_producer() -> Arc<ProducerInner> {
    let generation = refused_generation(1, TEST_COLLECTOR_BOOT).await;
    producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(generation)),
        None,
    )
}

pub(super) fn producer(
    component: DiagnosticsComponent,
    collector: CollectorAvailability,
    fallback: Option<crate::fallback::FallbackWriter>,
) -> Arc<ProducerInner> {
    let producer_boot_id = uuid::Uuid::new_v4().to_string();
    let factory = RecordFactory::new(
        component,
        TEST_RELEASE,
        TEST_ENVIRONMENT,
        producer_boot_id.clone(),
    )
    .expect("valid producer identity");
    Arc::new(ProducerInner {
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
            delivery_end_warned_generation: None,
        }),
        fallback: Arc::new(super::fallback_runtime::FallbackController::new(fallback)),
        notify: tokio::sync::Notify::new(),
    })
}

pub(super) fn emit(inner: &ProducerInner, input: DetailedDiagnosticInput) -> EmitDisposition {
    inner.try_emit_inner(super::record::DiagnosticInput::Detailed(input), false)
}

pub(super) fn emit_lifecycle(
    inner: &ProducerInner,
    input: crate::LifecycleDiagnosticInput,
) -> EmitDisposition {
    inner.try_emit_inner(super::record::DiagnosticInput::Lifecycle(input), false)
}

/// Ordinary lane input: `info` is neither protected nor immediately flushed.
pub(super) fn ordinary(message: &str) -> DetailedDiagnosticInput {
    input(SeverityV1::Info, message)
}

/// Protected lane input: `warn` reserves capacity and flushes immediately.
pub(super) fn protected(message: &str) -> DetailedDiagnosticInput {
    input(SeverityV1::Warn, message)
}

pub(super) fn input(severity: SeverityV1, message: &str) -> DetailedDiagnosticInput {
    DetailedDiagnosticInput {
        name: Cow::Borrowed("anyharness.tracing.event"),
        severity,
        kind: DetailedKindV1::Log,
        message: Some(message.to_owned()),
        privacy: DiagnosticPrivacy::Operational,
        arguments: Vec::new(),
        correlation: DiagnosticCorrelation::default(),
        error_classification: None,
        stream: None,
        dropped_count: None,
        milestone: None,
    }
}

/// An input the record factory must reject before sequence assignment:
/// `milestone` kind without the required validated milestone name.
pub(super) fn invalid_input() -> DetailedDiagnosticInput {
    let mut input = ordinary("milestone without a milestone name");
    input.kind = DetailedKindV1::Milestone;
    input
}

pub(super) fn filler(bytes: usize) -> String {
    "f".repeat(bytes)
}

pub(super) fn with_state<R>(
    inner: &ProducerInner,
    action: impl FnOnce(&mut AdmissionState) -> R,
) -> R {
    let mut state = inner.state.lock().expect("admission state");
    action(&mut state)
}

pub(super) fn queued_records(inner: &ProducerInner) -> Vec<ProducerRecordV1> {
    with_state(inner, |state| {
        state
            .queue
            .iter()
            .map(|record| record.record.clone())
            .collect()
    })
}

pub(super) fn queued_sequences(inner: &ProducerInner) -> Vec<u64> {
    with_state(inner, |state| {
        state
            .queue
            .iter()
            .map(|record| record.record.producer_sequence)
            .collect()
    })
}

pub(super) fn resident_bytes(inner: &ProducerInner) -> usize {
    with_state(inner, |state| state.resident_bytes)
}

pub(super) fn ordinary_bytes(inner: &ProducerInner) -> usize {
    with_state(inner, |state| state.ordinary_bytes)
}

pub(super) fn dropped(inner: &ProducerInner) -> BoundedLossCounters {
    with_state(inner, |state| state.dropped.clone())
}

pub(super) fn loss_summaries(records: &[ProducerRecordV1]) -> Vec<&ProducerRecordV1> {
    records
        .iter()
        .filter(|record| {
            record
                .detailed
                .as_ref()
                .is_some_and(|detail| detail.kind == DetailedKindV1::LossSummary)
        })
        .collect()
}

pub(super) fn argument_names(record: &ProducerRecordV1) -> Vec<String> {
    record
        .arguments
        .iter()
        .map(|argument| argument.name.clone())
        .collect()
}

/// Starts the real background worker for `inner`. Nothing here fakes the
/// dispatch loop: batching, receipts, and fallback routing are the production
/// code paths.
pub(super) fn spawn_worker(inner: &Arc<ProducerInner>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(super::worker::run(Arc::clone(inner)))
}

/// Waits until nothing is queued or in flight.
pub(super) async fn drained(inner: &ProducerInner) -> bool {
    wait_for(|| {
        with_state(inner, |state| {
            state.queue.is_empty() && state.in_flight.is_empty()
        })
    })
    .await
}

/// Index of the single loss summary inside a delivered batch, if any.
pub(super) fn summary_index(batch: &IngestBatchV1) -> Option<usize> {
    batch.records.iter().position(|record| {
        record
            .detailed
            .as_ref()
            .is_some_and(|detail| detail.kind == DetailedKindV1::LossSummary)
    })
}

/// Polls `condition` on a bounded schedule. Returns the final value so a
/// caller can assert with its own message; never sleeps past the bound.
pub(super) async fn wait_for(mut condition: impl FnMut() -> bool) -> bool {
    for _ in 0..1_000 {
        if condition() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    condition()
}

/// Gives the running worker a bounded window to do more work than the test
/// expects. Used only for absence proofs (no retry, no second summary).
pub(super) async fn settle() {
    tokio::time::sleep(Duration::from_millis(300)).await;
}

#[cfg(unix)]
pub(super) fn fallback_directory() -> tempfile::TempDir {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))
        .expect("secure directory mode");
    directory
}

#[cfg(unix)]
pub(super) fn fallback_writer(
    directory: &tempfile::TempDir,
    component: DiagnosticsComponent,
) -> crate::fallback::FallbackWriter {
    let file = std::fs::File::open(directory.path()).expect("directory descriptor");
    crate::fallback::FallbackWriter::from_directory(
        component,
        crate::bridge::activation::FallbackDirectoryHandle {
            descriptor: file.into(),
        },
    )
    .expect("fallback writer")
}

#[cfg(unix)]
pub(super) fn fallback_bytes(directory: &tempfile::TempDir, file: &str) -> Vec<u8> {
    std::fs::read(directory.path().join(file)).unwrap_or_default()
}

// The hand-served loopback collector lives in its own module; re-exported
// here so every suite keeps one scaffolding import.
pub(super) use super::tests_collector_fixture::{
    accepted_receipt, receipt, refused_generation, CollectorFixture, FixtureResponse,
};
