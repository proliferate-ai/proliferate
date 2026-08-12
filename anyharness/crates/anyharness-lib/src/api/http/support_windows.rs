use std::collections::BTreeMap;

use anyharness_contract::v1::{
    AnyHarnessBoundedWindowCompletenessV1, AnyHarnessBoundedWindowMetaV1,
    AnyHarnessBoundedWindowPresentationOrderV1, AnyHarnessBoundedWindowSelectionV1,
    AnyHarnessEventSupportWindowV1, AnyHarnessRawNotificationSupportWindowV1,
    AnyHarnessSessionSupportWindowV1, SessionEvent, SessionEventEnvelope,
    SessionRawNotificationEnvelope,
};
use axum::{
    extract::{Path, RawQuery, State},
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Extension,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};

use super::access::{assert_session_auth_scope, assert_workspace_auth_scope};
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::sessions::model::{
    SessionEventRecord, SessionRawNotificationRecord, SessionRecord,
};
use crate::domains::sessions::service::support_windows::{
    SupportEvidenceWindowRequest, SupportSessionWindowMode, SupportSessionWindowRequest,
    SupportWindowCompleteness, SupportWindowPresentationOrder, SupportWindowResult,
    SUPPORT_EVENT_MAX_ITEMS, SUPPORT_EVENT_MAX_RESPONSE_BYTES, SUPPORT_RAW_NOTIFICATION_MAX_ITEMS,
    SUPPORT_RAW_NOTIFICATION_MAX_RESPONSE_BYTES, SUPPORT_SESSION_MAX_ITEMS,
    SUPPORT_SESSION_MAX_RESPONSE_BYTES, SUPPORT_WINDOW_MIN_RESPONSE_BYTES,
};

const SUPPORT_WINDOW_QUERY_BYTES: usize = 4_096;
const INVALID_SUPPORT_WINDOW_QUERY: &str = "INVALID_SUPPORT_WINDOW_QUERY";

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/sessions/support-window",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("mode" = String, Query, description = "Required exact or recent selection mode"),
        ("session_id" = Option<String>, Query, description = "Required only for exact mode"),
        ("updated_at_from" = Option<String>, Query, description = "Required UTC RFC3339 inclusive lower timestamp only for recent mode"),
        ("updated_at_to" = String, Query, description = "Required UTC RFC3339 inclusive upper timestamp"),
        ("limit" = usize, Query, description = "Required limit: 1 for exact mode, 1 through 3 for recent mode"),
        ("max_response_bytes" = usize, Query, description = "Required response limit from 16384 through 1048576 bytes"),
    ),
    responses(
        (status = 200, description = "Bounded newest matching durable sessions", body = AnyHarnessSessionSupportWindowV1),
        (status = 400, description = "Invalid support-window query", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn list_sessions_support_window(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(workspace_id): Path<String>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, ApiError> {
    let request = parse_support_session_window_query(raw_query.as_deref())?;
    assert_workspace_auth_scope(&auth, &workspace_id)?;
    let (cancellation, guard) = state.session_service.begin_support_window_query();
    let service = state.session_service.clone();
    let query_cancellation = cancellation.clone();
    let result = super::blocking::run_blocking("session support window", move || {
        let window = service.session_support_window(
            &workspace_id,
            &request,
            &query_cancellation,
            encode_session,
        )?;
        encode_support_window(window, || query_cancellation.check_cancelled())
    })
    .await?;
    guard.disarm();
    let bytes = result.map_err(map_support_window_error)?;
    Ok(support_window_response(bytes))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/events/support-window",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("timestamp_from" = String, Query, description = "Required UTC RFC3339 inclusive lower timestamp"),
        ("timestamp_to" = String, Query, description = "Required UTC RFC3339 inclusive upper timestamp, at most 15 minutes after timestamp_from"),
        ("limit" = usize, Query, description = "Required item limit from 1 through 200"),
        ("max_response_bytes" = usize, Query, description = "Required response limit from 16384 through 4194304 bytes"),
    ),
    responses(
        (status = 200, description = "Bounded newest matching session events in sequence order", body = AnyHarnessEventSupportWindowV1),
        (status = 400, description = "Invalid support-window query", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn list_session_events_support_window(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, ApiError> {
    let request = parse_support_evidence_window_query(raw_query.as_deref(), EvidenceKind::Event)?;
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let (cancellation, guard) = state.session_service.begin_support_window_query();
    let service = state.session_service.clone();
    let query_cancellation = cancellation.clone();
    let result = super::blocking::run_blocking("session event support window", move || {
        let Some(window) = service.event_support_window(
            &session_id,
            &request,
            &query_cancellation,
            encode_event,
        )?
        else {
            return Ok(None);
        };
        encode_support_window(window, || query_cancellation.check_cancelled()).map(Some)
    })
    .await?;
    guard.disarm();
    let bytes = result
        .map_err(map_support_window_error)?
        .ok_or_else(|| ApiError::not_found("Session not found", "SESSION_NOT_FOUND"))?;
    Ok(support_window_response(bytes))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/raw-notifications/support-window",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("timestamp_from" = String, Query, description = "Required UTC RFC3339 inclusive lower timestamp"),
        ("timestamp_to" = String, Query, description = "Required UTC RFC3339 inclusive upper timestamp, at most 15 minutes after timestamp_from"),
        ("limit" = usize, Query, description = "Required item limit from 1 through 100"),
        ("max_response_bytes" = usize, Query, description = "Required response limit from 16384 through 2097152 bytes"),
    ),
    responses(
        (status = 200, description = "Bounded newest matching raw notifications in sequence order", body = AnyHarnessRawNotificationSupportWindowV1),
        (status = 400, description = "Invalid support-window query", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn list_session_raw_notifications_support_window(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, ApiError> {
    let request =
        parse_support_evidence_window_query(raw_query.as_deref(), EvidenceKind::RawNotification)?;
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let (cancellation, guard) = state.session_service.begin_support_window_query();
    let service = state.session_service.clone();
    let query_cancellation = cancellation.clone();
    let result = super::blocking::run_blocking("raw notification support window", move || {
        let Some(window) = service.raw_notification_support_window(
            &session_id,
            &request,
            &query_cancellation,
            encode_raw_notification,
        )?
        else {
            return Ok(None);
        };
        encode_support_window(window, || query_cancellation.check_cancelled()).map(Some)
    })
    .await?;
    guard.disarm();
    let bytes = result
        .map_err(map_support_window_error)?
        .ok_or_else(|| ApiError::not_found("Session not found", "SESSION_NOT_FOUND"))?;
    Ok(support_window_response(bytes))
}

#[derive(Clone, Copy)]
pub(crate) enum EvidenceKind {
    Event,
    RawNotification,
}

pub(crate) fn parse_support_session_window_query(
    raw_query: Option<&str>,
) -> Result<SupportSessionWindowRequest, ApiError> {
    let values = parse_strict_query(
        raw_query,
        &[
            "mode",
            "session_id",
            "updated_at_from",
            "updated_at_to",
            "limit",
            "max_response_bytes",
        ],
    )?;
    let mode = required(&values, "mode")?;
    let limit = parse_decimal(required(&values, "limit")?)?;
    let max_response_bytes = parse_decimal(required(&values, "max_response_bytes")?)?;
    if !(SUPPORT_WINDOW_MIN_RESPONSE_BYTES..=SUPPORT_SESSION_MAX_RESPONSE_BYTES)
        .contains(&max_response_bytes)
    {
        return Err(invalid_support_query("max_response_bytes is out of range"));
    }
    let (updated_at_to_instant, updated_at_to) =
        parse_utc_timestamp(required(&values, "updated_at_to")?)?;
    let mode = match mode {
        "exact" => {
            require_exact_keys(
                &values,
                &[
                    "mode",
                    "session_id",
                    "updated_at_to",
                    "limit",
                    "max_response_bytes",
                ],
            )?;
            if limit != 1 {
                return Err(invalid_support_query("exact mode requires limit=1"));
            }
            let session_id = required(&values, "session_id")?;
            if !valid_support_id(session_id) {
                return Err(invalid_support_query("session_id is invalid"));
            }
            SupportSessionWindowMode::Exact {
                session_id: session_id.to_owned(),
                updated_at_to,
            }
        }
        "recent" => {
            require_exact_keys(
                &values,
                &[
                    "mode",
                    "updated_at_from",
                    "updated_at_to",
                    "limit",
                    "max_response_bytes",
                ],
            )?;
            if !(1..=SUPPORT_SESSION_MAX_ITEMS).contains(&limit) {
                return Err(invalid_support_query("recent limit is out of range"));
            }
            let (from, updated_at_from) =
                parse_utc_timestamp(required(&values, "updated_at_from")?)?;
            validate_time_window(from, updated_at_to_instant)?;
            SupportSessionWindowMode::Recent {
                updated_at_from,
                updated_at_to,
            }
        }
        _ => return Err(invalid_support_query("mode must be exact or recent")),
    };
    Ok(SupportSessionWindowRequest {
        mode,
        limit,
        max_response_bytes,
    })
}

pub(crate) fn parse_support_evidence_window_query(
    raw_query: Option<&str>,
    kind: EvidenceKind,
) -> Result<SupportEvidenceWindowRequest, ApiError> {
    let values = parse_strict_query(
        raw_query,
        &[
            "timestamp_from",
            "timestamp_to",
            "limit",
            "max_response_bytes",
        ],
    )?;
    require_exact_keys(
        &values,
        &[
            "timestamp_from",
            "timestamp_to",
            "limit",
            "max_response_bytes",
        ],
    )?;
    let (from, timestamp_from) = parse_utc_timestamp(required(&values, "timestamp_from")?)?;
    let (to, timestamp_to) = parse_utc_timestamp(required(&values, "timestamp_to")?)?;
    validate_time_window(from, to)?;
    let limit = parse_decimal(required(&values, "limit")?)?;
    let max_response_bytes = parse_decimal(required(&values, "max_response_bytes")?)?;
    let (max_items, max_bytes) = match kind {
        EvidenceKind::Event => (SUPPORT_EVENT_MAX_ITEMS, SUPPORT_EVENT_MAX_RESPONSE_BYTES),
        EvidenceKind::RawNotification => (
            SUPPORT_RAW_NOTIFICATION_MAX_ITEMS,
            SUPPORT_RAW_NOTIFICATION_MAX_RESPONSE_BYTES,
        ),
    };
    if !(1..=max_items).contains(&limit) {
        return Err(invalid_support_query("limit is out of range"));
    }
    if !(SUPPORT_WINDOW_MIN_RESPONSE_BYTES..=max_bytes).contains(&max_response_bytes) {
        return Err(invalid_support_query("max_response_bytes is out of range"));
    }
    Ok(SupportEvidenceWindowRequest {
        timestamp_from,
        timestamp_to,
        limit,
        max_response_bytes,
    })
}

fn parse_strict_query(
    raw_query: Option<&str>,
    allowed: &[&str],
) -> Result<BTreeMap<String, String>, ApiError> {
    let raw_query = raw_query
        .filter(|query| !query.is_empty())
        .ok_or_else(|| invalid_support_query("query parameters are required"))?;
    if raw_query.len() > SUPPORT_WINDOW_QUERY_BYTES {
        return Err(invalid_support_query("query string is too large"));
    }
    let mut values = BTreeMap::new();
    for segment in raw_query.split('&') {
        if segment.is_empty() {
            return Err(invalid_support_query("empty query segment"));
        }
        let (raw_key, raw_value) = segment
            .split_once('=')
            .ok_or_else(|| invalid_support_query("query parameter is missing '='"))?;
        if raw_key.is_empty() || raw_value.is_empty() {
            return Err(invalid_support_query("query parameter value is missing"));
        }
        let key = strict_percent_decode(raw_key)?;
        let value = strict_percent_decode(raw_value)?;
        if !allowed.contains(&key.as_str()) {
            return Err(invalid_support_query("unknown query parameter"));
        }
        if values.insert(key, value).is_some() {
            return Err(invalid_support_query("duplicate query parameter"));
        }
    }
    Ok(values)
}

fn strict_percent_decode(value: &str) -> Result<String, ApiError> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                if index + 2 >= bytes.len() {
                    return Err(invalid_support_query("malformed percent escape"));
                }
                let high = hex_value(bytes[index + 1])
                    .ok_or_else(|| invalid_support_query("malformed percent escape"))?;
                let low = hex_value(bytes[index + 2])
                    .ok_or_else(|| invalid_support_query("malformed percent escape"))?;
                decoded.push((high << 4) | low);
                index += 3;
            }
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).map_err(|_| invalid_support_query("query is not valid UTF-8"))
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn required<'a>(values: &'a BTreeMap<String, String>, key: &str) -> Result<&'a str, ApiError> {
    values
        .get(key)
        .map(String::as_str)
        .ok_or_else(|| invalid_support_query("required query parameter is missing"))
}

fn require_exact_keys(
    values: &BTreeMap<String, String>,
    expected: &[&str],
) -> Result<(), ApiError> {
    if values.len() != expected.len() || expected.iter().any(|key| !values.contains_key(*key)) {
        return Err(invalid_support_query(
            "query parameters are incompatible with the selected window",
        ));
    }
    Ok(())
}

fn parse_decimal(value: &str) -> Result<usize, ApiError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(invalid_support_query("numeric query parameter is invalid"));
    }
    value
        .parse()
        .map_err(|_| invalid_support_query("numeric query parameter is out of range"))
}

fn parse_utc_timestamp(value: &str) -> Result<(DateTime<Utc>, String), ApiError> {
    let parsed = DateTime::parse_from_rfc3339(value)
        .map_err(|_| invalid_support_query("timestamp is not valid RFC3339"))?;
    if parsed.offset().local_minus_utc() != 0 || value.ends_with("-00:00") {
        return Err(invalid_support_query("timestamp must use UTC"));
    }
    let utc = parsed.with_timezone(&Utc);
    Ok((utc, utc.to_rfc3339_opts(SecondsFormat::AutoSi, true)))
}

fn validate_time_window(from: DateTime<Utc>, to: DateTime<Utc>) -> Result<(), ApiError> {
    if from > to {
        return Err(invalid_support_query("timestamp window is inverted"));
    }
    if to.signed_duration_since(from) > Duration::minutes(15) {
        return Err(invalid_support_query("timestamp window exceeds 15 minutes"));
    }
    Ok(())
}

fn valid_support_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
}

fn invalid_support_query(detail: &'static str) -> ApiError {
    ApiError::bad_request(detail, INVALID_SUPPORT_WINDOW_QUERY)
}

fn map_support_window_error(_error: anyhow::Error) -> ApiError {
    ApiError::internal("Support window could not be read.")
}

fn support_window_response(bytes: Vec<u8>) -> Response {
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

fn encode_session(record: SessionRecord) -> anyhow::Result<Vec<u8>> {
    Ok(serde_json::to_vec(&record.to_contract())?)
}

fn encode_event(record: SessionEventRecord) -> anyhow::Result<Vec<u8>> {
    let event = serde_json::from_str::<SessionEvent>(&record.payload_json)
        .map_err(|_| anyhow::anyhow!("stored session event payload is invalid"))?;
    Ok(serde_json::to_vec(&SessionEventEnvelope {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        turn_id: record.turn_id,
        item_id: record.item_id,
        event,
    })?)
}

fn encode_raw_notification(record: SessionRawNotificationRecord) -> anyhow::Result<Vec<u8>> {
    let notification = serde_json::from_str::<serde_json::Value>(&record.payload_json)
        .map_err(|_| anyhow::anyhow!("stored raw notification payload is invalid"))?;
    Ok(serde_json::to_vec(&SessionRawNotificationEnvelope {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        notification_kind: record.notification_kind,
        notification,
    })?)
}

pub(crate) fn encode_support_window<F>(
    window: SupportWindowResult,
    check_cancelled: F,
) -> anyhow::Result<Vec<u8>>
where
    F: Fn() -> anyhow::Result<()>,
{
    check_cancelled()?;
    let response_byte_limit = window.meta.response_byte_limit;
    let meta = AnyHarnessBoundedWindowMetaV1 {
        schema_version: 1,
        selection: AnyHarnessBoundedWindowSelectionV1::NewestMatching,
        presentation_order: match window.meta.presentation_order {
            SupportWindowPresentationOrder::UpdatedDescIdAsc => {
                AnyHarnessBoundedWindowPresentationOrderV1::UpdatedDescIdAsc
            }
            SupportWindowPresentationOrder::SeqAsc => {
                AnyHarnessBoundedWindowPresentationOrderV1::SeqAsc
            }
        },
        item_limit: window.meta.item_limit,
        response_byte_limit,
        returned_items: window.meta.returned_items,
        omitted_oversized_items: window.meta.omitted_oversized_items,
        completeness: match window.meta.completeness {
            SupportWindowCompleteness::Complete => AnyHarnessBoundedWindowCompletenessV1::Complete,
            SupportWindowCompleteness::LimitUncertain => {
                AnyHarnessBoundedWindowCompletenessV1::LimitUncertain
            }
        },
    };
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"{\"window\":");
    serde_json::to_writer(&mut bytes, &meta)?;
    bytes.extend_from_slice(b",\"items\":[");
    for (index, item) in window.items.into_iter().enumerate() {
        check_cancelled()?;
        if index > 0 {
            bytes.push(b',');
        }
        bytes.extend_from_slice(&item);
    }
    bytes.extend_from_slice(b"]}");
    check_cancelled()?;
    if bytes.len() > response_byte_limit {
        anyhow::bail!("bounded support-window envelope exceeded its response limit");
    }
    check_cancelled()?;
    Ok(bytes)
}
