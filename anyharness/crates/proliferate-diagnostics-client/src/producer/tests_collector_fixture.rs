//! The hand-served loopback collector used by the producer suites.
//!
//! No collector crate and no HTTP server dependency: every request body is
//! retained so a test can assert on the exact batch that crossed the wire.

#![allow(dead_code)]

use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use proliferate_diagnostics_protocol::v1::{
    limits::CURRENT_SCHEMA_VERSION,
    types::{
        AcceptedOrderRangeV1, IngestBatchV1, IngestReceiptV1, IngestRejectionV1, PressureV1,
        ProducerRecordV1,
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use super::tests_support::TEST_CAPABILITY;
use super::{transport::CollectorClient, CollectorAvailability};
use crate::bridge::activation::CollectorGenerationHandle;

/// The response the fixture writes for one accepted request.
pub(super) enum FixtureResponse {
    Receipt(IngestReceiptV1),
    /// A 200 response with arbitrary body bytes, for malformed receipts.
    RawBody(Vec<u8>),
    /// Declares a longer body than it writes, then closes: a mid-body close.
    Truncated,
    /// Closes the connection without writing any response byte.
    Hangup,
    /// Holds the response past the 500 ms transport deadline.
    Delayed(Duration, IngestReceiptV1),
}

type Responder = Box<dyn Fn(usize, &IngestBatchV1) -> FixtureResponse + Send + Sync>;

struct FixtureShared {
    responder: Responder,
    batches: Mutex<Vec<IngestBatchV1>>,
    request_lines: Mutex<Vec<String>>,
    content_types: Mutex<Vec<String>>,
    body_bytes: Mutex<Vec<usize>>,
    in_flight: AtomicUsize,
    peak_in_flight: AtomicUsize,
}

/// A loopback collector served by hand: no collector crate, no HTTP server
/// dependency, and every request body retained for exact batch assertions.
pub(super) struct CollectorFixture {
    endpoint: String,
    boot_id: String,
    shared: Arc<FixtureShared>,
}

impl CollectorFixture {
    pub(super) async fn start(
        boot_id: &str,
        responder: impl Fn(usize, &IngestBatchV1) -> FixtureResponse + Send + Sync + 'static,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback listener");
        let port = listener.local_addr().expect("listener address").port();
        let shared = Arc::new(FixtureShared {
            responder: Box::new(responder),
            batches: Mutex::new(Vec::new()),
            request_lines: Mutex::new(Vec::new()),
            content_types: Mutex::new(Vec::new()),
            body_bytes: Mutex::new(Vec::new()),
            in_flight: AtomicUsize::new(0),
            peak_in_flight: AtomicUsize::new(0),
        });
        tokio::spawn(accept_loop(listener, Arc::clone(&shared)));
        Self {
            endpoint: format!("http://127.0.0.1:{port}/"),
            boot_id: boot_id.to_owned(),
            shared,
        }
    }

    /// A fixture that always returns a coherent whole-batch acceptance.
    pub(super) async fn accepting(boot_id: &str) -> Self {
        let owned = boot_id.to_owned();
        Self::start(boot_id, move |_, batch| {
            FixtureResponse::Receipt(accepted_receipt(&owned, batch.records.len()))
        })
        .await
    }

    pub(super) fn boot_id(&self) -> &str {
        &self.boot_id
    }

    pub(super) fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub(super) fn batches(&self) -> Vec<IngestBatchV1> {
        self.shared.batches.lock().expect("batches").clone()
    }

    pub(super) fn batch_count(&self) -> usize {
        self.shared.batches.lock().expect("batches").len()
    }

    pub(super) fn records(&self) -> Vec<ProducerRecordV1> {
        self.batches()
            .into_iter()
            .flat_map(|batch| batch.records)
            .collect()
    }

    pub(super) fn request_lines(&self) -> Vec<String> {
        self.shared
            .request_lines
            .lock()
            .expect("request lines")
            .clone()
    }

    pub(super) fn content_types(&self) -> Vec<String> {
        self.shared
            .content_types
            .lock()
            .expect("content types")
            .clone()
    }

    pub(super) fn body_bytes(&self) -> Vec<usize> {
        self.shared.body_bytes.lock().expect("body bytes").clone()
    }

    pub(super) fn peak_in_flight(&self) -> usize {
        self.shared.peak_in_flight.load(Ordering::SeqCst)
    }

    pub(super) fn generation(&self, number: u64) -> CollectorGenerationHandle {
        CollectorGenerationHandle {
            generation: number,
            collector_boot_id: self.boot_id.clone(),
            client: Arc::new(
                CollectorClient::new(&self.endpoint, TEST_CAPABILITY.to_owned())
                    .expect("loopback collector client"),
            ),
        }
    }

    pub(super) fn ready(&self, number: u64) -> CollectorAvailability {
        CollectorAvailability::Ready(Arc::new(self.generation(number)))
    }
}

/// A ready generation whose loopback port has no listener: the connect fails
/// before any byte is written, which is the transient same-generation failure.
pub(super) async fn refused_generation(number: u64, boot_id: &str) -> CollectorGenerationHandle {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("loopback listener");
    let port = listener.local_addr().expect("listener address").port();
    drop(listener);
    CollectorGenerationHandle {
        generation: number,
        collector_boot_id: boot_id.to_owned(),
        client: Arc::new(
            CollectorClient::new(
                &format!("http://127.0.0.1:{port}/"),
                TEST_CAPABILITY.to_owned(),
            )
            .expect("loopback collector client"),
        ),
    }
}

pub(super) fn accepted_receipt(boot_id: &str, count: usize) -> IngestReceiptV1 {
    receipt(boot_id, count, 0, Vec::new(), PressureV1::Normal)
}

pub(super) fn receipt(
    boot_id: &str,
    accepted: usize,
    duplicate: usize,
    rejections: Vec<IngestRejectionV1>,
    pressure: PressureV1,
) -> IngestReceiptV1 {
    let accepted = u16::try_from(accepted).expect("bounded accepted count");
    IngestReceiptV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        accepted_range: (accepted > 0).then(|| AcceptedOrderRangeV1 {
            first: 1,
            last: u64::from(accepted),
        }),
        collector_boot_id: boot_id.to_owned(),
        accepted_count: accepted,
        duplicate_count: u16::try_from(duplicate).expect("bounded duplicate count"),
        rejections,
        pressure,
    }
}

async fn accept_loop(listener: TcpListener, shared: Arc<FixtureShared>) {
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(serve_connection(stream, Arc::clone(&shared)));
    }
}

async fn serve_connection(mut stream: TcpStream, shared: Arc<FixtureShared>) {
    let mut buffered = Vec::new();
    loop {
        let Some(request) = read_request(&mut stream, &mut buffered).await else {
            return;
        };
        let live = shared.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        shared.peak_in_flight.fetch_max(live, Ordering::SeqCst);
        let batch: IngestBatchV1 =
            serde_json::from_slice(&request.body).expect("schema 1.1 ingest batch");
        let ordinal = {
            let mut batches = shared.batches.lock().expect("batches");
            batches.push(batch.clone());
            batches.len()
        };
        shared
            .request_lines
            .lock()
            .expect("request lines")
            .push(request.line.clone());
        shared
            .content_types
            .lock()
            .expect("content types")
            .push(request.content_type.clone());
        shared
            .body_bytes
            .lock()
            .expect("body bytes")
            .push(request.body.len());
        let response = (shared.responder)(ordinal, &batch);
        let written = write_response(&mut stream, response).await;
        shared.in_flight.fetch_sub(1, Ordering::SeqCst);
        if !written {
            return;
        }
    }
}

async fn write_response(stream: &mut TcpStream, response: FixtureResponse) -> bool {
    let bytes = match response {
        FixtureResponse::Receipt(receipt) => http_response(
            200,
            &serde_json::to_vec(&receipt).expect("serializable receipt"),
        ),
        FixtureResponse::RawBody(body) => http_response(200, &body),
        FixtureResponse::Truncated => {
            let mut bytes = b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 4096\r\n\r\n".to_vec();
            bytes.extend_from_slice(b"{\"schema_ver");
            let _ = stream.write_all(&bytes).await;
            let _ = stream.flush().await;
            return false;
        }
        FixtureResponse::Hangup => return false,
        FixtureResponse::Delayed(delay, receipt) => {
            tokio::time::sleep(delay).await;
            http_response(
                200,
                &serde_json::to_vec(&receipt).expect("serializable receipt"),
            )
        }
    };
    stream.write_all(&bytes).await.is_ok() && stream.flush().await.is_ok()
}

fn http_response(status: u16, body: &[u8]) -> Vec<u8> {
    let mut bytes = format!(
        "HTTP/1.1 {status} STATUS\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: keep-alive\r\n\r\n",
        body.len()
    )
    .into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

struct FixtureRequest {
    line: String,
    content_type: String,
    body: Vec<u8>,
}

async fn read_request(stream: &mut TcpStream, buffered: &mut Vec<u8>) -> Option<FixtureRequest> {
    loop {
        if let Some(head_end) = find_head_end(buffered) {
            let head = String::from_utf8_lossy(&buffered[..head_end]).into_owned();
            let total = head_end + 4 + content_length(&head);
            if buffered.len() >= total {
                let body = buffered[head_end + 4..total].to_vec();
                buffered.drain(..total);
                let mut lines = head.lines();
                let line = lines.next()?.to_owned();
                let content_type = header(&head, "content-type").unwrap_or_default();
                return Some(FixtureRequest {
                    line,
                    content_type,
                    body,
                });
            }
        }
        let mut chunk = [0_u8; 8_192];
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffered.extend_from_slice(&chunk[..read]);
    }
}

fn find_head_end(buffered: &[u8]) -> Option<usize> {
    buffered.windows(4).position(|window| window == b"\r\n\r\n")
}

fn content_length(head: &str) -> usize {
    header(head, "content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn header(head: &str, name: &str) -> Option<String> {
    head.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then(|| value.trim().to_owned())
    })
}
