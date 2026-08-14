//! Producer sequence proofs: first sequence, admission-order assignment,
//! process restart, and the `MAX_SAFE_INTEGER` exhaustion boundary.

use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::{
    limits::MAX_SAFE_INTEGER, types::SeverityV1, validation::validate_producer_record,
};

use super::admission::PendingLossRange;
use super::status::ProducerFailureClassification;
use super::tests_support::{
    dropped, emit, filler, ordinary, protected, queued_records, queued_sequences, ready_producer,
    unavailable_producer, with_state,
};
use crate::EmitDisposition;

#[test]
fn frozen_safe_integer_bound_is_the_last_assignable_sequence() {
    assert_eq!(MAX_SAFE_INTEGER, 9_007_199_254_740_991);
    assert_ne!(MAX_SAFE_INTEGER, u64::MAX);
}

#[test]
fn first_valid_record_has_sequence_one() {
    let inner = unavailable_producer();

    assert_eq!(emit(&inner, ordinary("first")), EmitDisposition::Admitted);

    let records = queued_records(&inner);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].producer_sequence, 1);
    let snapshot = inner.snapshot();
    assert_eq!(snapshot.last_assigned_sequence, Some(1));
    assert_eq!(snapshot.next_sequence, Some(2));
}

#[test]
fn sequences_are_assigned_in_emission_order_without_gaps() {
    let inner = unavailable_producer();

    for index in 0..16 {
        assert_eq!(
            emit(&inner, ordinary(&format!("event-{index}"))),
            EmitDisposition::Admitted
        );
    }

    assert_eq!(queued_sequences(&inner), (1..=16).collect::<Vec<_>>());
    assert_eq!(inner.snapshot().last_assigned_sequence, Some(16));
    assert_eq!(inner.snapshot().next_sequence, Some(17));
}

/// Sequence assignment and ordered insertion share one short critical
/// section, so concurrent tracing calls cannot enqueue out of sequence.
#[test]
fn concurrent_emissions_never_enqueue_out_of_sequence() {
    const THREADS: usize = 8;
    const PER_THREAD: usize = 24;

    let inner = unavailable_producer();
    let mut handles = Vec::new();
    for thread in 0..THREADS {
        let inner = Arc::clone(&inner);
        handles.push(std::thread::spawn(move || {
            for index in 0..PER_THREAD {
                assert_eq!(
                    emit(&inner, ordinary(&format!("thread-{thread}-{index}"))),
                    EmitDisposition::Admitted
                );
            }
        }));
    }
    for handle in handles {
        handle.join().expect("emitting thread");
    }

    let total = u64::try_from(THREADS * PER_THREAD).expect("bounded total");
    assert_eq!(queued_sequences(&inner), (1..=total).collect::<Vec<_>>());
    assert_eq!(inner.snapshot().last_assigned_sequence, Some(total));
}

/// A process restart is the only thing that changes the boot id, and the new
/// producer starts its own sequence at one; nothing is renumbered or shared.
#[test]
fn process_restart_generates_a_new_boot_id_and_restarts_at_sequence_one() {
    let first = unavailable_producer();
    assert_eq!(emit(&first, ordinary("before")), EmitDisposition::Admitted);
    assert_eq!(emit(&first, ordinary("before")), EmitDisposition::Admitted);
    let first_snapshot = first.snapshot();

    let second = unavailable_producer();
    assert_eq!(emit(&second, ordinary("after")), EmitDisposition::Admitted);
    let second_snapshot = second.snapshot();

    assert_ne!(
        first_snapshot.producer_boot_id,
        second_snapshot.producer_boot_id
    );
    assert_eq!(first_snapshot.last_assigned_sequence, Some(2));
    assert_eq!(second_snapshot.last_assigned_sequence, Some(1));
    assert_eq!(queued_sequences(&second), vec![1]);
}

/// Boundary injection: the safe-integer maximum is assigned exactly once and
/// the producer then refuses every later emission without wrapping, reusing
/// zero/one, or serializing `MAX_SAFE_INTEGER + 1`.
#[test]
fn exhaustion_at_the_safe_integer_bound_stops_assignment_without_wrap_or_reuse() {
    let inner = unavailable_producer();
    with_state(&inner, |state| {
        state.next_sequence = Some(MAX_SAFE_INTEGER);
    });

    assert_eq!(emit(&inner, ordinary("last")), EmitDisposition::Admitted);

    let records = queued_records(&inner);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].producer_sequence, MAX_SAFE_INTEGER);
    validate_producer_record(&records[0]).expect("in-range record");
    let encoded = serde_json::to_string(&records[0]).expect("serializable record");
    assert!(encoded.contains("\"producer_sequence\":9007199254740991"));
    assert!(!encoded.contains("9007199254740992"));

    let exhausted = inner.snapshot();
    assert_eq!(exhausted.next_sequence, None);
    assert_eq!(exhausted.last_assigned_sequence, Some(MAX_SAFE_INTEGER));

    for _ in 0..3 {
        assert_eq!(
            emit(&inner, ordinary("after exhaustion")),
            EmitDisposition::Dropped(ProducerFailureClassification::SequenceExhausted)
        );
    }
    // The protected lane has no sequence of its own to fall back on.
    assert_eq!(
        emit(&inner, protected("protected after exhaustion")),
        EmitDisposition::Dropped(ProducerFailureClassification::SequenceExhausted)
    );

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.next_sequence, None);
    assert_eq!(snapshot.last_assigned_sequence, Some(MAX_SAFE_INTEGER));
    assert_eq!(snapshot.dropped_by_reason.sequence_exhausted, 4);
    assert_eq!(
        snapshot.last_failure,
        Some(ProducerFailureClassification::SequenceExhausted)
    );
    // Status-only: no record was renumbered, reused, or added.
    assert_eq!(queued_sequences(&inner), vec![MAX_SAFE_INTEGER]);
    assert!(queued_sequences(&inner)
        .iter()
        .all(|sequence| *sequence != 0 && *sequence <= MAX_SAFE_INTEGER));
}

/// Post-exhaustion losses own no legal assigned interval, so no summary can
/// be constructed and no range is invented.
#[tokio::test(flavor = "multi_thread")]
async fn post_exhaustion_losses_produce_no_summary_and_no_invented_range() {
    let inner = ready_producer().await;
    with_state(&inner, |state| {
        state.next_sequence = None;
        state.last_assigned_sequence = Some(MAX_SAFE_INTEGER);
    });

    for _ in 0..5 {
        assert_eq!(
            emit(&inner, ordinary("after exhaustion")),
            EmitDisposition::Dropped(ProducerFailureClassification::SequenceExhausted)
        );
    }

    assert_eq!(dropped(&inner).sequence_exhausted, 5);
    with_state(&inner, |state| {
        assert_eq!(state.pending_loss_total, 5);
        // Unsequenced losses break the interval claim instead of inventing one.
        assert!(matches!(state.pending_loss_range, PendingLossRange::Broken));
    });

    inner.maybe_emit_loss_summary();

    assert!(queued_records(&inner).is_empty());
    with_state(&inner, |state| {
        assert!(state.open_loss_snapshot.is_none());
        assert_eq!(state.pending_loss_total, 5);
    });
}

/// Filter-invalid input fails before sequence assignment, so it consumes no
/// sequence and leaves no gap.
#[test]
fn filter_invalid_input_consumes_no_sequence() {
    let inner = unavailable_producer();
    assert_eq!(emit(&inner, ordinary("valid")), EmitDisposition::Admitted);

    assert_eq!(
        emit(&inner, super::tests_support::invalid_input()),
        EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid)
    );

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.last_assigned_sequence, Some(1));
    assert_eq!(snapshot.next_sequence, Some(2));
    assert_eq!(snapshot.dropped_by_reason.filter_invalid, 1);

    assert_eq!(emit(&inner, ordinary("next")), EmitDisposition::Admitted);
    assert_eq!(queued_sequences(&inner), vec![1, 2]);
}

/// Every drop after assignment leaves an observable gap: the surviving
/// records keep their original sequences and the queue is never compacted.
#[test]
fn drops_after_assignment_leave_observable_sequence_gaps() {
    let inner = unavailable_producer();
    assert_eq!(emit(&inner, ordinary("kept")), EmitDisposition::Admitted);
    // A pressure suppression window drops the ordinary lane after assignment.
    with_state(&inner, |state| {
        state.apply_pressure(proliferate_diagnostics_protocol::v1::types::PressureV1::Critical);
    });
    for _ in 0..2 {
        assert_eq!(
            emit(
                &inner,
                super::tests_support::input(SeverityV1::Info, &filler(8))
            ),
            EmitDisposition::Dropped(ProducerFailureClassification::Pressure)
        );
    }
    with_state(&inner, |state| {
        state.pressure = super::PressureSuppression::Normal;
    });

    assert_eq!(emit(&inner, ordinary("kept")), EmitDisposition::Admitted);

    assert_eq!(queued_sequences(&inner), vec![1, 4]);
    assert_eq!(dropped(&inner).pressure, 2);
}
