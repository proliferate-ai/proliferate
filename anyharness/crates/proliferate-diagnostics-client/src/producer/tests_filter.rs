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

#[test]
fn closed_secret_key_and_value_corpus_is_removed() {
    for name in [
        "raw_env_vars",
        "raw_env_values",
        "aws_access_key_id",
        "aws_secret_access_key",
        "x_amz_security_token",
        "github_token",
    ] {
        assert!(super::record::secret_name(name), "missed {name}");
    }
    for value in [
        "ghp_abcdefghijklmnopqrstuvwxyz123456",
        "github_pat_abcdefghijklmnopqrstuvwxyz_123456",
        "eyJabcdefgh.ijklmnop.qrstuvwxyz",
        "sk-abcdefghijklmnopqrstuvwxyz",
        concat!("xox", "b-1234567890-abcdefghijklmnopqrstuvwxyz"),
        "AKIAABCDEFGHIJKLMNOP",
    ] {
        assert!(super::record::secret_value(value), "missed {value}");
    }
}

#[test]
fn correlation_ids_cannot_promote_secret_canaries() {
    let inner = unavailable_producer();
    let mut input = ordinary("correlation-secret");
    let canary = "ghp_abcdefghijklmnopqrstuvwxyz123456".to_owned();
    input.correlation.operation_id = Some(canary.clone());
    input.correlation.parent_operation_id = Some(canary.clone());
    input.correlation.trace_id = Some(canary.clone());
    input.correlation.workspace_id = Some(canary.clone());
    input.correlation.session_id = Some(canary.clone());
    input.correlation.turn_id = Some(canary.clone());
    input.correlation.item_id = Some(canary.clone());
    input.correlation.request_id = Some(canary.clone());
    input.correlation.target_id = Some(canary.clone());
    input.correlation.prompt_id = Some(canary.clone());
    input.correlation.workflow_id = Some(canary);

    assert_eq!(emit(&inner, input), EmitDisposition::Admitted);
    let records = queued_records(&inner);
    let record = &records[0];
    assert_ne!(record.operation_id, "ghp_abcdefghijklmnopqrstuvwxyz123456");
    assert!(record.parent_operation_id.is_none());
    assert!(record.trace_id.is_none());
    assert!(record.workspace_id.is_none());
    assert!(record.session_id.is_none());
    assert!(record.turn_id.is_none());
    assert!(record.item_id.is_none());
    assert!(record.request_id.is_none());
    assert!(record.target_id.is_none());
    assert!(record.prompt_id.is_none());
    assert!(record.workflow_id.is_none());
}

#[test]
fn multi_megabyte_secret_input_is_prescanned_with_bounded_output() {
    let value = format!(
        "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456 {} {}",
        "x".repeat(2_000_000),
        "y".repeat(2_000_000)
    );
    let retained = super::record::redact_and_bound(value, 4_096);
    assert!(retained.len() <= 4_096);
    assert!(!retained.contains("ghp_"));
}

#[test]
fn secret_crossing_prescan_output_boundary_is_redacted_conservatively() {
    for secret in [
        "ghp_abcdefghijklmnopqrstuvwxyz123456",
        "https://example.invalid/?x-amz-signature=abcdefghijklmnopqrstuvwxyz",
        "https://example.invalid/?x-amz-security-token=abcdefghijklmnopqrstuvwxyz",
        "-----BEGIN PRIVATE KEY-----abcdefghijklmnopqrstuvwxyz",
    ] {
        let value = format!("{}{secret} tail", "x".repeat(4_090));
        let retained = super::record::redact_and_bound(value, 4_096);
        assert!(retained.len() <= 4_096);
        assert!(!retained.contains("ghp_"));
        assert!(!retained.contains("x-amz-signature="));
        assert!(!retained.contains("x-amz-security-token="));
        assert!(!retained.contains("BEGIN PRIVATE"));
    }
}

#[test]
fn secret_crossing_the_fixed_prescan_cutoff_never_leaves_a_prefix() {
    let limit = 4_096;
    let cutoff = limit + 8_192;
    for secret_prefix in [
        "ghp_",
        "eyJ",
        "-----BEGIN PRIVATE KEY-----",
        "https://example.invalid/?x-amz-signature=",
        "https://example.invalid/?x-amz-security-token=",
    ] {
        let value = format!(
            "{}{}{}",
            "x".repeat(cutoff - secret_prefix.len() - 2),
            secret_prefix,
            "a".repeat(2_000_000)
        );
        let mut prescan = value;
        super::record::redact_secret_crossing_cutoff(&mut prescan, cutoff);
        assert!(prescan.len() <= cutoff);
        assert!(prescan.ends_with("[REDACTED]"));
        assert!(!prescan.contains("ghp_"));
        assert!(!prescan.contains("eyJ"));
        assert!(!prescan.contains("BEGIN PRIVATE"));
        assert!(!prescan.contains("x-amz-signature="));
        assert!(!prescan.contains("x-amz-security-token="));
    }
}
