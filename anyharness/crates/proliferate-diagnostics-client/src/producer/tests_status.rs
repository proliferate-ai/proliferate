//! Status-snapshot proofs: the exact frozen surface, zero-inclusive ordered
//! counters, the optional exhausted sequence, resident totals that cover both
//! queued and in-flight records, and the absence of content or connection
//! material.

use std::borrow::Cow;

use proliferate_diagnostics_protocol::v1::{
    limits::MAX_SAFE_INTEGER,
    types::{ArgumentValueV1, ComponentV1, SeverityV1},
};
use serde_json::Value;

use super::status::{BoundedLossCounters, ProducerCollectorState, ProducerFailureClassification};
use super::tests_support::{
    emit, ordinary, producer, protected, unavailable_producer, with_state, CollectorFixture,
    TEST_CAPABILITY, TEST_COLLECTOR_BOOT,
};
use super::{CollectorAvailability, ResidentAccounting};
use crate::{DiagnosticArgument, DiagnosticPrivacy, DiagnosticsComponent, EmitDisposition};

const CANARY_MESSAGE: &str = "canary-message-8f3a";
const CANARY_ARGUMENT: &str = "canary.argument";
const CANARY_VALUE: &str = "canary-value-4b21";

const SNAPSHOT_FIELDS: [&str; 15] = [
    "collector_state",
    "component",
    "delivery_fence_eligible",
    "dropped_by_reason",
    "fallback_active",
    "fallback_bytes",
    "fallback_routed",
    "fallback_write_failures",
    "in_flight",
    "last_assigned_sequence",
    "last_failure",
    "next_sequence",
    "producer_boot_id",
    "resident_bytes",
    "resident_records",
];

fn encode(snapshot: &super::status::ProducerStatusSnapshot) -> Value {
    serde_json::to_value(snapshot).expect("serializable snapshot")
}

fn sorted_keys(value: &Value) -> Vec<String> {
    let mut keys: Vec<String> = value
        .as_object()
        .expect("JSON object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

/// The snapshot surface is exactly the frozen status fields: no record, no
/// message, no argument, no endpoint, no capability.
#[test]
fn status_snapshot_exposes_exactly_the_frozen_fields() {
    let inner = unavailable_producer();
    assert_eq!(emit(&inner, ordinary("event")), EmitDisposition::Admitted);

    let encoded = encode(&inner.snapshot());
    assert_eq!(sorted_keys(&encoded), SNAPSHOT_FIELDS.to_vec());
    assert_eq!(encoded["component"], "anyharness");
    for absent in [
        "message",
        "arguments",
        "detailed",
        "records",
        "queue",
        "endpoint",
        "capability",
        "authorization",
        "token",
        "records_by_sequence",
    ] {
        assert!(
            encoded.get(absent).is_none(),
            "{absent} must not be part of the status surface"
        );
    }
}

/// Every one of the fourteen closed reasons is present at zero: a snapshot
/// never omits a counter just because nothing has been lost yet.
#[test]
fn zero_counters_are_reported_not_omitted() {
    let inner = unavailable_producer();

    let encoded = encode(&inner.snapshot());
    let counters = encoded["dropped_by_reason"]
        .as_object()
        .expect("counter object");
    let mut names: Vec<&str> = BoundedLossCounters::default()
        .named_counts()
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    assert_eq!(names.len(), 14);
    names.sort_unstable();
    assert_eq!(sorted_keys(&encoded["dropped_by_reason"]), names);
    for (name, value) in counters {
        assert_eq!(value.as_u64(), Some(0), "{name} must be reported as zero");
    }
    assert_eq!(encoded["fallback_routed"], 0);
    assert_eq!(encoded["fallback_write_failures"], 0);
    assert!(encoded["last_failure"].is_null());
    assert!(encoded["last_assigned_sequence"].is_null());
    assert_eq!(encoded["next_sequence"], 1);
}

/// The exhausted sequence is optional and reported as absent, never as zero,
/// a wrap, or a fabricated successor.
#[test]
fn exhausted_sequence_is_reported_as_an_absent_next_sequence() {
    let inner = unavailable_producer();
    with_state(&inner, |state| {
        state.next_sequence = None;
        state.last_assigned_sequence = Some(MAX_SAFE_INTEGER);
    });

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.next_sequence, None);
    assert_eq!(snapshot.last_assigned_sequence, Some(MAX_SAFE_INTEGER));
    let encoded = encode(&snapshot);
    assert!(encoded["next_sequence"].is_null());
    assert_eq!(encoded["last_assigned_sequence"], 9_007_199_254_740_991_u64);
    let text = encoded.to_string();
    assert!(!text.contains("9007199254740992"));
}

/// Resident totals cover queued and in-flight records together, because both
/// hold capacity, and the in-flight flag is the single-batch indicator.
#[test]
fn resident_totals_cover_queued_and_in_flight_records() {
    let inner = unavailable_producer();
    for index in 0..3 {
        assert_eq!(
            emit(&inner, ordinary(&format!("queued-{index}"))),
            EmitDisposition::Admitted
        );
    }
    let queued_bytes = with_state(&inner, |state| state.resident_bytes);
    with_state(&inner, |state| {
        state.in_flight = vec![
            ResidentAccounting {
                producer_sequence: 4,
                is_loss_summary: false,
            },
            ResidentAccounting {
                producer_sequence: 5,
                is_loss_summary: false,
            },
        ];
        state.resident_bytes += 96;
    });

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.resident_records, 5);
    assert_eq!(
        snapshot.resident_bytes,
        u32::try_from(queued_bytes + 96).expect("bounded bytes")
    );
    assert!(snapshot.in_flight);

    with_state(&inner, |state| state.clear_in_flight());
    let drained = inner.snapshot();
    assert_eq!(drained.resident_records, 3);
    assert!(!drained.in_flight);
}

/// Collector state uses the frozen three-value vocabulary. Identity (boot id
/// and generation) is status; the connection is not.
#[tokio::test(flavor = "multi_thread")]
async fn collector_state_reports_identity_without_connection_material() {
    let fixture = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let ready = producer(DiagnosticsComponent::AnyHarness, fixture.ready(7), None);
    let encoded = encode(&ready.snapshot());
    assert_eq!(
        encoded["collector_state"],
        serde_json::json!({
            "state": "ready",
            "collector_boot_id": TEST_COLLECTOR_BOOT,
            "generation_number": 7,
        })
    );
    assert_eq!(
        ready.snapshot().collector_state,
        ProducerCollectorState::Ready {
            collector_boot_id: TEST_COLLECTOR_BOOT.to_owned(),
            generation_number: 7,
        }
    );

    let text = encoded.to_string();
    // No endpoint, port, capability, or bearer material may appear.
    assert!(!text.contains(fixture.endpoint()));
    assert!(!text.contains("127.0.0.1"));
    assert!(!text.contains(TEST_CAPABILITY));
    assert!(!text.contains("Bearer"));

    let unavailable = unavailable_producer();
    assert_eq!(
        encode(&unavailable.snapshot())["collector_state"],
        serde_json::json!({ "state": "unavailable" })
    );

    let cooldown = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Cooldown {
            generation: match fixture.ready(7) {
                CollectorAvailability::Ready(generation) => generation,
                _ => unreachable!("ready availability"),
            },
            until: std::time::Instant::now() + super::CIRCUIT_INTERVAL,
        },
        None,
    );
    assert_eq!(
        encode(&cooldown.snapshot())["collector_state"],
        serde_json::json!({ "state": "cooldown" })
    );
}

/// Emitted content never reaches the status surface: neither the message body
/// nor an argument name or value appears in a snapshot.
#[test]
fn status_snapshot_carries_no_record_content() {
    let inner = unavailable_producer();
    let mut input = ordinary(CANARY_MESSAGE);
    input.arguments = vec![DiagnosticArgument {
        name: Cow::Borrowed(CANARY_ARGUMENT),
        privacy: DiagnosticPrivacy::Operational,
        value: ArgumentValueV1::String(CANARY_VALUE.to_owned()),
    }];
    assert_eq!(emit(&inner, input), EmitDisposition::Admitted);
    assert_eq!(
        emit(&inner, protected(CANARY_MESSAGE)),
        EmitDisposition::Admitted
    );

    let snapshot = inner.snapshot();
    // The records are resident, so their capacity is visible…
    assert_eq!(snapshot.resident_records, 2);
    assert!(snapshot.resident_bytes > 0);
    // …but none of their content is.
    let text = encode(&snapshot).to_string();
    for canary in [CANARY_MESSAGE, CANARY_ARGUMENT, CANARY_VALUE] {
        assert!(!text.contains(canary), "{canary} leaked into the snapshot");
    }
    assert_eq!(snapshot.component, ComponentV1::Anyharness);
}

/// The most recent failure classification is status-only and uses the closed
/// vocabulary; it never adds a record or a counter of its own.
#[test]
fn last_failure_reports_the_closed_vocabulary_only() {
    let inner = unavailable_producer();
    with_state(&inner, |state| {
        state.record_loss(ProducerFailureClassification::ShutdownTimeout);
    });

    let snapshot = inner.snapshot();
    assert_eq!(
        snapshot.last_failure,
        Some(ProducerFailureClassification::ShutdownTimeout)
    );
    assert_eq!(snapshot.dropped_by_reason.shutdown_timeout, 1);
    assert_eq!(snapshot.resident_records, 0);
    let encoded = encode(&snapshot);
    assert_eq!(encoded["last_failure"], "shutdown_timeout");
    assert_eq!(encoded["dropped_by_reason"]["shutdown_timeout"], 1);
}

/// The desktop worker adapter reports its own component identity through the
/// same surface, so one snapshot shape serves both bundled adapters.
#[test]
fn both_bundled_components_share_one_snapshot_shape() {
    let worker = producer(
        DiagnosticsComponent::DesktopWorker,
        CollectorAvailability::Unavailable { generation: 0 },
        None,
    );
    assert_eq!(
        emit(
            &worker,
            super::tests_support::input(SeverityV1::Info, "event")
        ),
        EmitDisposition::Admitted
    );

    let encoded = encode(&worker.snapshot());
    assert_eq!(encoded["component"], "desktop_worker");
    assert_eq!(sorted_keys(&encoded), SNAPSHOT_FIELDS.to_vec());
}

#[test]
fn fallbackless_degraded_bootstrap_creates_no_producer_runtime() {
    let degraded = crate::bridge::activation::DesktopDiagnosticsDegradedBootstrap {
        classification: crate::bridge::wire::DegradedClassification::BridgeUnavailable,
        fallback: None,
        #[cfg(unix)]
        bridge: None,
        #[cfg(unix)]
        shutdown: None,
    };

    assert!(matches!(
        super::install(
            DiagnosticsComponent::AnyHarness,
            crate::bridge::activation::BundledDesktopDiagnosticsBootstrap::Degraded(degraded),
            "anyharness@test",
            "local",
        ),
        Err(crate::InstallError::BootstrapInvalid)
    ));
}
