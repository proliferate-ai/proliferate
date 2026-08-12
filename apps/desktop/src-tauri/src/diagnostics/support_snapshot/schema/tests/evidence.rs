use super::{empty_coverage, no_evidence_skeleton, set_manifest_source, TS};

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportCollectorCompletenessV1, SupportCollectorStatusV1, SupportEndpointStateV1,
    SupportLegacySourceKindV1, SupportLiveConfigStateV1, SupportSessionSelectionV1,
    SupportSourceManifestSourceV1, SupportSourceStateV1, SupportUnknownDesktopNativeV1,
};
use crate::diagnostics::support_snapshot::schema::limits::{COLLECTOR_BYTES, MAX_SAFE_INTEGER};
use crate::diagnostics::support_snapshot::schema::model::common::SupportJsonValueV1;
use crate::diagnostics::support_snapshot::schema::model::evidence::{
    SupportFallbackComponentV1, SupportLegacyLineV1, SupportLegacySourceV1,
    SupportOpaqueFallbackLineV1, SupportSessionEndpointStatesV1, SupportSessionLedgerV1,
    SupportSessionV1,
};
use crate::diagnostics::support_snapshot::schema::model::manifest::SupportSessionCollectionManifestV1;
use crate::diagnostics::support_snapshot::schema::validate::{
    stabilize_serialized_bytes, validate_collector_coverage, validate_snapshot,
    validate_support_json_value, SupportSchemaError,
};

#[test]
fn projected_values_reject_all_directly_constructed_invalid_forms() {
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Integer(-1)),
        Err(SupportSchemaError::UnsafeInteger)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Number(f64::NAN)),
        Err(SupportSchemaError::NonFiniteNumber)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Number(f64::INFINITY)),
        Err(SupportSchemaError::NonFiniteNumber)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Number(-1.0)),
        Err(SupportSchemaError::UnsafeInteger)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Number(-0.0)),
        Err(SupportSchemaError::UnsafeInteger)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Number(9_007_199_254_740_992.0)),
        Err(SupportSchemaError::UnsafeInteger)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Object(vec![
            ("z".to_string(), SupportJsonValueV1::Null),
            ("a".to_string(), SupportJsonValueV1::Null),
        ])),
        Err(SupportSchemaError::InvariantViolation(
            "projected object key order/uniqueness"
        ))
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Object(vec![
            ("a".to_string(), SupportJsonValueV1::Null),
            ("a".to_string(), SupportJsonValueV1::Bool(true)),
        ])),
        Err(SupportSchemaError::InvariantViolation(
            "projected object key order/uniqueness"
        ))
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Object(
            (0..257)
                .map(|index| (format!("{index:03}"), SupportJsonValueV1::Null))
                .collect()
        )),
        Err(SupportSchemaError::TooManyItems)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::Object(vec![(
            "k".repeat(4_097),
            SupportJsonValueV1::Null,
        )])),
        Err(SupportSchemaError::OversizedGenericString)
    );
    assert_eq!(
        validate_support_json_value(&SupportJsonValueV1::String("v".repeat(16_385))),
        Err(SupportSchemaError::OversizedContentString)
    );

    let at_depth = (0..16).fold(SupportJsonValueV1::Null, |value, _| {
        SupportJsonValueV1::Array(vec![value])
    });
    validate_support_json_value(&at_depth).expect("sixteen container edges");
    let too_deep = SupportJsonValueV1::Array(vec![at_depth]);
    assert_eq!(
        validate_support_json_value(&too_deep),
        Err(SupportSchemaError::TooDeep)
    );
}

#[test]
fn projected_object_keys_use_unicode_scalar_not_utf16_order() {
    let scalar_order = SupportJsonValueV1::Object(vec![
        ("\u{e000}".to_string(), SupportJsonValueV1::Null),
        ("\u{10000}".to_string(), SupportJsonValueV1::Null),
    ]);
    validate_support_json_value(&scalar_order).expect("Unicode-scalar order");

    let utf16_order = SupportJsonValueV1::Object(vec![
        ("\u{10000}".to_string(), SupportJsonValueV1::Null),
        ("\u{e000}".to_string(), SupportJsonValueV1::Null),
    ]);
    assert_eq!(
        validate_support_json_value(&utf16_order),
        Err(SupportSchemaError::InvariantViolation(
            "projected object key order/uniqueness"
        ))
    );
}

#[test]
fn projected_json_conversion_rejects_unsigned_overflow_and_sorts_keys() {
    assert_eq!(
        SupportJsonValueV1::try_from_json(&serde_json::json!(MAX_SAFE_INTEGER + 1)),
        Err(SupportSchemaError::UnsafeInteger)
    );
    let exponent_integer: serde_json::Value =
        serde_json::from_str("9.007199254740992e15").expect("JSON number");
    assert_eq!(
        SupportJsonValueV1::try_from_json(&exponent_integer),
        Err(SupportSchemaError::UnsafeInteger)
    );
    let source: serde_json::Value = serde_json::from_str(r#"{"z":0,"a":1}"#).expect("object JSON");
    assert_eq!(
        SupportJsonValueV1::try_from_json(&source).expect("projected object"),
        SupportJsonValueV1::Object(vec![
            ("a".to_string(), SupportJsonValueV1::Integer(1)),
            ("z".to_string(), SupportJsonValueV1::Integer(0)),
        ])
    );
}

pub(super) fn populated_coverage(
    bytes: u64,
    uncertain: bool,
) -> super::super::model::evidence::SupportCollectorCoverageV1 {
    let mut coverage = empty_coverage();
    coverage.status = if uncertain {
        SupportCollectorStatusV1::LimitUncertain
    } else {
        SupportCollectorStatusV1::Complete
    };
    coverage.completeness = if uncertain {
        SupportCollectorCompletenessV1::LimitUncertain
    } else {
        SupportCollectorCompletenessV1::Complete
    };
    coverage.limit_uncertain = uncertain;
    coverage.returned_records = 1;
    coverage.returned_record_bytes = bytes;
    coverage.cursor_start = Some(7);
    coverage.cursor_end = Some(7);
    coverage
}

#[test]
fn collector_byte_uncertainty_boundary_is_conservative() {
    let threshold = COLLECTOR_BYTES - 65_536;
    validate_collector_coverage(&populated_coverage(threshold, false))
        .expect("exactly one maximum record of headroom is complete");
    validate_collector_coverage(&populated_coverage(threshold + 1, true))
        .expect("less than one maximum record of headroom is uncertain");

    assert_eq!(
        validate_collector_coverage(&populated_coverage(threshold, true)),
        Err(SupportSchemaError::InvariantViolation(
            "collector coverage status/completeness"
        ))
    );

    let mut record_limit = populated_coverage(1, true);
    record_limit.returned_records = 10_000;
    validate_collector_coverage(&record_limit).expect("record-limit equality is uncertain");
}

#[test]
fn collector_coverage_rejects_caps_cursor_and_status_lies() {
    let mut too_many = populated_coverage(1, true);
    too_many.returned_records = 10_001;
    assert_eq!(
        validate_collector_coverage(&too_many),
        Err(SupportSchemaError::CapExceeded("coverage.returnedRecords"))
    );

    let mut split_cursor = populated_coverage(1, false);
    split_cursor.cursor_end = None;
    assert_eq!(
        validate_collector_coverage(&split_cursor),
        Err(SupportSchemaError::InvariantViolation(
            "coverage cursor pair"
        ))
    );

    let mut unavailable_with_data = empty_coverage();
    unavailable_with_data.returned_record_bytes = 1;
    assert_eq!(
        validate_collector_coverage(&unavailable_with_data),
        Err(SupportSchemaError::InvariantViolation(
            "coverage record/byte emptiness"
        ))
    );
}

fn endpoint_states() -> SupportSessionEndpointStatesV1 {
    SupportSessionEndpointStatesV1 {
        summary: SupportEndpointStateV1::Omitted,
        events: SupportEndpointStateV1::Omitted,
        raw_notifications: SupportEndpointStateV1::Omitted,
        live_config: SupportLiveConfigStateV1::NotCollected,
    }
}

pub(super) fn session(id: &str) -> SupportSessionV1 {
    SupportSessionV1 {
        session_id: id.to_string(),
        summary_captured_at: TS.to_string(),
        summary: None,
        normalized_events: Vec::new(),
        raw_notifications: Vec::new(),
        endpoint_states: endpoint_states(),
    }
}

pub(super) fn bind_recent_ledger(
    snapshot: &mut super::super::model::snapshot::SupportSnapshotV3,
    sessions: Vec<SupportSessionV1>,
) {
    snapshot.selection.workspace_id = Some("workspace-1".to_string());
    snapshot.selection.anyharness_workspace_id = Some("runtime-workspace-1".to_string());
    snapshot.session_ledger = Some(SupportSessionLedgerV1 {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selection: SupportSessionSelectionV1::RecentActivity,
        sessions,
    });
    let selected_sessions = snapshot
        .session_ledger
        .as_ref()
        .expect("ledger")
        .sessions
        .len() as u64;
    snapshot.manifest.session_collection = SupportSessionCollectionManifestV1::Included {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selected_sessions,
        session_included_bytes: 0,
        event_included_bytes: 0,
        raw_notification_included_bytes: 0,
        limit_uncertain_endpoints: 0,
    };
    set_manifest_source(
        snapshot,
        SupportSourceManifestSourceV1::SessionLedger,
        SupportSourceStateV1::Included,
        0,
        0,
        selected_sessions,
    );
}

#[test]
fn recent_ledger_may_be_present_and_empty() {
    let mut snapshot = no_evidence_skeleton();
    bind_recent_ledger(&mut snapshot, Vec::new());
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("zero matching recent sessions is honest");
}

#[test]
fn fallback_legacy_and_session_ledgers_require_their_section_orders() {
    let opaque = |segment, line| SupportOpaqueFallbackLineV1 {
        component: SupportUnknownDesktopNativeV1::UnknownDesktopNative,
        value: SupportJsonValueV1::Null,
        segment,
        line,
        semantic_claims: false,
    };
    let mut snapshot = no_evidence_skeleton();
    snapshot.fallback_evidence = vec![SupportFallbackComponentV1::Pr3DesktopNativeMixed {
        records: Vec::new(),
        opaque_lines: vec![opaque(0, 1), opaque(3, 1)],
    }];
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "opaque fallback line order"
        ))
    );

    let mut snapshot = no_evidence_skeleton();
    snapshot.legacy_evidence = vec![SupportLegacySourceV1 {
        source: SupportLegacySourceKindV1::RendererDiagnostics,
        lines: vec![
            SupportLegacyLineV1 {
                segment: 0,
                line: 1,
                value: "active".to_string(),
            },
            SupportLegacyLineV1 {
                segment: 5,
                line: 1,
                value: "oldest".to_string(),
            },
        ],
        semantic_claims: false,
    }];
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation("legacy line order"))
    );

    let mut out_of_order = session("session-1");
    out_of_order.endpoint_states.events = SupportEndpointStateV1::Included;
    out_of_order.normalized_events = [2, 1]
        .into_iter()
        .map(|sequence| {
            SupportJsonValueV1::Object(vec![(
                "seq".to_string(),
                SupportJsonValueV1::Integer(sequence),
            )])
        })
        .collect();
    let mut snapshot = no_evidence_skeleton();
    bind_recent_ledger(&mut snapshot, vec![out_of_order]);
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "session ledger sequence order"
        ))
    );
}

#[test]
fn session_recursive_copy_accounting_is_enforced() {
    let events = (1..=39)
        .map(|sequence| {
            SupportJsonValueV1::Object(vec![
                (
                    "payload".to_string(),
                    SupportJsonValueV1::Array(vec![SupportJsonValueV1::Null; 256]),
                ),
                ("seq".to_string(), SupportJsonValueV1::Integer(sequence)),
            ])
        })
        .collect();
    let mut over = session("session-1");
    over.normalized_events = events;
    over.endpoint_states.events = SupportEndpointStateV1::Included;
    let mut snapshot = no_evidence_skeleton();
    bind_recent_ledger(&mut snapshot, vec![over]);
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::CapExceeded(
            "session copied projected values"
        ))
    );
}

#[test]
fn session_event_and_notification_caps_are_enforced_before_projection() {
    let value =
        SupportJsonValueV1::Object(vec![("seq".to_string(), SupportJsonValueV1::Integer(1))]);
    let mut over_events = session("session-1");
    over_events.normalized_events = vec![value.clone(); 201];
    over_events.endpoint_states.events = SupportEndpointStateV1::Included;
    let mut snapshot = no_evidence_skeleton();
    bind_recent_ledger(&mut snapshot, vec![over_events]);
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::CapExceeded("session.normalizedEvents"))
    );

    let mut over_raw = session("session-1");
    over_raw.raw_notifications = vec![value; 101];
    over_raw.endpoint_states.raw_notifications = SupportEndpointStateV1::Included;
    let mut snapshot = no_evidence_skeleton();
    bind_recent_ledger(&mut snapshot, vec![over_raw]);
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::CapExceeded("session.rawNotifications"))
    );
}
