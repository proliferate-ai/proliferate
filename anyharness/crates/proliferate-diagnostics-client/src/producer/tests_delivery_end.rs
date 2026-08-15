//! Loud delivery-end proofs: every latch into `Unavailable` logs exactly one
//! warning per dead generation, and re-attach logs its matching info line.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use tracing::instrument::WithSubscriber;
use tracing_subscriber::layer::SubscriberExt;

use super::tests_support::{
    accepted_receipt, emit, producer, protected, unavailable_producer, wait_for, with_state,
    CollectorFixture, FixtureResponse, TEST_COLLECTOR_BOOT,
};
use super::CollectorAvailability;
use crate::{DiagnosticsComponent, EmitDisposition};

const DELIVERY_TARGET: &str = "anyharness.diagnostics.delivery";

#[derive(Clone, Default)]
struct DeliveryEventCounter {
    warns: Arc<AtomicUsize>,
    infos: Arc<AtomicUsize>,
}

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for DeliveryEventCounter {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _context: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if event.metadata().target() != DELIVERY_TARGET {
            return;
        }
        match *event.metadata().level() {
            tracing::Level::WARN => self.warns.fetch_add(1, Ordering::SeqCst),
            tracing::Level::INFO => self.infos.fetch_add(1, Ordering::SeqCst),
            _ => 0,
        };
    }
}

#[test]
fn note_delivery_ended_is_one_shot_per_generation() {
    let inner = unavailable_producer();
    with_state(&inner, |state| {
        assert!(state.note_delivery_ended(3));
        assert!(!state.note_delivery_ended(3));
        assert!(state.note_delivery_ended(4));
    });
}

#[test]
fn generation_unavailable_warns_exactly_once_per_generation() {
    let inner = unavailable_producer();
    let counter = DeliveryEventCounter::default();
    let subscriber = tracing_subscriber::registry().with(counter.clone());
    tracing::subscriber::with_default(subscriber, || {
        inner.mark_generation_unavailable(5);
        inner.mark_generation_unavailable(5);
        assert_eq!(
            counter.warns.load(Ordering::SeqCst),
            1,
            "a repeated notice for a dead generation must stay silent"
        );
        inner.mark_generation_unavailable(7);
        assert_eq!(counter.warns.load(Ordering::SeqCst), 2);
    });
}

#[tokio::test(flavor = "multi_thread")]
async fn replacement_logs_the_canonical_reattach_info_line() {
    let fresh = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let inner = unavailable_producer();
    let counter = DeliveryEventCounter::default();
    let subscriber = tracing_subscriber::registry().with(counter.clone());
    tracing::subscriber::with_default(subscriber, || {
        inner.replace_generation(fresh.generation(1));
    });
    assert_eq!(counter.infos.load(Ordering::SeqCst), 1);
    assert!(matches!(
        with_state(&inner, |state| match &state.collector {
            CollectorAvailability::Ready(generation) => Some(generation.generation),
            _ => None,
        }),
        Some(1)
    ));
}

/// The real worker, transport, and receipt validation run against a scripted
/// collector whose receipts carry a foreign boot id. The latch that made the
/// 2026-08-15 outage silent must now warn, exactly once.
#[tokio::test(flavor = "multi_thread")]
async fn boot_mismatched_receipt_latch_warns_exactly_once() {
    let fixture = CollectorFixture::start(TEST_COLLECTOR_BOOT, |_, batch| {
        FixtureResponse::Receipt(accepted_receipt("collector-boot-9999", batch.records.len()))
    })
    .await;
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(fixture.generation(1))),
        None,
    );
    assert_eq!(
        emit(&inner, protected("dispatched-to-foreign-boot")),
        EmitDisposition::Admitted
    );
    let counter = DeliveryEventCounter::default();
    let subscriber = tracing_subscriber::registry().with(counter.clone());
    let worker = tokio::spawn(super::worker::run(Arc::clone(&inner)).with_subscriber(subscriber));
    assert!(
        wait_for(|| with_state(&inner, |state| matches!(
            state.collector,
            CollectorAvailability::Unavailable { generation: 1 }
        )))
        .await,
        "the boot-mismatched receipt must latch the generation unusable"
    );
    assert!(
        wait_for(|| counter.warns.load(Ordering::SeqCst) == 1).await,
        "the latch must announce the end of delivery"
    );
    assert!(
        !with_state(&inner, |state| state.note_delivery_ended(1)),
        "the per-generation guard is spent after the single warning"
    );
    worker.abort();
}
