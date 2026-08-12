//! Collector-generation replacement proofs for queued and dispatched work.

use std::{sync::Arc, time::Duration};

use super::{
    status::ProducerCollectorState,
    tests_support::{
        accepted_receipt, drained, dropped, emit, fallback_directory, fallback_writer, producer,
        protected, settle, spawn_worker, wait_for, CollectorFixture, FixtureResponse,
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
