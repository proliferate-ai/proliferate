use std::convert::Infallible;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, Sse};
use futures::stream::{self, BoxStream, Stream, StreamExt as FuturesStreamExt};
use tokio::sync::broadcast;
use tokio::time::sleep;
use tokio_stream::wrappers::BroadcastStream;

use crate::api::http::error::ApiError;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::app::AppState;
use anyharness_contract::v1::{SessionEvent, SessionEventEnvelope};

const LIVE_HANDLE_ATTACH_TIMEOUT: Duration = Duration::from_secs(30);
const LIVE_HANDLE_ATTACH_INTERVAL: Duration = Duration::from_millis(100);

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
        measurement_operation_id = latency_fields.measurement_operation_id,
        "[workspace-latency] session.sse.request_received"
    );
    let acp_manager = state.acp_manager.clone();
    let live_handle_started = Instant::now();
    let live_handle = acp_manager.get_handle(&session_id).await;
    let live_rx = live_handle.as_ref().map(|handle| handle.subscribe());
    tracing::info!(
        session_id = %session_id,
        has_live_handle = live_handle.is_some(),
        elapsed_ms = live_handle_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
        flow_kind = latency_fields.flow_kind,
        flow_source = latency_fields.flow_source,
        prompt_id = latency_fields.prompt_id,
        measurement_operation_id = latency_fields.measurement_operation_id,
        "[anyharness-latency] session.sse.live_handle_checked"
    );

    let backlog_query_started = Instant::now();
    let backlog_records = state
        .session_service
        .list_session_event_records(&session_id, Some(after_seq), None, None, None)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("Session not found: {session_id}"),
                "SESSION_NOT_FOUND",
            )
        })?;
    tracing::info!(
        session_id = %session_id,
        after_seq,
        backlog_record_count = backlog_records.len(),
        elapsed_ms = backlog_query_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
        flow_kind = latency_fields.flow_kind,
        flow_source = latency_fields.flow_source,
        prompt_id = latency_fields.prompt_id,
        measurement_operation_id = latency_fields.measurement_operation_id,
        "[anyharness-latency] session.sse.backlog_records_loaded"
    );

    let backlog_map_started = Instant::now();
    let backlog = backlog_records
        .into_iter()
        .filter_map(event_record_to_envelope)
        .collect::<Vec<_>>();
    tracing::info!(
        session_id = %session_id,
        after_seq,
        backlog_count = backlog.len(),
        elapsed_ms = backlog_map_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
        flow_kind = latency_fields.flow_kind,
        flow_source = latency_fields.flow_source,
        prompt_id = latency_fields.prompt_id,
        measurement_operation_id = latency_fields.measurement_operation_id,
        "[anyharness-latency] session.sse.backlog_mapped"
    );
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
        measurement_operation_id = latency_fields.measurement_operation_id,
        "[workspace-latency] session.sse.open"
    );
    let max_sent_seq = Arc::new(AtomicI64::new(
        backlog.last().map(|env| env.seq).unwrap_or(after_seq),
    ));
    let backlog_stream = stream::iter(backlog.into_iter().filter_map(envelope_to_event));

    let live_stream: BoxStream<'static, Result<Event, Infallible>> = if let Some(rx) = live_rx {
        live_receiver_stream(rx, max_sent_seq.clone())
    } else {
        let session_service = state.session_service.clone();
        tracing::info!(
            session_id = %session_id,
            after_seq,
            timeout_ms = LIVE_HANDLE_ATTACH_TIMEOUT.as_millis(),
            "[workspace-latency] session.sse.await_live_handle.start"
        );
        stream::once(wait_for_live_receiver(acp_manager, session_id.clone()))
            .flat_map(move |rx| {
                let Some(rx) = rx else {
                    return stream::empty().boxed();
                };
                let after_seq = max_sent_seq.load(Ordering::Acquire);
                let replay_started = Instant::now();
                let replay = match session_service.list_session_event_records(
                    &session_id,
                    Some(after_seq),
                    None,
                    None,
                    None,
                ) {
                    Ok(Some(records)) => records
                        .into_iter()
                        .filter_map(event_record_to_envelope)
                        .collect::<Vec<_>>(),
                    Ok(None) => Vec::new(),
                    Err(error) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %error,
                            "[workspace-latency] session.sse.await_live_handle.replay_failed"
                        );
                        Vec::new()
                    }
                };
                tracing::info!(
                    session_id = %session_id,
                    after_seq,
                    replay_count = replay.len(),
                    elapsed_ms = replay_started.elapsed().as_millis(),
                    "[workspace-latency] session.sse.await_live_handle.replay"
                );
                let replay_stream = stream::iter(replay.into_iter().filter_map({
                    let max_sent_seq = max_sent_seq.clone();
                    move |envelope| {
                        let last_sent = max_sent_seq.load(Ordering::Acquire);
                        if envelope.seq <= last_sent {
                            return None;
                        }
                        max_sent_seq.store(envelope.seq, Ordering::Release);
                        envelope_to_event(envelope)
                    }
                }));
                replay_stream
                    .chain(live_receiver_stream(rx, max_sent_seq.clone()))
                    .boxed()
            })
            .boxed()
    };
    let stream = backlog_stream.chain(live_stream).boxed();

    Ok(Sse::new(stream))
}

async fn wait_for_live_receiver(
    acp_manager: crate::acp::manager::AcpManager,
    session_id: String,
) -> Option<broadcast::Receiver<SessionEventEnvelope>> {
    let started = Instant::now();
    while started.elapsed() < LIVE_HANDLE_ATTACH_TIMEOUT {
        if let Some(handle) = acp_manager.get_handle(&session_id).await {
            tracing::info!(
                session_id = %session_id,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] session.sse.await_live_handle.attached"
            );
            return Some(handle.subscribe());
        }
        sleep(LIVE_HANDLE_ATTACH_INTERVAL).await;
    }

    tracing::warn!(
        session_id = %session_id,
        elapsed_ms = started.elapsed().as_millis(),
        "[workspace-latency] session.sse.await_live_handle.timeout"
    );
    None
}

fn live_receiver_stream(
    rx: broadcast::Receiver<SessionEventEnvelope>,
    max_sent_seq: Arc<AtomicI64>,
) -> BoxStream<'static, Result<Event, Infallible>> {
    BroadcastStream::new(rx)
        .filter_map(move |result| {
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
        })
        .boxed()
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
