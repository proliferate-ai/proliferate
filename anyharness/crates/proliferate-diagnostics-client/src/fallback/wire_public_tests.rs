use proliferate_diagnostics_protocol::v1::{
    limits::CURRENT_SCHEMA_VERSION,
    types::{
        ComponentV1, DetailedDiagnosticV1, DetailedKindV1, PrivacyClassificationV1,
        ProducerRecordV1, RecordClassV1, RedactionClassificationV1, SeverityV1, SourceV1,
    },
};
use serde_json::Value;

use crate::{
    parse_fallback_record_line, DiagnosticsComponent, FallbackReason, FallbackRecordV1,
    FALLBACK_SCHEMA, FALLBACK_SEGMENTS, FALLBACK_SEGMENT_BYTES, FALLBACK_TOTAL_BYTES,
};

#[test]
fn public_parser_returns_component_bound_canonical_record() {
    let wrapper = wrapper(DiagnosticsComponent::AnyHarness);
    let mut line = serde_json::to_vec(&wrapper).expect("fallback JSON");
    line.push(b'\n');

    let parsed = parse_fallback_record_line(DiagnosticsComponent::AnyHarness, &line)
        .expect("strict valid line");

    assert_eq!(parsed, wrapper);
    assert_eq!(parsed.reason, FallbackReason::CollectorUnavailable);
    assert_eq!(FALLBACK_SCHEMA, 1);
    assert_eq!(FALLBACK_SEGMENTS, 4);
    assert_eq!(FALLBACK_SEGMENT_BYTES, 524_288);
    assert_eq!(FALLBACK_TOTAL_BYTES, 2_097_152);
}

#[test]
fn public_parser_rejects_unknown_wrapper_shape_reason_and_schema() {
    let baseline =
        serde_json::to_value(wrapper(DiagnosticsComponent::AnyHarness)).expect("fallback value");

    let mut unknown_key = baseline.clone();
    unknown_key["retry_context"] = Value::Bool(true);
    assert_invalid(unknown_key);

    let mut unknown_reason = baseline.clone();
    unknown_reason["reason"] = Value::String("future_reason".into());
    assert_invalid(unknown_reason);

    let mut unknown_schema = baseline;
    unknown_schema["fallback_schema"] = Value::from(2);
    assert_invalid(unknown_schema);
}

#[test]
fn public_parser_rejects_wrong_component_and_invalid_producer() {
    let worker =
        serde_json::to_vec(&wrapper(DiagnosticsComponent::DesktopWorker)).expect("worker fallback");
    assert!(parse_fallback_record_line(DiagnosticsComponent::AnyHarness, &worker).is_none());

    let mut invalid =
        serde_json::to_value(wrapper(DiagnosticsComponent::AnyHarness)).expect("fallback value");
    invalid["record"]["privacy"] = Value::String("secret".into());
    assert_invalid(invalid);

    let mut prohibited_raw_field =
        serde_json::to_value(wrapper(DiagnosticsComponent::AnyHarness)).expect("fallback value");
    prohibited_raw_field["record"]["access_token"] = Value::String("must-not-be-discarded".into());
    assert_invalid(prohibited_raw_field);
}

#[test]
fn public_parser_accepts_one_value_and_rejects_non_lines_or_oversize_input() {
    let value =
        serde_json::to_vec(&wrapper(DiagnosticsComponent::AnyHarness)).expect("fallback JSON");
    assert!(parse_fallback_record_line(DiagnosticsComponent::AnyHarness, &value).is_some());

    let mut two_lines = value.clone();
    two_lines.push(b'\n');
    two_lines.extend_from_slice(&value);
    assert!(parse_fallback_record_line(DiagnosticsComponent::AnyHarness, &two_lines).is_none());
    assert!(parse_fallback_record_line(DiagnosticsComponent::AnyHarness, b"\n").is_none());
    let mut trailing_space = value.clone();
    trailing_space.push(b' ');
    assert!(
        parse_fallback_record_line(DiagnosticsComponent::AnyHarness, &trailing_space).is_none()
    );
    assert!(parse_fallback_record_line(
        DiagnosticsComponent::AnyHarness,
        &vec![b' '; FALLBACK_SEGMENT_BYTES as usize + 1],
    )
    .is_none());
}

fn assert_invalid(value: Value) {
    let line = serde_json::to_vec(&value).expect("fallback JSON");
    assert!(parse_fallback_record_line(DiagnosticsComponent::AnyHarness, &line).is_none());
}

fn wrapper(component: DiagnosticsComponent) -> FallbackRecordV1 {
    FallbackRecordV1 {
        fallback_schema: FALLBACK_SCHEMA,
        reason: FallbackReason::CollectorUnavailable,
        record: record(component),
    }
}

fn record(component: DiagnosticsComponent) -> ProducerRecordV1 {
    let (component, source, name) = match component {
        DiagnosticsComponent::AnyHarness => (
            ComponentV1::Anyharness,
            SourceV1::Anyharness,
            "anyharness.transport.status",
        ),
        DiagnosticsComponent::DesktopWorker => (
            ComponentV1::DesktopWorker,
            SourceV1::Worker,
            "desktop_worker.transport.status",
        ),
    };
    ProducerRecordV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        source_timestamp: "2026-08-11T12:00:00.000Z".into(),
        producer_sequence: 1,
        producer_boot_id: "producer-boot-0001".into(),
        component,
        source,
        release: "test-release".into(),
        environment: "test".into(),
        operation_id: "operation-0001".into(),
        parent_operation_id: None,
        trace_id: None,
        workspace_id: None,
        session_id: None,
        turn_id: None,
        item_id: None,
        request_id: None,
        target_id: None,
        prompt_id: None,
        workflow_id: None,
        name: name.into(),
        severity: SeverityV1::Warn,
        arguments: Vec::new(),
        error_classification: None,
        record_class: RecordClassV1::Detailed,
        privacy: PrivacyClassificationV1::Operational,
        redaction: RedactionClassificationV1::Structural,
        detailed: Some(DetailedDiagnosticV1 {
            kind: DetailedKindV1::Log,
            message: Some("collector unavailable".into()),
            stream: None,
            dropped_count: None,
            milestone: None,
        }),
        lifecycle: None,
    }
}
