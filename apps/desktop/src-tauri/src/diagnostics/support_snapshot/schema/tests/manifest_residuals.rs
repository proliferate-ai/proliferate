use super::{no_evidence_skeleton, set_manifest_source, skeleton_manifest, TS};

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportChildComponentV1, SupportEndpointStateV1, SupportLegacySourceKindV1,
    SupportSourceManifestSourceV1, SupportSourceStateV1, SupportUnknownDesktopNativeV1,
};
use crate::diagnostics::support_snapshot::schema::model::common::SupportJsonValueV1;
use crate::diagnostics::support_snapshot::schema::model::evidence::{
    SupportFallbackComponentV1, SupportLegacyLineV1, SupportLegacySourceV1,
    SupportOpaqueFallbackLineV1,
};
use crate::diagnostics::support_snapshot::schema::model::manifest::SupportSourceManifestV1;
use crate::diagnostics::support_snapshot::schema::model::snapshot::SupportSelectionV1;
use crate::diagnostics::support_snapshot::schema::validate::{
    stabilize_serialized_bytes, validate_manifest, validate_snapshot, SupportSchemaError,
};

fn source_with_read_bytes(
    source: SupportSourceManifestSourceV1,
    read_bytes: u64,
) -> SupportSourceManifestV1 {
    SupportSourceManifestV1 {
        source,
        state: SupportSourceStateV1::Omitted,
        captured_at: TS.to_string(),
        read_bytes,
        included_bytes: 0,
        included_items: 0,
    }
}

#[test]
fn logical_file_families_share_the_two_mib_read_cap() {
    let cases = [
        (
            vec![
                source_with_read_bytes(
                    SupportSourceManifestSourceV1::DesktopNativeFallback,
                    1_048_576,
                ),
                source_with_read_bytes(SupportSourceManifestSourceV1::RendererLegacy, 1_048_576),
            ],
            SupportSourceManifestSourceV1::RendererLegacy,
        ),
        (
            vec![
                source_with_read_bytes(
                    SupportSourceManifestSourceV1::AnyharnessFallback,
                    1_048_576,
                ),
                source_with_read_bytes(SupportSourceManifestSourceV1::AnyharnessLegacy, 1_048_576),
            ],
            SupportSourceManifestSourceV1::AnyharnessLegacy,
        ),
        (
            vec![
                source_with_read_bytes(
                    SupportSourceManifestSourceV1::DesktopWorkerFallback,
                    1_000_000,
                ),
                source_with_read_bytes(SupportSourceManifestSourceV1::WorkerLegacyV2, 500_000),
                source_with_read_bytes(SupportSourceManifestSourceV1::WorkerLegacyV1, 597_152),
            ],
            SupportSourceManifestSourceV1::WorkerLegacyV1,
        ),
    ];
    for (family, increment_source) in cases {
        let mut manifest = skeleton_manifest();
        manifest.sources.extend(family);
        manifest.sources.sort_by_key(|source| source.source);
        validate_manifest(&manifest).expect("logical-family equality is allowed");
        manifest
            .sources
            .iter_mut()
            .find(|source| source.source == increment_source)
            .expect("increment source")
            .read_bytes += 1;
        assert_eq!(
            validate_manifest(&manifest),
            Err(SupportSchemaError::CapExceeded(
                "manifest logical-family read bytes"
            )),
            "{increment_source:?}"
        );
    }
}

fn all_file_sections_snapshot() -> super::super::model::snapshot::SupportSnapshotV3 {
    let mut snapshot = no_evidence_skeleton();
    snapshot.fallback_evidence = vec![
        SupportFallbackComponentV1::Pr3DesktopNativeMixed {
            records: Vec::new(),
            opaque_lines: Vec::new(),
        },
        SupportFallbackComponentV1::Pr5Wrapped {
            component: SupportChildComponentV1::Anyharness,
            records: Vec::new(),
            opaque_lines: Vec::new(),
        },
        SupportFallbackComponentV1::Pr5Wrapped {
            component: SupportChildComponentV1::DesktopWorker,
            records: Vec::new(),
            opaque_lines: Vec::new(),
        },
    ];
    snapshot.legacy_evidence = [
        SupportLegacySourceKindV1::RendererDiagnostics,
        SupportLegacySourceKindV1::AnyharnessPrimary,
        SupportLegacySourceKindV1::WorkerPrimaryV2,
        SupportLegacySourceKindV1::WorkerPrimaryV1,
    ]
    .into_iter()
    .map(|source| SupportLegacySourceV1 {
        source,
        lines: Vec::new(),
        semantic_claims: false,
    })
    .collect();
    for source in [
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        SupportSourceManifestSourceV1::AnyharnessFallback,
        SupportSourceManifestSourceV1::DesktopWorkerFallback,
        SupportSourceManifestSourceV1::RendererLegacy,
        SupportSourceManifestSourceV1::AnyharnessLegacy,
        SupportSourceManifestSourceV1::WorkerLegacyV2,
        SupportSourceManifestSourceV1::WorkerLegacyV1,
    ] {
        set_manifest_source(
            &mut snapshot,
            source,
            SupportSourceStateV1::Included,
            0,
            0,
            0,
        );
    }
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    snapshot
}

#[test]
fn every_final_file_section_has_exact_canonical_source_accounting() {
    let snapshot = all_file_sections_snapshot();
    validate_snapshot(&snapshot).expect("all seven fixed file sources map exactly");
    for source in [
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        SupportSourceManifestSourceV1::AnyharnessFallback,
        SupportSourceManifestSourceV1::DesktopWorkerFallback,
        SupportSourceManifestSourceV1::RendererLegacy,
        SupportSourceManifestSourceV1::AnyharnessLegacy,
        SupportSourceManifestSourceV1::WorkerLegacyV2,
        SupportSourceManifestSourceV1::WorkerLegacyV1,
    ] {
        let mut missing = snapshot.clone();
        missing
            .manifest
            .sources
            .retain(|entry| entry.source != source);
        stabilize_serialized_bytes(&mut missing).expect("stabilize");
        assert_eq!(
            validate_snapshot(&missing),
            Err(SupportSchemaError::InvariantViolation(
                "evidence section missing source accounting"
            )),
            "{source:?} missing"
        );

        let mut wrong_items = snapshot.clone();
        wrong_items
            .manifest
            .sources
            .iter_mut()
            .find(|entry| entry.source == source)
            .expect("source")
            .included_items = 1;
        stabilize_serialized_bytes(&mut wrong_items).expect("stabilize");
        assert_eq!(
            validate_snapshot(&wrong_items),
            Err(SupportSchemaError::InvariantViolation(
                "evidence/source state or item accounting"
            )),
            "{source:?} items"
        );

        let mut wrong_state = snapshot.clone();
        wrong_state
            .manifest
            .sources
            .iter_mut()
            .find(|entry| entry.source == source)
            .expect("source")
            .state = SupportSourceStateV1::Missing;
        stabilize_serialized_bytes(&mut wrong_state).expect("stabilize");
        assert_eq!(
            validate_snapshot(&wrong_state),
            Err(SupportSchemaError::InvariantViolation(
                "evidence/source state or item accounting"
            )),
            "{source:?} state"
        );
    }

    let mut impossible_bytes = snapshot;
    let source = impossible_bytes
        .manifest
        .sources
        .iter_mut()
        .find(|entry| entry.source == SupportSourceManifestSourceV1::RendererLegacy)
        .expect("renderer source");
    source.read_bytes = 1;
    source.included_bytes = 1;
    stabilize_serialized_bytes(&mut impossible_bytes).expect("stabilize");
    assert_eq!(
        validate_snapshot(&impossible_bytes),
        Err(SupportSchemaError::InvariantViolation(
            "evidence/source included-byte presence"
        ))
    );

    let mut spurious_included = no_evidence_skeleton();
    set_manifest_source(
        &mut spurious_included,
        SupportSourceManifestSourceV1::RendererLegacy,
        SupportSourceStateV1::Included,
        0,
        0,
        0,
    );
    stabilize_serialized_bytes(&mut spurious_included).expect("stabilize");
    assert_eq!(
        validate_snapshot(&spurious_included),
        Err(SupportSchemaError::InvariantViolation(
            "included source missing final evidence section"
        ))
    );
}

#[test]
fn collector_and_session_sections_preserve_defined_byte_counters() {
    let mut missing_collector = super::protocol_tests::completed_snapshot();
    missing_collector
        .manifest
        .sources
        .retain(|source| source.source != SupportSourceManifestSourceV1::Collector);
    stabilize_serialized_bytes(&mut missing_collector).expect("stabilize");
    assert_eq!(
        validate_snapshot(&missing_collector),
        Err(SupportSchemaError::InvariantViolation(
            "evidence section missing source accounting"
        ))
    );

    let mut collector = super::protocol_tests::completed_snapshot();
    collector
        .manifest
        .sources
        .iter_mut()
        .find(|source| source.source == SupportSourceManifestSourceV1::Collector)
        .expect("collector source")
        .included_bytes -= 1;
    stabilize_serialized_bytes(&mut collector).expect("stabilize");
    assert_eq!(
        validate_snapshot(&collector),
        Err(SupportSchemaError::InvariantViolation(
            "collector full-prefix byte accounting"
        ))
    );

    let mut wrong_collector_items = super::protocol_tests::completed_snapshot();
    wrong_collector_items
        .manifest
        .sources
        .iter_mut()
        .find(|source| source.source == SupportSourceManifestSourceV1::Collector)
        .expect("collector source")
        .included_items = 2;
    stabilize_serialized_bytes(&mut wrong_collector_items).expect("stabilize");
    assert_eq!(
        validate_snapshot(&wrong_collector_items),
        Err(SupportSchemaError::InvariantViolation(
            "collector source accounting"
        ))
    );

    let mut wrong_collector_state = super::protocol_tests::completed_snapshot();
    let source = wrong_collector_state
        .manifest
        .sources
        .iter_mut()
        .find(|source| source.source == SupportSourceManifestSourceV1::Collector)
        .expect("collector source");
    source.state = SupportSourceStateV1::Omitted;
    source.included_bytes = 0;
    source.included_items = 0;
    stabilize_serialized_bytes(&mut wrong_collector_state).expect("stabilize");
    assert_eq!(
        validate_snapshot(&wrong_collector_state),
        Err(SupportSchemaError::InvariantViolation(
            "collector source accounting"
        ))
    );

    let mut wrong_session_items = no_evidence_skeleton();
    super::evidence_tests::bind_recent_ledger(&mut wrong_session_items, Vec::new());
    wrong_session_items
        .manifest
        .sources
        .iter_mut()
        .find(|source| source.source == SupportSourceManifestSourceV1::SessionLedger)
        .expect("session source")
        .included_items = 1;
    stabilize_serialized_bytes(&mut wrong_session_items).expect("stabilize");
    assert_eq!(
        validate_snapshot(&wrong_session_items),
        Err(SupportSchemaError::InvariantViolation(
            "evidence/source state or item accounting"
        ))
    );

    let mut wrong_session_state = no_evidence_skeleton();
    super::evidence_tests::bind_recent_ledger(&mut wrong_session_state, Vec::new());
    wrong_session_state
        .manifest
        .sources
        .iter_mut()
        .find(|source| source.source == SupportSourceManifestSourceV1::SessionLedger)
        .expect("session source")
        .state = SupportSourceStateV1::Omitted;
    stabilize_serialized_bytes(&mut wrong_session_state).expect("stabilize");
    assert_eq!(
        validate_snapshot(&wrong_session_state),
        Err(SupportSchemaError::InvariantViolation(
            "evidence/source state or item accounting"
        ))
    );

    for (kind, expected) in [
        (0, "session summary included-byte accounting"),
        (1, "session event included-byte accounting"),
        (2, "session raw-notification included-byte accounting"),
    ] {
        let mut session = super::evidence_tests::session("session-1");
        let item =
            SupportJsonValueV1::Object(vec![("seq".to_string(), SupportJsonValueV1::Integer(1))]);
        match kind {
            0 => {
                session.summary = Some(SupportJsonValueV1::Null);
                session.endpoint_states.summary = SupportEndpointStateV1::Included;
            }
            1 => {
                session.normalized_events = vec![item];
                session.endpoint_states.events = SupportEndpointStateV1::Included;
            }
            2 => {
                session.raw_notifications = vec![item];
                session.endpoint_states.raw_notifications = SupportEndpointStateV1::Included;
            }
            _ => unreachable!(),
        }
        let mut snapshot = no_evidence_skeleton();
        super::evidence_tests::bind_recent_ledger(&mut snapshot, vec![session]);
        set_manifest_source(
            &mut snapshot,
            SupportSourceManifestSourceV1::SessionLedger,
            SupportSourceStateV1::Included,
            1,
            0,
            1,
        );
        stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
        assert_eq!(
            validate_snapshot(&snapshot),
            Err(SupportSchemaError::InvariantViolation(expected))
        );

        let mut missing_source = snapshot;
        missing_source
            .manifest
            .sources
            .retain(|source| source.source != SupportSourceManifestSourceV1::SessionLedger);
        stabilize_serialized_bytes(&mut missing_source).expect("stabilize");
        assert_eq!(
            validate_snapshot(&missing_source),
            Err(SupportSchemaError::InvariantViolation(
                "evidence section missing source accounting"
            ))
        );
    }
}

#[test]
fn worker_legacy_sources_accept_only_the_unrotated_segment() {
    for source in [
        SupportLegacySourceKindV1::WorkerPrimaryV2,
        SupportLegacySourceKindV1::WorkerPrimaryV1,
    ] {
        let mut snapshot = no_evidence_skeleton();
        snapshot.legacy_evidence = vec![SupportLegacySourceV1 {
            source,
            lines: vec![SupportLegacyLineV1 {
                segment: 0,
                line: 1,
                value: "worker".to_string(),
            }],
            semantic_claims: false,
        }];
        let manifest_source = match source {
            SupportLegacySourceKindV1::WorkerPrimaryV2 => {
                SupportSourceManifestSourceV1::WorkerLegacyV2
            }
            SupportLegacySourceKindV1::WorkerPrimaryV1 => {
                SupportSourceManifestSourceV1::WorkerLegacyV1
            }
            _ => unreachable!(),
        };
        set_manifest_source(
            &mut snapshot,
            manifest_source,
            SupportSourceStateV1::Included,
            1,
            1,
            1,
        );
        stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
        validate_snapshot(&snapshot).expect("worker segment zero");

        snapshot.legacy_evidence[0].lines[0].segment = 1;
        stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
        assert_eq!(
            validate_snapshot(&snapshot),
            Err(SupportSchemaError::CapExceeded("legacy segment")),
            "{source:?}"
        );
    }

    for source in [
        SupportLegacySourceKindV1::RendererDiagnostics,
        SupportLegacySourceKindV1::AnyharnessPrimary,
    ] {
        let mut snapshot = no_evidence_skeleton();
        snapshot.legacy_evidence = vec![SupportLegacySourceV1 {
            source,
            lines: vec![SupportLegacyLineV1 {
                segment: 5,
                line: 1,
                value: "oldest".to_string(),
            }],
            semantic_claims: false,
        }];
        let manifest_source = match source {
            SupportLegacySourceKindV1::RendererDiagnostics => {
                SupportSourceManifestSourceV1::RendererLegacy
            }
            SupportLegacySourceKindV1::AnyharnessPrimary => {
                SupportSourceManifestSourceV1::AnyharnessLegacy
            }
            _ => unreachable!(),
        };
        set_manifest_source(
            &mut snapshot,
            manifest_source,
            SupportSourceStateV1::Included,
            1,
            1,
            1,
        );
        stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
        validate_snapshot(&snapshot).expect("six-segment compatibility family");
    }
}

#[test]
fn opaque_fallback_source_accounting_counts_records_and_lines() {
    let mut snapshot = no_evidence_skeleton();
    snapshot.fallback_evidence = vec![SupportFallbackComponentV1::Pr3DesktopNativeMixed {
        records: Vec::new(),
        opaque_lines: vec![SupportOpaqueFallbackLineV1 {
            component: SupportUnknownDesktopNativeV1::UnknownDesktopNative,
            value: SupportJsonValueV1::Null,
            segment: 0,
            line: 1,
            semantic_claims: false,
        }],
    }];
    set_manifest_source(
        &mut snapshot,
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        SupportSourceStateV1::Included,
        1,
        1,
        1,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("opaque line is one included item");
}

#[test]
fn negative_fixtures_cover_id_source_and_manifest_caps() {
    let selection: SupportSelectionV1 =
        serde_json::from_str(include_str!("../fixtures/negative_oversized_id.json"))
            .expect("negative selection shape");
    let mut snapshot = no_evidence_skeleton();
    snapshot.selection = selection;
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::OversizedId)
    );

    let oversized_source: SupportSourceManifestV1 =
        serde_json::from_str(include_str!("../fixtures/negative_source_byte_cap.json"))
            .expect("negative source shape");
    let mut manifest = skeleton_manifest();
    manifest.sources = vec![oversized_source];
    assert_eq!(
        validate_manifest(&manifest),
        Err(SupportSchemaError::CapExceeded("manifest source bytes"))
    );

    let too_many_sources: Vec<SupportSourceManifestV1> = serde_json::from_str(include_str!(
        "../fixtures/negative_manifest_source_cap.json"
    ))
    .expect("negative source-list shape");
    let mut manifest = skeleton_manifest();
    manifest.sources = too_many_sources;
    assert_eq!(
        validate_manifest(&manifest),
        Err(SupportSchemaError::CapExceeded("manifest.sources"))
    );
}
