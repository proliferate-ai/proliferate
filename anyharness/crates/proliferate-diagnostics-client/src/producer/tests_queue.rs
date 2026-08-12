//! Queue, reservation-band, eviction, and pressure proofs against the exact
//! frozen caps. Every bound here is asserted against the shared constant and
//! its frozen literal so a silent retune fails the suite.

use std::{
    borrow::Cow,
    time::{Duration, Instant},
};

use proliferate_diagnostics_protocol::v1::types::{ArgumentValueV1, PressureV1, SeverityV1};

use super::status::ProducerFailureClassification;
use super::tests_support::{
    dropped, emit, filler, input, ordinary, ordinary_bytes, protected, queued_sequences,
    resident_bytes, unavailable_producer, with_state,
};
use super::{
    PressureSuppression, ResidentAccounting, ORDINARY_BYTE_LIMIT, ORDINARY_RECORD_LIMIT,
    PRESSURE_INTERVAL, TOTAL_BYTE_LIMIT, TOTAL_RECORD_LIMIT,
};
use crate::{DiagnosticArgument, DiagnosticPrivacy, EmitDisposition};

#[test]
fn frozen_admission_caps() {
    assert_eq!(TOTAL_RECORD_LIMIT, 256);
    assert_eq!(TOTAL_BYTE_LIMIT, 1_048_576);
    assert_eq!(ORDINARY_RECORD_LIMIT, 224);
    assert_eq!(ORDINARY_BYTE_LIMIT, 917_504);
    // The reservation band is both dimensions at once, not either one.
    assert_eq!(TOTAL_RECORD_LIMIT - ORDINARY_RECORD_LIMIT, 32);
    assert_eq!(TOTAL_BYTE_LIMIT - ORDINARY_BYTE_LIMIT, 131_072);
    assert_eq!(PRESSURE_INTERVAL, Duration::from_secs(1));
}

/// Ordinary admission stops at 224 records, both reservation dimensions stay
/// free inside the totals, and the protected lane consumes exactly the
/// 32-record band before the first eviction.
#[test]
fn ordinary_records_stop_at_224_and_the_protected_band_is_exactly_32_records() {
    let inner = unavailable_producer();

    for index in 0..ORDINARY_RECORD_LIMIT {
        assert_eq!(
            emit(&inner, ordinary(&format!("ordinary-{index}"))),
            EmitDisposition::Admitted
        );
    }
    assert_eq!(
        emit(&inner, ordinary("one too many")),
        EmitDisposition::Dropped(ProducerFailureClassification::QueueRecords)
    );

    let snapshot = inner.snapshot();
    assert_eq!(
        usize::from(snapshot.resident_records),
        ORDINARY_RECORD_LIMIT
    );
    assert!(
        usize::try_from(snapshot.resident_bytes).expect("bounded bytes") <= ORDINARY_BYTE_LIMIT
    );
    assert_eq!(
        TOTAL_RECORD_LIMIT - usize::from(snapshot.resident_records),
        32
    );
    assert!(
        TOTAL_BYTE_LIMIT - usize::try_from(snapshot.resident_bytes).expect("bounded bytes")
            >= 131_072
    );

    let mut admitted_without_eviction = 0;
    for index in 0..33 {
        assert_eq!(
            emit(&inner, protected(&format!("protected-{index}"))),
            EmitDisposition::Admitted
        );
        if dropped(&inner).protected_eviction == 0 {
            admitted_without_eviction += 1;
        }
    }

    assert_eq!(admitted_without_eviction, 32);
    assert_eq!(dropped(&inner).protected_eviction, 1);
    let snapshot = inner.snapshot();
    assert_eq!(usize::from(snapshot.resident_records), TOTAL_RECORD_LIMIT);
    // Oldest evictable ordinary record left first; nothing was renumbered.
    let sequences = queued_sequences(&inner);
    assert_eq!(sequences.first(), Some(&2));
    assert_eq!(sequences.len(), TOTAL_RECORD_LIMIT);
    assert!(sequences.windows(2).all(|pair| pair[0] < pair[1]));
}

/// With large records the byte dimension binds first: admission stops well
/// below 224 records and still leaves the full 131,072-byte reservation.
#[test]
fn ordinary_bytes_stop_at_917_504_before_the_record_threshold() {
    let inner = unavailable_producer();
    let message = filler(8_000);
    let mut smallest = usize::MAX;
    let mut previous = 0;
    let mut admitted = 0;

    loop {
        match emit(&inner, ordinary(&message)) {
            EmitDisposition::Admitted => {
                let bytes = ordinary_bytes(&inner);
                smallest = smallest.min(bytes - previous);
                previous = bytes;
                admitted += 1;
                assert!(
                    admitted < ORDINARY_RECORD_LIMIT,
                    "8 KiB records must exhaust the byte threshold first"
                );
            }
            other => {
                assert_eq!(
                    other,
                    EmitDisposition::Dropped(ProducerFailureClassification::QueueBytes)
                );
                break;
            }
        }
    }

    let ordinary_resident = ordinary_bytes(&inner);
    assert!(ordinary_resident <= ORDINARY_BYTE_LIMIT);
    // Exact boundary: one more record of the smallest observed size would
    // have crossed 917,504.
    assert!(ordinary_resident + smallest > ORDINARY_BYTE_LIMIT);
    assert!(admitted < ORDINARY_RECORD_LIMIT);
    assert!(TOTAL_BYTE_LIMIT - resident_bytes(&inner) >= 131_072);
    assert!(TOTAL_RECORD_LIMIT - admitted >= 32);

    // The protected lane may use the byte band, and its first eviction is
    // driven by bytes while the record cap still has room.
    let mut protected_size = 0;
    let mut bytes_before_eviction = resident_bytes(&inner);
    let mut records_before_eviction = admitted;
    for index in 0..64 {
        let before_bytes = resident_bytes(&inner);
        let before_records = usize::from(inner.snapshot().resident_records);
        assert_eq!(
            emit(&inner, input(SeverityV1::Warn, &message)),
            EmitDisposition::Admitted,
            "protected record {index} must use free total capacity"
        );
        if dropped(&inner).protected_eviction > 0 {
            bytes_before_eviction = before_bytes;
            records_before_eviction = before_records;
            break;
        }
        protected_size = resident_bytes(&inner) - before_bytes;
    }

    assert_eq!(dropped(&inner).protected_eviction, 1);
    assert!(protected_size > 0);
    // Bytes, not records, forced the eviction.
    assert!(records_before_eviction < TOTAL_RECORD_LIMIT);
    // The band was consumed before any eviction: the evicting record simply
    // no longer fit inside the 1 MiB total.
    assert!(TOTAL_BYTE_LIMIT - bytes_before_eviction < protected_size);
    assert!(bytes_before_eviction - ordinary_resident >= 131_072 - protected_size);
    assert_eq!(queued_sequences(&inner).first(), Some(&2));
}

/// A dispatched in-flight record is immutable: it holds both record and byte
/// capacity, and a protected record is dropped rather than withdrawing it.
#[test]
fn in_flight_ownership_holds_capacity_and_is_never_withdrawn() {
    let record_bound = unavailable_producer();
    with_state(&record_bound, |state| {
        state.in_flight = (0..TOTAL_RECORD_LIMIT)
            .map(|_| ResidentAccounting {
                serialized_bytes: 0,
            })
            .collect();
    });

    assert_eq!(
        emit(&record_bound, protected("protected")),
        EmitDisposition::Dropped(ProducerFailureClassification::QueueRecords)
    );
    with_state(&record_bound, |state| {
        assert_eq!(state.in_flight.len(), TOTAL_RECORD_LIMIT);
        assert!(state.queue.is_empty());
    });
    assert!(record_bound.snapshot().in_flight);
    assert_eq!(
        usize::from(record_bound.snapshot().resident_records),
        TOTAL_RECORD_LIMIT
    );

    let byte_bound = unavailable_producer();
    with_state(&byte_bound, |state| {
        state.in_flight = vec![ResidentAccounting {
            serialized_bytes: TOTAL_BYTE_LIMIT,
        }];
        state.resident_bytes = TOTAL_BYTE_LIMIT;
    });

    assert_eq!(
        emit(&byte_bound, protected("protected")),
        EmitDisposition::Dropped(ProducerFailureClassification::QueueBytes)
    );
    with_state(&byte_bound, |state| {
        assert_eq!(state.in_flight.len(), 1);
        assert!(state.queue.is_empty());
    });
}

/// A single record over the accepted 65,536-byte bound is rejected before
/// admission; nothing is split and no sequence is consumed.
#[test]
fn oversized_record_is_rejected_before_admission_and_never_split() {
    let inner = unavailable_producer();
    let mut oversized = ordinary("oversized");
    oversized.arguments = (0..32)
        .map(|index| DiagnosticArgument {
            name: Cow::Owned(format!("argument.{index}")),
            privacy: DiagnosticPrivacy::Operational,
            value: ArgumentValueV1::String(filler(4_096)),
        })
        .collect();

    assert_eq!(
        emit(&inner, oversized),
        EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid)
    );

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.resident_records, 0);
    assert_eq!(snapshot.next_sequence, Some(1));
    assert_eq!(snapshot.last_assigned_sequence, None);
    assert_eq!(snapshot.dropped_by_reason.filter_invalid, 1);
}

/// The accepted pressure vocabulary is exact: `elevated` suppresses
/// trace/debug, `critical` also suppresses info, warn/error are never
/// suppressed, and `normal` removes suppression.
#[test]
fn pressure_vocabulary_suppresses_exactly_the_frozen_lanes() {
    let inner = unavailable_producer();
    let severities = [
        SeverityV1::Trace,
        SeverityV1::Debug,
        SeverityV1::Info,
        SeverityV1::Warn,
        SeverityV1::Error,
    ];

    for severity in severities {
        assert_eq!(
            emit(&inner, input(severity, "normal pressure")),
            EmitDisposition::Admitted
        );
    }

    let before = Instant::now();
    with_state(&inner, |state| state.apply_pressure(PressureV1::Elevated));
    let after = Instant::now();
    with_state(&inner, |state| match state.pressure {
        PressureSuppression::Elevated { until, probe_used } => {
            assert!(!probe_used);
            assert!(until >= before + PRESSURE_INTERVAL);
            assert!(until <= after + PRESSURE_INTERVAL);
        }
        _ => panic!("elevated suppression must be armed"),
    });
    for severity in [SeverityV1::Trace, SeverityV1::Debug] {
        assert_eq!(
            emit(&inner, input(severity, "elevated")),
            EmitDisposition::Dropped(ProducerFailureClassification::Pressure)
        );
    }
    for severity in [SeverityV1::Info, SeverityV1::Warn, SeverityV1::Error] {
        assert_eq!(
            emit(&inner, input(severity, "elevated")),
            EmitDisposition::Admitted
        );
    }

    with_state(&inner, |state| state.apply_pressure(PressureV1::Critical));
    for severity in [SeverityV1::Trace, SeverityV1::Debug, SeverityV1::Info] {
        assert_eq!(
            emit(&inner, input(severity, "critical")),
            EmitDisposition::Dropped(ProducerFailureClassification::Pressure)
        );
    }
    for severity in [SeverityV1::Warn, SeverityV1::Error] {
        assert_eq!(
            emit(&inner, input(severity, "critical")),
            EmitDisposition::Admitted
        );
    }

    with_state(&inner, |state| state.apply_pressure(PressureV1::Normal));
    assert!(matches!(
        with_state(&inner, |state| state.pressure),
        PressureSuppression::Normal
    ));
    assert_eq!(
        emit(&inner, input(SeverityV1::Trace, "normal again")),
        EmitDisposition::Admitted
    );
}

/// After the interval exactly one otherwise eligible ordinary record is
/// admitted as a probe. Suppressed records consume sequence, count as
/// `pressure`, and never spill to fallback while the collector is healthy.
#[test]
fn a_single_probe_is_admitted_after_the_suppression_interval() {
    let inner = unavailable_producer();
    with_state(&inner, |state| state.apply_pressure(PressureV1::Elevated));

    assert_eq!(
        emit(&inner, input(SeverityV1::Trace, "suppressed")),
        EmitDisposition::Dropped(ProducerFailureClassification::Pressure)
    );
    // Expire the window without sleeping on the wall clock.
    with_state(&inner, |state| {
        if let PressureSuppression::Elevated { until, .. } = &mut state.pressure {
            *until = Instant::now() - Duration::from_millis(1);
        }
    });

    assert_eq!(
        emit(&inner, input(SeverityV1::Trace, "probe")),
        EmitDisposition::Admitted
    );
    assert_eq!(
        emit(&inner, input(SeverityV1::Trace, "suppressed again")),
        EmitDisposition::Dropped(ProducerFailureClassification::Pressure)
    );

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.last_assigned_sequence, Some(3));
    assert_eq!(snapshot.dropped_by_reason.pressure, 2);
    assert_eq!(snapshot.fallback_routed, 0);
    assert!(!snapshot.fallback_active);
    assert_eq!(queued_sequences(&inner), vec![2]);
}
