use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, RawQuery, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream;
use proliferate_diagnostics_protocol::v1::limits::{MAX_BATCH_BYTES, MAX_BATCH_RECORDS};
use proliferate_diagnostics_protocol::v1::types::{
    ExportRequestV1, ExportStreamFrameV1, RejectionReasonV1, TailFrameV1, TerminalOutcomeV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    parse_ingest_batch_value, parse_producer_record_value, validate_export_frame,
    validate_export_request, validate_tail_frame,
};
use tokio::sync::{broadcast, OwnedSemaphorePermit};

use crate::auth::{authorize, RequestGuard};
use crate::state::{CollectorCore, ExportSnapshot, IngestCandidate, StoredRecord};
use crate::transport_query::{parse_records_query, parse_tail_cursor};

#[derive(Clone)]
struct HttpState {
    core: Arc<CollectorCore>,
}

pub(crate) fn router(core: Arc<CollectorCore>, capability: &[u8]) -> Result<Router, &'static str> {
    let guard = Arc::new(RequestGuard::new(
        capability,
        core.limits.concurrent_handlers,
    )?);
    let state = HttpState { core };
    Ok(Router::new()
        .route("/v1/ingest", post(ingest))
        .route("/v1/records", get(records))
        .route("/v1/tail", get(tail))
        .route("/v1/export", post(export))
        .route("/v1/health", get(health))
        .layer(DefaultBodyLimit::max(MAX_BATCH_BYTES + 1))
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
    body: Bytes,
) -> Result<Json<proliferate_diagnostics_protocol::v1::types::IngestReceiptV1>, ApiError> {
    if !state.core.accepting_ingest() {
        return Err(ApiError {
            status: StatusCode::SERVICE_UNAVAILABLE,
            reason: RejectionReasonV1::LimitExceeded,
        });
    }
    if body.len() > MAX_BATCH_BYTES {
        state
            .core
            .note_request_rejection(RejectionReasonV1::BatchTooLarge);
        return Err(ApiError::from_reason(RejectionReasonV1::BatchTooLarge));
    }
    let mut value: serde_json::Value = serde_json::from_slice(&body).map_err(|_| {
        state
            .core
            .note_request_rejection(RejectionReasonV1::InvalidShape);
        ApiError::from_reason(RejectionReasonV1::InvalidShape)
    })?;
    let raw_records = value
        .get("records")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .ok_or_else(|| {
            state
                .core
                .note_request_rejection(RejectionReasonV1::InvalidShape);
            ApiError::from_reason(RejectionReasonV1::InvalidShape)
        })?;
    if raw_records.len() > MAX_BATCH_RECORDS {
        state
            .core
            .note_request_rejection(RejectionReasonV1::BatchTooLarge);
        return Err(ApiError::from_reason(RejectionReasonV1::BatchTooLarge));
    }
    value
        .as_object_mut()
        .ok_or_else(|| ApiError::from_reason(RejectionReasonV1::InvalidShape))?
        .insert("records".to_owned(), serde_json::Value::Array(Vec::new()));
    if let Err(reason) = parse_ingest_batch_value(&value) {
        state.core.note_request_rejection(reason);
        return Err(ApiError::from_reason(reason));
    }
    let candidates = raw_records
        .iter()
        .enumerate()
        .map(|(index, value)| IngestCandidate {
            index: index as u16,
            parsed: parse_producer_record_value(value),
        })
        .collect();
    let result = state
        .core
        .ingest_candidates(candidates)
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

async fn export(State(state): State<HttpState>, body: Bytes) -> Result<Response, ApiError> {
    if body.len() > MAX_BATCH_BYTES {
        state
            .core
            .note_request_rejection(RejectionReasonV1::BatchTooLarge);
        return Err(ApiError::from_reason(RejectionReasonV1::BatchTooLarge));
    }
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
    let operation_id = state
        .core
        .begin_export()
        .map_err(|_| ApiError::internal())?;
    let snapshot = match state.core.export_snapshot(&request) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let reason = error.contract_reason();
            let _ = state.core.finish_export(
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
                    let _ = self.core.finish_export(
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
            let _ = self
                .core
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
            let _ = self
                .core
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
