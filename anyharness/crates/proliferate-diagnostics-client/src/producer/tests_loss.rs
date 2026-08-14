//! Closed-snapshot loss accounting: exact `dropped_count`, an optional exact
//! assigned interval, concurrent-loss preservation, and safe-integer
//! saturation. Nothing here clears a counter on construction.

use proliferate_diagnostics_protocol::v1::{
    limits::MAX_SAFE_INTEGER,
    types::{ArgumentValueV1, DetailedKindV1, PrivacyClassificationV1, SeverityV1},
};

use super::admission::PendingLossRange;
use super::status::{BoundedLossCounters, ProducerFailureClassification};
use super::tests_support::{
    argument_names, dropped, emit, invalid_input, loss_summaries, ordinary, queued_records,
    ready_producer, unavailable_producer, with_state,
};
use super::ORDINARY_RECORD_LIMIT;
use crate::EmitDisposition;

const CLOSED_REASONS: [(ProducerFailureClassification, &str); 14] = [
    (ProducerFailureClassification::QueueRecords, "queue_records"),
    (ProducerFailureClassification::QueueBytes, "queue_bytes"),
    (
        ProducerFailureClassification::ProtectedEviction,
        "protected_eviction",
    ),
    (ProducerFailureClassification::Pressure, "pressure"),
    (
        ProducerFailureClassification::GenerationChanged,
        "generation_changed",
    ),
    (
        ProducerFailureClassification::TransportTimeout,
        "transport_timeout",
    ),
    (
        ProducerFailureClassification::TransportFailure,
        "transport_failure",
    ),
    (
        ProducerFailureClassification::ReceiptInvalid,
        "receipt_invalid",
    ),
    (
        ProducerFailureClassification::ReceiptRejected,
        "receipt_rejected",
    ),
    (
        ProducerFailureClassification::FallbackOverflow,
        "fallback_overflow",
    ),
    (
        ProducerFailureClassification::FallbackWriteFailed,
        "fallback_write_failed",
    ),
    (
        ProducerFailureClassification::ShutdownTimeout,
        "shutdown_timeout",
    ),
    (
        ProducerFailureClassification::FilterInvalid,
        "filter_invalid",
    ),
    (
        ProducerFailureClassification::SequenceExhausted,
        "sequence_exhausted",
    ),
];

/// The 14 closed reasons, in the frozen order, each with its own declared
/// counter field. Fixed cardinality, no map.
#[test]
fn closed_loss_vocabulary_is_exact_and_ordered() {
    let counters = BoundedLossCounters::default();
    let names: Vec<&str> = counters
        .named_counts()
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    let expected: Vec<&str> = CLOSED_REASONS.iter().map(|(_, name)| *name).collect();
    assert_eq!(names, expected);

    for (index, (reason, name)) in CLOSED_REASONS.into_iter().enumerate() {
        assert_eq!(
            serde_json::to_string(&reason).expect("serializable reason"),
            format!("\"{name}\"")
        );
        let mut counters = BoundedLossCounters::default();
        counters.increment(reason);
        let counts = counters.named_counts();
        assert_eq!(counts[index], (name, 1));
        assert_eq!(
            counts.iter().map(|(_, count)| *count).sum::<u64>(),
            1,
            "{name} must own exactly one counter"
        );
    }
}

/// A closed snapshot reports the exact total and, when it owns one exact
/// assigned interval, both of its bounds.
#[tokio::test(flavor = "multi_thread")]
async fn closed_snapshot_summary_carries_the_exact_total_and_exact_range() {
    let inner = ready_producer().await;
    for index in 0..ORDINARY_RECORD_LIMIT {
        assert_eq!(
            emit(&inner, ordinary(&format!("ordinary-{index}"))),
            EmitDisposition::Admitted
        );
    }
    for index in 0..5 {
        assert_eq!(
            emit(&inner, ordinary(&format!("dropped-{index}"))),
            EmitDisposition::Dropped(ProducerFailureClassification::QueueRecords)
        );
    }
    with_state(&inner, |state| {
        assert!(matches!(
            state.pending_loss_range,
            PendingLossRange::Exact {
                first: 225,
                last: 229
            }
        ));
    });

    inner.maybe_emit_loss_summary();

    let records = queued_records(&inner);
    let summaries = loss_summaries(&records);
    assert_eq!(summaries.len(), 1);
    let summary = summaries[0];
    assert_eq!(summary.name, "anyharness.diagnostics.loss");
    assert_eq!(summary.severity, SeverityV1::Warn);
    assert_eq!(summary.privacy, PrivacyClassificationV1::Operational);
    // Appended after every already-resident lower sequence, with its own.
    assert_eq!(summary.producer_sequence, 230);
    assert_eq!(
        records.last().expect("summary is last").producer_sequence,
        230
    );
    let detailed = summary.detailed.as_ref().expect("detailed summary");
    assert_eq!(detailed.kind, DetailedKindV1::LossSummary);
    assert_eq!(detailed.dropped_count, Some(5));
    assert_eq!(detailed.message, None);
    let arguments: Vec<(String, ArgumentValueV1)> = summary
        .arguments
        .iter()
        .map(|argument| (argument.name.clone(), argument.value.clone()))
        .collect();
    assert_eq!(
        arguments,
        vec![
            ("queue_records".to_owned(), ArgumentValueV1::Integer(5)),
            (
                "first_lost_sequence".to_owned(),
                ArgumentValueV1::Integer(225)
            ),
            (
                "last_lost_sequence".to_owned(),
                ArgumentValueV1::Integer(229)
            ),
        ]
    );

    // Construction closes a snapshot but clears nothing from the ledger.
    assert_eq!(dropped(&inner).queue_records, 5);
    with_state(&inner, |state| {
        assert!(state.open_loss_snapshot.is_some());
        assert_eq!(state.pending_loss_total, 0);
        assert!(matches!(state.pending_loss_range, PendingLossRange::Empty));
    });
}

/// Filter-invalid loss owns no sequence, so the summary reports the exact
/// total with no invented bounds.
#[tokio::test(flavor = "multi_thread")]
async fn unsequenced_loss_removes_the_range_without_inventing_one() {
    let inner = ready_producer().await;
    assert_eq!(
        emit(&inner, invalid_input()),
        EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid)
    );
    with_state(&inner, |state| {
        state.record_loss_with_sequence(ProducerFailureClassification::Pressure, Some(1));
        assert!(matches!(state.pending_loss_range, PendingLossRange::Broken));
    });

    inner.maybe_emit_loss_summary();

    let records = queued_records(&inner);
    let summaries = loss_summaries(&records);
    assert_eq!(summaries.len(), 1);
    let detailed = summaries[0].detailed.as_ref().expect("detailed summary");
    assert_eq!(detailed.dropped_count, Some(2));
    let names = argument_names(summaries[0]);
    assert!(names.contains(&"filter_invalid".to_owned()));
    assert!(names.contains(&"pressure".to_owned()));
    assert!(!names.contains(&"first_lost_sequence".to_owned()));
    assert!(!names.contains(&"last_lost_sequence".to_owned()));
}

/// A non-contiguous assigned interval is not an interval: no bounds are
/// reported rather than spanning the surviving records in between.
#[tokio::test(flavor = "multi_thread")]
async fn noncontiguous_losses_remove_the_range() {
    let inner = ready_producer().await;
    with_state(&inner, |state| {
        state.record_loss_with_sequence(ProducerFailureClassification::QueueBytes, Some(10));
        state.record_loss_with_sequence(ProducerFailureClassification::QueueBytes, Some(12));
        assert!(matches!(state.pending_loss_range, PendingLossRange::Broken));
    });

    inner.maybe_emit_loss_summary();

    let records = queued_records(&inner);
    let summaries = loss_summaries(&records);
    assert_eq!(summaries.len(), 1);
    assert_eq!(
        summaries[0]
            .detailed
            .as_ref()
            .expect("detailed summary")
            .dropped_count,
        Some(2)
    );
    assert_eq!(argument_names(summaries[0]), vec!["queue_bytes".to_owned()]);
}

/// An undelivered snapshot returns to the pending pool, keeps concurrent
/// losses, and a later summary takes a new sequence instead of replaying.
#[tokio::test(flavor = "multi_thread")]
async fn returned_snapshot_preserves_concurrent_losses_and_takes_a_new_sequence() {
    let inner = ready_producer().await;
    with_state(&inner, |state| {
        state.record_loss_with_sequence(ProducerFailureClassification::QueueRecords, Some(1));
        state.record_loss_with_sequence(ProducerFailureClassification::QueueRecords, Some(2));
    });

    inner.maybe_emit_loss_summary();
    let first = queued_records(&inner);
    let first_summary = loss_summaries(&first)[0].producer_sequence;
    assert_eq!(
        loss_summaries(&first)[0]
            .detailed
            .as_ref()
            .expect("detailed summary")
            .dropped_count,
        Some(2)
    );

    // A loss concurrent with the open snapshot stays pending, then the
    // undelivered snapshot rejoins it.
    with_state(&inner, |state| {
        state.record_loss(ProducerFailureClassification::TransportFailure);
        assert_eq!(state.pending_loss_total, 1);
        state.return_loss_snapshot();
        assert_eq!(state.pending_loss_total, 3);
        assert!(matches!(state.pending_loss_range, PendingLossRange::Broken));
        assert!(state.open_loss_snapshot.is_none());
        // The already-queued summary is not withdrawn or renumbered.
        state.queue.clear();
        state.resident_bytes = 0;
        state.ordinary_records = 0;
        state.ordinary_bytes = 0;
    });

    inner.maybe_emit_loss_summary();

    let second = queued_records(&inner);
    let second_summary = loss_summaries(&second)[0];
    assert!(second_summary.producer_sequence > first_summary);
    assert_eq!(
        second_summary
            .detailed
            .as_ref()
            .expect("detailed summary")
            .dropped_count,
        Some(3)
    );
    let names = argument_names(second_summary);
    assert!(names.contains(&"queue_records".to_owned()));
    assert!(names.contains(&"transport_failure".to_owned()));
    assert!(!names.contains(&"first_lost_sequence".to_owned()));
}

/// Only one summary is open at a time: a second construction while the first
/// is unresolved is refused, so the ledger cannot be double counted.
#[tokio::test(flavor = "multi_thread")]
async fn only_one_loss_snapshot_is_open_at_a_time() {
    let inner = ready_producer().await;
    with_state(&inner, |state| {
        state.record_loss_with_sequence(ProducerFailureClassification::Pressure, Some(1));
    });

    inner.maybe_emit_loss_summary();
    with_state(&inner, |state| {
        state.record_loss_with_sequence(ProducerFailureClassification::Pressure, Some(2));
    });
    inner.maybe_emit_loss_summary();

    let records = queued_records(&inner);
    assert_eq!(loss_summaries(&records).len(), 1);
    with_state(&inner, |state| {
        assert_eq!(state.pending_loss_total, 1);
    });
}

/// Counters and totals saturate at the accepted safe maximum even though
/// their Rust storage is `u64`.
#[test]
fn loss_counters_saturate_at_the_safe_integer_bound() {
    let inner = unavailable_producer();
    with_state(&inner, |state| {
        state.dropped.queue_records = MAX_SAFE_INTEGER;
        state.pending_loss_total = MAX_SAFE_INTEGER;
        state.fallback_routed = MAX_SAFE_INTEGER;
        state.record_loss(ProducerFailureClassification::QueueRecords);
        assert_eq!(state.dropped.queue_records, MAX_SAFE_INTEGER);
        assert_eq!(state.pending_loss_total, MAX_SAFE_INTEGER);
    });

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.dropped_by_reason.queue_records, MAX_SAFE_INTEGER);
    assert_eq!(snapshot.fallback_routed, MAX_SAFE_INTEGER);
    let encoded = serde_json::to_string(&snapshot).expect("serializable snapshot");
    assert!(encoded.contains("9007199254740991"));
    assert!(!encoded.contains("9007199254740992"));

    let mut left = BoundedLossCounters {
        queue_records: MAX_SAFE_INTEGER,
        ..BoundedLossCounters::default()
    };
    let right = BoundedLossCounters {
        queue_records: MAX_SAFE_INTEGER,
        pressure: 7,
        ..BoundedLossCounters::default()
    };
    left.merge(&right);
    assert_eq!(left.queue_records, MAX_SAFE_INTEGER);
    assert_eq!(left.pressure, 7);
}

/// `fallback_routed` is gap evidence tracked separately from the loss
/// counters and is never folded into `dropped_by_reason`.
#[test]
fn fallback_routed_is_tracked_separately_from_loss() {
    let inner = unavailable_producer();
    with_state(&inner, |state| {
        state.fallback_routed = 3;
    });

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.fallback_routed, 3);
    assert_eq!(snapshot.dropped_by_reason, BoundedLossCounters::default());
}
