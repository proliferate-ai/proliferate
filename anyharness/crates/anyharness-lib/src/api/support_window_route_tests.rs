use super::http::support_windows::{
    encode_support_window, parse_support_evidence_window_query, parse_support_session_window_query,
    EvidenceKind,
};
use super::openapi::openapi_json;
use crate::domains::sessions::service::support_windows::{
    SupportWindowCompleteness, SupportWindowMeta, SupportWindowPresentationOrder,
    SupportWindowResult,
};

fn assert_invalid_evidence(query: &str, kind: EvidenceKind) {
    let error = parse_support_evidence_window_query(Some(query), kind)
        .err()
        .expect("query should be rejected");
    assert_eq!(error.status(), axum::http::StatusCode::BAD_REQUEST);
    assert_eq!(error.code(), Some("INVALID_SUPPORT_WINDOW_QUERY"));
    assert!(!error.detail().unwrap_or_default().contains(query));
}

#[test]
fn strict_support_query_rejects_duplicates_unknowns_and_bad_encoding() {
    for query in [
        "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&limit=2&max_response_bytes=16384",
        "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16384&access_token=secret",
        "timestamp_from=%ZZ&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16384",
        "timestamp_from=%FF&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16384",
    ] {
        assert_invalid_evidence(query, EvidenceKind::Event);
    }
    assert_invalid_evidence(
        "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&%6cimit=2&max_response_bytes=16384",
        EvidenceKind::Event,
    );
}

#[test]
fn strict_support_query_rejects_missing_segments_and_invalid_windows() {
    for query in [
        "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes",
        "timestamp_from=2026-01-01T00%3A00%3A00Z&&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16384",
        "timestamp_from=2026-01-01T00%3A02%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16384",
        "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A16%3A00Z&limit=1&max_response_bytes=16384",
        "timestamp_from=2026-01-01T00%3A00%3A00%2B01%3A00&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16384",
        "timestamp_from=2026-01-01T00%3A00%3A00-00%3A00&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16384",
        "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=0&max_response_bytes=16384",
        "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit=1&max_response_bytes=16383",
    ] {
        assert_invalid_evidence(query, EvidenceKind::Event);
    }
}

#[test]
fn strict_support_query_normalizes_utc_and_rejects_numeric_syntax() {
    let query = "timestamp_from=2026-01-01T00%3A00%3A00%2B00%3A00&timestamp_to=2026-01-01T00%3A15%3A00Z&limit=200&max_response_bytes=4194304";
    let parsed = parse_support_evidence_window_query(Some(query), EvidenceKind::Event)
        .expect("parse valid bounded query");
    assert_eq!(parsed.timestamp_from, "2026-01-01T00:00:00Z");
    assert_eq!(parsed.timestamp_to, "2026-01-01T00:15:00Z");
    for invalid_limit in ["+1", "-1", " 1", "1e2"] {
        let query = format!(
            "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A01%3A00Z&limit={invalid_limit}&max_response_bytes=16384"
        );
        assert_invalid_evidence(&query, EvidenceKind::Event);
    }

    let raw_query = "timestamp_from=2026-01-01T00%3A00%3A00Z&timestamp_to=2026-01-01T00%3A15%3A00Z&limit=100&max_response_bytes=2097152";
    assert!(
        parse_support_evidence_window_query(Some(raw_query), EvidenceKind::RawNotification).is_ok()
    );
}

#[test]
fn session_modes_require_their_exact_parameter_sets() {
    let exact = "mode=exact&session_id=session-1&updated_at_to=2026-01-01T00%3A15%3A00Z&limit=1&max_response_bytes=1048576";
    assert!(parse_support_session_window_query(Some(exact)).is_ok());
    let incompatible = format!("{exact}&updated_at_from=2026-01-01T00%3A00%3A00Z");
    assert!(parse_support_session_window_query(Some(&incompatible)).is_err());
    let recent = "mode=recent&updated_at_from=2026-01-01T00%3A00%3A00Z&updated_at_to=2026-01-01T00%3A15%3A00Z&limit=3&max_response_bytes=1048576";
    assert!(parse_support_session_window_query(Some(recent)).is_ok());
    assert!(
        parse_support_session_window_query(Some(&recent.replace("limit=3", "limit=4"))).is_err()
    );
}

#[test]
fn openapi_registers_all_bounded_support_window_routes_and_schemas() {
    let document: serde_json::Value =
        serde_json::from_str(&openapi_json()).expect("parse OpenAPI JSON");
    for path in [
        "/v1/workspaces/{workspace_id}/sessions/support-window",
        "/v1/sessions/{session_id}/events/support-window",
        "/v1/sessions/{session_id}/raw-notifications/support-window",
    ] {
        assert!(document["paths"].get(path).is_some(), "missing path {path}");
    }
    for schema in [
        "AnyHarnessBoundedWindowMetaV1",
        "AnyHarnessSessionSupportWindowV1",
        "AnyHarnessEventSupportWindowV1",
        "AnyHarnessRawNotificationSupportWindowV1",
    ] {
        assert!(
            document["components"]["schemas"].get(schema).is_some(),
            "missing schema {schema}"
        );
    }
    let meta = &document["components"]["schemas"]["AnyHarnessBoundedWindowMetaV1"];
    for field in [
        "schemaVersion",
        "selection",
        "presentationOrder",
        "itemLimit",
        "responseByteLimit",
        "returnedItems",
        "omittedOversizedItems",
        "completeness",
    ] {
        assert!(
            meta["required"]
                .as_array()
                .is_some_and(|required| required.iter().any(|value| value == field)),
            "missing required metadata field {field}"
        );
    }
    assert_eq!(
        meta["properties"]["selection"]["$ref"],
        "#/components/schemas/AnyHarnessBoundedWindowSelectionV1"
    );
}

#[test]
fn response_assembly_splices_the_exact_pre_serialized_item_bytes() {
    let item = br#"{ "normalized" : true }"#.to_vec();
    let response = encode_support_window(
        SupportWindowResult {
            meta: SupportWindowMeta {
                item_limit: 1,
                response_byte_limit: 16_384,
                returned_items: 1,
                omitted_oversized_items: 0,
                presentation_order: SupportWindowPresentationOrder::SeqAsc,
                completeness: SupportWindowCompleteness::Complete,
            },
            items: vec![item.clone()],
        },
        || Ok(()),
    )
    .expect("assemble bounded response");

    assert!(response
        .windows(item.len())
        .any(|window| window == item.as_slice()));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&response).expect("valid response JSON")
            ["window"]["returnedItems"],
        1
    );
}
