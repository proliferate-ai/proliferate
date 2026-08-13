use crate::diagnostics::support_snapshot::schema::enums::SupportEvidenceSourceV1;
use crate::diagnostics::support_snapshot::schema::model::common::SupportJsonValueV1;
use crate::diagnostics::support_snapshot::scrub::SupportExportScrubber;

#[test]
fn positive_fixture_retains_approved_customer_and_semantic_detail() {
    let parsed: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/positive_projected.json"))
            .expect("positive fixture JSON");
    let value = SupportJsonValueV1::try_from_json(&parsed).expect("bounded projected fixture");
    let output = SupportExportScrubber::default()
        .scrub_value(value.clone(), SupportEvidenceSourceV1::SessionLedger)
        .expect("positive scrub");
    assert_eq!(output.value, value);
    assert_eq!(output.accounting, Default::default());

    let serialized = serde_json::to_string(&output.value).expect("serialize output");
    for retained in [
        "Please fix the failing parser test.",
        "assistant explained the change",
        "patched src/main.rs",
        "cargo test --package sample",
        "tests passed",
        "warning: unused value",
        "fn main() { println!",
        "/Users/alice/work/project/src/main.rs",
        "sample-repository",
        "https://example.test/a/path?tab=files&page=2",
        "provider returned an ordinary retryable error",
        "response body with useful non-secret detail",
        "gpt-test",
        "formatter",
        "openai-compatible",
        "123e4567-e89b-12d3-a456-426614174000",
        // Both hashes are retained by their semantic role, not by any property
        // of the value: `sha256` and `commit` are hash fields, which are never
        // opaque-scanned. The same sixty-four-byte hex in a generic or content
        // position is a credential-shaped run and is redacted -- proven by
        // `bare_lowercase_hex_secrets_are_redacted_under_every_reachable_rule`.
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "0123456789abcdef0123456789abcdef01234567",
        "accepted-42",
        "passwordless",
        "ordinary long prose",
        "token_count",
        "input_tokens",
    ] {
        assert!(serialized.contains(retained), "lost {retained}");
    }
    assert!(serialized.contains("\"cursor\":41"));
    assert!(serialized.contains("\"token_count\":256"));
}

#[test]
fn parsed_object_output_is_independent_of_input_map_order() {
    let left: serde_json::Value =
        serde_json::from_str(r#"{"z":"last","a":"first","m":{"y":2,"b":1}}"#).expect("left JSON");
    let right: serde_json::Value =
        serde_json::from_str(r#"{"m":{"b":1,"y":2},"a":"first","z":"last"}"#).expect("right JSON");
    let left = SupportJsonValueV1::try_from_json(&left).expect("left value");
    let right = SupportJsonValueV1::try_from_json(&right).expect("right value");
    let scrubber = SupportExportScrubber::default();
    let left = scrubber
        .scrub_value(left, SupportEvidenceSourceV1::Package)
        .expect("left scrub");
    let right = scrubber
        .scrub_value(right, SupportEvidenceSourceV1::Package)
        .expect("right scrub");
    assert_eq!(left, right);
}
