//! Receipt proofs against a hand-served loopback collector. The real worker
//! loop, the real transport, and the real receipt validation run; only the
//! collector's answer is scripted.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use proliferate_diagnostics_protocol::v1::{
    limits::CURRENT_SCHEMA_VERSION,
    types::{
        AcceptedOrderRangeV1, DetailedKindV1, IngestReceiptV1, IngestRejectionV1, PressureV1,
        ProducerRecordV1, RejectionReasonV1, SeverityV1,
    },
};

use super::status::{BoundedLossCounters, ProducerCollectorState, ProducerFailureClassification};
use super::tests_support::{
    accepted_receipt, drained, dropped, emit, filler, input, ordinary, producer, receipt, settle,
    spawn_worker, summary_index, wait_for, with_state, CollectorFixture, FixtureResponse,
    TEST_COLLECTOR_BOOT,
};
use super::{PressureSuppression, MAX_BATCH_BODY_BYTES, MAX_BATCH_RECORDS};
use crate::{DiagnosticsComponent, EmitDisposition};

#[test]
fn frozen_batch_caps() {
    assert_eq!(MAX_BATCH_RECORDS, 64);
    assert_eq!(MAX_BATCH_BODY_BYTES, 262_144);
}

fn detailed_kind(record: &ProducerRecordV1) -> Option<DetailedKindV1> {
    record.detailed.as_ref().map(|detail| detail.kind)
}

fn is_summary(record: &ProducerRecordV1) -> bool {
    detailed_kind(record) == Some(DetailedKindV1::LossSummary)
}

/// A coherent whole-batch acceptance releases residency, and the record cap
/// splits the resident set into batches of exactly 64 in ascending order with
/// only one batch body in flight at a time.
#[tokio::test(flavor = "multi_thread")]
async fn coherent_acceptance_releases_residency_under_the_record_cap() {
    let fixture = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let inner = producer(DiagnosticsComponent::AnyHarness, fixture.ready(1), None);

    // All records are admitted before the worker starts, so the first batch is
    // formed against a full queue rather than a race.
    for index in 0..200 {
        assert_eq!(
            emit(&inner, ordinary(&format!("event-{index}"))),
            EmitDisposition::Admitted
        );
    }
    let _worker = spawn_worker(&inner);
    assert!(drained(&inner).await, "every record must be delivered");

    let batches = fixture.batches();
    assert_eq!(batches.len(), 4);
    assert_eq!(
        batches
            .iter()
            .map(|batch| batch.records.len())
            .collect::<Vec<_>>(),
        vec![
            MAX_BATCH_RECORDS,
            MAX_BATCH_RECORDS,
            MAX_BATCH_RECORDS,
            200 - 3 * MAX_BATCH_RECORDS
        ]
    );
    for batch in &batches {
        assert_eq!(batch.schema_version, CURRENT_SCHEMA_VERSION);
    }
    for body in fixture.body_bytes() {
        assert!(body <= MAX_BATCH_BODY_BYTES);
    }
    for line in fixture.request_lines() {
        assert_eq!(line, "POST /v1/ingest HTTP/1.1");
    }
    for content_type in fixture.content_types() {
        assert_eq!(content_type, "application/json");
    }
    assert_eq!(fixture.peak_in_flight(), 1);

    let delivered: Vec<u64> = fixture
        .records()
        .iter()
        .map(|record| record.producer_sequence)
        .collect();
    assert_eq!(delivered, (1..=200).collect::<Vec<_>>());

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.resident_records, 0);
    assert_eq!(snapshot.resident_bytes, 0);
    assert!(!snapshot.in_flight);
    assert_eq!(snapshot.dropped_by_reason, BoundedLossCounters::default());
    assert_eq!(snapshot.fallback_routed, 0);
    assert!(snapshot.delivery_fence_eligible);
    assert_eq!(snapshot.last_failure, None);
}

/// With larger records the body cap binds before the record cap: the batch is
/// split exactly where the next record would have crossed 262,144 bytes.
#[tokio::test(flavor = "multi_thread")]
async fn batch_body_cap_splits_before_the_record_cap() {
    let fixture = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let inner = producer(DiagnosticsComponent::AnyHarness, fixture.ready(1), None);

    let message = filler(6_000);
    for _ in 0..90 {
        assert_eq!(emit(&inner, ordinary(&message)), EmitDisposition::Admitted);
    }
    let _worker = spawn_worker(&inner);
    assert!(drained(&inner).await, "every record must be delivered");

    let batches = fixture.batches();
    assert!(batches.len() >= 2);
    assert!(
        batches[0].records.len() < MAX_BATCH_RECORDS,
        "6 KiB records must exhaust the body cap first"
    );
    let first_body = fixture.body_bytes()[0];
    assert!(first_body <= MAX_BATCH_BODY_BYTES);
    let next_record = serde_json::to_vec(&batches[1].records[0])
        .expect("serializable record")
        .len();
    assert!(first_body + next_record > MAX_BATCH_BODY_BYTES);

    let delivered: Vec<u64> = fixture
        .records()
        .iter()
        .map(|record| record.producer_sequence)
        .collect();
    assert_eq!(delivered, (1..=90).collect::<Vec<_>>());
    assert_eq!(fixture.peak_in_flight(), 1);
}

/// Indexed rejections are the only per-record loss in an otherwise coherent
/// receipt; duplicates count as delivery, and nothing is replayed.
#[tokio::test(flavor = "multi_thread")]
async fn indexed_rejections_and_duplicates_are_accounted_without_replay() {
    let boot = TEST_COLLECTOR_BOOT.to_owned();
    let fixture = CollectorFixture::start(TEST_COLLECTOR_BOOT, move |_, batch| {
        let submitted = batch.records.len();
        if submitted < 3 {
            return FixtureResponse::Receipt(accepted_receipt(&boot, submitted));
        }
        FixtureResponse::Receipt(receipt(
            &boot,
            submitted - 2,
            1,
            vec![IngestRejectionV1 {
                index: 0,
                reason: RejectionReasonV1::LimitExceeded,
            }],
            PressureV1::Normal,
        ))
    })
    .await;
    let inner = producer(DiagnosticsComponent::AnyHarness, fixture.ready(1), None);

    for index in 0..8 {
        assert_eq!(
            emit(&inner, ordinary(&format!("event-{index}"))),
            EmitDisposition::Admitted
        );
    }
    let _worker = spawn_worker(&inner);
    assert!(drained(&inner).await, "the batch must resolve");
    assert!(
        wait_for(|| fixture.batch_count() >= 2).await,
        "the rejection must produce a loss summary"
    );
    settle().await;

    // A rejection is not a retry: no original record is submitted twice.
    let originals: Vec<u64> = fixture
        .records()
        .iter()
        .filter(|record| !is_summary(record))
        .map(|record| record.producer_sequence)
        .collect();
    assert_eq!(originals, (1..=8).collect::<Vec<_>>());

    let counters = dropped(&inner);
    assert_eq!(counters.receipt_rejected, 1);
    assert_eq!(counters.receipt_invalid, 0);
    assert_eq!(counters.transport_failure, 0);
    let snapshot = inner.snapshot();
    assert_eq!(snapshot.resident_records, 0);
    // A rejected record is a loss, never a fallback write.
    assert_eq!(snapshot.fallback_routed, 0);
    assert!(snapshot.delivery_fence_eligible);
    assert_eq!(
        snapshot.collector_state,
        ProducerCollectorState::Ready {
            collector_boot_id: TEST_COLLECTOR_BOOT.to_owned(),
            generation_number: 1,
        }
    );

    // The summary reports exactly the one rejected sequence.
    let delivered = fixture.records();
    let summary = delivered
        .iter()
        .find(|record| is_summary(record))
        .expect("loss summary");
    assert_eq!(
        summary.detailed.as_ref().expect("detailed").dropped_count,
        Some(1)
    );
    let names: Vec<String> = summary
        .arguments
        .iter()
        .map(|argument| argument.name.clone())
        .collect();
    assert_eq!(
        names,
        vec![
            "receipt_rejected".to_owned(),
            "first_lost_sequence".to_owned(),
            "last_lost_sequence".to_owned(),
        ]
    );
}

/// The collector's pressure claim is honoured from a coherent receipt, using
/// exactly the frozen three-value vocabulary.
#[tokio::test(flavor = "multi_thread")]
async fn receipt_pressure_vocabulary_is_applied_from_the_wire() {
    for (claimed, suppressed, unsuppressed) in [
        (
            PressureV1::Elevated,
            vec![SeverityV1::Trace, SeverityV1::Debug],
            vec![SeverityV1::Info, SeverityV1::Warn, SeverityV1::Error],
        ),
        (
            PressureV1::Critical,
            vec![SeverityV1::Trace, SeverityV1::Debug, SeverityV1::Info],
            vec![SeverityV1::Warn, SeverityV1::Error],
        ),
    ] {
        let boot = TEST_COLLECTOR_BOOT.to_owned();
        let fixture = CollectorFixture::start(TEST_COLLECTOR_BOOT, move |_, batch| {
            FixtureResponse::Receipt(receipt(&boot, batch.records.len(), 0, Vec::new(), claimed))
        })
        .await;
        let inner = producer(DiagnosticsComponent::AnyHarness, fixture.ready(1), None);

        assert_eq!(emit(&inner, ordinary("probe")), EmitDisposition::Admitted);
        let _worker = spawn_worker(&inner);
        assert!(drained(&inner).await, "the batch must resolve");
        assert!(
            wait_for(|| with_state(&inner, |state| !matches!(
                state.pressure,
                PressureSuppression::Normal
            )))
            .await,
            "the receipt pressure must be applied"
        );

        with_state(&inner, |state| {
            match (&mut state.pressure, claimed) {
                (PressureSuppression::Elevated { until, probe_used }, PressureV1::Elevated)
                | (PressureSuppression::Critical { until, probe_used }, PressureV1::Critical) => {
                    // Hold the window open so the one-probe allowance cannot
                    // fire mid-assertion; the interval itself is proven in the
                    // queue suite.
                    *until = Instant::now() + Duration::from_secs(3_600);
                    *probe_used = false;
                }
                _ => panic!("the receipt must arm exactly the claimed suppression"),
            }
        });

        for severity in suppressed {
            assert_eq!(
                emit(&inner, input(severity, "under pressure")),
                EmitDisposition::Dropped(ProducerFailureClassification::Pressure)
            );
        }
        for severity in unsuppressed {
            assert_eq!(
                emit(&inner, input(severity, "never suppressed")),
                EmitDisposition::Admitted
            );
        }
    }
}

/// A coherent receipt that did not reject the summary index is the only thing
/// that subtracts a closed snapshot; a rejected summary returns it, and the
/// replacement summary takes a strictly higher sequence.
#[tokio::test(flavor = "multi_thread")]
async fn accepted_summary_clears_the_snapshot_and_a_rejected_summary_returns_it() {
    let boot = TEST_COLLECTOR_BOOT.to_owned();
    let rejected_once = Arc::new(AtomicBool::new(false));
    let responder_flag = Arc::clone(&rejected_once);
    let fixture = CollectorFixture::start(TEST_COLLECTOR_BOOT, move |_, batch| {
        let submitted = batch.records.len();
        match summary_index(batch) {
            Some(index) if !responder_flag.swap(true, Ordering::SeqCst) => {
                FixtureResponse::Receipt(receipt(
                    &boot,
                    submitted - 1,
                    0,
                    vec![IngestRejectionV1 {
                        index: u16::try_from(index).expect("bounded index"),
                        reason: RejectionReasonV1::InvalidShape,
                    }],
                    PressureV1::Normal,
                ))
            }
            _ => FixtureResponse::Receipt(accepted_receipt(&boot, submitted)),
        }
    })
    .await;
    let inner = producer(DiagnosticsComponent::AnyHarness, fixture.ready(1), None);

    // Three unsequenced losses: the exact interval is proven in the loss suite.
    with_state(&inner, |state| {
        for _ in 0..3 {
            state.record_loss(ProducerFailureClassification::TransportFailure);
        }
    });
    let _worker = spawn_worker(&inner);

    assert!(
        wait_for(|| {
            fixture
                .batches()
                .iter()
                .filter(|batch| summary_index(batch).is_some())
                .count()
                >= 2
        })
        .await,
        "the returned snapshot must produce a replacement summary"
    );
    assert!(drained(&inner).await, "everything must resolve");
    assert!(
        wait_for(
            || with_state(&inner, |state| state.open_loss_snapshot.is_none()
                && state.pending_loss_total == 0)
        )
        .await,
        "an accepted summary subtracts the closed snapshot exactly once"
    );
    settle().await;

    let delivered = fixture.records();
    let summaries: Vec<&ProducerRecordV1> = delivered
        .iter()
        .filter(|record| is_summary(record))
        .collect();
    assert_eq!(summaries.len(), 2, "no summary is replayed");
    // Rejected: the snapshot returned, so the replacement carries the original
    // three losses plus the receipt rejection, under a strictly new sequence.
    assert!(summaries[1].producer_sequence > summaries[0].producer_sequence);
    assert_eq!(
        summaries[0]
            .detailed
            .as_ref()
            .expect("detailed")
            .dropped_count,
        Some(3)
    );
    assert_eq!(
        summaries[1]
            .detailed
            .as_ref()
            .expect("detailed")
            .dropped_count,
        Some(4)
    );

    let counters = dropped(&inner);
    assert_eq!(counters.transport_failure, 3);
    assert_eq!(counters.receipt_rejected, 1);
    assert_eq!(inner.snapshot().fallback_routed, 0);
}

#[cfg(unix)]
#[derive(Clone, Copy)]
enum BadReceipt {
    CountMismatch,
    IndexOutOfRange,
    DuplicateIndex,
    RangeArithmetic,
    RangeWithoutAccepted,
    Garbage,
}

#[cfg(unix)]
impl BadReceipt {
    fn records(self) -> usize {
        match self {
            Self::DuplicateIndex => 2,
            _ => 1,
        }
    }

    /// Every scripted receipt also claims `critical` pressure, so an honoured
    /// pressure change would be observable.
    fn response(self, boot: &str) -> FixtureResponse {
        let rejection = |index| IngestRejectionV1 {
            index,
            reason: RejectionReasonV1::InvalidShape,
        };
        let base = IngestReceiptV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            collector_boot_id: boot.to_owned(),
            accepted_range: None,
            accepted_count: 0,
            duplicate_count: 0,
            rejections: Vec::new(),
            pressure: PressureV1::Critical,
        };
        match self {
            // Two accounted outcomes for one submitted record.
            Self::CountMismatch => FixtureResponse::Receipt(IngestReceiptV1 {
                accepted_count: 2,
                accepted_range: Some(AcceptedOrderRangeV1 { first: 1, last: 2 }),
                ..base
            }),
            // Coherent totals, but the index addresses nothing.
            Self::IndexOutOfRange => FixtureResponse::Receipt(IngestReceiptV1 {
                rejections: vec![rejection(5)],
                ..base
            }),
            Self::DuplicateIndex => FixtureResponse::Receipt(IngestReceiptV1 {
                rejections: vec![rejection(0), rejection(0)],
                ..base
            }),
            // last - first + 1 must equal accepted_count.
            Self::RangeArithmetic => FixtureResponse::Receipt(IngestReceiptV1 {
                accepted_count: 1,
                accepted_range: Some(AcceptedOrderRangeV1 { first: 1, last: 5 }),
                ..base
            }),
            // The range is absent exactly when nothing was accepted.
            Self::RangeWithoutAccepted => FixtureResponse::Receipt(IngestReceiptV1 {
                rejections: vec![rejection(0)],
                accepted_range: Some(AcceptedOrderRangeV1 { first: 1, last: 1 }),
                ..base
            }),
            Self::Garbage => FixtureResponse::RawBody(b"{\"schema_version\":".to_vec()),
        }
    }
}

/// An incoherent or unparseable receipt is `receipt_invalid`: its pressure
/// claim is ignored, the batch is not retried, and the generation latches
/// unusable until a strictly newer one arrives.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn incoherent_receipts_are_invalid_and_ignore_their_pressure_claim() {
    use super::tests_support::{fallback_bytes, fallback_directory, fallback_writer};

    for case in [
        BadReceipt::CountMismatch,
        BadReceipt::IndexOutOfRange,
        BadReceipt::DuplicateIndex,
        BadReceipt::RangeArithmetic,
        BadReceipt::RangeWithoutAccepted,
        BadReceipt::Garbage,
    ] {
        let expected_records = case.records();
        let boot = TEST_COLLECTOR_BOOT.to_owned();
        let fixture =
            CollectorFixture::start(TEST_COLLECTOR_BOOT, move |_, _| case.response(&boot)).await;
        let directory = fallback_directory();
        let inner = producer(
            DiagnosticsComponent::AnyHarness,
            fixture.ready(1),
            Some(fallback_writer(
                &directory,
                DiagnosticsComponent::AnyHarness,
            )),
        );

        for index in 0..expected_records {
            assert_eq!(
                emit(&inner, ordinary(&format!("event-{index}"))),
                EmitDisposition::Admitted
            );
        }
        let _worker = spawn_worker(&inner);
        assert!(drained(&inner).await, "the batch must resolve");
        // Absence proof: no retry of the same records.
        settle().await;

        let counters = dropped(&inner);
        assert_eq!(counters.receipt_invalid, 1);
        assert_eq!(counters.transport_failure, 0);
        assert_eq!(counters.transport_timeout, 0);
        assert_eq!(fixture.batch_count(), 1, "the batch is never re-sent");
        // The claimed critical pressure came from an invalid receipt.
        with_state(&inner, |state| {
            assert!(matches!(state.pressure, PressureSuppression::Normal));
        });

        let snapshot = inner.snapshot();
        assert_eq!(
            snapshot.collector_state,
            ProducerCollectorState::Unavailable
        );
        assert!(!snapshot.delivery_fence_eligible);
        assert_eq!(
            snapshot.fallback_routed,
            u64::try_from(expected_records).expect("bounded count")
        );
        assert_eq!(snapshot.resident_records, 0);

        let written = fallback_bytes(&directory, "anyharness.jsonl");
        let lines: Vec<serde_json::Value> = written
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("fallback JSON line"))
            .collect();
        assert_eq!(lines.len(), expected_records);
        for line in &lines {
            assert_eq!(line["reason"], "delivery_unknown");
        }
    }
}
