//! Golden and negative coverage for the schema-3 support snapshot model.

use proliferate_diagnostics_protocol::v1::types::{GapReasonV1, GapV1};

use super::enums::{
    SupportChildOmissionReasonV1, SupportCollectorCompletenessV1, SupportCollectorStatusV1,
    SupportConsentDisclosureVersionV1, SupportCoverageSelectionV1, SupportEvidenceSourceV1,
    SupportOmissionReasonV1, SupportProducerStatusUnavailableV1, SupportSessionOmissionReasonV1,
    SupportSessionSelectionV1, SupportSourceManifestSourceV1, SupportSourceStateV1,
    SupportTruncationReasonV1,
};
use super::limits::{MAX_SAFE_INTEGER, SESSIONS};
use super::model::common::{SupportJsonValueV1, SupportOmissionV1, SupportTruncationV1};
use super::model::evidence::{
    SupportCollectorCoverageV1, SupportCollectorEvidenceV1, SupportOpaqueFallbackLineV1,
    SupportSessionEndpointStatesV1, SupportSessionLedgerV1, SupportSessionV1,
};
use super::model::health::{
    SupportChildProducerStatusV1, SupportLossCountsV1, SupportOmittedProducerStatusV1,
    SupportProducerHealthV1, SupportTauriProducerHealthV1,
};
use super::model::manifest::{
    SupportAdditionalEntriesV1, SupportDegradationV1, SupportSecretScrubCountsV1,
    SupportSessionCollectionManifestV1, SupportSnapshotLimitsV1, SupportSnapshotManifestV1,
    SupportSourceManifestV1,
};
use super::model::snapshot::{
    SupportAppV1, SupportConsentV1, SupportSelectionV1, SupportSnapshotV3,
};
use super::validate::{
    stabilize_serialized_bytes, validate_content_string, validate_id, validate_manifest,
    validate_snapshot, validate_timestamp, SupportSchemaError,
};

const GOLDEN_SKELETON: &str = include_str!("fixtures/golden_no_evidence_skeleton.json");
pub(super) const TS: &str = "2026-08-12T00:00:00Z";
pub(super) const WINDOW_START: &str = "2026-08-11T23:45:00Z";

pub(super) fn empty_coverage() -> SupportCollectorCoverageV1 {
    SupportCollectorCoverageV1 {
        status: SupportCollectorStatusV1::Unavailable,
        completeness: SupportCollectorCompletenessV1::Unknown,
        limit_uncertain: false,
        request_record_limit: 10_000,
        request_byte_limit: 16_777_216,
        returned_records: 0,
        returned_record_bytes: 0,
        cursor_start: None,
        cursor_end: None,
        health_oldest_cursor: None,
        health_newest_cursor: None,
        selection: SupportCoverageSelectionV1::OldestMatchingRetainedPrefix,
        newest_edge_claimed: false,
    }
}

pub(super) fn skeleton_manifest() -> SupportSnapshotManifestV1 {
    SupportSnapshotManifestV1 {
        schema_version: 1,
        generated_at: TS.to_string(),
        serialized_bytes: 0,
        limits: SupportSnapshotLimitsV1::fixed(),
        collector: empty_coverage(),
        sources: vec![
            SupportSourceManifestV1 {
                source: SupportSourceManifestSourceV1::Collector,
                state: SupportSourceStateV1::Omitted,
                captured_at: TS.to_string(),
                read_bytes: 0,
                included_bytes: 0,
                included_items: 0,
            },
            SupportSourceManifestV1 {
                source: SupportSourceManifestSourceV1::SessionLedger,
                state: SupportSourceStateV1::Omitted,
                captured_at: TS.to_string(),
                read_bytes: 0,
                included_bytes: 0,
                included_items: 0,
            },
        ],
        session_collection: SupportSessionCollectionManifestV1::Omitted {
            reason: SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
        },
        gaps: Vec::new(),
        omissions: Vec::new(),
        truncations: Vec::new(),
        scrubbed_by_class: SupportSecretScrubCountsV1::default(),
        degradation: SupportDegradationV1 {
            policy_version: 1,
            removed_by_tier: [0; 8],
        },
        additional_entries: SupportAdditionalEntriesV1 {
            gaps: 0,
            omissions: 0,
            truncations: 0,
        },
    }
}

pub(super) fn set_manifest_source(
    snapshot: &mut SupportSnapshotV3,
    source: SupportSourceManifestSourceV1,
    state: SupportSourceStateV1,
    read_bytes: u64,
    included_bytes: u64,
    included_items: u64,
) {
    let entry = SupportSourceManifestV1 {
        source,
        state,
        captured_at: TS.to_string(),
        read_bytes,
        included_bytes,
        included_items,
    };
    match snapshot
        .manifest
        .sources
        .binary_search_by_key(&source, |candidate| candidate.source)
    {
        Ok(index) => snapshot.manifest.sources[index] = entry,
        Err(index) => snapshot.manifest.sources.insert(index, entry),
    }
}

pub(super) fn no_evidence_skeleton() -> SupportSnapshotV3 {
    let mut snapshot = SupportSnapshotV3 {
        schema_version: 3,
        snapshot_id: "support-snapshot-fixture-0001".to_string(),
        generated_at: TS.to_string(),
        app: SupportAppV1 {
            version: "0.0.0".to_string(),
            release: "0.0.0".to_string(),
            platform: "darwin-aarch64".to_string(),
            runtime_version: None,
            runtime_status: None,
        },
        consent: SupportConsentV1 {
            disclosure_version:
                SupportConsentDisclosureVersionV1::DesktopSupportSnapshotCustomerContentV1,
            granted_at: TS.to_string(),
            selection: SupportSessionSelectionV1::RecentActivity,
        },
        selection: SupportSelectionV1 {
            report_opened_at: TS.to_string(),
            source_time_from: WINDOW_START.to_string(),
            source_time_to: TS.to_string(),
            workspace_id: None,
            anyharness_workspace_id: None,
            ui_session_id: None,
            materialized_session_id: None,
        },
        collector: SupportCollectorEvidenceV1 {
            captured_at: TS.to_string(),
            desktop_health: None,
            coverage: empty_coverage(),
            export_manifest: None,
            export_health: None,
            gaps: Vec::new(),
        },
        producer_health: SupportProducerHealthV1 {
            renderer: SupportOmittedProducerStatusV1::default(),
            tauri: SupportTauriProducerHealthV1::Omitted {
                reason: SupportProducerStatusUnavailableV1::ProducerStatusUnavailable,
            },
            anyharness: SupportChildProducerStatusV1::Omitted {
                captured_at: TS.to_string(),
                reason: SupportChildOmissionReasonV1::ChildMissing,
            },
            desktop_worker: SupportChildProducerStatusV1::Omitted {
                captured_at: TS.to_string(),
                reason: SupportChildOmissionReasonV1::ChildMissing,
            },
        },
        records: Vec::new(),
        fallback_evidence: Vec::new(),
        legacy_evidence: Vec::new(),
        session_ledger: None,
        manifest: skeleton_manifest(),
    };
    snapshot.manifest.omissions.push(SupportOmissionV1 {
        source: SupportEvidenceSourceV1::Collector,
        reason: SupportOmissionReasonV1::CollectorUnavailable,
        count: 1,
        known_bytes: None,
    });
    stabilize_serialized_bytes(&mut snapshot).expect("skeleton byte fixed point");
    snapshot
}

#[test]
fn golden_no_evidence_skeleton_serializes_byte_identically() {
    let skeleton = no_evidence_skeleton();
    validate_snapshot(&skeleton).expect("skeleton must validate");
    let serialized = serde_json::to_string(&skeleton).expect("serialize");
    assert_eq!(serialized, GOLDEN_SKELETON.trim_end());
}

#[test]
fn golden_no_evidence_skeleton_round_trips() {
    let parsed: SupportSnapshotV3 =
        serde_json::from_str(GOLDEN_SKELETON.trim_end()).expect("deserialize golden");
    assert_eq!(parsed, no_evidence_skeleton());
    validate_snapshot(&parsed).expect("golden must validate");
}

#[test]
fn optional_fields_omit_when_absent_and_never_serialize_null() {
    let serialized = serde_json::to_string(&no_evidence_skeleton()).expect("serialize");
    for absent in ["sessionLedger", "exportManifest", "exportHealth"] {
        assert!(!serialized.contains(absent), "{absent} must be omitted");
    }
    // Nullable (non-optional) fields DO serialize null.
    assert!(serialized.contains("\"desktopHealth\":null"));
    assert!(serialized.contains("\"runtimeVersion\":null"));
}

#[test]
fn artifact_carries_no_identity_or_capability_fields() {
    for forbidden in [
        "email",
        "hostname",
        "username",
        "deviceId",
        "installId",
        "tenant",
        "reportId",
        "clientJobId",
        "presigned",
        "permit",
        "authorizationId",
        "keychain",
        "stagingPath",
        "environmentMap",
        "capability",
        "endpoint",
    ] {
        assert!(
            !GOLDEN_SKELETON.contains(forbidden),
            "forbidden field {forbidden} present"
        );
    }
}

#[test]
fn loss_counts_serialize_all_fourteen_keys_in_enum_order() {
    let serialized = serde_json::to_string(&SupportLossCountsV1::default()).expect("serialize");
    assert_eq!(
        serialized,
        "{\"queue_records\":0,\"queue_bytes\":0,\"protected_eviction\":0,\"pressure\":0,\
         \"generation_changed\":0,\"transport_timeout\":0,\"transport_failure\":0,\
         \"receipt_invalid\":0,\"receipt_rejected\":0,\"fallback_overflow\":0,\
         \"fallback_write_failed\":0,\"shutdown_timeout\":0,\"filter_invalid\":0,\
         \"sequence_exhausted\":0}"
    );
}

#[test]
fn negative_fixtures_fail_to_deserialize() {
    assert!(serde_json::from_str::<SupportOmissionV1>(include_str!(
        "fixtures/negative_negative_count.json"
    ))
    .is_err());
    assert!(serde_json::from_str::<SupportOmissionV1>(include_str!(
        "fixtures/negative_unknown_enum_literal.json"
    ))
    .is_err());
    assert!(serde_json::from_str::<SupportOmissionV1>(include_str!(
        "fixtures/negative_unknown_field.json"
    ))
    .is_err());
    assert!(
        serde_json::from_str::<SupportOpaqueFallbackLineV1>(include_str!(
            "fixtures/negative_nonfinite_number.json"
        ))
        .is_err()
    );
    assert!(
        serde_json::from_str::<SupportOpaqueFallbackLineV1>(include_str!(
            "fixtures/negative_unsafe_integer.json"
        ))
        .is_err()
    );
}

#[test]
fn id_and_string_bounds_hold_at_and_over_the_edge() {
    assert!(validate_id(&"a".repeat(128)).is_ok());
    assert_eq!(
        validate_id(&"a".repeat(129)),
        Err(SupportSchemaError::OversizedId)
    );
    assert_eq!(validate_id(""), Err(SupportSchemaError::OversizedId));
    assert!(validate_content_string(&"b".repeat(16_384)).is_ok());
    assert_eq!(
        validate_content_string(&"b".repeat(16_385)),
        Err(SupportSchemaError::OversizedContentString)
    );
}

#[test]
fn timestamps_must_be_rfc3339_utc() {
    assert!(validate_timestamp("2026-08-12T00:00:00Z").is_ok());
    assert!(validate_timestamp("2026-08-12T00:00:00.123Z").is_ok());
    for bad in [
        "2026-08-12 00:00:00Z",
        "2026-08-12T00:00:00",
        "2026-08-12T00:00:00+02:00",
        "not-a-time",
        "2026-08-12T00:00:00.Z",
    ] {
        assert_eq!(
            validate_timestamp(bad),
            Err(SupportSchemaError::InvalidTimestamp),
            "{bad} must be rejected"
        );
    }
}

#[test]
fn projected_json_values_enforce_scrub_bounds() {
    let at_depth = (0..16).fold(serde_json::json!(null), |inner, _| {
        serde_json::json!([inner])
    });
    assert!(SupportJsonValueV1::try_from_json(&at_depth).is_ok());
    let too_deep = (0..17).fold(serde_json::json!(null), |inner, _| {
        serde_json::json!([inner])
    });
    assert_eq!(
        SupportJsonValueV1::try_from_json(&too_deep),
        Err(SupportSchemaError::TooDeep)
    );

    let wide = serde_json::Value::Array(vec![serde_json::json!(0); 257]);
    assert_eq!(
        SupportJsonValueV1::try_from_json(&wide),
        Err(SupportSchemaError::TooManyItems)
    );
    let at_cap = serde_json::Value::Array(vec![serde_json::json!(0); 256]);
    assert!(SupportJsonValueV1::try_from_json(&at_cap).is_ok());

    let unsafe_integer = serde_json::json!(MAX_SAFE_INTEGER + 1);
    assert_eq!(
        SupportJsonValueV1::try_from_json(&unsafe_integer),
        Err(SupportSchemaError::UnsafeInteger)
    );
    assert!(SupportJsonValueV1::try_from_json(&serde_json::json!(MAX_SAFE_INTEGER)).is_ok());
}

#[path = "tests/aggregate.rs"]
mod aggregate_tests;
#[path = "tests/evidence.rs"]
mod evidence_tests;
#[path = "tests/gap_prefix.rs"]
mod gap_prefix_tests;
#[path = "tests/literals.rs"]
mod literal_tests;
#[path = "tests/manifest_residuals.rs"]
mod manifest_residual_tests;
#[path = "tests/populated_golden.rs"]
mod populated_golden_tests;
#[path = "tests/protocol.rs"]
mod protocol_tests;
#[path = "tests/protocol_timestamps.rs"]
mod protocol_timestamp_tests;
#[path = "tests/residuals.rs"]
mod residual_tests;
#[path = "tests/unions.rs"]
mod union_tests;

fn manifest_gap() -> GapV1 {
    GapV1 {
        reason: GapReasonV1::Evicted,
        from_cursor: None,
        to_cursor: None,
        component: None,
        producer_boot_id: None,
        missing_sequence_from: None,
        missing_sequence_to: None,
        dropped_records: 1,
    }
}

fn manifest_source() -> SupportSourceManifestV1 {
    SupportSourceManifestV1 {
        source: SupportSourceManifestSourceV1::Collector,
        state: SupportSourceStateV1::Omitted,
        captured_at: TS.to_string(),
        read_bytes: 0,
        included_bytes: 0,
        included_items: 0,
    }
}

#[test]
fn manifest_collections_enforce_fixed_caps() {
    let omission = SupportOmissionV1 {
        source: SupportEvidenceSourceV1::Collector,
        reason: SupportOmissionReasonV1::RecordLimit,
        count: 1,
        known_bytes: None,
    };
    let truncation = SupportTruncationV1 {
        source: SupportEvidenceSourceV1::Package,
        reason: SupportTruncationReasonV1::PackageBytes,
        count: 1,
        omitted_bytes: None,
    };

    let mut at_cap = skeleton_manifest();
    at_cap.sources = [
        SupportSourceManifestSourceV1::Collector,
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        SupportSourceManifestSourceV1::AnyharnessFallback,
        SupportSourceManifestSourceV1::DesktopWorkerFallback,
        SupportSourceManifestSourceV1::RendererLegacy,
        SupportSourceManifestSourceV1::AnyharnessLegacy,
        SupportSourceManifestSourceV1::WorkerLegacyV2,
        SupportSourceManifestSourceV1::WorkerLegacyV1,
        SupportSourceManifestSourceV1::SessionLedger,
    ]
    .into_iter()
    .map(|source| SupportSourceManifestV1 {
        source,
        ..manifest_source()
    })
    .collect();
    at_cap.gaps = vec![manifest_gap(); 128];
    validate_manifest(&at_cap).expect("caps are inclusive");

    let mut over_sources = skeleton_manifest();
    over_sources.sources = vec![manifest_source(); 10];
    assert_eq!(
        validate_manifest(&over_sources),
        Err(SupportSchemaError::CapExceeded("manifest.sources"))
    );
    let mut over_gaps = skeleton_manifest();
    over_gaps.gaps = vec![manifest_gap(); 129];
    assert_eq!(
        validate_manifest(&over_gaps),
        Err(SupportSchemaError::CapExceeded("manifest.gaps"))
    );
    let mut over_omissions = skeleton_manifest();
    over_omissions.omissions = vec![omission; 65];
    assert_eq!(
        validate_manifest(&over_omissions),
        Err(SupportSchemaError::CapExceeded("manifest.omissions"))
    );
    let mut over_truncations = skeleton_manifest();
    over_truncations.truncations = vec![truncation; 65];
    assert_eq!(
        validate_manifest(&over_truncations),
        Err(SupportSchemaError::CapExceeded("manifest.truncations"))
    );
}

#[test]
fn session_ledger_enforces_session_cap() {
    let session = SupportSessionV1 {
        session_id: "session-1".to_string(),
        summary_captured_at: TS.to_string(),
        summary: None,
        normalized_events: Vec::new(),
        raw_notifications: Vec::new(),
        endpoint_states: SupportSessionEndpointStatesV1 {
            summary: super::enums::SupportEndpointStateV1::Omitted,
            events: super::enums::SupportEndpointStateV1::Omitted,
            raw_notifications: super::enums::SupportEndpointStateV1::Omitted,
            live_config: super::enums::SupportLiveConfigStateV1::NotCollected,
        },
    };
    let mut snapshot = no_evidence_skeleton();
    snapshot.selection.workspace_id = Some("ws-1".to_string());
    snapshot.selection.anyharness_workspace_id = Some("ahws-1".to_string());
    snapshot.session_ledger = Some(SupportSessionLedgerV1 {
        workspace_id: "ws-1".to_string(),
        anyharness_workspace_id: "ahws-1".to_string(),
        selection: SupportSessionSelectionV1::RecentActivity,
        sessions: (1..=SESSIONS)
            .map(|index| SupportSessionV1 {
                session_id: format!("session-{index}"),
                ..session.clone()
            })
            .collect(),
    });
    snapshot.manifest.session_collection = SupportSessionCollectionManifestV1::Included {
        workspace_id: "ws-1".to_string(),
        anyharness_workspace_id: "ahws-1".to_string(),
        selected_sessions: SESSIONS,
        session_included_bytes: 0,
        event_included_bytes: 0,
        raw_notification_included_bytes: 0,
        limit_uncertain_endpoints: 0,
    };
    set_manifest_source(
        &mut snapshot,
        SupportSourceManifestSourceV1::SessionLedger,
        SupportSourceStateV1::Included,
        0,
        0,
        SESSIONS,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize session snapshot");
    validate_snapshot(&snapshot).expect("three sessions are allowed");

    snapshot
        .session_ledger
        .as_mut()
        .expect("ledger present")
        .sessions
        .push(session);
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::CapExceeded("sessionLedger.sessions"))
    );
}

#[test]
fn pinned_literals_are_enforced() {
    let mut wrong_schema = no_evidence_skeleton();
    wrong_schema.schema_version = 2;
    assert_eq!(
        validate_snapshot(&wrong_schema),
        Err(SupportSchemaError::PinnedLiteralMismatch(
            "snapshot.schemaVersion"
        ))
    );

    let mut wrong_record_limit = no_evidence_skeleton();
    wrong_record_limit.collector.coverage.request_record_limit = 9_999;
    assert_eq!(
        validate_snapshot(&wrong_record_limit),
        Err(SupportSchemaError::PinnedLiteralMismatch(
            "coverage.requestRecordLimit"
        ))
    );

    let mut claims_newest = no_evidence_skeleton();
    claims_newest.collector.coverage.newest_edge_claimed = true;
    assert_eq!(
        validate_snapshot(&claims_newest),
        Err(SupportSchemaError::PinnedLiteralMismatch(
            "coverage.newestEdgeClaimed"
        ))
    );

    let mut wrong_limits = no_evidence_skeleton();
    wrong_limits.manifest.limits.package_bytes = 1;
    assert_eq!(
        validate_snapshot(&wrong_limits),
        Err(SupportSchemaError::PinnedLiteralMismatch("manifest.limits"))
    );

    let mut wrong_policy = no_evidence_skeleton();
    wrong_policy.manifest.degradation.policy_version = 2;
    assert_eq!(
        validate_snapshot(&wrong_policy),
        Err(SupportSchemaError::PinnedLiteralMismatch(
            "degradation.policyVersion"
        ))
    );
}
