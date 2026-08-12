//! Collector-generation replacement proofs for queued and dispatched work.

use std::{
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use super::{
    status::ProducerCollectorState,
    tests_support::{
        accepted_receipt, drained, dropped, emit, fallback_directory, fallback_writer, ordinary,
        producer, protected, settle, spawn_worker, wait_for, CollectorFixture, FixtureResponse,
        TEST_COLLECTOR_BOOT,
    },
    CollectorAvailability,
};
use crate::{DiagnosticsComponent, EmitDisposition};

const FRESH_COLLECTOR_BOOT: &str = "collector-boot-0002";

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

/// Replacement wakes the sole worker, drops the old HTTP future before its
/// fixed transport timeout, routes the possibly-written batch exactly once,
/// and lets a record emitted for the fresh generation dispatch immediately.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn replacement_cancels_stalled_old_request_and_dispatches_fresh_work() {
    let old = CollectorFixture::start(TEST_COLLECTOR_BOOT, |_, batch| {
        FixtureResponse::Delayed(
            Duration::from_secs(5),
            accepted_receipt(TEST_COLLECTOR_BOOT, batch.records.len()),
        )
    })
    .await;
    let fresh = CollectorFixture::accepting(FRESH_COLLECTOR_BOOT).await;
    let directory = fallback_directory();
    let old_generation = old.generation(1);
    let old_client = Arc::downgrade(&old_generation.client);
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(old_generation)),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    assert_eq!(
        emit(&inner, protected("old-dispatched")),
        EmitDisposition::Admitted
    );
    let worker = spawn_worker(&inner);
    assert!(
        wait_for(|| old.batch_count() == 1).await,
        "the old request must cross the dispatch boundary"
    );

    inner.replace_generation(fresh.generation(2));
    assert_eq!(emit(&inner, protected("fresh")), EmitDisposition::Admitted);
    tokio::time::timeout(Duration::from_millis(400), async {
        assert!(
            wait_for(|| fresh.batch_count() == 1 && old_client.upgrade().is_none()).await,
            "replacement must cancel and clear the old client before its 500 ms deadline"
        );
        assert!(drained(&inner).await, "fresh work must resolve immediately");
    })
    .await
    .expect("generation cancellation is prompt");

    assert_eq!(old.batch_count(), 1, "the old batch is never retried");
    assert_eq!(
        fresh
            .records()
            .iter()
            .map(|record| record.producer_sequence)
            .collect::<Vec<_>>(),
        vec![2]
    );
    assert_eq!(
        fallback_reasons(&directory),
        vec!["delivery_unknown".to_owned()]
    );
    let counters = dropped(&inner);
    assert_eq!(counters.transport_timeout, 0);
    assert_eq!(counters.transport_failure, 0);
    let snapshot = inner.snapshot();
    assert_eq!(snapshot.fallback_routed, 1);
    assert_eq!(
        snapshot.collector_state,
        ProducerCollectorState::Ready {
            collector_boot_id: FRESH_COLLECTOR_BOOT.to_owned(),
            generation_number: 2,
        }
    );

    settle().await;
    assert_eq!(old.batch_count(), 1, "cancellation never schedules a retry");
    worker.abort();
}

/// A permanently busy admission signal cannot prevent the already-dispatched
/// request from observing its fixed transport deadline. Once the request is
/// detached, all residency is released and a replacement generation can run.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admission_flood_cannot_starve_the_transport_deadline() {
    let old = CollectorFixture::start(TEST_COLLECTOR_BOOT, |_, batch| {
        FixtureResponse::Delayed(
            Duration::from_secs(5),
            accepted_receipt(TEST_COLLECTOR_BOOT, batch.records.len()),
        )
    })
    .await;
    let fresh = CollectorFixture::accepting(FRESH_COLLECTOR_BOOT).await;
    let directory = fallback_directory();
    let old_generation = old.generation(1);
    let old_client = Arc::downgrade(&old_generation.client);
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(old_generation)),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    assert_eq!(
        emit(&inner, protected("stalled")),
        EmitDisposition::Admitted
    );
    let worker = spawn_worker(&inner);
    assert!(
        wait_for(|| old.batch_count() == 1).await,
        "the stalled request must cross the dispatch boundary"
    );

    // Admissions wake the same notifier the request loop observes. Keep a
    // permit hot beyond the 500 ms request bound to exercise biased starvation.
    let flood_inner = Arc::clone(&inner);
    let flood = thread::spawn(move || {
        let until = Instant::now() + Duration::from_millis(900);
        let mut admitted = 0_usize;
        while Instant::now() < until {
            if emit(&flood_inner, ordinary("admission-flood")) == EmitDisposition::Admitted {
                admitted += 1;
            }
            flood_inner.notify.notify_one();
            thread::yield_now();
        }
        admitted
    });

    tokio::time::timeout(Duration::from_millis(750), async {
        assert!(
            wait_for(|| dropped(&inner).transport_timeout == 1).await,
            "the fixed request deadline must win while notifications stay ready"
        );
    })
    .await
    .expect("notification flood cannot extend the transport deadline");
    assert!(flood.join().expect("admission flood thread") > 0);
    tokio::time::timeout(Duration::from_secs(2), async {
        assert!(drained(&inner).await, "timeout must release all capacity");
    })
    .await
    .expect("residency drains after the transport timeout");

    let timed_out = inner.snapshot();
    assert_eq!(timed_out.resident_records, 0);
    assert_eq!(timed_out.resident_bytes, 0);
    assert!(!timed_out.in_flight);
    assert!(!timed_out.delivery_fence_eligible);
    assert_eq!(old.batch_count(), 1, "the timed-out batch is never retried");
    assert_eq!(
        fallback_reasons(&directory).first().map(String::as_str),
        Some("delivery_unknown")
    );

    inner.replace_generation(fresh.generation(2));
    assert!(
        old_client.upgrade().is_none(),
        "the detached request and replaced generation release the old client"
    );
    let fresh_sequence = inner.snapshot().next_sequence.expect("fresh sequence");
    assert_eq!(
        emit(&inner, protected("fresh-after-timeout")),
        EmitDisposition::Admitted
    );
    assert!(
        wait_for(|| {
            fresh
                .records()
                .iter()
                .any(|record| record.producer_sequence == fresh_sequence)
        })
        .await,
        "fresh work dispatches after the timed-out request is released"
    );
    assert!(drained(&inner).await);
    settle().await;
    assert_eq!(
        old.batch_count(),
        1,
        "no later retry reaches the old collector"
    );
    worker.abort();
}
