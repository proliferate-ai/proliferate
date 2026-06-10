use std::time::Instant;

use anyharness_contract::v1::{SessionEventEnvelope, SessionRawNotificationEnvelope};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::Deserialize;

use super::access::assert_session_auth_scope;
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::observability::latency::FlowHeaders;
use tracing::Instrument;

#[derive(Debug, Deserialize)]
pub struct ListSessionEventsQuery {
    pub after_seq: Option<i64>,
    pub before_seq: Option<i64>,
    pub limit: Option<i64>,
    pub turn_limit: Option<i64>,
    pub oldest_first: Option<bool>,
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/events",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("after_seq" = Option<i64>, Query, description = "Return only events with seq greater than this value"),
        ("before_seq" = Option<i64>, Query, description = "Return only events with seq less than this value"),
        ("limit" = Option<i64>, Query, description = "Return at most this many newest matching events, or use as the event budget when turn_limit is set"),
        ("turn_limit" = Option<i64>, Query, description = "Return complete newest turns, bounded by the limit event budget"),
        ("oldest_first" = Option<bool>, Query, description = "When after_seq and limit are set, page from the oldest matching event instead of the newest matching window"),
    ),
    responses(
        (status = 200, description = "Session event history", body = Vec<SessionEventEnvelope>),
        (status = 400, description = "Unsupported event history window", body = anyharness_contract::v1::ProblemDetails),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn list_session_events(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(query): Query<ListSessionEventsQuery>,
) -> Result<Json<Vec<SessionEventEnvelope>>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let span = FlowHeaders::from_headers(&headers).span();
    async move {
        let started = Instant::now();
        let after_seq = query.after_seq.map(|seq| seq.max(0));
        let before_seq = query.before_seq.map(|seq| seq.max(0));
        let limit = query.limit.map(|limit| limit.clamp(1, 5_000));
        let turn_limit = query.turn_limit.map(|turn_limit| turn_limit.clamp(1, 200));
        let oldest_first = query.oldest_first.unwrap_or(false);
        if is_unsupported_event_history_window(after_seq, before_seq, turn_limit) {
            return Err(ApiError::bad_request(
                "after_seq cannot be combined with before_seq or turn_limit",
                "UNSUPPORTED_EVENT_HISTORY_WINDOW",
            ));
        }
        tracing::debug!(
            session_id = %session_id,
            after_seq,
            before_seq,
            limit,
            turn_limit,
            oldest_first,
            "[workspace-latency] session.http.events.start"
        );
        let event_records = state
            .session_service
            .list_session_event_records(
                &session_id,
                after_seq,
                before_seq,
                limit,
                turn_limit,
                oldest_first,
            )
            .map_err(|e| ApiError::internal(e.to_string()))?
            .ok_or_else(|| {
                ApiError::not_found(
                    format!("Session not found: {session_id}"),
                    "SESSION_NOT_FOUND",
                )
            })?;

        let envelopes: Vec<SessionEventEnvelope> = event_records
            .iter()
            .filter_map(|r| {
                let event = serde_json::from_str(&r.payload_json).ok()?;
                Some(SessionEventEnvelope {
                    session_id: r.session_id.clone(),
                    seq: r.seq,
                    timestamp: r.timestamp.clone(),
                    turn_id: r.turn_id.clone(),
                    item_id: r.item_id.clone(),
                    event,
                })
            })
            .collect();

        if envelopes.is_empty() {
            tracing::debug!(
                session_id = %session_id,
                event_count = envelopes.len(),
                after_seq,
                before_seq,
                limit,
                turn_limit,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] session.http.events.completed"
            );
        } else {
            tracing::info!(
                session_id = %session_id,
                event_count = envelopes.len(),
                after_seq,
                before_seq,
                limit,
                turn_limit,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] session.http.events.completed"
            );
        }

        Ok(Json(envelopes))
    }
    .instrument(span)
    .await
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/raw-notifications",
    params(
        ("session_id" = String, Path, description = "Session ID"),
        ("after_seq" = Option<i64>, Query, description = "Return only raw notifications with seq greater than this value"),
    ),
    responses(
        (status = 200, description = "Raw ACP notification history", body = Vec<SessionRawNotificationEnvelope>),
        (status = 404, description = "Session not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "sessions"
)]
pub async fn list_session_raw_notifications(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    Query(query): Query<ListSessionEventsQuery>,
) -> Result<Json<Vec<SessionRawNotificationEnvelope>>, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let raw_records = state
        .session_service
        .list_session_raw_notification_records(&session_id, query.after_seq.map(|seq| seq.max(0)))
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;

    let notifications = raw_records
        .into_iter()
        .filter_map(raw_notification_record_to_envelope)
        .collect();

    Ok(Json(notifications))
}

fn raw_notification_record_to_envelope(
    record: crate::domains::sessions::model::SessionRawNotificationRecord,
) -> Option<SessionRawNotificationEnvelope> {
    let notification = serde_json::from_str(&record.payload_json).ok()?;
    Some(SessionRawNotificationEnvelope {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        notification_kind: record.notification_kind,
        notification,
    })
}

fn is_unsupported_event_history_window(
    after_seq: Option<i64>,
    before_seq: Option<i64>,
    turn_limit: Option<i64>,
) -> bool {
    after_seq.is_some() && (before_seq.is_some() || turn_limit.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_history_query_rejects_unsupported_after_seq_windows() {
        assert!(is_unsupported_event_history_window(
            Some(10),
            Some(20),
            None
        ));
        assert!(is_unsupported_event_history_window(Some(10), None, Some(2)));
        assert!(!is_unsupported_event_history_window(Some(10), None, None));
        assert!(!is_unsupported_event_history_window(
            None,
            Some(20),
            Some(2)
        ));
    }
}
