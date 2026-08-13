use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use proliferate_diagnostics_protocol::v1::catalog::{p0_operation_count, P0_OPERATION_FAMILIES};
use proliferate_diagnostics_protocol::v1::limits::*;
use proliferate_diagnostics_protocol::v1::sequence::LifecycleSequenceValidatorV1;
use proliferate_diagnostics_protocol::v1::types::*;
use proliferate_diagnostics_protocol::v1::validation::*;
use serde_json::{json, Value};

fn fixture_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/contracts/rust-observability-v1")
        .join(relative)
}

fn fixture(relative: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(fixture_path(relative)).unwrap()).unwrap()
}

#[test]
fn valid_records_roundtrip_and_cover_both_classes_and_every_terminal() {
    let records = fixture("valid/records.json")["records"]
        .as_array()
        .unwrap()
        .clone();
    let mut outcomes = Vec::new();
    let mut classes = Vec::new();
    for value in &records {
        let parsed = parse_producer_record_value(value).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), *value);
        classes.push(parsed.record_class);
        if let Some(outcome) = parsed.lifecycle.and_then(|lifecycle| lifecycle.outcome) {
            outcomes.push(outcome);
        }
    }
    outcomes.sort();
    outcomes.dedup();
    assert_eq!(
        outcomes,
        vec![
            TerminalOutcomeV1::Succeeded,
            TerminalOutcomeV1::Failed,
            TerminalOutcomeV1::Cancelled,
            TerminalOutcomeV1::TimedOut,
            TerminalOutcomeV1::Abandoned,
            TerminalOutcomeV1::Rejected,
            TerminalOutcomeV1::Skipped,
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
    );
    assert!(classes.contains(&RecordClassV1::Detailed));
    assert!(classes.contains(&RecordClassV1::Lifecycle));
    assert!(records
        .iter()
        .any(|record| record.pointer("/lifecycle/model").is_some()));
    assert!(records
        .iter()
        .any(|record| record.pointer("/lifecycle/plugin").is_some()));
}

#[test]
fn previous_minor_and_unknown_optional_fields_are_canonicalized() {
    let case = fixture("valid/unknown-optional.json");
    let parsed = parse_producer_record_value(&case["input"]).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), case["canonical"]);
}

#[test]
fn lifecycle_sequences_pin_retry_conflict_death_and_orphan_behavior() {
    let records = fixture("valid/records.json")["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| parse_producer_record_value(value).unwrap())
        .collect::<Vec<_>>();
    let sequences = fixture("valid/lifecycle-sequences.json");
    for scenario in sequences["scenarios"].as_array().unwrap() {
        let mut validator = LifecycleSequenceValidatorV1::default();
        let indexes = scenario["record_indexes"].as_array().unwrap();
        let expected = scenario["expected"].as_array().unwrap();
        for (index, expectation) in indexes.iter().zip(expected) {
            let result = validator.apply(records[index.as_u64().unwrap() as usize].clone());
            if let Some(error) = expectation.get("error") {
                assert_eq!(serde_json::to_value(result.unwrap_err()).unwrap(), *error);
            } else {
                let decision = serde_json::to_value(result.unwrap()).unwrap();
                assert_eq!(decision["disposition"], expectation["disposition"]);
                assert_eq!(
                    decision["requires_gap_or_health_violation"],
                    expectation["requires_gap_or_health_violation"]
                );
                if scenario["name"] == "structurally_valid_orphan_terminal" {
                    assert_eq!(expectation["invented_start"], false);
                    assert_eq!(expectation["invented_failure"], false);
                }
            }
        }
    }
}

#[test]
fn every_invalid_record_rejects_for_the_pinned_reason() {
    let cases = fixture("invalid/records.json");
    for case in cases["cases"].as_array().unwrap() {
        let error = parse_producer_record_value(&case["input"]).unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            case["reason"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn all_api_shapes_parse_validate_and_roundtrip() {
    let api = fixture("valid/api.json");

    let descriptor = parse_connection_descriptor_value(&api["connection_descriptor"]).unwrap();
    assert_eq!(
        serde_json::to_value(descriptor).unwrap(),
        api["connection_descriptor"]
    );

    let collector_record = parse_collector_accepted_record_value(&api["collector_record"]).unwrap();
    assert_eq!(
        serde_json::to_value(collector_record).unwrap(),
        api["collector_record"]
    );
    let batch = parse_ingest_batch_value(&api["ingest_batch"]).unwrap();
    assert_eq!(serde_json::to_value(batch).unwrap(), api["ingest_batch"]);
    let receipt = parse_ingest_receipt_value(&api["ingest_receipt"]).unwrap();
    assert_eq!(
        serde_json::to_value(receipt).unwrap(),
        api["ingest_receipt"]
    );

    let query = parse_records_query_value(&api["records_query"]).unwrap();
    assert_eq!(serde_json::to_value(query).unwrap(), api["records_query"]);

    let page = parse_records_page_value(&api["records_page"]).unwrap();
    assert_eq!(serde_json::to_value(page).unwrap(), api["records_page"]);

    for value in api["tail_frames"].as_array().unwrap() {
        let frame = parse_tail_frame_value(value).unwrap();
        assert_eq!(serde_json::to_value(frame).unwrap(), *value);
    }

    let request = parse_export_request_value(&api["export_request"]).unwrap();
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        api["export_request"]
    );

    let manifest = parse_export_manifest_value(&api["export_manifest"]).unwrap();
    assert_eq!(
        serde_json::to_value(manifest).unwrap(),
        api["export_manifest"]
    );

    let health = parse_health_value(&api["health"]).unwrap();
    assert_eq!(serde_json::to_value(health).unwrap(), api["health"]);

    for value in api["export_frames"].as_array().unwrap() {
        let frame = parse_export_frame_value(value).unwrap();
        assert_eq!(serde_json::to_value(frame).unwrap(), *value);
    }
}

#[test]
fn every_invalid_api_shape_rejects_for_the_pinned_reason() {
    let cases = fixture("invalid/api.json");
    for case in cases["cases"].as_array().unwrap() {
        let result = match case["kind"].as_str().unwrap() {
            "connection_descriptor" => {
                parse_connection_descriptor_value(&case["input"]).map(|_| ())
            }
            "collector_record" => parse_collector_accepted_record_value(&case["input"]).map(|_| ()),
            "records_query" => parse_records_query_value(&case["input"]).map(|_| ()),
            "records_page" => parse_records_page_value(&case["input"]).map(|_| ()),
            "tail_frame" => parse_tail_frame_value(&case["input"]).map(|_| ()),
            "export_request" => parse_export_request_value(&case["input"]).map(|_| ()),
            "export_frame" => parse_export_frame_value(&case["input"]).map(|_| ()),
            "health" => parse_health_value(&case["input"]).map(|_| ()),
            other => panic!("unknown invalid API fixture kind: {other}"),
        };
        assert_eq!(
            serde_json::to_value(result.unwrap_err()).unwrap(),
            case["reason"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn operation_catalog_is_closed_and_matches_the_golden_fixture() {
    let expected = fixture("operation-catalog.json");
    let families = P0_OPERATION_FAMILIES
        .iter()
        .map(|family| {
            json!({
                "pattern": family.pattern,
                "operations": family.operations,
                "semantic_owner": family.semantic_owner,
                "boundary": family.boundary,
                "owning_pr": family.owning_pr,
            })
        })
        .collect::<Vec<_>>();
    assert_eq!(
        json!({"schema_version": CURRENT_SCHEMA_VERSION, "families": families}),
        expected
    );
    assert_eq!(p0_operation_count(), 91);
}

#[test]
fn constants_and_release_rss_profile_match_the_golden_boundaries() {
    let limits = fixture("limits.json");
    assert_eq!(
        limits["limits"],
        json!({
            "max_safe_integer": MAX_SAFE_INTEGER,
            "max_record_bytes": MAX_RECORD_BYTES,
            "max_string_bytes": MAX_STRING_BYTES,
            "max_message_bytes": MAX_MESSAGE_BYTES,
            "max_name_bytes": MAX_NAME_BYTES,
            "max_id_bytes": MAX_ID_BYTES,
            "max_arguments": MAX_ARGUMENTS,
            "max_argument_list_items": MAX_ARGUMENT_LIST_ITEMS,
            "max_argument_object_fields": MAX_ARGUMENT_OBJECT_FIELDS,
            "max_argument_depth": MAX_ARGUMENT_DEPTH,
            "max_batch_records": MAX_BATCH_RECORDS,
            "max_batch_bytes": MAX_BATCH_BYTES,
            "max_filter_values": MAX_FILTER_VALUES,
            "default_page_records": DEFAULT_PAGE_RECORDS,
            "max_page_records": MAX_PAGE_RECORDS,
            "max_tail_frame_records": MAX_TAIL_FRAME_RECORDS,
            "max_export_records": MAX_EXPORT_RECORDS,
            "max_export_bytes": MAX_EXPORT_BYTES,
            "max_cardinality_entries": MAX_CARDINALITY_ENTRIES,
            "max_versions_present": MAX_VERSIONS_PRESENT,
            "max_health_producers": MAX_HEALTH_PRODUCERS,
            "collector_total_rss_limit_bytes": COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
            "retained_record_arena_limit_bytes": RETAINED_RECORD_ARENA_LIMIT_BYTES,
        })
    );
    assert_eq!(limits["schema_version"], json!(CURRENT_SCHEMA_VERSION));
    assert_eq!(
        limits["supported_previous_producer_minor_window"],
        SUPPORTED_PREVIOUS_PRODUCER_MINOR_WINDOW
    );
    assert!(RETAINED_RECORD_ARENA_LIMIT_BYTES < COLLECTOR_TOTAL_RSS_LIMIT_BYTES);

    let profile_value = fixture("rss-profile.json");
    let profile = parse_rss_profile_value(&profile_value).unwrap();
    assert_eq!(serde_json::to_value(profile).unwrap(), profile_value);
}

#[test]
fn representative_at_limit_and_over_limit_inputs_are_enforced() {
    let mut record = fixture("valid/records.json")["records"][0].clone();

    record["operation_id"] = Value::String("a".repeat(MAX_ID_BYTES));
    parse_producer_record_value(&record).unwrap();
    record["operation_id"] = Value::String("a".repeat(MAX_ID_BYTES + 1));
    assert_eq!(
        parse_producer_record_value(&record).unwrap_err(),
        RejectionReasonV1::LimitExceeded
    );

    let base = fixture("valid/records.json")["records"][0].clone();
    let mut padded = base.clone();
    padded["future_padding"] = Value::String(String::new());
    let overhead = serde_json::to_vec(&padded).unwrap().len();
    padded["future_padding"] = Value::String("x".repeat(MAX_RECORD_BYTES - overhead));
    assert_eq!(serde_json::to_vec(&padded).unwrap().len(), MAX_RECORD_BYTES);
    parse_producer_record_value(&padded).unwrap();
    let at_limit_record = padded.clone();
    padded["future_padding"] = Value::String("x".repeat(MAX_RECORD_BYTES - overhead + 1));
    assert_eq!(
        parse_producer_record_value(&padded).unwrap_err(),
        RejectionReasonV1::RecordTooLarge
    );

    let mut batch = json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "records": [base],
        "future_padding": ""
    });
    let batch_overhead = serde_json::to_vec(&batch).unwrap().len();
    batch["future_padding"] = Value::String("x".repeat(MAX_BATCH_BYTES - batch_overhead));
    assert_eq!(serde_json::to_vec(&batch).unwrap().len(), MAX_BATCH_BYTES);
    parse_ingest_batch_value(&batch).unwrap();
    batch["future_padding"] = Value::String("x".repeat(MAX_BATCH_BYTES - batch_overhead + 1));
    assert_eq!(
        parse_ingest_batch_value(&batch).unwrap_err(),
        RejectionReasonV1::BatchTooLarge
    );

    let api = fixture("valid/api.json");
    let mut page = api["records_page"].clone();
    page["records"][0]["record"] = at_limit_record;
    parse_records_page_value(&page).unwrap();
    page["records"][0]["record"] = padded;
    assert_eq!(
        parse_records_page_value(&page).unwrap_err(),
        RejectionReasonV1::RecordTooLarge
    );

    let mut health: HealthResponseV1 = serde_json::from_value(api["health"].clone()).unwrap();
    health.cardinality_counts = (0..MAX_CARDINALITY_ENTRIES)
        .map(|index| (format!("key.{index}"), index as u64))
        .collect::<BTreeMap<_, _>>();
    validate_health(&health).unwrap();
    health
        .cardinality_counts
        .insert(format!("key.{MAX_CARDINALITY_ENTRIES}"), 1);
    assert_eq!(
        validate_health(&health).unwrap_err(),
        RejectionReasonV1::LimitExceeded
    );
}
