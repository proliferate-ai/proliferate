use super::super::session_cross_check::cross_check_collection;
use super::*;

fn window(
    item_limit: u64,
    response_byte_limit: u64,
    returned_items: u64,
    completeness: WindowCompletenessV1,
) -> BoundedWindowMetaV1 {
    BoundedWindowMetaV1 {
        schema_version: 1,
        selection: WindowSelectionV1::NewestMatching,
        presentation_order: WindowPresentationOrderV1::SeqAsc,
        item_limit,
        response_byte_limit,
        returned_items,
        omitted_oversized_items: 0,
        completeness,
    }
}

#[test]
fn endpoint_freshness_is_anchored_after_native_capture() {
    let exact = window(
        EVENTS_PER_SESSION,
        EVENT_RESPONSE_BYTES,
        1,
        WindowCompletenessV1::Complete,
    );
    assert_eq!(
        validate_endpoint(
            "2026-08-12T00:00:05Z",
            EndpointCaptureState::Included,
            None,
            1,
            &exact,
            EVENTS_PER_SESSION,
            EVENT_RESPONSE_BYTES,
            WindowPresentationOrderV1::SeqAsc,
            "2026-08-12T00:00:05Z",
        ),
        Ok(SupportEndpointStateV1::Included)
    );
    let wrong_cap = window(
        EVENTS_PER_SESSION - 1,
        EVENT_RESPONSE_BYTES,
        1,
        WindowCompletenessV1::Complete,
    );
    assert_eq!(
        validate_endpoint(
            "2026-08-12T00:00:05Z",
            EndpointCaptureState::Included,
            None,
            1,
            &wrong_cap,
            EVENTS_PER_SESSION,
            EVENT_RESPONSE_BYTES,
            WindowPresentationOrderV1::SeqAsc,
            "2026-08-12T00:00:05Z",
        ),
        Err(SessionInputError::Incoherent)
    );
    assert_eq!(
        validate_endpoint(
            "2026-08-12T00:00:10.001Z",
            EndpointCaptureState::Included,
            None,
            1,
            &exact,
            EVENTS_PER_SESSION,
            EVENT_RESPONSE_BYTES,
            WindowPresentationOrderV1::SeqAsc,
            "2026-08-12T00:00:05Z",
        ),
        Err(SessionInputError::Incoherent)
    );
}

#[test]
fn omitted_bytes_are_zero_and_limit_uncertain_may_return_no_item() {
    let omitted = window(
        EVENTS_PER_SESSION,
        EVENT_RESPONSE_BYTES,
        0,
        WindowCompletenessV1::Complete,
    );
    assert_eq!(
        validate_endpoint(
            "2026-08-12T00:00:00Z",
            EndpointCaptureState::Omitted,
            Some(EndpointFailureReason::Timeout),
            1,
            &omitted,
            EVENTS_PER_SESSION,
            EVENT_RESPONSE_BYTES,
            WindowPresentationOrderV1::SeqAsc,
            "2026-08-12T00:00:00Z",
        ),
        Err(SessionInputError::Incoherent)
    );
    let uncertain = window(
        EVENTS_PER_SESSION,
        EVENT_RESPONSE_BYTES,
        0,
        WindowCompletenessV1::LimitUncertain,
    );
    assert_eq!(
        validate_endpoint(
            "2026-08-12T00:00:00Z",
            EndpointCaptureState::LimitUncertain,
            Some(EndpointFailureReason::WindowLimitUncertain),
            0,
            &uncertain,
            EVENTS_PER_SESSION,
            EVENT_RESPONSE_BYTES,
            WindowPresentationOrderV1::SeqAsc,
            "2026-08-12T00:00:00Z",
        ),
        Ok(SupportEndpointStateV1::LimitUncertain)
    );
    assert!(summary_presence_is_coherent(
        SupportEndpointStateV1::LimitUncertain,
        0,
        false,
    ));
    assert!(!summary_presence_is_coherent(
        SupportEndpointStateV1::Included,
        0,
        true,
    ));
}

#[test]
fn product_client_manifest_counts_the_shared_recent_summary_response_once() {
    for (selected_sessions, session_bytes, uncertain, total_read_bytes) in
        [(0, 0, 0, 128), (1, 17, 1, 29), (3, 17, 1, 91)]
    {
        let collection = SupportSessionCollectionManifestV1::Included {
            workspace_id: "workspace".to_string(),
            anyharness_workspace_id: "runtime-workspace".to_string(),
            selected_sessions,
            session_included_bytes: session_bytes,
            event_included_bytes: 0,
            raw_notification_included_bytes: 0,
            limit_uncertain_endpoints: uncertain,
        };
        assert_eq!(
            cross_check_collection(
                &collection,
                "workspace",
                "runtime-workspace",
                selected_sessions,
                session_bytes,
                0,
                0,
                uncertain,
                total_read_bytes,
            ),
            Ok(())
        );
    }

    let repeated_per_shell = SupportSessionCollectionManifestV1::Included {
        workspace_id: "workspace".to_string(),
        anyharness_workspace_id: "runtime-workspace".to_string(),
        selected_sessions: 3,
        session_included_bytes: 17,
        event_included_bytes: 0,
        raw_notification_included_bytes: 0,
        limit_uncertain_endpoints: 3,
    };
    assert_eq!(
        cross_check_collection(
            &repeated_per_shell,
            "workspace",
            "runtime-workspace",
            3,
            17,
            0,
            0,
            1,
            91,
        ),
        Err(SessionInputError::Incoherent)
    );
}

#[test]
fn native_records_the_fixed_live_config_omission_without_a_dto_field() {
    let mut accounting = SupportScrubAccounting::default();
    note_live_config_not_collected(3, &mut accounting);
    assert_eq!(accounting.omissions.len(), 1);
    assert_eq!(
        accounting.omissions[0].reason,
        super::super::super::schema::enums::SupportOmissionReasonV1::LiveConfigNotCollected
    );
    assert_eq!(accounting.omissions[0].count, 3);

    let mut empty = SupportScrubAccounting::default();
    note_live_config_not_collected(0, &mut empty);
    assert!(empty.omissions.is_empty());
}

#[test]
fn no_workspace_omission_reason_is_exact() {
    let begin = BeginSupportSnapshotInput {
        client_job_id: uuid::Uuid::new_v4().to_string(),
        report_opened_at: "2026-08-11T23:59:00Z".to_string(),
        consent_epoch: "epoch-1".to_string(),
        consent: super::super::model::SupportSnapshotConsentInput {
            version: 1,
            disclosure_version: super::super::model::DISCLOSURE_VERSION.to_string(),
            granted_at: "2026-08-12T00:00:00Z".to_string(),
            selection: SupportSnapshotSelectionInput::RecentActivity {
                workspace: SupportSnapshotWorkspaceInput::None {
                    reason: super::super::model::NoWorkspaceReason::NoSelectedBundledLocalWorkspace,
                },
            },
        },
    };
    assert_eq!(
        validate_omitted_binding(
            SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
            &begin,
        ),
        Ok(())
    );
    assert_eq!(
        validate_omitted_binding(SupportSessionOmissionReasonV1::SessionUnavailable, &begin),
        Err(SessionInputError::Incoherent)
    );
}

#[test]
fn zero_item_uncertain_recent_list_is_preserved_without_a_phantom_shell() {
    let evidence = serde_json::json!({
        "schemaVersion": 1,
        "workspaceId": "workspace",
        "anyharnessWorkspaceId": "runtime-workspace",
        "selection": "recent_activity",
        "sourceTimeFrom": "2026-08-11T23:45:00Z",
        "sourceTimeTo": "2026-08-12T00:00:00Z",
        "totalReadBytes": 128,
        "sessionList": {
            "capturedAt": "2026-08-12T00:00:01Z",
            "state": "limit_uncertain",
            "reason": "session_window_limit_uncertain",
            "includedBytes": 0,
            "window": {
                "schemaVersion": 1,
                "selection": "newest_matching",
                "presentationOrder": "updated_desc_id_asc",
                "itemLimit": 3,
                "responseByteLimit": 1048576,
                "returnedItems": 0,
                "omittedOversizedItems": 1,
                "completeness": "limit_uncertain"
            }
        },
        "sessions": []
    });
    let collection = SupportSessionCollectionManifestV1::Included {
        workspace_id: "workspace".to_string(),
        anyharness_workspace_id: "runtime-workspace".to_string(),
        selected_sessions: 0,
        session_included_bytes: 0,
        event_included_bytes: 0,
        raw_notification_included_bytes: 0,
        limit_uncertain_endpoints: 1,
    };
    let begin = BeginSupportSnapshotInput {
        client_job_id: uuid::Uuid::new_v4().to_string(),
        report_opened_at: "2026-08-11T23:59:00Z".to_string(),
        consent_epoch: "epoch-1".to_string(),
        consent: super::super::model::SupportSnapshotConsentInput {
            version: 1,
            disclosure_version: super::super::model::DISCLOSURE_VERSION.to_string(),
            granted_at: "2026-08-12T00:00:00Z".to_string(),
            selection: SupportSnapshotSelectionInput::RecentActivity {
                workspace: SupportSnapshotWorkspaceInput::BundledLocal {
                    workspace_id: "workspace".to_string(),
                    anyharness_workspace_id: "runtime-workspace".to_string(),
                },
            },
        },
    };
    let encoded = serde_json::to_string(&evidence).expect("private evidence");
    let (parsed, accounting) = parse_session_input(
        Some(&encoded),
        &collection,
        &begin,
        "2026-08-11T23:45:00Z",
        "2026-08-12T00:00:00Z",
        "2026-08-12T00:00:00Z",
        &SupportExportScrubber::default(),
    )
    .expect("zero-item uncertain list");
    assert!(matches!(
        parsed,
        SupportSessionAssemblyV1::Included {
            session_list_state: SupportEndpointStateV1::LimitUncertain,
            sessions,
            ..
        } if sessions.is_empty()
    ));
    assert!(accounting.omissions.iter().any(|entry| {
        entry.reason
            == super::super::super::schema::enums::SupportOmissionReasonV1::SessionWindowLimitUncertain
            && entry.count == 1
    }));

    let mut missing = evidence;
    missing
        .as_object_mut()
        .expect("object")
        .remove("sessionList");
    assert!(serde_json::from_value::<SessionCaptureEnvelopeV1>(missing).is_err());
}
