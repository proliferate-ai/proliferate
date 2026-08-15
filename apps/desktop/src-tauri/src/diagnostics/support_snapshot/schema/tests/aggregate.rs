use super::{no_evidence_skeleton, set_manifest_source, skeleton_manifest, TS};

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportEndpointStateV1, SupportLiveConfigStateV1, SupportSessionSelectionV1,
    SupportSourceManifestSourceV1, SupportSourceStateV1,
};
use crate::diagnostics::support_snapshot::schema::model::evidence::{
    SupportSessionEndpointStatesV1, SupportSessionLedgerV1, SupportSessionV1,
};
use crate::diagnostics::support_snapshot::schema::model::manifest::{
    SupportSessionCollectionManifestV1, SupportSourceManifestV1,
};
use crate::diagnostics::support_snapshot::schema::validate::{
    serialized_snapshot_bytes, stabilize_serialized_bytes, validate_manifest, validate_snapshot,
    validate_timestamp, SupportSchemaError,
};

#[test]
fn timestamps_are_real_rfc3339_instants_in_literal_utc() {
    for valid in ["2024-02-29T23:59:59Z", "2026-08-12T00:00:00.123456789Z"] {
        validate_timestamp(valid).expect(valid);
    }
    for invalid in [
        "2023-02-29T00:00:00Z",
        "2026-13-01T00:00:00Z",
        "2026-08-12T24:00:00Z",
        "2026-08-12T00:60:00Z",
        "2026-08-12T00:00:60Z",
        "2026-08-12T00:00:00+00:00",
        "2026-08-12T00:00:00z",
    ] {
        assert_eq!(
            validate_timestamp(invalid),
            Err(SupportSchemaError::InvalidTimestamp),
            "{invalid}"
        );
    }
}

#[test]
fn snapshot_requires_the_exact_fifteen_minute_capture_window() {
    let mut snapshot = no_evidence_skeleton();
    snapshot.selection.source_time_from = "2026-08-11T23:45:01Z".to_string();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "selection exact fifteen-minute window"
        ))
    );

    let mut reversed = no_evidence_skeleton();
    reversed.selection.source_time_from = "2026-08-12T00:15:00Z".to_string();
    stabilize_serialized_bytes(&mut reversed).expect("stabilize");
    assert_eq!(
        validate_snapshot(&reversed),
        Err(SupportSchemaError::InvariantViolation(
            "selection exact fifteen-minute window"
        ))
    );
}

#[test]
fn manifest_serialized_bytes_is_an_exact_stable_fixed_point() {
    let mut snapshot = no_evidence_skeleton();
    let exact = serialized_snapshot_bytes(&snapshot).expect("encode");
    assert_eq!(snapshot.manifest.serialized_bytes, exact);
    validate_snapshot(&snapshot).expect("fixed point validates");

    snapshot.manifest.serialized_bytes -= 1;
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "manifest.serializedBytes fixed point"
        ))
    );
    assert_eq!(
        stabilize_serialized_bytes(&mut snapshot).expect("restabilize"),
        serialized_snapshot_bytes(&snapshot).expect("encode")
    );
}

#[test]
fn optional_runtime_strings_and_all_scrub_counters_are_traversed() {
    let mut snapshot = no_evidence_skeleton();
    snapshot.app.runtime_version = Some("v".repeat(4_097));
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::OversizedGenericString)
    );

    let mut snapshot = no_evidence_skeleton();
    snapshot.manifest.scrubbed_by_class.url_userinfo =
        crate::diagnostics::support_snapshot::schema::limits::MAX_SAFE_INTEGER + 1;
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::UnsafeInteger)
    );
}

#[test]
fn duplicated_or_unordered_manifest_aggregates_are_rejected() {
    let mut manifest = skeleton_manifest();
    let source = SupportSourceManifestV1 {
        source: SupportSourceManifestSourceV1::Collector,
        state: SupportSourceStateV1::Omitted,
        captured_at: TS.to_string(),
        read_bytes: 0,
        included_bytes: 0,
        included_items: 0,
    };
    manifest.sources = vec![source.clone(), source];
    assert_eq!(
        validate_manifest(&manifest),
        Err(SupportSchemaError::InvariantViolation(
            "manifest source order/uniqueness"
        ))
    );

    let mut snapshot = no_evidence_skeleton();
    snapshot
        .manifest
        .omissions
        .push(snapshot.manifest.omissions[0].clone());
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "manifest omission order/aggregation"
        ))
    );
}

#[test]
fn source_and_session_manifest_byte_accounting_is_bounded_and_truthful() {
    let mut manifest = skeleton_manifest();
    manifest.sources = vec![SupportSourceManifestV1 {
        source: SupportSourceManifestSourceV1::RendererLegacy,
        state: SupportSourceStateV1::Missing,
        captured_at: TS.to_string(),
        read_bytes: 10,
        included_bytes: 1,
        included_items: 1,
    }];
    assert_eq!(
        validate_manifest(&manifest),
        Err(SupportSchemaError::InvariantViolation(
            "non-included source carries included evidence"
        ))
    );

    let mut manifest = skeleton_manifest();
    manifest.session_collection = SupportSessionCollectionManifestV1::Included {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selected_sessions: 0,
        session_included_bytes: 1,
        event_included_bytes: 0,
        raw_notification_included_bytes: 0,
        limit_uncertain_endpoints: 0,
    };
    assert_eq!(
        validate_manifest(&manifest),
        Err(SupportSchemaError::InvariantViolation(
            "empty sessionCollection accounting"
        ))
    );
}

fn active_session() -> SupportSessionV1 {
    SupportSessionV1 {
        session_id: "materialized-session-1".to_string(),
        summary_captured_at: TS.to_string(),
        summary: None,
        normalized_events: Vec::new(),
        raw_notifications: Vec::new(),
        endpoint_states: SupportSessionEndpointStatesV1 {
            summary: SupportEndpointStateV1::Omitted,
            events: SupportEndpointStateV1::Omitted,
            raw_notifications: SupportEndpointStateV1::Omitted,
            live_config: SupportLiveConfigStateV1::NotCollected,
        },
    }
}

fn active_snapshot() -> super::super::model::snapshot::SupportSnapshotV3 {
    let mut snapshot = no_evidence_skeleton();
    snapshot.consent.selection = SupportSessionSelectionV1::ActiveSession;
    snapshot.selection.workspace_id = Some("workspace-1".to_string());
    snapshot.selection.anyharness_workspace_id = Some("runtime-workspace-1".to_string());
    snapshot.selection.ui_session_id = Some("ui-session-1".to_string());
    snapshot.selection.materialized_session_id = Some("materialized-session-1".to_string());
    snapshot.session_ledger = Some(SupportSessionLedgerV1 {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selection: SupportSessionSelectionV1::ActiveSession,
        sessions: vec![active_session()],
    });
    snapshot.manifest.session_collection = SupportSessionCollectionManifestV1::Included {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selected_sessions: 1,
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
        1,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("active fixed point");
    snapshot
}

#[test]
fn active_selection_requires_one_exact_materialized_session() {
    let snapshot = active_snapshot();
    validate_snapshot(&snapshot).expect("valid active selection");

    let mut wrong_id = active_snapshot();
    wrong_id.selection.materialized_session_id = Some("other-session".to_string());
    stabilize_serialized_bytes(&mut wrong_id).expect("stabilize");
    assert_eq!(
        validate_snapshot(&wrong_id),
        Err(SupportSchemaError::InvariantViolation(
            "active-session ledger identity"
        ))
    );

    let mut empty = active_snapshot();
    empty
        .session_ledger
        .as_mut()
        .expect("ledger")
        .sessions
        .clear();
    let SupportSessionCollectionManifestV1::Included {
        selected_sessions, ..
    } = &mut empty.manifest.session_collection
    else {
        unreachable!()
    };
    *selected_sessions = 0;
    stabilize_serialized_bytes(&mut empty).expect("stabilize");
    assert_eq!(
        validate_snapshot(&empty),
        Err(SupportSchemaError::CapExceeded("sessionLedger.sessions"))
    );
}

#[test]
fn generated_and_capture_timestamps_preserve_their_owners() {
    let mut snapshot = no_evidence_skeleton();
    snapshot.collector.captured_at = "2026-08-12T00:00:01Z".to_string();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "collector capture equals sourceTimeTo"
        ))
    );

    let mut snapshot = no_evidence_skeleton();
    snapshot.manifest.generated_at = "2026-08-12T00:00:01Z".to_string();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "manifest generatedAt equals snapshot generatedAt"
        ))
    );
}
