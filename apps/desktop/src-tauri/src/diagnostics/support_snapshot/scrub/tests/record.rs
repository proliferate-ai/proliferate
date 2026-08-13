use std::collections::BTreeMap;

use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, CollectorAcceptedRecordV1, PrivacyClassificationV1, ProducerRecordV1,
    RedactionClassificationV1, TypedArgumentV1,
};

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1,
};
use crate::diagnostics::support_snapshot::scrub::SupportExportScrubber;
use crate::diagnostics::support_snapshot::scrub::SupportTextKind;

fn accepted_record() -> CollectorAcceptedRecordV1 {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/api.json"
    )))
    .expect("accepted protocol fixture");
    serde_json::from_value(fixture["collector_record"].clone()).expect("accepted record")
}

fn producer_records() -> Vec<ProducerRecordV1> {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/records.json"
    )))
    .expect("producer protocol fixture");
    serde_json::from_value(fixture["records"].clone()).expect("producer records")
}

#[test]
fn accepted_record_keeps_identity_privacy_environment_and_customer_detail() {
    let mut record = accepted_record();
    record.record.environment = "passwordless-production".to_owned();
    record.record.privacy = PrivacyClassificationV1::CustomerContent;
    record.record.operation_id = "123e4567-e89b-12d3-a456-426614174000".to_owned();
    record.record.trace_id = Some("Aa0_Bb1_Cc2_Dd3_Ee4_Ff5_Gg6_Hh7_Ii8_Jj9_Kk0_Ll1".to_owned());
    let message_canary = "accepted-record-secret-canary";
    let detailed = record.record.detailed.as_mut().expect("detailed record");
    detailed.message = Some(format!(
        "prompt and terminal output survive; Authorization: Bearer {message_canary}"
    ));
    record.record.arguments.push(TypedArgumentV1 {
        name: "token_count".to_owned(),
        privacy: PrivacyClassificationV1::Operational,
        value: ArgumentValueV1::Integer(512),
    });
    record.record.arguments.push(TypedArgumentV1 {
        name: "metadata".to_owned(),
        privacy: PrivacyClassificationV1::CustomerContent,
        value: ArgumentValueV1::Object(BTreeMap::from([
            (
                "commit".to_owned(),
                ArgumentValueV1::String("0123456789abcdef0123456789abcdef01234567".to_owned()),
            ),
            (
                "environment".to_owned(),
                ArgumentValueV1::String("nested-environment-canary".to_owned()),
            ),
            (
                "provider_error".to_owned(),
                ArgumentValueV1::String("ordinary provider failure detail".to_owned()),
            ),
        ])),
    });
    let original = record.clone();

    let result = SupportExportScrubber::default()
        .scrub_accepted_record(record, SupportEvidenceSourceV1::Collector)
        .expect("scrub accepted record");
    // Borrowed, not moved: the canary assertion below renders the whole result.
    let output = result.value.as_ref().expect("accepted record retained");

    assert_eq!(output.accepted_timestamp, original.accepted_timestamp);
    assert_eq!(output.accepted_order, original.accepted_order);
    assert_eq!(output.retention_cursor, original.retention_cursor);
    assert_eq!(output.record.component, original.record.component);
    assert_eq!(output.record.source, original.record.source);
    assert_eq!(
        output.record.producer_boot_id,
        original.record.producer_boot_id
    );
    assert_eq!(output.record.privacy, original.record.privacy);
    assert_eq!(output.record.environment, "passwordless-production");
    assert_eq!(
        output.record.operation_id,
        "123e4567-e89b-12d3-a456-426614174000"
    );
    assert_eq!(output.record.trace_id, original.record.trace_id);
    assert_eq!(
        output.record.redaction,
        RedactionClassificationV1::SupportExport
    );

    let serialized = serde_json::to_string(&output).expect("serialize record");
    assert!(serialized.contains("prompt and terminal output survive"));
    assert!(serialized.contains("ordinary provider failure detail"));
    assert!(serialized.contains("0123456789abcdef0123456789abcdef01234567"));
    assert!(serialized.contains("\"token_count\""));
    assert!(serialized.contains("\"value\":512"));
    assert!(serialized.contains("[REDACTED:environment_secret]"));
    assert!(!serialized.contains(message_canary));
    assert!(!serialized.contains("nested-environment-canary"));
    assert_eq!(result.accounting.scrubbed_by_class.authorization, 1);
    assert_eq!(result.accounting.scrubbed_by_class.environment_secret, 1);

    // The caller-owned source clone remains richer and unchanged.
    let original_json = serde_json::to_string(&original).expect("serialize original");
    assert!(original_json.contains(message_canary));
    assert!(original_json.contains("nested-environment-canary"));
    let visible = format!("{result:?} {serialized}");
    assert!(!visible.contains(message_canary));
    assert!(!visible.contains("nested-environment-canary"));
}

#[test]
fn optional_oversized_id_is_dropped_but_required_id_omits_the_record() {
    let mut optional = accepted_record();
    optional.record.workspace_id = Some("w".repeat(129));
    let output = SupportExportScrubber::default()
        .scrub_accepted_record(optional, SupportEvidenceSourceV1::Collector)
        .expect("scrub optional ID");
    assert!(output
        .value
        .as_ref()
        .expect("record retained")
        .record
        .workspace_id
        .is_none());
    assert!(output.accounting.omissions.iter().any(|entry| {
        entry.reason == SupportOmissionReasonV1::SourceCap && entry.known_bytes == Some(129)
    }));

    let mut required = accepted_record();
    required.record.operation_id = "required-id-canary".repeat(10);
    let output = SupportExportScrubber::default()
        .scrub_accepted_record(required, SupportEvidenceSourceV1::Collector)
        .expect("scrub required ID");
    assert!(output.value.is_none());
    assert!(output
        .accounting
        .omissions
        .iter()
        .any(|entry| entry.reason == SupportOmissionReasonV1::SourceInvalid));
    assert!(!format!("{output:?}").contains("required-id-canary"));
}

#[test]
fn producer_record_adapter_marks_support_export_without_collector_metadata() {
    let record = accepted_record().record;
    let component = record.component;
    let source = record.source;
    let privacy = record.privacy;
    let output = SupportExportScrubber::default()
        .scrub_producer_record(record, SupportEvidenceSourceV1::Tauri)
        .expect("scrub producer record")
        .value
        .expect("producer record retained");
    assert_eq!(output.component, component);
    assert_eq!(output.source, source);
    assert_eq!(output.privacy, privacy);
    assert_eq!(output.redaction, RedactionClassificationV1::SupportExport);
}

#[test]
fn typed_model_usage_and_plugin_metadata_survive_exactly() {
    let scrubber = SupportExportScrubber::default();
    for name in ["anyharness.model.request", "anyharness.plugin.invoke"] {
        let record = producer_records()
            .into_iter()
            .find(|record| record.name == name)
            .expect("typed lifecycle fixture");
        let expected = record.lifecycle.clone();
        let output = scrubber
            .scrub_producer_record(record, SupportEvidenceSourceV1::Anyharness)
            .expect("scrub lifecycle record")
            .value
            .expect("retain lifecycle record");
        assert_eq!(output.lifecycle, expected);
        assert_eq!(output.redaction, RedactionClassificationV1::SupportExport);
    }
}

#[test]
fn semantic_argument_roles_are_closed_exact_keys_not_suffix_guesses() {
    let opaque_canary = "Aa0_Bb1_Cc2_Dd3_Ee4_Ff5_Gg6_Hh7_Ii8_Jj9_Kk0_Ll1";
    let safe_trace = "Zz9_Yy8_Xx7_Ww6_Vv5_Uu4_Tt3_Ss2_Rr1_Qq0_Pp9_Oo8";
    let mut record = accepted_record().record;
    record.arguments.push(TypedArgumentV1 {
        name: "semantic_roles".to_owned(),
        privacy: PrivacyClassificationV1::Operational,
        value: ArgumentValueV1::Object(BTreeMap::from([
            (
                "captured_at".to_owned(),
                ArgumentValueV1::String("2026-08-12T12:34:56Z".to_owned()),
            ),
            (
                "format".to_owned(),
                ArgumentValueV1::String(opaque_canary.to_owned()),
            ),
            (
                "invalid".to_owned(),
                ArgumentValueV1::String(opaque_canary.to_owned()),
            ),
            (
                "trace_id".to_owned(),
                ArgumentValueV1::String(safe_trace.to_owned()),
            ),
            (
                "updated_at".to_owned(),
                ArgumentValueV1::String("not-a-timestamp".to_owned()),
            ),
        ])),
    });

    let output = SupportExportScrubber::default()
        .scrub_producer_record(record, SupportEvidenceSourceV1::Tauri)
        .expect("scrub semantic-role fixture");
    let serialized =
        serde_json::to_string(&output.value.expect("record retained")).expect("serialize record");
    assert!(!serialized.contains(opaque_canary));
    assert!(!serialized.contains("not-a-timestamp"));
    assert!(serialized.contains(safe_trace));
    assert!(serialized.contains("2026-08-12T12:34:56Z"));
    assert_eq!(output.accounting.scrubbed_by_class.opaque_credential, 2);
    assert!(output
        .accounting
        .omissions
        .iter()
        .any(|entry| entry.reason == SupportOmissionReasonV1::SourceInvalid));
}

#[test]
fn embedded_protocol_timestamps_keep_valid_offsets_while_support_timestamps_require_z() {
    let offset_timestamp = "2026-08-12T12:34:56+05:30";
    let mut record = accepted_record();
    record.record.source_timestamp = offset_timestamp.to_owned();
    record.accepted_timestamp = offset_timestamp.to_owned();
    let output = SupportExportScrubber::default()
        .scrub_accepted_record(record, SupportEvidenceSourceV1::Collector)
        .expect("scrub protocol timestamp")
        .value
        .expect("protocol-valid record retained");
    assert_eq!(output.record.source_timestamp, offset_timestamp);
    assert_eq!(output.accepted_timestamp, offset_timestamp);

    let support_owned = SupportExportScrubber::default()
        .scrub_text(
            offset_timestamp.to_owned(),
            SupportEvidenceSourceV1::Package,
            SupportTextKind::Timestamp,
        )
        .expect("scrub support-owned timestamp");
    assert!(support_owned.value.is_none());
    assert!(support_owned
        .accounting
        .omissions
        .iter()
        .any(|entry| entry.reason == SupportOmissionReasonV1::SourceInvalid));

    let mut invalid = accepted_record();
    invalid.record.source_timestamp = "2026-08-12 12:34:56".to_owned();
    let output = SupportExportScrubber::default()
        .scrub_accepted_record(invalid, SupportEvidenceSourceV1::Collector)
        .expect("omit protocol-invalid record");
    assert!(output.value.is_none());
}

#[test]
fn scrubber_debug_never_exposes_the_configured_home_prefix() {
    let canary = "/Users/debug-home-canary";
    let scrubber = SupportExportScrubber::new(Some(canary.to_owned())).expect("scrubber");
    let visible = format!("{scrubber:?}");
    assert!(!visible.contains(canary));
    assert!(visible.contains("[configured]"));
}
