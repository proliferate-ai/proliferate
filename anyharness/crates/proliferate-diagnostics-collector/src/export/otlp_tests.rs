use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, CollectorAcceptedRecordV1, ComponentV1, PrivacyClassificationV1,
    RecordClassV1, TypedArgumentV1,
};
use proliferate_diagnostics_protocol::v1::validation::parse_producer_record_value;
use serde_json::Value;

use super::*;

fn fixture_records() -> Vec<CollectorAcceptedRecordV1> {
    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/records.json"
    )))
    .expect("valid records fixture");
    fixture["records"]
        .as_array()
        .expect("record array")
        .iter()
        .enumerate()
        .map(|(index, value)| CollectorAcceptedRecordV1 {
            record: parse_producer_record_value(value).expect("fixture record"),
            accepted_timestamp: "2026-08-11T00:00:00.500Z".to_owned(),
            accepted_order: index as u64 + 1,
            retention_cursor: index as u64 + 1,
        })
        .collect()
}

fn attribute_of<'a>(log: &'a Value, key: &str) -> Option<&'a Value> {
    log["attributes"]
        .as_array()
        .expect("attribute array")
        .iter()
        .find(|attribute| attribute["key"] == key)
        .map(|attribute| &attribute["value"])
}

/// The encoder's mechanics are the same under either policy, so the tests that
/// prove them pin [`ExportPolicy::All`] and stay meaningful in a
/// default-features CI run. The tests that prove the policy itself name the
/// policy they are asserting about. Only the tests whose subject is "what does
/// THIS build do" call [`encode_batch`] and pick up the compiled policy.
fn encode_all(records: &[CollectorAcceptedRecordV1]) -> (Value, u64) {
    encode_batch_with_policy(ExportPolicy::All, None, None, records)
}

fn all_log_records(payload: &Value) -> Vec<&Value> {
    payload["resourceLogs"]
        .as_array()
        .expect("resource logs")
        .iter()
        .flat_map(|resource| resource["scopeLogs"].as_array().expect("scope logs"))
        .flat_map(|scope| scope["logRecords"].as_array().expect("log records"))
        .collect()
}

#[test]
fn every_golden_record_becomes_exactly_one_log_record() {
    let records = fixture_records();
    let (payload, refused) = encode_all(&records);
    assert_eq!(refused, 0);
    assert_eq!(all_log_records(&payload).len(), records.len());
}

#[test]
fn records_group_into_one_resource_per_producer_boot_and_one_scope_per_version() {
    let (payload, _) = encode_all(&fixture_records());
    let resources = payload["resourceLogs"].as_array().expect("resource logs");
    let instances = resources
        .iter()
        .map(|resource| {
            resource["resource"]["attributes"]
                .as_array()
                .expect("resource attributes")
                .iter()
                .find(|attribute| attribute["key"] == "service.instance.id")
                .expect("service.instance.id")["value"]["stringValue"]
                .as_str()
                .expect("instance id")
                .to_owned()
        })
        .collect::<Vec<_>>();
    let mut unique = instances.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(
        instances.len(),
        unique.len(),
        "each producer boot must own one resource stream"
    );
    for resource in resources {
        for scope in resource["scopeLogs"].as_array().expect("scope logs") {
            assert_eq!(scope["scope"]["name"], "proliferate.diagnostics");
            assert_eq!(scope["scope"]["version"], "1.1");
        }
    }
}

#[test]
fn service_identity_comes_from_the_record_component_release_and_environment() {
    let (payload, _) = encode_all(&fixture_records());
    let resource_value = |resource: &Value, key: &str| {
        resource["attributes"]
            .as_array()
            .expect("attributes")
            .iter()
            .find(|attribute| attribute["key"] == key)
            .expect("resource attribute")["value"]["stringValue"]
            .as_str()
            .expect("string value")
            .to_owned()
    };
    let mut services = payload["resourceLogs"]
        .as_array()
        .expect("resource logs")
        .iter()
        .map(|entry| {
            let resource = &entry["resource"];
            assert_eq!(
                resource_value(resource, "service.version"),
                "2026.08.10-rc1"
            );
            assert_eq!(
                resource_value(resource, "deployment.environment.name"),
                "dogfood"
            );
            resource_value(resource, "service.name")
        })
        .collect::<Vec<_>>();
    services.sort();
    services.dedup();
    assert_eq!(
        services,
        vec![
            "anyharness".to_owned(),
            "desktop_renderer".to_owned(),
            "desktop_tauri".to_owned(),
            "desktop_worker".to_owned(),
        ]
    );
}

/// What a DOGFOOD build does with a detailed record. A customer build never
/// reaches this code for a detailed record at all, which is the subject of
/// `the_customer_policy_refuses_every_detailed_record_in_the_fixture`.
#[test]
fn detailed_record_carries_its_message_as_the_body_and_typed_arguments_as_attributes() {
    let records = fixture_records();
    let detailed = records
        .iter()
        .find(|accepted| accepted.record.name == "renderer.console.error")
        .expect("detailed fixture record")
        .clone();
    let (payload, _) = encode_all(std::slice::from_ref(&detailed));
    let log = all_log_records(&payload)[0];
    assert_eq!(
        log["body"]["stringValue"],
        Value::from(
            detailed
                .record
                .detailed
                .as_ref()
                .and_then(|value| value.message.clone())
                .expect("fixture message")
        )
    );
    assert_eq!(log["severityNumber"], 17);
    assert_eq!(log["severityText"], "ERROR");
    assert_eq!(
        attribute_of(log, "proliferate.argument.attempt"),
        Some(&serde_json::json!({ "intValue": "2" }))
    );
    assert_eq!(
        attribute_of(log, "proliferate.argument.modes"),
        Some(&serde_json::json!({
            "arrayValue": {
                "values": [
                    { "stringValue": "streaming" },
                    { "boolValue": true },
                ],
            },
        }))
    );
    assert!(
        attribute_of(log, "proliferate.argument.context").expect("object argument")["kvlistValue"]
            ["values"]
            .is_array()
    );
}

#[test]
fn lifecycle_record_carries_phase_outcome_and_finalizer() {
    let records = fixture_records();
    let terminal = records
        .iter()
        .find(|accepted| {
            accepted
                .record
                .lifecycle
                .as_ref()
                .is_some_and(|lifecycle| lifecycle.outcome.is_some())
        })
        .expect("terminal fixture record")
        .clone();
    let (payload, _) = encode_batch(None, None, std::slice::from_ref(&terminal));
    let log = all_log_records(&payload)[0];
    assert_eq!(
        attribute_of(log, "proliferate.lifecycle.phase"),
        Some(&serde_json::json!({ "stringValue": "terminal" }))
    );
    assert_eq!(
        attribute_of(log, "proliferate.lifecycle.outcome"),
        Some(&serde_json::json!({ "stringValue": "succeeded" }))
    );
    assert_eq!(
        attribute_of(log, "proliferate.lifecycle.finalizer"),
        Some(&serde_json::json!({ "stringValue": "producer" }))
    );
    assert_eq!(
        attribute_of(log, "proliferate.record_class"),
        Some(&serde_json::json!({ "stringValue": "lifecycle" }))
    );
}

#[test]
fn model_metadata_survives_as_bounded_scalar_attributes() {
    let records = fixture_records();
    let model = records
        .iter()
        .find(|accepted| {
            accepted
                .record
                .lifecycle
                .as_ref()
                .is_some_and(|lifecycle| lifecycle.model.is_some())
        })
        .expect("model fixture record")
        .clone();
    let (payload, _) = encode_batch(None, None, std::slice::from_ref(&model));
    let log = all_log_records(&payload)[0];
    assert!(attribute_of(log, "proliferate.lifecycle.model.model_id").is_some());
    for key in [
        "proliferate.lifecycle.model.input_tokens",
        "proliferate.lifecycle.model.output_tokens",
    ] {
        let value = attribute_of(log, key).expect("token count");
        assert!(
            value["intValue"].is_string(),
            "{key} must use the protobuf JSON decimal-string integer encoding"
        );
    }
}

#[test]
fn source_and_accepted_timestamps_become_distinct_nanosecond_strings() {
    let records = fixture_records();
    let (payload, _) = encode_all(std::slice::from_ref(&records[0]));
    let log = all_log_records(&payload)[0];
    assert_eq!(log["timeUnixNano"], "1786363200000000000");
    assert_eq!(log["observedTimeUnixNano"], "1786406400500000000");
}

#[test]
fn only_a_hex_trace_id_is_promoted_to_the_otlp_trace_field() {
    let mut record = fixture_records()[0].clone();
    assert_eq!(record.record.trace_id.as_deref(), Some("trace-01"));
    let (payload, _) = encode_all(std::slice::from_ref(&record));
    let log = all_log_records(&payload)[0];
    assert!(log.get("traceId").is_none());
    assert_eq!(
        attribute_of(log, "proliferate.trace_id"),
        Some(&serde_json::json!({ "stringValue": "trace-01" }))
    );

    record.record.trace_id = Some("4BF92F3577B34DA6A3CE929D0E0E4736".to_owned());
    let (payload, _) = encode_all(std::slice::from_ref(&record));
    let log = all_log_records(&payload)[0];
    assert_eq!(log["traceId"], "4bf92f3577b34da6a3ce929d0e0e4736");
}

#[test]
fn a_secret_classified_record_is_refused_instead_of_encoded() {
    let mut record = fixture_records()[0].clone();
    record.record.privacy = PrivacyClassificationV1::Secret;
    let (payload, refused) = encode_batch(None, None, std::slice::from_ref(&record));
    assert_eq!(refused, 1);
    assert!(all_log_records(&payload).is_empty());
}

fn sample_resource_key() -> ResourceKey {
    ResourceKey {
        component: ComponentV1::DesktopTauri,
        producer_boot_id: "boot-1".to_owned(),
        release: "2026.08.10-rc1".to_owned(),
        environment: "dogfood".to_owned(),
    }
}

fn assert_base_resource_attributes(attributes: &[Value], key: &ResourceKey) {
    let value_of = |attr_key: &str| {
        attributes
            .iter()
            .find(|attribute| attribute["key"] == attr_key)
            .unwrap_or_else(|| panic!("missing {attr_key}"))["value"]["stringValue"]
            .as_str()
            .unwrap_or_else(|| panic!("{attr_key} is not a string"))
            .to_owned()
    };
    assert_eq!(value_of("service.name"), component_name(key.component));
    assert_eq!(value_of("service.version"), key.release);
    assert_eq!(value_of("service.instance.id"), key.producer_boot_id);
    assert_eq!(value_of("deployment.environment.name"), key.environment);
    assert_eq!(value_of("telemetry.sdk.name"), SCOPE_NAME);
}

#[test]
fn a_configured_dev_tag_is_added_to_resource_attributes_without_disturbing_the_rest() {
    let key = sample_resource_key();
    let attributes = resource_attributes(&key, Some("alice"), None, None);
    assert_eq!(
        attributes.len(),
        6,
        "the five base attributes plus dev.user"
    );
    assert_eq!(
        attributes
            .iter()
            .find(|attribute| attribute["key"] == "dev.user")
            .expect("dev.user attribute")["value"],
        serde_json::json!({ "stringValue": "alice" })
    );
    assert_base_resource_attributes(&attributes, &key);
}

#[test]
fn an_absent_dev_tag_omits_dev_user_and_leaves_the_rest_unchanged() {
    let key = sample_resource_key();
    let attributes = resource_attributes(&key, None, None, None);
    assert_eq!(attributes.len(), 5, "no dev.user attribute is added");
    assert!(attributes
        .iter()
        .all(|attribute| attribute["key"] != "dev.user"));
    assert_base_resource_attributes(&attributes, &key);
}

#[test]
fn a_secret_classified_argument_is_dropped_from_an_otherwise_exportable_record() {
    let mut record = fixture_records()[1].clone();
    record.record.arguments = vec![
        TypedArgumentV1 {
            name: "kept".to_owned(),
            privacy: PrivacyClassificationV1::Operational,
            value: ArgumentValueV1::String("visible".to_owned()),
        },
        TypedArgumentV1 {
            name: "refused".to_owned(),
            privacy: PrivacyClassificationV1::Secret,
            value: ArgumentValueV1::String("never-exported".to_owned()),
        },
    ];
    let (payload, refused) = encode_batch(None, None, std::slice::from_ref(&record));
    assert_eq!(refused, 0);
    let log = all_log_records(&payload)[0];
    assert!(attribute_of(log, "proliferate.argument.kept").is_some());
    assert!(attribute_of(log, "proliferate.argument.refused").is_none());
    assert!(!serde_json::to_string(&payload)
        .expect("payload")
        .contains("never-exported"));
}

/// The encoder fence, stated against the golden fixture rather than a
/// hand-built record. The fixture's one detailed record is also its only
/// free-text carrier and its only non-operational record, so this is the whole
/// customer-facing question in one assertion.
///
/// Negative control: change `LifecycleOnly` to `All` here, or delete the
/// `policy.admits` guard in `encode_batch_with_policy`, and this fails with 13
/// log records, a refusal count of 0, and the message text on the wire.
#[test]
fn the_customer_policy_refuses_every_detailed_record_in_the_fixture() {
    let records = fixture_records();
    let detailed = records
        .iter()
        .filter(|accepted| accepted.record.record_class == RecordClassV1::Detailed)
        .count();
    assert!(detailed > 0, "the fixture must exercise the refusal path");

    let (payload, refused) =
        encode_batch_with_policy(ExportPolicy::LifecycleOnly, None, None, &records);
    assert_eq!(refused as usize, detailed);
    assert_eq!(all_log_records(&payload).len(), records.len() - detailed);
    for log in all_log_records(&payload) {
        assert_eq!(
            attribute_of(log, "proliferate.record_class"),
            Some(&serde_json::json!({ "stringValue": "lifecycle" }))
        );
    }

    let wire = serde_json::to_string(&payload).expect("payload");
    for accepted in &records {
        let Some(message) = accepted
            .record
            .detailed
            .as_ref()
            .and_then(|detailed| detailed.message.as_deref())
        else {
            continue;
        };
        assert!(
            !wire.contains(message),
            "detailed free text reached the customer wire payload"
        );
    }
}

/// The privacy narrowing is per field as well as per record: a customer build
/// exports only `operational` arguments, so a lifecycle record that somehow
/// carries a `customer_content` argument still exports the record without it.
#[test]
fn the_customer_policy_drops_a_non_operational_argument_a_dogfood_build_keeps() {
    let mut record = fixture_records()[1].clone();
    record.record.arguments = vec![
        TypedArgumentV1 {
            name: "kept".to_owned(),
            privacy: PrivacyClassificationV1::Operational,
            value: ArgumentValueV1::String("visible".to_owned()),
        },
        TypedArgumentV1 {
            name: "narrowed".to_owned(),
            privacy: PrivacyClassificationV1::CustomerContent,
            value: ArgumentValueV1::String("customer-only".to_owned()),
        },
    ];

    let (customer, refused) = encode_batch_with_policy(
        ExportPolicy::LifecycleOnly,
        None,
        None,
        std::slice::from_ref(&record),
    );
    assert_eq!(refused, 0, "the record itself is still exportable");
    let log = all_log_records(&customer)[0];
    assert!(attribute_of(log, "proliferate.argument.kept").is_some());
    assert!(attribute_of(log, "proliferate.argument.narrowed").is_none());
    assert!(!serde_json::to_string(&customer)
        .expect("payload")
        .contains("customer-only"));

    let (dogfood, _) = encode_all(std::slice::from_ref(&record));
    let log = all_log_records(&dogfood)[0];
    assert!(attribute_of(log, "proliferate.argument.narrowed").is_some());
}

/// The tests above name their policy so both are covered in one CI run. This
/// one asserts the thing that actually ships: `encode_batch` consults the
/// compiled [`EXPORT_POLICY`] and nothing else.
#[test]
fn encode_batch_applies_the_compiled_policy() {
    let records = fixture_records();
    let (compiled, compiled_refused) = encode_batch(None, None, &records);
    let (expected, expected_refused) =
        encode_batch_with_policy(EXPORT_POLICY, None, None, &records);
    assert_eq!(compiled_refused, expected_refused);
    assert_eq!(compiled, expected);

    #[cfg(not(feature = "internal-dogfood-export"))]
    assert!(
        compiled_refused > 0,
        "a customer build must refuse the fixture's detailed record"
    );
    #[cfg(feature = "internal-dogfood-export")]
    assert_eq!(
        compiled_refused, 0,
        "a dogfood build exports every non-secret fixture record"
    );
}

#[test]
fn the_install_id_is_stamped_as_a_resource_attribute_when_the_host_supplies_one() {
    let key = sample_resource_key();
    let attributes = resource_attributes(&key, None, Some("install-9f2c"), None);
    assert_eq!(
        attributes.len(),
        6,
        "the five base attributes plus install id"
    );
    assert_eq!(
        attributes
            .iter()
            .find(|attribute| attribute["key"] == "proliferate.install_id")
            .expect("proliferate.install_id attribute")["value"],
        serde_json::json!({ "stringValue": "install-9f2c" })
    );
    assert_base_resource_attributes(&attributes, &key);
}

/// Absent rather than empty or invented. A host with no identity to give
/// produces records with no install attribute at all, so a consumer can tell
/// "unknown install" from "install whose id is the empty string".
#[test]
fn an_absent_install_id_omits_the_attribute_entirely() {
    let key = sample_resource_key();
    let attributes = resource_attributes(&key, None, None, None);
    assert!(attributes
        .iter()
        .all(|attribute| attribute["key"] != "proliferate.install_id"));
    assert_base_resource_attributes(&attributes, &key);
}

/// One install id covers every resource stream in a batch, whatever producer
/// boot or component each record came from. That is the whole point: it is the
/// only field in the payload that is stable across producer restarts.
#[test]
fn every_resource_stream_in_a_batch_carries_the_same_install_id() {
    let (payload, _) = encode_batch_with_policy(
        ExportPolicy::All,
        Some("install-9f2c"),
        None,
        &fixture_records(),
    );
    let resources = payload["resourceLogs"].as_array().expect("resource logs");
    assert!(
        resources.len() > 1,
        "the fixture must span several resource streams"
    );
    for resource in resources {
        let value = resource["resource"]["attributes"]
            .as_array()
            .expect("resource attributes")
            .iter()
            .find(|attribute| attribute["key"] == "proliferate.install_id")
            .expect("proliferate.install_id attribute");
        assert_eq!(
            value["value"],
            serde_json::json!({ "stringValue": "install-9f2c" })
        );
    }
}

#[test]
fn a_user_id_is_stamped_as_a_resource_attribute_and_absent_when_signed_out() {
    let key = sample_resource_key();
    let attributes = resource_attributes(&key, None, Some("install-9f2c"), Some("user-77a1"));
    assert_eq!(
        attributes
            .iter()
            .find(|attribute| attribute["key"] == "proliferate.user_id")
            .expect("proliferate.user_id attribute")["value"],
        serde_json::json!({ "stringValue": "user-77a1" })
    );
    assert_base_resource_attributes(&attributes, &key);

    let signed_out = resource_attributes(&key, None, Some("install-9f2c"), None);
    assert!(signed_out
        .iter()
        .all(|attribute| attribute["key"] != "proliferate.user_id"));
}
