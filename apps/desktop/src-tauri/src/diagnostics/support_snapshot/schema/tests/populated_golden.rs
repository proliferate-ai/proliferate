use super::{set_manifest_source, TS};

use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, HealthStatusV1, RedactionClassificationV1, SourceV1,
};

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportChildComponentV1, SupportCollectorCompletenessV1, SupportCollectorStatusV1,
    SupportEndpointStateV1, SupportEvidenceSourceV1, SupportFallbackDispositionV1,
    SupportFallbackRecordComponentV1, SupportLegacySourceKindV1, SupportLossReasonV1,
    SupportOmissionReasonV1, SupportPr5FallbackReasonV1, SupportSessionSelectionV1,
    SupportSourceManifestSourceV1, SupportSourceStateV1, SupportTruncationReasonV1,
    SupportUnknownDesktopNativeV1,
};
use crate::diagnostics::support_snapshot::schema::limits::COLLECTOR_BYTES;
use crate::diagnostics::support_snapshot::schema::model::common::{
    SupportJsonValueV1, SupportOmissionV1, SupportTruncationV1,
};
use crate::diagnostics::support_snapshot::schema::model::evidence::{
    SupportFallbackComponentV1, SupportFallbackRecordV1, SupportLegacyLineV1,
    SupportLegacySourceV1, SupportOpaqueFallbackLineV1, SupportSessionEndpointStatesV1,
    SupportSessionLedgerV1, SupportSessionV1,
};
use crate::diagnostics::support_snapshot::schema::model::health::{
    DesktopDiagnosticsHealthV1, DesktopDiagnosticsSupervisorStateV1, SupportChildCollectorStateV1,
    SupportChildProducerStatusV1, SupportTauriProducerHealthV1,
};
use crate::diagnostics::support_snapshot::schema::model::manifest::SupportSessionCollectionManifestV1;
use crate::diagnostics::support_snapshot::schema::model::snapshot::SupportSnapshotV3;
use crate::diagnostics::support_snapshot::schema::validate::{
    stabilize_serialized_bytes, validate_snapshot,
};

const GOLDEN_POPULATED: &str = include_str!("../fixtures/golden_populated_compact.json");

fn session_value(entries: &[(&str, SupportJsonValueV1)]) -> SupportJsonValueV1 {
    SupportJsonValueV1::Object(
        entries
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect(),
    )
}

pub(super) fn populated_snapshot() -> SupportSnapshotV3 {
    let mut snapshot = super::protocol_tests::completed_snapshot();
    snapshot.app.runtime_version = Some("1.2.3".to_string());
    snapshot.app.runtime_status = Some("ready".to_string());
    snapshot.consent.selection = SupportSessionSelectionV1::ActiveSession;
    snapshot.selection.workspace_id = Some("workspace-1".to_string());
    snapshot.selection.anyharness_workspace_id = Some("runtime-workspace-1".to_string());
    snapshot.selection.ui_session_id = Some("ui-session-1".to_string());
    snapshot.selection.materialized_session_id = Some("materialized-session-1".to_string());

    let returned_bytes = COLLECTOR_BYTES - 65_536 + 1;
    snapshot.collector.coverage.status = SupportCollectorStatusV1::LimitUncertain;
    snapshot.collector.coverage.completeness = SupportCollectorCompletenessV1::LimitUncertain;
    snapshot.collector.coverage.limit_uncertain = true;
    snapshot.collector.coverage.returned_record_bytes = returned_bytes;
    snapshot.collector.gaps = vec![super::manifest_gap()];
    let export_manifest = snapshot
        .collector
        .export_manifest
        .as_mut()
        .expect("export manifest");
    export_manifest.byte_count = returned_bytes;
    export_manifest.gaps = snapshot.collector.gaps.clone();
    snapshot.manifest.collector = snapshot.collector.coverage.clone();
    snapshot.manifest.gaps = snapshot.collector.gaps.clone();

    let mut health = snapshot
        .collector
        .export_health
        .as_ref()
        .expect("export health")
        .clone();
    health.status = HealthStatusV1::Ready;
    let desktop_health = DesktopDiagnosticsHealthV1 {
        supervisor: DesktopDiagnosticsSupervisorStateV1::Ready {
            collector_boot_id: health.collector_boot_id.clone(),
            schema_major: 1,
            restart_count: health.restart_count,
        },
        fallback: health.fallback.clone(),
        collector: Some(health),
    };
    snapshot.collector.desktop_health = Some(desktop_health.clone());
    snapshot.producer_health.tauri = SupportTauriProducerHealthV1::SupervisorOnly {
        desktop_health,
        producer_status: Default::default(),
    };

    let mut anyharness = super::protocol_tests::child_snapshot(SupportChildComponentV1::Anyharness);
    anyharness.last_assigned_sequence = Some(14);
    anyharness.next_sequence = Some(15);
    anyharness.collector_state = SupportChildCollectorStateV1::Ready {
        collector_boot_id: "collector-boot-01".to_string(),
        generation_number: 2,
    };
    anyharness.resident_records = 3;
    anyharness.resident_bytes = 300;
    anyharness.in_flight = true;
    anyharness.fallback_active = true;
    anyharness.fallback_bytes = 400;
    anyharness.fallback_write_failures = 11;
    anyharness.dropped_by_reason.queue_records = 1;
    anyharness.dropped_by_reason.queue_bytes = 2;
    anyharness.dropped_by_reason.protected_eviction = 3;
    anyharness.dropped_by_reason.pressure = 4;
    anyharness.dropped_by_reason.generation_changed = 5;
    anyharness.dropped_by_reason.transport_timeout = 6;
    anyharness.dropped_by_reason.transport_failure = 7;
    anyharness.dropped_by_reason.receipt_invalid = 8;
    anyharness.dropped_by_reason.receipt_rejected = 9;
    anyharness.dropped_by_reason.fallback_overflow = 10;
    anyharness.dropped_by_reason.fallback_write_failed = 11;
    anyharness.dropped_by_reason.shutdown_timeout = 12;
    anyharness.dropped_by_reason.filter_invalid = 13;
    anyharness.dropped_by_reason.sequence_exhausted = 14;
    anyharness.fallback_routed = 15;
    anyharness.delivery_fence_eligible = false;
    anyharness.last_failure = Some(SupportLossReasonV1::SequenceExhausted);
    snapshot.producer_health.anyharness = SupportChildProducerStatusV1::Available {
        captured_at: TS.to_string(),
        snapshot: anyharness,
    };

    let mut worker = super::protocol_tests::child_snapshot(SupportChildComponentV1::DesktopWorker);
    worker.last_assigned_sequence = Some(1);
    worker.next_sequence = Some(2);
    worker.collector_state = SupportChildCollectorStateV1::Cooldown {};
    snapshot.producer_health.desktop_worker = SupportChildProducerStatusV1::Available {
        captured_at: TS.to_string(),
        snapshot: worker,
    };

    let mut tauri_record = super::protocol_tests::accepted_record().record;
    tauri_record.source_timestamp = "2026-08-11T23:50:00Z".to_string();
    tauri_record.redaction = RedactionClassificationV1::SupportExport;
    let opaque = SupportOpaqueFallbackLineV1 {
        component: SupportUnknownDesktopNativeV1::UnknownDesktopNative,
        value: session_value(&[(
            "message",
            SupportJsonValueV1::String("native fallback".to_string()),
        )]),
        segment: 0,
        line: 2,
        semantic_claims: false,
    };
    let mut anyharness_record = tauri_record.clone();
    anyharness_record.component = ComponentV1::Anyharness;
    anyharness_record.source = SourceV1::Anyharness;
    let mut worker_record = tauri_record.clone();
    worker_record.component = ComponentV1::DesktopWorker;
    worker_record.source = SourceV1::Worker;
    snapshot.fallback_evidence = vec![
        SupportFallbackComponentV1::Pr3DesktopNativeMixed {
            records: vec![SupportFallbackRecordV1 {
                component: SupportFallbackRecordComponentV1::DesktopTauri,
                disposition: SupportFallbackDispositionV1::NotCollectorAccepted,
                fallback_reason: None,
                record: tauri_record,
                segment: 3,
                line: 1,
            }],
            opaque_lines: vec![opaque],
        },
        SupportFallbackComponentV1::Pr5Wrapped {
            component: SupportChildComponentV1::Anyharness,
            records: vec![SupportFallbackRecordV1 {
                component: SupportFallbackRecordComponentV1::Anyharness,
                disposition: SupportFallbackDispositionV1::DeliveryUnknown,
                fallback_reason: Some(SupportPr5FallbackReasonV1::DeliveryUnknown),
                record: anyharness_record,
                segment: 0,
                line: 1,
            }],
            opaque_lines: Vec::new(),
        },
        SupportFallbackComponentV1::Pr5Wrapped {
            component: SupportChildComponentV1::DesktopWorker,
            records: vec![SupportFallbackRecordV1 {
                component: SupportFallbackRecordComponentV1::DesktopWorker,
                disposition: SupportFallbackDispositionV1::NotCollectorAccepted,
                fallback_reason: Some(SupportPr5FallbackReasonV1::FinalTeardown),
                record: worker_record,
                segment: 0,
                line: 1,
            }],
            opaque_lines: Vec::new(),
        },
    ];

    snapshot.legacy_evidence = [
        (
            SupportLegacySourceKindV1::RendererDiagnostics,
            5,
            "renderer",
        ),
        (SupportLegacySourceKindV1::AnyharnessPrimary, 5, "runtime"),
        (SupportLegacySourceKindV1::WorkerPrimaryV2, 0, "worker-v2"),
        (SupportLegacySourceKindV1::WorkerPrimaryV1, 0, "worker-v1"),
    ]
    .into_iter()
    .map(|(source, segment, value)| SupportLegacySourceV1 {
        source,
        lines: vec![SupportLegacyLineV1 {
            segment,
            line: 1,
            value: value.to_string(),
        }],
        semantic_claims: false,
    })
    .collect();

    let session = SupportSessionV1 {
        session_id: "materialized-session-1".to_string(),
        summary_captured_at: TS.to_string(),
        summary: Some(session_value(&[
            ("model", SupportJsonValueV1::String("gpt-test".to_string())),
            ("prompt", SupportJsonValueV1::String("help me".to_string())),
        ])),
        normalized_events: vec![session_value(&[
            ("payload", SupportJsonValueV1::Bool(true)),
            ("seq", SupportJsonValueV1::Integer(1)),
        ])],
        raw_notifications: vec![session_value(&[
            ("body", SupportJsonValueV1::String("raw".to_string())),
            ("seq", SupportJsonValueV1::Integer(2)),
        ])],
        endpoint_states: SupportSessionEndpointStatesV1 {
            summary: SupportEndpointStateV1::LimitUncertain,
            events: SupportEndpointStateV1::Included,
            raw_notifications: SupportEndpointStateV1::LimitUncertain,
            live_config: crate::diagnostics::support_snapshot::schema::enums::SupportLiveConfigStateV1::NotCollected,
        },
    };
    snapshot.session_ledger = Some(SupportSessionLedgerV1 {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selection: SupportSessionSelectionV1::ActiveSession,
        sessions: vec![session],
    });
    snapshot.manifest.session_collection = SupportSessionCollectionManifestV1::Included {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selected_sessions: 1,
        session_included_bytes: 1,
        event_included_bytes: 1,
        raw_notification_included_bytes: 1,
        limit_uncertain_endpoints: 2,
    };

    for (source, read_bytes, included_items) in [
        (SupportSourceManifestSourceV1::Collector, returned_bytes, 1),
        (SupportSourceManifestSourceV1::DesktopNativeFallback, 2, 2),
        (SupportSourceManifestSourceV1::AnyharnessFallback, 1, 1),
        (SupportSourceManifestSourceV1::DesktopWorkerFallback, 1, 1),
        (SupportSourceManifestSourceV1::RendererLegacy, 1, 1),
        (SupportSourceManifestSourceV1::AnyharnessLegacy, 1, 1),
        (SupportSourceManifestSourceV1::WorkerLegacyV2, 1, 1),
        (SupportSourceManifestSourceV1::WorkerLegacyV1, 1, 1),
        (SupportSourceManifestSourceV1::SessionLedger, 3, 1),
    ] {
        set_manifest_source(
            &mut snapshot,
            source,
            SupportSourceStateV1::Included,
            read_bytes,
            read_bytes,
            included_items,
        );
    }

    snapshot.manifest.omissions = vec![
        SupportOmissionV1 {
            source: SupportEvidenceSourceV1::Collector,
            reason: SupportOmissionReasonV1::CollectorLimitUncertain,
            count: 1,
            known_bytes: None,
        },
        SupportOmissionV1 {
            source: SupportEvidenceSourceV1::Renderer,
            reason: SupportOmissionReasonV1::ProducerStatusUnavailable,
            count: 1,
            known_bytes: Some(1),
        },
        SupportOmissionV1 {
            source: SupportEvidenceSourceV1::Tauri,
            reason: SupportOmissionReasonV1::SourceMissing,
            count: 2,
            known_bytes: Some(2),
        },
        SupportOmissionV1 {
            source: SupportEvidenceSourceV1::Anyharness,
            reason: SupportOmissionReasonV1::SourceUnreadable,
            count: 3,
            known_bytes: Some(3),
        },
        SupportOmissionV1 {
            source: SupportEvidenceSourceV1::DesktopWorker,
            reason: SupportOmissionReasonV1::SourceUnsafeMetadata,
            count: 4,
            known_bytes: Some(4),
        },
        SupportOmissionV1 {
            source: SupportEvidenceSourceV1::SessionLedger,
            reason: SupportOmissionReasonV1::SessionWindowLimitUncertain,
            count: 5,
            known_bytes: Some(5),
        },
        SupportOmissionV1 {
            source: SupportEvidenceSourceV1::Package,
            reason: SupportOmissionReasonV1::PackageCap,
            count: 6,
            known_bytes: Some(6),
        },
    ];
    snapshot.manifest.truncations = [
        (
            SupportEvidenceSourceV1::Collector,
            SupportTruncationReasonV1::SourceTail,
        ),
        (
            SupportEvidenceSourceV1::Renderer,
            SupportTruncationReasonV1::FieldBytes,
        ),
        (
            SupportEvidenceSourceV1::Tauri,
            SupportTruncationReasonV1::ContainerItems,
        ),
        (
            SupportEvidenceSourceV1::Anyharness,
            SupportTruncationReasonV1::SessionEvents,
        ),
        (
            SupportEvidenceSourceV1::DesktopWorker,
            SupportTruncationReasonV1::RawNotifications,
        ),
        (
            SupportEvidenceSourceV1::SessionLedger,
            SupportTruncationReasonV1::ComponentBytes,
        ),
        (
            SupportEvidenceSourceV1::Package,
            SupportTruncationReasonV1::PackageBytes,
        ),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (source, reason))| SupportTruncationV1 {
        source,
        reason,
        count: index as u64 + 1,
        omitted_bytes: Some(index as u64 + 10),
    })
    .collect();
    let scrubbed = &mut snapshot.manifest.scrubbed_by_class;
    scrubbed.authorization = 1;
    scrubbed.cookie = 2;
    scrubbed.access_token = 3;
    scrubbed.refresh_token = 4;
    scrubbed.identity_token = 5;
    scrubbed.api_key = 6;
    scrubbed.client_secret = 7;
    scrubbed.password = 8;
    scrubbed.private_key = 9;
    scrubbed.credential_container = 10;
    scrubbed.environment_secret = 11;
    scrubbed.signed_url = 12;
    scrubbed.provider_credential = 13;
    scrubbed.opaque_credential = 14;
    scrubbed.url_userinfo = 15;
    snapshot.manifest.degradation.removed_by_tier = [1, 2, 3, 4, 5, 6, 7, 8];

    stabilize_serialized_bytes(&mut snapshot).expect("populated fixed point");
    snapshot
}

#[test]
fn golden_populated_snapshot_serializes_byte_identically() {
    let snapshot = populated_snapshot();
    validate_snapshot(&snapshot).expect("populated snapshot validates");
    assert_eq!(
        serde_json::to_string(&snapshot).expect("serialize"),
        GOLDEN_POPULATED.trim_end()
    );
}

#[test]
fn golden_populated_snapshot_round_trips() {
    let parsed: SupportSnapshotV3 =
        serde_json::from_str(GOLDEN_POPULATED.trim_end()).expect("deserialize golden");
    assert_eq!(parsed, populated_snapshot());
    validate_snapshot(&parsed).expect("populated golden validates");
}
