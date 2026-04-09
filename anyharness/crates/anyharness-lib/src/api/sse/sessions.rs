use std::convert::Infallible;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, Sse};
use futures::stream::{self, BoxStream, Stream, StreamExt as FuturesStreamExt};
use tokio_stream::wrappers::BroadcastStream;

use crate::api::http::error::ApiError;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::app::AppState;
use anyharness_contract::v1::{SessionEvent, SessionEventEnvelope};

#[derive(Debug, serde::Deserialize)]
pub struct StreamSessionQuery {
    pub after_seq: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/stream",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "SSE event stream"),
        (status = 404, description = "Session not found or not live"),
    ),
    tag = "sessions"
)]
pub async fn stream_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(query): Query<StreamSessionQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    let after_seq = query.after_seq.unwrap_or(0).max(0);
    tracing::info!(
        session_id = %session_id,
        after_seq,
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.sse.request_received"
    );
    let live_handle = state.acp_manager.get_handle(&session_id).await;
    let live_rx = live_handle.as_ref().map(|handle| handle.subscribe());

    let backlog_records = state
        .session_service
        .list_session_event_records(&session_id, Some(after_seq))
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;

    let backlog = backlog_records
        .into_iter()
        .filter_map(event_record_to_envelope)
        .collect::<Vec<_>>();
    tracing::info!(
        session_id = %session_id,
        after_seq,
        backlog_count = backlog.len(),
        has_live_handle = live_handle.is_some(),
        elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.sse.open"
    );
    let max_sent_seq = Arc::new(AtomicI64::new(
        backlog.last().map(|env| env.seq).unwrap_or(after_seq),
    ));
    let backlog_stream = stream::iter(backlog.into_iter().filter_map(envelope_to_event));

    let stream: BoxStream<'static, Result<Event, Infallible>> = if let Some(rx) = live_rx {
        let max_sent_seq = max_sent_seq.clone();
        backlog_stream
            .chain(BroadcastStream::new(rx).filter_map(move |result| {
                let max_sent_seq = max_sent_seq.clone();
                match result {
                    Ok(envelope) => {
                        let last_sent = max_sent_seq.load(Ordering::Acquire);
                        if envelope.seq <= last_sent {
                            return futures::future::ready(None);
                        }
                        max_sent_seq.store(envelope.seq, Ordering::Release);
                        futures::future::ready(envelope_to_event(envelope))
                    }
                    Err(_) => futures::future::ready(None),
                }
            }))
            .boxed()
    } else {
        backlog_stream.boxed()
    };

    Ok(Sse::new(stream))
}

fn event_record_to_envelope(
    record: crate::sessions::model::SessionEventRecord,
) -> Option<SessionEventEnvelope> {
    let event = serde_json::from_str::<SessionEvent>(&record.payload_json).ok()?;
    Some(SessionEventEnvelope {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        turn_id: record.turn_id,
        item_id: record.item_id,
        event,
    })
}

fn envelope_to_event(envelope: SessionEventEnvelope) -> Option<Result<Event, Infallible>> {
    let json = serde_json::to_string(&envelope).ok()?;
    Some(Ok(Event::default()
        .id(envelope.seq.to_string())
        .event(envelope.event.event_type())
        .data(json)))
}
