use super::*;
use proliferate_diagnostics_protocol::v1::limits::MAX_FILTER_VALUES;
use proliferate_diagnostics_protocol::v1::types::{
    ExporterHealthV1, ExporterStateV1, FallbackHealthV1, FallbackStateV1, PressureV1,
    RecordsFilterV1, SchemaVersionV1,
};
use std::collections::BTreeMap;

fn query(minor: u16) -> RecordsQueryV1 {
    RecordsQueryV1 {
        schema_version: SchemaVersionV1 { major: 1, minor },
        after_cursor: Some(7),
        limit: 42,
        filters: RecordsFilterV1 {
            source_time_from: Some("2026-08-11T00:00:00Z&next=yes".to_string()),
            source_time_to: Some("2026-08-12T00:00:00Z".to_string()),
            components: vec![ComponentV1::DesktopTauri, ComponentV1::Anyharness],
            record_classes: vec![RecordClassV1::Detailed, RecordClassV1::Lifecycle],
            severities: vec![SeverityV1::Warn, SeverityV1::Error],
            names: (0..MAX_FILTER_VALUES)
                .map(|i| format!("name/{i}"))
                .collect(),
            outcomes: vec![TerminalOutcomeV1::Succeeded, TerminalOutcomeV1::Failed],
            operation_id: Some("operation?reserved".to_string()),
            parent_operation_id: Some("parent".to_string()),
            trace_id: Some("trace".to_string()),
            workspace_id: Some("workspace".to_string()),
            session_id: Some("session".to_string()),
            turn_id: Some("turn".to_string()),
            item_id: Some("item".to_string()),
            request_id: Some("request".to_string()),
            target_id: Some("target".to_string()),
            prompt_id: Some("prompt".to_string()),
            workflow_id: Some("workflow".to_string()),
            error_classification: Some("spawn_failed".to_string()),
        },
    }
}

#[test]
fn records_encoder_is_exhaustive_repeatable_and_preserves_both_minors() {
    for minor in [0, 1] {
        let encoded = encode_records_query(&query(minor));
        let pairs = url::form_urlencoded::parse(encoded.as_bytes()).collect::<Vec<_>>();
        assert!(pairs
            .iter()
            .any(|(key, value)| { key == "schema_version" && value == &format!("1.{minor}") }));
        assert_eq!(
            pairs.iter().filter(|(key, _)| key == "name").count(),
            MAX_FILTER_VALUES
        );
        assert!(pairs
            .iter()
            .any(|(key, value)| { key == "operation_id" && value == "operation?reserved" }));
        for expected in [
            "source_time_from",
            "source_time_to",
            "component",
            "record_class",
            "severity",
            "name",
            "outcome",
            "operation_id",
            "parent_operation_id",
            "trace_id",
            "workspace_id",
            "session_id",
            "turn_id",
            "item_id",
            "request_id",
            "target_id",
            "prompt_id",
            "workflow_id",
            "error_classification",
        ] {
            assert!(
                pairs.iter().any(|(key, _)| key == expected),
                "missing {expected}"
            );
        }
    }
}

#[test]
fn tail_encoder_is_exactly_v1_1_and_cursor_only() {
    assert_eq!(encode_tail_query(None), "schema_version=1.1");
    assert_eq!(
        encode_tail_query(Some(9)),
        "schema_version=1.1&after_cursor=9"
    );
}

#[test]
fn capability_debug_never_contains_secret() {
    let capability = SecretCapability::new("canary-secret".to_string()).expect("capability");
    let rendered = format!("{capability:?}");
    assert!(!rendered.contains("canary-secret"));
}

#[test]
fn health_context_changes_only_restart_count_and_fallback() {
    let raw = HealthResponseV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        status: proliferate_diagnostics_protocol::v1::types::HealthStatusV1::Ready,
        collector_boot_id: uuid::Uuid::new_v4().to_string(),
        restart_count: 0,
        pressure: PressureV1::Normal,
        oldest_cursor: Some(1),
        newest_cursor: Some(2),
        retained_bytes: 123,
        evictions_by_class: BTreeMap::new(),
        evictions_by_component: BTreeMap::new(),
        evictions_by_reason: BTreeMap::new(),
        rejections_by_reason: BTreeMap::new(),
        cardinality_counts: BTreeMap::new(),
        rejected_records: 1,
        oversized_records: 2,
        duplicate_terminals: 3,
        conflicting_terminals: 4,
        producers: Vec::new(),
        tail_reader_drops: 5,
        exporter: ExporterHealthV1 {
            state: ExporterStateV1::Disabled,
            dropped_records: 0,
            last_error_classification: None,
        },
        fallback: FallbackHealthV1 {
            state: FallbackStateV1::Inactive,
            bytes: 0,
            dropped_records: 0,
        },
    };
    let replacement = FallbackHealthV1 {
        state: FallbackStateV1::Active,
        bytes: 17,
        dropped_records: 2,
    };
    let contextual =
        contextualize_health(raw.clone(), 9, replacement.clone()).expect("contextual health");
    assert_eq!(contextual.restart_count, 9);
    assert_eq!(contextual.fallback, replacement);

    let mut raw_value = serde_json::to_value(raw).expect("raw health");
    let mut contextual_value = serde_json::to_value(contextual).expect("context health");
    for key in ["restart_count", "fallback"] {
        raw_value.as_object_mut().expect("raw object").remove(key);
        contextual_value
            .as_object_mut()
            .expect("context object")
            .remove(key);
    }
    assert_eq!(contextual_value, raw_value);
}
