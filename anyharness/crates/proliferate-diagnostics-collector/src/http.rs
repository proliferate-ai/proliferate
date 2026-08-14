use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::{RawQuery, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::{stream, StreamExt};
use proliferate_diagnostics_protocol::v1::limits::{MAX_BATCH_BYTES, MAX_BATCH_RECORDS};
use proliferate_diagnostics_protocol::v1::types::{
    ExportRequestV1, ExportStreamFrameV1, RejectionReasonV1, TailFrameV1, TerminalOutcomeV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_export_frame, validate_export_request, validate_tail_frame,
};
use tokio::sync::{broadcast, OwnedSemaphorePermit, Semaphore};

use crate::auth::{authorize, RequestGuard};
use crate::ingest_body::{parse_ingest_body, MAX_PREPARED_BATCH_BYTES};
use crate::state::{CollectorCore, ExportSnapshot, StoredRecord};
use crate::transport_query::{parse_records_query, parse_tail_cursor};

#[derive(Clone)]
struct HttpState {
    core: Arc<CollectorCore>,
    body_parse_slots: Arc<Semaphore>,
}

pub(crate) fn router(core: Arc<CollectorCore>, capability: &[u8]) -> Result<Router, &'static str> {
    let guard = Arc::new(RequestGuard::new(
        capability,
        core.limits.concurrent_handlers,
    )?);
    let body_parse_slots = Arc::new(Semaphore::new(core.limits.concurrent_body_parsers));
    let state = HttpState {
        core,
        body_parse_slots,
    };
    Ok(Router::new()
        .route("/v1/ingest", post(ingest))
        .route("/v1/records", get(records))
        .route("/v1/tail", get(tail))
        .route("/v1/export", post(export))
        .route("/v1/health", get(health))
        .layer(middleware::from_fn_with_state(guard, authorize))
        .with_state(state))
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    reason: RejectionReasonV1,
}

impl ApiError {
    fn from_reason(reason: RejectionReasonV1) -> Self {
        let status = match reason {
            RejectionReasonV1::RecordTooLarge | RejectionReasonV1::BatchTooLarge => {
                StatusCode::PAYLOAD_TOO_LARGE
            }
            RejectionReasonV1::UnsupportedMajor | RejectionReasonV1::UnsupportedMinor => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            _ => StatusCode::BAD_REQUEST,
        };
        Self { status, reason }
    }

    fn internal() -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            reason: RejectionReasonV1::InvalidShape,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.reason)).into_response()
    }
}

async fn ingest(
    State(state): State<HttpState>,
    request: Request,
) -> Result<Json<proliferate_diagnostics_protocol::v1::types::IngestReceiptV1>, ApiError> {
    if !state.core.accepting_ingest() {
        return Err(ApiError {
            status: StatusCode::SERVICE_UNAVAILABLE,
            reason: RejectionReasonV1::LimitExceeded,
        });
    }
    let _parse_permit = Arc::clone(&state.body_parse_slots)
        .acquire_owned()
        .await
        .map_err(|_| ApiError::internal())?;
    let body = bounded_request_body(&state, request).await?;
    let parsed = parse_ingest_body(&body).map_err(|reason| {
        state.core.note_request_rejection(reason);
        ApiError::from_reason(reason)
    })?;
    debug_assert!(parsed.raw_record_count <= MAX_BATCH_RECORDS);
    debug_assert!(parsed.prepared_bytes <= MAX_PREPARED_BATCH_BYTES);
    let result = state
        .core
        .ingest_candidates(parsed.candidates)
        .map_err(|_| ApiError::internal())?;
    Ok(Json(result.receipt))
}

async fn records(
    State(state): State<HttpState>,
    RawQuery(raw): RawQuery,
) -> Result<Json<proliferate_diagnostics_protocol::v1::types::RecordsPageV1>, ApiError> {
    let query = parse_records_query(raw.as_deref()).map_err(|reason| {
        state.core.note_request_rejection(reason);
        ApiError::from_reason(reason)
    })?;
    let page = state.core.query(&query).map_err(|error| {
        let reason = error.contract_reason();
        state.core.note_request_rejection(reason);
        ApiError::from_reason(reason)
    })?;
    Ok(Json(page))
}

async fn health(
    State(state): State<HttpState>,
) -> Result<Json<proliferate_diagnostics_protocol::v1::types::HealthResponseV1>, ApiError> {
    state
        .core
        .health()
        .map(Json)
        .map_err(|_| ApiError::internal())
}

async fn tail(
    State(state): State<HttpState>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let cursor = parse_tail_cursor(raw.as_deref()).map_err(|reason| {
        state.core.note_request_rejection(reason);
        ApiError::from_reason(reason)
    })?;
    let permit = Arc::clone(&state.core.tail_slots)
        .try_acquire_owned()
        .map_err(|_| ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            reason: RejectionReasonV1::LimitExceeded,
        })?;
    let receiver = state.core.subscribe_tail();
    let tail = TailStream {
        core: state.core,
        receiver,
        _permit: permit,
        cursor,
        pending: VecDeque::new(),
        catching_up: true,
        done: false,
    };
    let stream = stream::unfold(tail, |mut tail| async move {
        let frame = tail.next_frame().await?;
        let bytes = encode_line(&frame).ok()?;
        Some((Ok::<Bytes, Infallible>(bytes), tail))
    });
    let mut response = Response::new(Body::from_stream(stream));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/x-ndjson"),
    );
    Ok(response)
}

struct TailStream {
    core: Arc<CollectorCore>,
    receiver: broadcast::Receiver<Arc<[u8]>>,
    _permit: OwnedSemaphorePermit,
    cursor: u64,
    pending: VecDeque<TailFrameV1>,
    catching_up: bool,
    done: bool,
}

impl TailStream {
    async fn next_frame(&mut self) -> Option<TailFrameV1> {
        loop {
            if let Some(frame) = self.pending.pop_front() {
                return Some(frame);
            }
            if self.done {
                return None;
            }
            if self.catching_up {
                let page = self.core.tail_page(self.cursor).ok()?;
                if let Some(gap) = page.gap {
                    self.cursor = gap.to_cursor.unwrap_or(self.cursor);
                    self.pending.push_back(TailFrameV1::Gap { gap });
                }
                if !page.records.is_empty() {
                    self.cursor = page
                        .records
                        .last()
                        .map_or(self.cursor, |record| record.retention_cursor);
                    self.pending.push_back(TailFrameV1::Records {
                        records: page.records,
                        cursor: self.cursor,
                    });
                }
                self.catching_up = !page.caught_up;
                if !self.pending.is_empty() {
                    continue;
                }
                if self.catching_up {
                    continue;
                }
            }
            match self.receiver.recv().await {
                Ok(encoded) => {
                    let record: proliferate_diagnostics_protocol::v1::types::CollectorAcceptedRecordV1 =
                        serde_json::from_slice(&encoded).ok()?;
                    if record.retention_cursor <= self.cursor {
                        continue;
                    }
                    self.cursor = record.retention_cursor;
                    return Some(TailFrameV1::Records {
                        records: vec![record],
                        cursor: self.cursor,
                    });
                }
                Err(broadcast::error::RecvError::Lagged(dropped)) => {
                    self.core.note_tail_drop(dropped);
                    self.done = true;
                    return Some(TailFrameV1::Lag {
                        dropped_frames: dropped,
                        resume_after_cursor: self.cursor,
                    });
                }
                Err(broadcast::error::RecvError::Closed) => {
                    self.done = true;
                    return None;
                }
            }
        }
    }
}

async fn export(State(state): State<HttpState>, request: Request) -> Result<Response, ApiError> {
    let _parse_permit = Arc::clone(&state.body_parse_slots)
        .acquire_owned()
        .await
        .map_err(|_| ApiError::internal())?;
    let body = bounded_request_body(&state, request).await?;
    let request: ExportRequestV1 = serde_json::from_slice(&body).map_err(|_| {
        state
            .core
            .note_request_rejection(RejectionReasonV1::InvalidShape);
        ApiError::from_reason(RejectionReasonV1::InvalidShape)
    })?;
    validate_export_request(&request).map_err(|reason| {
        state.core.note_request_rejection(reason);
        ApiError::from_reason(reason)
    })?;
    let permit = Arc::clone(&state.core.export_slots)
        .try_acquire_owned()
        .map_err(|_| ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            reason: RejectionReasonV1::LimitExceeded,
        })?;
    let operation_id = state.core.begin_export();
    let snapshot = match state.core.export_snapshot(&request) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let reason = error.contract_reason();
            state.core.finish_export(
                &operation_id,
                TerminalOutcomeV1::Failed,
                Some("snapshot_selection_failed"),
            );
            return Err(ApiError::from_reason(reason));
        }
    };
    let export = ExportStream::new(state.core, operation_id, permit, snapshot);
    let stream = stream::unfold(export, |mut export| async move {
        // Give cancellation a deterministic observation point between every
        // bounded frame instead of draining a whole snapshot in one poll.
        tokio::task::yield_now().await;
        let frame = export.next_frame()?;
        let bytes = encode_line(&frame).ok()?;
        Some((Ok::<Bytes, Infallible>(bytes), export))
    });
    let mut response = Response::new(Body::from_stream(stream));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/x-ndjson"),
    );
    Ok(response)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BodyReadError {
    TooLarge,
    Invalid,
    TimedOut,
}

async fn bounded_request_body(state: &HttpState, request: Request) -> Result<Bytes, ApiError> {
    // A peer that opens a body and then stalls would otherwise hold the
    // body-parse permit, and through it the handler permit, until it
    // disconnects. Bounding the read keeps a stalled peer from wedging ingest
    // and every other route collector-wide.
    let deadline = state.core.limits.body_read_deadline;
    let read = tokio::time::timeout(deadline, read_bounded_body(request, MAX_BATCH_BYTES))
        .await
        .unwrap_or(Err(BodyReadError::TimedOut));
    read.map_err(|error| {
        let reason = match error {
            BodyReadError::TooLarge => RejectionReasonV1::BatchTooLarge,
            BodyReadError::Invalid | BodyReadError::TimedOut => RejectionReasonV1::InvalidShape,
        };
        state.core.note_request_rejection(reason);
        if error == BodyReadError::TimedOut {
            return ApiError {
                status: StatusCode::REQUEST_TIMEOUT,
                reason,
            };
        }
        ApiError::from_reason(reason)
    })
}

async fn read_bounded_body(request: Request, limit: usize) -> Result<Bytes, BodyReadError> {
    let declared_length = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .map(|value| {
            value
                .to_str()
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .ok_or(BodyReadError::Invalid)
        })
        .transpose()?;
    if declared_length.is_some_and(|length| length > limit as u64) {
        return Err(BodyReadError::TooLarge);
    }

    // `concurrent_body_parsers` requests may each own a body at once, so the
    // request-body heap bound across ingest and export is that many times
    // `limit`, not a single `limit`. Reserving the declared length keeps an
    // undeclared body growing on demand instead of taking the whole cap up
    // front.
    let mut buffered = Vec::with_capacity(
        declared_length
            .map_or(0, |length| length as usize)
            .min(limit),
    );
    let mut stream = request.into_body().into_data_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| BodyReadError::Invalid)?;
        if chunk.len() > limit.saturating_sub(buffered.len()) {
            return Err(BodyReadError::TooLarge);
        }
        buffered.extend_from_slice(&chunk);
    }
    Ok(buffered.into())
}

struct ExportStream {
    core: Arc<CollectorCore>,
    operation_id: String,
    _permit: OwnedSemaphorePermit,
    manifest: Option<proliferate_diagnostics_protocol::v1::types::ExportManifestV1>,
    records: std::vec::IntoIter<StoredRecord>,
    gaps: std::vec::IntoIter<proliferate_diagnostics_protocol::v1::types::GapV1>,
    health: Option<proliferate_diagnostics_protocol::v1::types::HealthResponseV1>,
    record_count: u32,
    record_bytes: u64,
    ended: bool,
    completed: bool,
}

impl ExportStream {
    fn new(
        core: Arc<CollectorCore>,
        operation_id: String,
        permit: OwnedSemaphorePermit,
        snapshot: ExportSnapshot,
    ) -> Self {
        let record_count = snapshot.records.len() as u32;
        Self {
            core,
            operation_id,
            _permit: permit,
            manifest: Some(snapshot.manifest),
            records: snapshot.records.into_iter(),
            gaps: snapshot.gaps.into_iter(),
            health: snapshot.health,
            record_count,
            record_bytes: snapshot.record_bytes,
            ended: false,
            completed: false,
        }
    }

    fn next_frame(&mut self) -> Option<ExportStreamFrameV1> {
        if let Some(manifest) = self.manifest.take() {
            return Some(ExportStreamFrameV1::Manifest { manifest });
        }
        if let Some(stored) = self.records.next() {
            let record = match stored.decode() {
                Ok(record) => record,
                Err(_) => {
                    self.core.finish_export(
                        &self.operation_id,
                        TerminalOutcomeV1::Failed,
                        Some("snapshot_decode_failed"),
                    );
                    self.completed = true;
                    return None;
                }
            };
            return Some(ExportStreamFrameV1::Record { record });
        }
        if let Some(gap) = self.gaps.next() {
            return Some(ExportStreamFrameV1::Gap { gap });
        }
        if let Some(health) = self.health.take() {
            return Some(ExportStreamFrameV1::Health { health });
        }
        if !self.ended {
            self.ended = true;
            self.core
                .finish_export(&self.operation_id, TerminalOutcomeV1::Succeeded, None);
            self.completed = true;
            return Some(ExportStreamFrameV1::End {
                records: self.record_count,
                bytes: self.record_bytes,
            });
        }
        None
    }
}

impl Drop for ExportStream {
    fn drop(&mut self) {
        if !self.completed {
            self.core
                .finish_export(&self.operation_id, TerminalOutcomeV1::Cancelled, None);
        }
    }
}

fn encode_line<T: serde::Serialize + FrameValidation>(frame: &T) -> Result<Bytes, ()> {
    frame.validate()?;
    let mut bytes = serde_json::to_vec(frame).map_err(|_| ())?;
    bytes.push(b'\n');
    Ok(bytes.into())
}

trait FrameValidation {
    fn validate(&self) -> Result<(), ()>;
}

impl FrameValidation for TailFrameV1 {
    fn validate(&self) -> Result<(), ()> {
        validate_tail_frame(self).map_err(|_| ())
    }
}

impl FrameValidation for ExportStreamFrameV1 {
    fn validate(&self) -> Result<(), ()> {
        validate_export_frame(self).map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[tokio::test]
    async fn declared_oversize_is_rejected_without_polling_the_body() {
        let polled = Arc::new(AtomicUsize::new(0));
        let stream_polled = Arc::clone(&polled);
        let body = Body::from_stream(stream::once(async move {
            stream_polled.fetch_add(1, Ordering::SeqCst);
            Ok::<Bytes, Infallible>(Bytes::from_static(b"never read"))
        }));
        let request = Request::builder()
            .header(header::CONTENT_LENGTH, MAX_BATCH_BYTES * 5)
            .body(body)
            .expect("oversized request");

        assert_eq!(
            read_bounded_body(request, MAX_BATCH_BYTES).await,
            Err(BodyReadError::TooLarge)
        );
        assert_eq!(polled.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn chunked_oversize_stops_on_the_first_overflowing_chunk() {
        let produced = Arc::new(AtomicUsize::new(0));
        let stream_produced = Arc::clone(&produced);
        let chunk_bytes = MAX_BATCH_BYTES / 4;
        let body = Body::from_stream(stream::unfold(0_usize, move |index| {
            let produced = Arc::clone(&stream_produced);
            async move {
                if index == 10 {
                    return None;
                }
                produced.fetch_add(1, Ordering::SeqCst);
                Some((
                    Ok::<Bytes, Infallible>(Bytes::from(vec![b'x'; chunk_bytes])),
                    index + 1,
                ))
            }
        }));
        let request = Request::new(body);

        assert_eq!(
            read_bounded_body(request, MAX_BATCH_BYTES).await,
            Err(BodyReadError::TooLarge)
        );
        assert_eq!(produced.load(Ordering::SeqCst), 5);
    }
}
