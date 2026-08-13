use serde::Serialize;

use crate::diagnostics::support_snapshot::schema::enums::*;
use crate::diagnostics::support_snapshot::schema::model::evidence::SupportFallbackComponentV1;
use crate::diagnostics::support_snapshot::schema::model::health::{
    DesktopDiagnosticsSupervisorStateV1, SupportChildCollectorStateV1,
    SupportChildProducerStatusV1, SupportTauriProducerHealthV1,
};
use crate::diagnostics::support_snapshot::schema::model::manifest::SupportSessionCollectionManifestV1;

fn assert_literals<T: Serialize>(values: &[T], expected: &[&str]) {
    let actual: Vec<String> = values
        .iter()
        .map(|value| {
            serde_json::to_value(value)
                .expect("serialize literal")
                .as_str()
                .expect("string literal")
                .to_string()
        })
        .collect();
    let expected: Vec<String> = expected.iter().map(|value| (*value).to_string()).collect();
    assert_eq!(actual, expected);
}

#[test]
fn omission_truncation_scrub_and_loss_literals_are_closed_and_complete() {
    assert_literals(
        &[
            SupportOmissionReasonV1::CollectorUnavailable,
            SupportOmissionReasonV1::CollectorExportInterrupted,
            SupportOmissionReasonV1::CollectorExportInvalid,
            SupportOmissionReasonV1::CollectorLimitUncertain,
            SupportOmissionReasonV1::ProducerStatusUnavailable,
            SupportOmissionReasonV1::ChildMissing,
            SupportOmissionReasonV1::SourceMissing,
            SupportOmissionReasonV1::SourceUnreadable,
            SupportOmissionReasonV1::SourceUnsafeMetadata,
            SupportOmissionReasonV1::SourceInvalid,
            SupportOmissionReasonV1::SourceCap,
            SupportOmissionReasonV1::NoSelectedBundledLocalWorkspace,
            SupportOmissionReasonV1::SessionUnavailable,
            SupportOmissionReasonV1::SessionTimeout,
            SupportOmissionReasonV1::SessionInvalid,
            SupportOmissionReasonV1::SessionWindowLimitUncertain,
            SupportOmissionReasonV1::LiveConfigNotCollected,
            SupportOmissionReasonV1::RecordLimit,
            SupportOmissionReasonV1::ByteLimit,
            SupportOmissionReasonV1::PackageCap,
        ],
        &[
            "collector_unavailable",
            "collector_export_interrupted",
            "collector_export_invalid",
            "collector_limit_uncertain",
            "producer_status_unavailable",
            "child_missing",
            "source_missing",
            "source_unreadable",
            "source_unsafe_metadata",
            "source_invalid",
            "source_cap",
            "no_selected_bundled_local_workspace",
            "session_unavailable",
            "session_timeout",
            "session_invalid",
            "session_window_limit_uncertain",
            "live_config_not_collected",
            "record_limit",
            "byte_limit",
            "package_cap",
        ],
    );
    assert_literals(
        &[
            SupportTruncationReasonV1::SourceTail,
            SupportTruncationReasonV1::FieldBytes,
            SupportTruncationReasonV1::ContainerItems,
            SupportTruncationReasonV1::SessionEvents,
            SupportTruncationReasonV1::RawNotifications,
            SupportTruncationReasonV1::ComponentBytes,
            SupportTruncationReasonV1::PackageBytes,
        ],
        &[
            "source_tail",
            "field_bytes",
            "container_items",
            "session_events",
            "raw_notifications",
            "component_bytes",
            "package_bytes",
        ],
    );
    assert_literals(
        &[
            SupportSecretClassV1::Authorization,
            SupportSecretClassV1::Cookie,
            SupportSecretClassV1::AccessToken,
            SupportSecretClassV1::RefreshToken,
            SupportSecretClassV1::IdentityToken,
            SupportSecretClassV1::ApiKey,
            SupportSecretClassV1::ClientSecret,
            SupportSecretClassV1::Password,
            SupportSecretClassV1::PrivateKey,
            SupportSecretClassV1::CredentialContainer,
            SupportSecretClassV1::EnvironmentSecret,
            SupportSecretClassV1::SignedUrl,
            SupportSecretClassV1::ProviderCredential,
            SupportSecretClassV1::OpaqueCredential,
            SupportSecretClassV1::UrlUserinfo,
        ],
        &[
            "authorization",
            "cookie",
            "access_token",
            "refresh_token",
            "identity_token",
            "api_key",
            "client_secret",
            "password",
            "private_key",
            "credential_container",
            "environment_secret",
            "signed_url",
            "provider_credential",
            "opaque_credential",
            "url_userinfo",
        ],
    );
    assert_literals(
        &[
            SupportLossReasonV1::QueueRecords,
            SupportLossReasonV1::QueueBytes,
            SupportLossReasonV1::ProtectedEviction,
            SupportLossReasonV1::Pressure,
            SupportLossReasonV1::GenerationChanged,
            SupportLossReasonV1::TransportTimeout,
            SupportLossReasonV1::TransportFailure,
            SupportLossReasonV1::ReceiptInvalid,
            SupportLossReasonV1::ReceiptRejected,
            SupportLossReasonV1::FallbackOverflow,
            SupportLossReasonV1::FallbackWriteFailed,
            SupportLossReasonV1::ShutdownTimeout,
            SupportLossReasonV1::FilterInvalid,
            SupportLossReasonV1::SequenceExhausted,
        ],
        &[
            "queue_records",
            "queue_bytes",
            "protected_eviction",
            "pressure",
            "generation_changed",
            "transport_timeout",
            "transport_failure",
            "receipt_invalid",
            "receipt_rejected",
            "fallback_overflow",
            "fallback_write_failed",
            "shutdown_timeout",
            "filter_invalid",
            "sequence_exhausted",
        ],
    );
}

#[test]
fn status_fallback_legacy_session_and_source_literals_are_closed_and_complete() {
    assert_literals(
        &[
            SupportEvidenceSourceV1::Collector,
            SupportEvidenceSourceV1::Renderer,
            SupportEvidenceSourceV1::Tauri,
            SupportEvidenceSourceV1::Anyharness,
            SupportEvidenceSourceV1::DesktopWorker,
            SupportEvidenceSourceV1::SessionLedger,
            SupportEvidenceSourceV1::Package,
        ],
        &[
            "collector",
            "renderer",
            "tauri",
            "anyharness",
            "desktop_worker",
            "session_ledger",
            "package",
        ],
    );
    assert_literals(
        &[
            SupportCollectorStatusV1::Complete,
            SupportCollectorStatusV1::LimitUncertain,
            SupportCollectorStatusV1::Unavailable,
            SupportCollectorStatusV1::Interrupted,
            SupportCollectorStatusV1::Invalid,
        ],
        &[
            "complete",
            "limit_uncertain",
            "unavailable",
            "interrupted",
            "invalid",
        ],
    );
    assert_literals(
        &[
            SupportCollectorCompletenessV1::Complete,
            SupportCollectorCompletenessV1::LimitUncertain,
            SupportCollectorCompletenessV1::Unknown,
        ],
        &["complete", "limit_uncertain", "unknown"],
    );
    assert_literals(
        &[
            SupportPr5FallbackReasonV1::CollectorUnavailable,
            SupportPr5FallbackReasonV1::GenerationChanged,
            SupportPr5FallbackReasonV1::TransportCooldown,
            SupportPr5FallbackReasonV1::DeliveryUnknown,
            SupportPr5FallbackReasonV1::FinalTeardown,
        ],
        &[
            "collector_unavailable",
            "generation_changed",
            "transport_cooldown",
            "delivery_unknown",
            "final_teardown",
        ],
    );
    assert_literals(
        &[
            SupportFallbackRecordComponentV1::DesktopRenderer,
            SupportFallbackRecordComponentV1::DesktopTauri,
            SupportFallbackRecordComponentV1::Anyharness,
            SupportFallbackRecordComponentV1::DesktopWorker,
        ],
        &[
            "desktop_renderer",
            "desktop_tauri",
            "anyharness",
            "desktop_worker",
        ],
    );
    assert_literals(
        &[
            SupportFallbackDispositionV1::NotCollectorAccepted,
            SupportFallbackDispositionV1::DeliveryUnknown,
        ],
        &["not_collector_accepted", "delivery_unknown"],
    );
    assert_literals(
        &[
            SupportLegacySourceKindV1::RendererDiagnostics,
            SupportLegacySourceKindV1::AnyharnessPrimary,
            SupportLegacySourceKindV1::WorkerPrimaryV2,
            SupportLegacySourceKindV1::WorkerPrimaryV1,
        ],
        &[
            "renderer_diagnostics",
            "anyharness_primary",
            "worker_primary_v2",
            "worker_primary_v1",
        ],
    );
    assert_literals(
        &[
            SupportEndpointStateV1::Included,
            SupportEndpointStateV1::Omitted,
            SupportEndpointStateV1::LimitUncertain,
        ],
        &["included", "omitted", "limit_uncertain"],
    );
    assert_literals(
        &[
            SupportSessionSelectionV1::ActiveSession,
            SupportSessionSelectionV1::RecentActivity,
        ],
        &["active_session", "recent_activity"],
    );
    assert_literals(
        &[
            SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
            SupportSessionOmissionReasonV1::SessionUnavailable,
            SupportSessionOmissionReasonV1::SessionTimeout,
            SupportSessionOmissionReasonV1::SessionInvalid,
        ],
        &[
            "no_selected_bundled_local_workspace",
            "session_unavailable",
            "session_timeout",
            "session_invalid",
        ],
    );
    assert_literals(
        &[
            SupportSourceManifestSourceV1::Collector,
            SupportSourceManifestSourceV1::DesktopNativeFallback,
            SupportSourceManifestSourceV1::AnyharnessFallback,
            SupportSourceManifestSourceV1::DesktopWorkerFallback,
            SupportSourceManifestSourceV1::RendererLegacy,
            SupportSourceManifestSourceV1::AnyharnessLegacy,
            SupportSourceManifestSourceV1::WorkerLegacyV2,
            SupportSourceManifestSourceV1::WorkerLegacyV1,
            SupportSourceManifestSourceV1::SessionLedger,
        ],
        &[
            "collector",
            "desktop_native_fallback",
            "anyharness_fallback",
            "desktop_worker_fallback",
            "renderer_legacy",
            "anyharness_legacy",
            "worker_legacy_v2",
            "worker_legacy_v1",
            "session_ledger",
        ],
    );
    assert_literals(
        &[
            SupportSourceStateV1::Included,
            SupportSourceStateV1::Missing,
            SupportSourceStateV1::Unreadable,
            SupportSourceStateV1::Unsafe,
            SupportSourceStateV1::Invalid,
            SupportSourceStateV1::Omitted,
        ],
        &[
            "included",
            "missing",
            "unreadable",
            "unsafe",
            "invalid",
            "omitted",
        ],
    );
}

#[test]
fn remaining_singletons_components_and_failure_literals_are_pinned() {
    assert_literals(
        &[
            DesktopDiagnosticsFailureClassV1::UnsupportedTarget,
            DesktopDiagnosticsFailureClassV1::BinaryMissing,
            DesktopDiagnosticsFailureClassV1::BinaryInvalid,
            DesktopDiagnosticsFailureClassV1::SpawnFailed,
            DesktopDiagnosticsFailureClassV1::EndpointUnavailable,
            DesktopDiagnosticsFailureClassV1::ReadinessTimeout,
            DesktopDiagnosticsFailureClassV1::AuthenticationFailed,
            DesktopDiagnosticsFailureClassV1::SchemaIncompatible,
            DesktopDiagnosticsFailureClassV1::BootIdMismatch,
            DesktopDiagnosticsFailureClassV1::HealthUnavailable,
            DesktopDiagnosticsFailureClassV1::ChildExited,
            DesktopDiagnosticsFailureClassV1::ChildInspectionFailed,
            DesktopDiagnosticsFailureClassV1::RestartExhausted,
            DesktopDiagnosticsFailureClassV1::ShutdownArmed,
            DesktopDiagnosticsFailureClassV1::ShutdownTimeout,
            DesktopDiagnosticsFailureClassV1::ShutdownFailed,
        ],
        &[
            "unsupported_target",
            "binary_missing",
            "binary_invalid",
            "spawn_failed",
            "endpoint_unavailable",
            "readiness_timeout",
            "authentication_failed",
            "schema_incompatible",
            "boot_id_mismatch",
            "health_unavailable",
            "child_exited",
            "child_inspection_failed",
            "restart_exhausted",
            "shutdown_armed",
            "shutdown_timeout",
            "shutdown_failed",
        ],
    );
    assert_literals(
        &[
            SupportLaunchKindV1::Initial,
            SupportLaunchKindV1::AutomaticRestart,
        ],
        &["initial", "automatic_restart"],
    );
    assert_literals(
        &[
            SupportChildComponentV1::Anyharness,
            SupportChildComponentV1::DesktopWorker,
        ],
        &["anyharness", "desktop_worker"],
    );
    assert_literals(
        &[
            SupportChildOmissionReasonV1::ProducerStatusUnavailable,
            SupportChildOmissionReasonV1::ChildMissing,
            SupportChildOmissionReasonV1::SourceInvalid,
        ],
        &[
            "producer_status_unavailable",
            "child_missing",
            "source_invalid",
        ],
    );
    assert_literals(
        &[SupportCoverageSelectionV1::OldestMatchingRetainedPrefix],
        &["oldest_matching_retained_prefix"],
    );
    assert_literals(&[SupportOmittedStateV1::Omitted], &["omitted"]);
    assert_literals(
        &[SupportProducerStatusUnavailableV1::ProducerStatusUnavailable],
        &["producer_status_unavailable"],
    );
    assert_literals(
        &[SupportUnknownDesktopNativeV1::UnknownDesktopNative],
        &["unknown_desktop_native"],
    );
    assert_literals(
        &[SupportLiveConfigStateV1::NotCollected],
        &["not_collected"],
    );
    assert_literals(
        &[SupportConsentDisclosureVersionV1::DesktopSupportSnapshotCustomerContentV1],
        &["desktop_support_snapshot_customer_content_v1"],
    );
}

fn tag<T: Serialize>(value: &T, field: &str) -> String {
    serde_json::to_value(value).expect("serialize union")[field]
        .as_str()
        .expect("union tag")
        .to_string()
}

fn assert_tags<T: Serialize>(values: &[T], field: &str, expected: &[&str]) {
    let actual: Vec<String> = values.iter().map(|value| tag(value, field)).collect();
    let expected: Vec<String> = expected.iter().map(|value| (*value).to_string()).collect();
    assert_eq!(actual, expected);
}

#[test]
fn every_tagged_union_variant_has_its_exact_wire_tag() {
    let populated = super::populated_golden_tests::populated_snapshot();
    let desktop_health = populated
        .collector
        .desktop_health
        .clone()
        .expect("populated desktop health");
    let supervisor = [
        DesktopDiagnosticsSupervisorStateV1::Unsupported {
            classification: DesktopDiagnosticsFailureClassV1::UnsupportedTarget,
        },
        DesktopDiagnosticsSupervisorStateV1::Starting {
            launch_kind: SupportLaunchKindV1::Initial,
            attempt: 1,
            restart_count: 0,
        },
        DesktopDiagnosticsSupervisorStateV1::Ready {
            collector_boot_id: "boot".to_string(),
            schema_major: 1,
            restart_count: 0,
        },
        DesktopDiagnosticsSupervisorStateV1::Degraded {
            classification: DesktopDiagnosticsFailureClassV1::HealthUnavailable,
            restart_count: 1,
            retry_exhausted: false,
        },
        DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: true },
    ];
    assert_tags(
        &supervisor,
        "state",
        &["unsupported", "starting", "ready", "degraded", "stopped"],
    );

    let collector_states = [
        SupportChildCollectorStateV1::Unavailable {},
        SupportChildCollectorStateV1::Cooldown {},
        SupportChildCollectorStateV1::Ready {
            collector_boot_id: "boot".to_string(),
            generation_number: 1,
        },
    ];
    assert_tags(
        &collector_states,
        "kind",
        &["unavailable", "cooldown", "ready"],
    );

    let child_statuses = [
        populated.producer_health.anyharness,
        SupportChildProducerStatusV1::Omitted {
            captured_at: super::TS.to_string(),
            reason: SupportChildOmissionReasonV1::ChildMissing,
        },
    ];
    assert_tags(&child_statuses, "state", &["available", "omitted"]);
    let tauri = [
        populated.producer_health.tauri,
        SupportTauriProducerHealthV1::Omitted {
            reason: SupportProducerStatusUnavailableV1::ProducerStatusUnavailable,
        },
    ];
    assert_tags(&tauri, "state", &["supervisor_only", "omitted"]);
    let fallback = [
        SupportFallbackComponentV1::Pr3DesktopNativeMixed {
            records: Vec::new(),
            opaque_lines: Vec::new(),
        },
        SupportFallbackComponentV1::Pr5Wrapped {
            component: SupportChildComponentV1::Anyharness,
            records: Vec::new(),
            opaque_lines: Vec::new(),
        },
    ];
    assert_tags(
        &fallback,
        "family",
        &["pr3_desktop_native_mixed", "pr5_wrapped"],
    );
    let session_collection = [
        populated.manifest.session_collection,
        SupportSessionCollectionManifestV1::Omitted {
            reason: SupportSessionOmissionReasonV1::SessionTimeout,
        },
    ];
    assert_tags(&session_collection, "state", &["included", "omitted"]);
    // The fixture's own supervisor value is tag-checked too, not just the
    // hand-built variants above: this test is about wire tags, so it asserts the
    // tag the real snapshot emits, not the field values behind it.
    assert_tags(&[desktop_health.supervisor], "state", &["ready"]);
}
