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

#[test]
fn exact_labeled_header_and_credential_forms_are_redacted_with_canaries_intact() {
    let secret = "opaque-secret-value-9f31";
    for labeled in [
        format!("Authorization: {secret}"),
        format!("Proxy-Authorization={secret}"),
        format!("Cookie: session={secret}"),
        format!("Set-Cookie='{secret}'"),
        format!("X-Api-Key: \"{secret}\""),
        format!("\"X-Auth-Token\"=\"{secret}\""),
        format!("password: {secret}"),
        format!("\"passphrase\"=\"{secret}\""),
        format!("Credentials {{ client_secret: \"{secret}\" }}"),
        format!("{{\"api_key\":\"{secret}\"}}"),
        format!("access_token={secret}"),
        format!("refresh_token: '{secret}'"),
        format!("session_token={secret}"),
        format!("security_token: {secret}"),
        format!("credential=Secret({secret})"),
    ] {
        let retained = super::record::redact_and_bound(
            format!("request-canary\n{labeled}\nfallback-canary"),
            4_096,
        );
        assert!(!retained.contains(secret), "missed {labeled}");
        assert!(retained.contains("request-canary"));
        assert!(retained.contains("fallback-canary"));
        assert!(retained.contains("[REDACTED]"));
    }
}

#[test]
fn credential_like_words_without_an_exact_label_are_not_false_positives() {
    let ordinary = "authorization_status=allowed passwordless=true passphrase_hint=safe \
        client_secret_rotation=due api_key_count=2 access_token_count=3 \
        refresh_token_age=4 session_token_count=5 security_token_version=1 \
        credentialed=true monkey=value";
    assert_eq!(
        super::record::redact_and_bound(ordinary.to_owned(), 4_096),
        ordinary
    );
}

#[test]
fn labeled_secrets_crossing_the_message_boundary_are_removed() {
    for label in ["Authorization: ", "\"password\": \""] {
        let value = format!(
            "{}{}boundary-secret-value-9f31",
            "x".repeat(4_096 - label.len() - 5),
            label,
        );
        let retained = super::record::redact_and_bound(value, 4_096);
        assert!(retained.len() <= 4_096);
        assert!(!retained.contains("boundary-secret"));
        assert!(retained.contains("[REDACTED]"));
    }
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_and_fallback_payloads_never_receive_labeled_secret_canaries() {
    use super::tests_support::{
        drained, fallback_bytes, fallback_directory, fallback_writer, producer, spawn_worker,
        CollectorFixture, TEST_COLLECTOR_BOOT,
    };
    use super::CollectorAvailability;
    use crate::DiagnosticsComponent;

    let message = "request-canary\nAuthorization: request-secret-9f31\nfallback-canary\n\
        password=\"fallback-secret-9f31\"";
    let fixture = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let request_inner = producer(DiagnosticsComponent::AnyHarness, fixture.ready(1), None);
    assert_eq!(
        emit(&request_inner, ordinary(message)),
        EmitDisposition::Admitted
    );
    let request_worker = spawn_worker(&request_inner);
    assert!(drained(&request_inner).await);
    request_worker.abort();
    let request = serde_json::to_string(&fixture.records()).expect("request records");
    assert_redacted_path(&request);

    let directory = fallback_directory();
    let fallback_inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Unavailable { generation: 0 },
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );
    assert_eq!(
        emit(&fallback_inner, ordinary(message)),
        EmitDisposition::Admitted
    );
    let fallback_worker = spawn_worker(&fallback_inner);
    assert!(drained(&fallback_inner).await);
    fallback_worker.abort();
    let fallback =
        String::from_utf8(fallback_bytes(&directory, "anyharness.jsonl")).expect("utf8 fallback");
    assert_redacted_path(&fallback);
}

fn assert_redacted_path(value: &str) {
    assert!(value.contains("request-canary"));
    assert!(value.contains("fallback-canary"));
    assert!(!value.contains("request-secret-9f31"));
    assert!(!value.contains("fallback-secret-9f31"));
}

#[test]
fn debug_formatting_that_emits_tracing_cannot_recurse_or_consume_a_sequence() {
    use std::fmt;
    use std::sync::Arc;

    use tracing_subscriber::prelude::*;

    struct EmitsTracing;
    impl fmt::Debug for EmitsTracing {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            tracing::warn!(target: "diagnostics.recursion.proof", "nested formatter event");
            formatter.write_str("outer-debug-value")
        }
    }

    let inner = unavailable_producer();
    let layer = crate::DiagnosticsTracingLayer::new(DiagnosticsProducerHandle {
        inner: Arc::clone(&inner),
    });
    let subscriber = tracing_subscriber::registry().with(layer);
    tracing::subscriber::with_default(subscriber, || {
        tracing::info!(debug_value = ?EmitsTracing, "outer event");
    });

    let records = queued_records(&inner);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].producer_sequence, 1);
    let status = inner.snapshot();
    assert_eq!(status.last_assigned_sequence, Some(1));
    assert_eq!(status.next_sequence, Some(2));
}
