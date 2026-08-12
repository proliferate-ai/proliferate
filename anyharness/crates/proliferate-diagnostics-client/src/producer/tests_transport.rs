//! Transport-failure, circuit, generation, and restart proofs. Every failure
//! is produced by a real socket condition: a wrong boot id on the wire, a
//! mid-body close, a response held past the deadline, or a refused connect.

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use super::status::ProducerCollectorState;
use super::tests_support::{
    accepted_receipt, drained, dropped, emit, ordinary, producer, queued_sequences,
    refused_generation, settle, spawn_worker, wait_for, with_state, CollectorFixture,
    FixtureResponse, TEST_COLLECTOR_BOOT,
};
use super::{CollectorAvailability, ProducerInner, CIRCUIT_INTERVAL};
use crate::{DiagnosticsComponent, EmitDisposition};

const OTHER_COLLECTOR_BOOT: &str = "collector-boot-0002";

#[test]
fn frozen_circuit_interval() {
    assert_eq!(CIRCUIT_INTERVAL, Duration::from_secs(1));
}

/// Reads the cooldown deadline currently latched on the producer.
fn cooldown_until(inner: &ProducerInner) -> Option<Instant> {
    with_state(inner, |state| match &state.collector {
        CollectorAvailability::Cooldown { until, .. } => Some(*until),
        _ => None,
    })
}

#[cfg(unix)]
fn fallback_reasons(directory: &tempfile::TempDir) -> Vec<String> {
    let written = super::tests_support::fallback_bytes(directory, "anyharness.jsonl");
    written
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let value: serde_json::Value =
                serde_json::from_slice(line).expect("fallback JSON line");
            value["reason"].as_str().expect("string reason").to_owned()
        })
        .collect()
}

/// A receipt from a different collector boot invalidates the whole batch with
/// a single `receipt_invalid`, poisons the delivery fence, and latches the
/// generation unusable. Delivery of the dispatched batch is unknowable.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn wrong_boot_receipt_invalidates_the_whole_batch() {
    use super::tests_support::{fallback_directory, fallback_writer};

    // The handle expects TEST_COLLECTOR_BOOT; the wire answers with another.
    let fixture = CollectorFixture::start(TEST_COLLECTOR_BOOT, |_, batch| {
        FixtureResponse::Receipt(accepted_receipt(OTHER_COLLECTOR_BOOT, batch.records.len()))
    })
    .await;
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        fixture.ready(1),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    for index in 0..5 {
        assert_eq!(
            emit(&inner, ordinary(&format!("event-{index}"))),
            EmitDisposition::Admitted
        );
    }
    let _worker = spawn_worker(&inner);
    assert!(drained(&inner).await, "the batch must resolve");
    settle().await;

    let counters = dropped(&inner);
    // One invalidation for the batch, not one per record.
    assert_eq!(counters.receipt_invalid, 1);
    assert_eq!(counters.receipt_rejected, 0);
    assert_eq!(counters.transport_failure, 0);
    assert_eq!(fixture.batch_count(), 1, "the batch is never re-sent");

    let snapshot = inner.snapshot();
    assert_eq!(
        snapshot.collector_state,
        ProducerCollectorState::Unavailable
    );
    assert!(!snapshot.delivery_fence_eligible);
    assert_eq!(snapshot.fallback_routed, 5);
    assert_eq!(snapshot.resident_records, 0);
    assert_eq!(
        fallback_reasons(&directory),
        vec!["delivery_unknown".to_owned(); 5]
    );
}

/// Terminal admission closes, but a ready collector remains the primary path
/// until the caller's bounded drain ends. The terminal transition must not
/// pre-tag resident records as fallback work.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn terminal_ready_queue_drains_to_the_collector_before_fallback() {
    use super::tests_support::{fallback_directory, fallback_writer};

    let fixture = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        fixture.ready(1),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );
    for index in 0..3 {
        assert_eq!(
            emit(&inner, ordinary(&format!("terminal-{index}"))),
            EmitDisposition::Admitted
        );
    }
    with_state(&inner, |state| state.terminal = true);

    let worker = spawn_worker(&inner);
    tokio::time::timeout(Duration::from_secs(1), worker)
        .await
        .expect("terminal worker deadline")
        .expect("terminal worker join");

    assert_eq!(fixture.batch_count(), 1);
    assert!(fallback_reasons(&directory).is_empty());
    assert_eq!(inner.snapshot().resident_records, 0);
}

/// A mid-body close is a transport failure on the same generation: it opens
/// the one-second circuit and routes the detached batch once.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn mid_body_close_opens_the_one_second_circuit() {
    use super::tests_support::{fallback_directory, fallback_writer};

    let fixture =
        CollectorFixture::start(TEST_COLLECTOR_BOOT, |_, _| FixtureResponse::Truncated).await;
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        fixture.ready(1),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    assert_eq!(emit(&inner, ordinary("event")), EmitDisposition::Admitted);
    let before = Instant::now();
    let _worker = spawn_worker(&inner);
    assert!(
        wait_for(|| cooldown_until(&inner).is_some()).await,
        "the circuit must open"
    );
    let after = Instant::now();

    let until = cooldown_until(&inner).expect("cooldown deadline");
    // Exactly one circuit interval from the failure instant.
    assert!(until >= before + CIRCUIT_INTERVAL);
    assert!(until <= after + CIRCUIT_INTERVAL);
    assert_eq!(
        inner.snapshot().collector_state,
        ProducerCollectorState::Cooldown
    );
    assert!(drained(&inner).await, "the detached batch must route once");

    let counters = dropped(&inner);
    assert_eq!(counters.transport_failure, 1);
    assert_eq!(counters.transport_timeout, 0);
    assert_eq!(counters.receipt_invalid, 0);
    assert!(!inner.snapshot().delivery_fence_eligible);
    assert_eq!(
        fallback_reasons(&directory),
        vec!["delivery_unknown".to_owned()]
    );
}

/// A response held past the 500 ms transport deadline is a timeout, not a
/// generic failure, and it opens the same one-second circuit. This is the only
/// test that deliberately waits on the wall clock.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn response_past_the_transport_deadline_is_a_timeout() {
    use super::tests_support::{fallback_directory, fallback_writer};

    let fixture = CollectorFixture::start(TEST_COLLECTOR_BOOT, |_, batch| {
        FixtureResponse::Delayed(
            Duration::from_millis(900),
            accepted_receipt(TEST_COLLECTOR_BOOT, batch.records.len()),
        )
    })
    .await;
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        fixture.ready(1),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    assert_eq!(emit(&inner, ordinary("event")), EmitDisposition::Admitted);
    let before = Instant::now();
    let _worker = spawn_worker(&inner);
    assert!(
        wait_for(|| dropped(&inner).transport_timeout == 1).await,
        "the deadline must classify as a timeout"
    );
    let after = Instant::now();

    let until = cooldown_until(&inner).expect("cooldown deadline");
    assert!(until >= before + CIRCUIT_INTERVAL);
    assert!(until <= after + CIRCUIT_INTERVAL);
    let counters = dropped(&inner);
    assert_eq!(counters.transport_timeout, 1);
    assert_eq!(counters.transport_failure, 0);
    assert!(drained(&inner).await, "the detached batch must route once");
    assert!(!inner.snapshot().delivery_fence_eligible);
    assert_eq!(
        fallback_reasons(&directory),
        vec!["delivery_unknown".to_owned()]
    );
}

/// A refused connect never reaches a collector, so no receipt, no
/// acknowledgement, and no replay is possible: the circuit opens for exactly
/// one interval and admitted records route to fallback instead of retrying.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn refused_connect_opens_the_circuit_and_routes_without_replay() {
    use super::tests_support::{fallback_directory, fallback_writer};

    let generation = refused_generation(1, TEST_COLLECTOR_BOOT).await;
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(generation)),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    assert_eq!(
        emit(&inner, ordinary("dispatched")),
        EmitDisposition::Admitted
    );
    let before = Instant::now();
    let _worker = spawn_worker(&inner);
    assert!(
        wait_for(|| cooldown_until(&inner).is_some()).await,
        "the circuit must open"
    );
    let after = Instant::now();
    let until = cooldown_until(&inner).expect("cooldown deadline");
    assert!(until >= before + CIRCUIT_INTERVAL);
    assert!(until <= after + CIRCUIT_INTERVAL);

    // Admitted while the circuit is open: routed on admission, never queued
    // for a retry.
    for index in 0..3 {
        assert_eq!(
            emit(&inner, ordinary(&format!("cooled-{index}"))),
            EmitDisposition::Admitted
        );
    }
    assert!(drained(&inner).await, "every record must route once");
    settle().await;

    let counters = dropped(&inner);
    // One connect attempt, one failure: nothing was retried against a dead
    // port because nothing stayed queued.
    assert_eq!(counters.transport_failure, 1);
    assert_eq!(counters.transport_timeout, 0);
    assert_eq!(counters.receipt_invalid, 0);
    assert_eq!(counters.receipt_rejected, 0);
    let snapshot = inner.snapshot();
    assert_eq!(snapshot.fallback_routed, 4);
    assert!(snapshot.fallback_active);
    assert_eq!(snapshot.resident_records, 0);
    assert_eq!(
        fallback_reasons(&directory),
        vec![
            "delivery_unknown".to_owned(),
            "transport_cooldown".to_owned(),
            "transport_cooldown".to_owned(),
            "transport_cooldown".to_owned(),
        ]
    );
}

/// A strictly newer generation invalidates everything already queued: those
/// records reach fallback as `generation_changed` and never reach the new
/// collector, while the producer sequence keeps counting up.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn a_new_generation_never_delivers_older_records() {
    use super::tests_support::{fallback_directory, fallback_writer};

    let old = refused_generation(1, TEST_COLLECTOR_BOOT).await;
    let fresh = CollectorFixture::accepting(OTHER_COLLECTOR_BOOT).await;
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(old)),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    // No worker yet, so these three are still queued when the swap lands.
    for index in 0..3 {
        assert_eq!(
            emit(&inner, ordinary(&format!("old-{index}"))),
            EmitDisposition::Admitted
        );
    }
    assert_eq!(queued_sequences(&inner), vec![1, 2, 3]);

    inner.replace_generation(fresh.generation(2));
    let _worker = spawn_worker(&inner);
    for index in 0..2 {
        assert_eq!(
            emit(&inner, ordinary(&format!("new-{index}"))),
            EmitDisposition::Admitted
        );
    }
    assert!(drained(&inner).await, "everything must resolve");
    settle().await;

    let delivered: Vec<u64> = fresh
        .records()
        .iter()
        .map(|record| record.producer_sequence)
        .collect();
    // Sequence never resets on a generation swap, and 1..=3 never arrive.
    assert_eq!(delivered, vec![4, 5]);
    assert_eq!(
        fallback_reasons(&directory),
        vec!["generation_changed".to_owned(); 3]
    );

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.last_assigned_sequence, Some(5));
    assert_eq!(snapshot.fallback_routed, 3);
    assert_eq!(
        snapshot.collector_state,
        ProducerCollectorState::Ready {
            collector_boot_id: OTHER_COLLECTOR_BOOT.to_owned(),
            generation_number: 2,
        }
    );
    // Nothing was in flight when the swap landed, so the fence survives.
    assert!(snapshot.delivery_fence_eligible);
}

/// A restarted producer over the same fallback directory admits only records
/// it emitted itself: the previous process's fallback bytes are evidence, not
/// a replay queue.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_producer_only_admits_newly_emitted_records() {
    use super::tests_support::{fallback_bytes, fallback_directory, fallback_writer};

    let directory = fallback_directory();
    let first = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Unavailable { generation: 0 },
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );
    for index in 0..3 {
        assert_eq!(
            emit(&first, ordinary(&format!("before-restart-{index}"))),
            EmitDisposition::Admitted
        );
    }
    let worker = spawn_worker(&first);
    assert!(drained(&first).await, "records must reach fallback");
    assert_eq!(
        fallback_reasons(&directory),
        vec!["collector_unavailable".to_owned(); 3]
    );
    let first_boot = first.snapshot().producer_boot_id;
    let bytes_before_restart = fallback_bytes(&directory, "anyharness.jsonl");

    // Process exit: the worker stops and the lifetime lock is released.
    worker.abort();
    let released = first
        .fallback
        .lock()
        .expect("fallback slot")
        .take()
        .expect("fallback writer");
    drop(released);
    drop(first);

    let fixture = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let second = producer(
        DiagnosticsComponent::AnyHarness,
        fixture.ready(1),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );
    let second_boot = second.snapshot().producer_boot_id;
    assert_ne!(first_boot, second_boot);
    for index in 0..2 {
        assert_eq!(
            emit(&second, ordinary(&format!("after-restart-{index}"))),
            EmitDisposition::Admitted
        );
    }
    let _second_worker = spawn_worker(&second);
    assert!(drained(&second).await, "new records must be delivered");
    settle().await;

    let delivered = fixture.records();
    assert_eq!(delivered.len(), 2);
    for record in &delivered {
        assert_eq!(record.producer_boot_id, second_boot);
    }
    assert_eq!(
        delivered
            .iter()
            .map(|record| record.producer_sequence)
            .collect::<Vec<_>>(),
        vec![1, 2],
        "the restarted producer owns its own sequence space"
    );
    // The previous process's fallback bytes are untouched: no re-ingest, no
    // truncation, no replay.
    assert_eq!(
        fallback_bytes(&directory, "anyharness.jsonl"),
        bytes_before_restart
    );
    assert_eq!(second.snapshot().fallback_routed, 0);
    assert_eq!(
        dropped(&second),
        super::status::BoundedLossCounters::default()
    );
}
