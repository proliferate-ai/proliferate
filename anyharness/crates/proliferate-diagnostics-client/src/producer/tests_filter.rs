//! Local-detail filtering proofs kept separate from remote Sentry policy.

use super::{
    tests_support::{emit, ordinary, queued_records, unavailable_producer},
    DiagnosticsProducerHandle,
};
use crate::{DiagnosticCorrelation, EmitDisposition};

#[test]
fn operation_context_generates_only_for_a_missing_explicit_id() {
    let handle = DiagnosticsProducerHandle {
        inner: unavailable_producer(),
    };
    let generated = handle.new_operation_context(DiagnosticCorrelation::default());
    assert!(super::record::valid_id(generated.operation_id.as_deref()));

    let invalid = "x".repeat(129);
    let retained = handle.new_operation_context(DiagnosticCorrelation {
        operation_id: Some(invalid.clone()),
        ..DiagnosticCorrelation::default()
    });
    assert_eq!(retained.operation_id.as_deref(), Some(invalid.as_str()));
}

#[test]
fn ordinary_43_character_local_detail_is_not_treated_as_a_token() {
    let inner = unavailable_producer();
    let ordinary_identifier = "abcdefghijklmnopqrstuvwxyz0123456789abcdefg";
    assert_eq!(ordinary_identifier.len(), 43);

    assert_eq!(
        emit(&inner, ordinary(ordinary_identifier)),
        EmitDisposition::Admitted
    );

    let records = queued_records(&inner);
    assert_eq!(
        records[0]
            .detailed
            .as_ref()
            .and_then(|detail| detail.message.as_deref()),
        Some(ordinary_identifier)
    );
}

#[test]
fn high_confidence_secret_patterns_still_redact_without_blanket_content_loss() {
    let inner = unavailable_producer();
    let message = "path /workspace/repo Bearer secret-token-123 https://example.com/view?tab=files";

    assert_eq!(emit(&inner, ordinary(message)), EmitDisposition::Admitted);

    let records = queued_records(&inner);
    let retained = records[0]
        .detailed
        .as_ref()
        .and_then(|detail| detail.message.as_deref())
        .expect("retained local message");
    assert!(retained.contains("path /workspace/repo"));
    assert!(retained.contains("https://example.com/view?tab=files"));
    assert!(!retained.contains("secret-token-123"));
    assert!(retained.contains("[REDACTED]"));
}
