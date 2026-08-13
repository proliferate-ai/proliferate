use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use proliferate_diagnostics_collector::{CollectorConfig, CollectorServer, RuntimeLimits};
use proliferate_diagnostics_protocol::v1::limits::{
    COLLECTOR_TOTAL_RSS_LIMIT_BYTES, CURRENT_SCHEMA_VERSION, MAX_ARGUMENTS, MAX_ARGUMENT_DEPTH,
    MAX_ARGUMENT_LIST_ITEMS, MAX_ARGUMENT_OBJECT_FIELDS, MAX_BATCH_BYTES, MAX_BATCH_RECORDS,
    MAX_CARDINALITY_ENTRIES, MAX_EXPORT_BYTES, MAX_EXPORT_RECORDS, MAX_FILTER_VALUES,
    MAX_HEALTH_PRODUCERS, MAX_ID_BYTES, MAX_MESSAGE_BYTES, MAX_NAME_BYTES, MAX_PAGE_RECORDS,
    MAX_RECORD_BYTES, MAX_SAFE_INTEGER, MAX_STRING_BYTES, MAX_TAIL_FRAME_RECORDS,
    MAX_VERSIONS_PRESENT, RETAINED_RECORD_ARENA_LIMIT_BYTES,
};
use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ConnectionDescriptorV1, ExportRequestV1, ExportStreamFrameV1,
    HealthResponseV1, IngestReceiptV1, LifecycleFinalizerV1, ProducerHealthV1, ProducerLivenessV1,
    RecordsPageV1, RejectionReasonV1, RssMeasurementProfileV1, TailFrameV1, TerminalOutcomeV1,
    VersionCountV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    parse_producer_record_value, validate_export_request, validate_health, validate_records_page,
    validate_rss_profile, validate_tail_frame,
};

const CAPABILITY: &str = "collector-test-capability-7f62";

fn fixture_records() -> Vec<serde_json::Value> {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/records.json"
    )))
    .expect("valid records fixture");
    fixture["records"].as_array().expect("record array").clone()
}

fn batch(records: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "records": records,
    })
}

fn pad_compact_json_to(value: &mut serde_json::Value, field: &str, target: usize) {
    value[field] = serde_json::json!("");
    let base = serde_json::to_vec(value).expect("compact JSON").len();
    assert!(base <= target, "base JSON exceeds target");
    value[field] = serde_json::json!("x".repeat(target - base));
    assert_eq!(
        serde_json::to_vec(value)
            .expect("padded compact JSON")
            .len(),
        target
    );
}

fn accepted_fixture_record() -> CollectorAcceptedRecordV1 {
    CollectorAcceptedRecordV1 {
        record: parse_producer_record_value(&fixture_records()[0]).expect("fixture record"),
        accepted_timestamp: "2026-08-11T00:00:00.000Z".to_owned(),
        accepted_order: 1,
        retention_cursor: 1,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("test client")
}

struct CollectorChild {
    child: Child,
    control: UnixStream,
}

impl CollectorChild {
    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn shutdown(&mut self) {
        writeln!(self.control, "{{\"command\":\"shutdown\"}}").expect("write child shutdown");
        self.control.flush().expect("flush child shutdown");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.child.try_wait().expect("poll child") {
                assert!(status.success(), "collector child failed: {status}");
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "collector child did not stop"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for CollectorChild {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn spawn_collector_child(working_directory: &std::path::Path) -> (CollectorChild, String) {
    let (mut capability_writer, capability_reader) = UnixStream::pair().expect("capability pair");
    let (control_writer, control_reader) = UnixStream::pair().expect("control pair");
    clear_cloexec(capability_reader.as_raw_fd());
    clear_cloexec(control_reader.as_raw_fd());
    let mut child = Command::new(env!("CARGO_BIN_EXE_proliferate-diagnostics-collector"))
        .arg("--capability-fd")
        .arg(capability_reader.as_raw_fd().to_string())
        .arg("--control-fd")
        .arg(control_reader.as_raw_fd().to_string())
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn collector child");
    drop(capability_reader);
    drop(control_reader);
    writeln!(capability_writer, "{CAPABILITY}").expect("write child capability");
    capability_writer
        .shutdown(Shutdown::Write)
        .expect("close child capability channel");
    let mut stdout = BufReader::new(child.stdout.take().expect("collector child stdout"));
    let mut descriptor_line = String::new();
    stdout
        .read_line(&mut descriptor_line)
        .expect("read collector child descriptor");
    let descriptor: ConnectionDescriptorV1 =
        serde_json::from_str(&descriptor_line).expect("collector child descriptor JSON");
    (
        CollectorChild {
            child,
            control: control_writer,
        },
        descriptor.endpoint,
    )
}

fn process_rss_bytes(pid: u32) -> Option<u64> {
    let pid = pid.to_string();
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", pid.as_str()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let kibibytes = std::str::from_utf8(&output.stdout)
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()?;
    kibibytes.checked_mul(1024)
}

async fn start() -> CollectorServer {
    CollectorServer::start(CollectorConfig::standalone(CAPABILITY))
        .await
        .expect("collector starts")
}

async fn post_ingest(server: &CollectorServer, value: &serde_json::Value) -> reqwest::Response {
    client()
        .post(format!("{}/v1/ingest", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .body(serde_json::to_vec(value).expect("serialize ingest"))
        .send()
        .await
        .expect("ingest response")
}

async fn get_health(server: &CollectorServer) -> HealthResponseV1 {
    client()
        .get(format!("{}/v1/health", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("health response")
        .error_for_status()
        .expect("health status")
        .json()
        .await
        .expect("health body")
}

async fn query(server: &CollectorServer, suffix: &str) -> RecordsPageV1 {
    client()
        .get(format!(
            "{}/v1/records?schema_version=1.1{}",
            server.endpoint(),
            suffix
        ))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("query response")
        .error_for_status()
        .expect("query status")
        .json()
        .await
        .expect("query body")
}

#[tokio::test]
async fn authenticated_loopback_distinguishes_liveness_from_readiness() {
    let mut config = CollectorConfig::standalone(CAPABILITY);
    config.auto_ready = false;
    let server = CollectorServer::start(config)
        .await
        .expect("collector starts");
    assert!(server.endpoint().starts_with("http://127.0.0.1:"));

    let unauthenticated = client()
        .get(format!("{}/v1/health", server.endpoint()))
        .send()
        .await
        .expect("unauthenticated response");
    assert_eq!(unauthenticated.status(), reqwest::StatusCode::UNAUTHORIZED);

    let wrong = client()
        .get(format!("{}/v1/health", server.endpoint()))
        .bearer_auth("wrong-capability")
        .send()
        .await
        .expect("wrong capability response");
    assert_eq!(wrong.status(), reqwest::StatusCode::UNAUTHORIZED);

    let origin = client()
        .get(format!("{}/v1/health", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .header("origin", "http://127.0.0.1:3000")
        .send()
        .await
        .expect("origin response");
    assert_eq!(origin.status(), reqwest::StatusCode::FORBIDDEN);

    let starting = get_health(&server).await;
    assert_eq!(
        starting.status,
        proliferate_diagnostics_protocol::v1::types::HealthStatusV1::Starting
    );
    server.mark_ready();
    let ready = get_health(&server).await;
    assert_eq!(
        ready.status,
        proliferate_diagnostics_protocol::v1::types::HealthStatusV1::Ready
    );
    assert_eq!(ready.restart_count, 0);
    assert_eq!(
        ready.exporter.state,
        proliferate_diagnostics_protocol::v1::types::ExporterStateV1::Disabled
    );
    assert_eq!(ready.exporter.dropped_records, 0);
    assert_eq!(
        ready.fallback.state,
        proliferate_diagnostics_protocol::v1::types::FallbackStateV1::Inactive
    );
    assert_eq!(ready.fallback.bytes, 0);
    assert_eq!(ready.fallback.dropped_records, 0);
    assert!(!serde_json::to_string(&ready).unwrap().contains(CAPABILITY));
    server.shutdown().await.expect("graceful shutdown");
}

#[tokio::test]
async fn far_oversized_and_chunked_bodies_are_json_accounted_without_unbounded_reads() {
    let server = start().await;
    let before = get_health(&server).await;
    let oversized = vec![b'x'; MAX_BATCH_BYTES * 5];

    for route in ["ingest", "export"] {
        let response = client()
            .post(format!("{}/v1/{route}", server.endpoint()))
            .bearer_auth(CAPABILITY)
            .header(reqwest::header::EXPECT, "100-continue")
            .body(oversized.clone())
            .send()
            .await
            .expect("far oversized response");
        assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            response
                .json::<RejectionReasonV1>()
                .await
                .expect("JSON oversized reason"),
            RejectionReasonV1::BatchTooLarge
        );
    }

    let chunks = futures::stream::iter(
        (0..10).map(|_| Ok::<Vec<u8>, std::io::Error>(vec![b'x'; MAX_BATCH_BYTES / 4])),
    );
    let response = client()
        .post(format!("{}/v1/ingest", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .body(reqwest::Body::wrap_stream(chunks))
        .send()
        .await
        .expect("chunked oversized response");
    assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        response
            .json::<RejectionReasonV1>()
            .await
            .expect("chunked JSON oversized reason"),
        RejectionReasonV1::BatchTooLarge
    );

    let health = get_health(&server).await;
    assert_eq!(health.oversized_records, before.oversized_records + 3);
    assert_eq!(
        health
            .rejections_by_reason
            .get(&RejectionReasonV1::BatchTooLarge)
            .copied()
            .unwrap_or(0),
        before
            .rejections_by_reason
            .get(&RejectionReasonV1::BatchTooLarge)
            .copied()
            .unwrap_or(0)
            + 3
    );
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn concurrent_maximum_and_degenerate_ingest_stays_under_the_process_rss_ceiling() {
    fn dense_batch(producer: &str, first_sequence: u64) -> Vec<u8> {
        let template = fixture_records()[0].clone();
        let records = (0..16_u64)
            .map(|offset| {
                let sequence = first_sequence + offset;
                let mut record = template.clone();
                record["producer_boot_id"] = serde_json::json!(producer);
                record["producer_sequence"] = serde_json::json!(sequence);
                record["operation_id"] =
                    serde_json::json!(format!("rss-bound-{producer}-{sequence}"));
                record["detailed"]["message"] = serde_json::json!("m".repeat(MAX_MESSAGE_BYTES));
                record["arguments"] = serde_json::json!((0..9)
                    .map(|argument| serde_json::json!({
                        "name": format!("arg{argument}"),
                        "privacy": "operational",
                        "value": {"type": "string", "value": "v".repeat(MAX_STRING_BYTES)}
                    }))
                    .collect::<Vec<_>>());
                assert!(serde_json::to_vec(&record).unwrap().len() <= MAX_RECORD_BYTES);
                record
            })
            .collect();
        let mut value = batch(records);
        pad_compact_json_to(&mut value, "ignored_padding", MAX_BATCH_BYTES);
        let encoded = serde_json::to_vec(&value).expect("dense batch JSON");
        assert_eq!(encoded.len(), MAX_BATCH_BYTES);
        encoded
    }

    fn degenerate_batch(single_record: bool) -> Vec<u8> {
        let prefix = if single_record {
            br#"{"schema_version":{"major":1,"minor":1},"records":[["#.as_slice()
        } else {
            br#"{"schema_version":{"major":1,"minor":1},"records":["#.as_slice()
        };
        let suffix: &[u8] = if single_record { b"]]}" } else { b"]}" };
        let mut body = Vec::with_capacity(MAX_BATCH_BYTES);
        body.extend_from_slice(prefix);
        while body.len() + suffix.len() + 2 <= MAX_BATCH_BYTES {
            body.extend_from_slice(b"0,");
        }
        body.pop();
        body.extend_from_slice(suffix);
        body
    }

    let temp = tempfile::tempdir().expect("RSS-bound child directory");
    let (mut child, endpoint) = spawn_collector_child(temp.path());
    let http = client();

    for batch_index in 0..10_u64 {
        let response = http
            .post(format!("{endpoint}/v1/ingest"))
            .bearer_auth(CAPABILITY)
            .body(dense_batch("rss-bound-fill", batch_index * 16 + 1))
            .send()
            .await
            .expect("fill ingest response")
            .error_for_status()
            .expect("fill ingest status")
            .json::<IngestReceiptV1>()
            .await
            .expect("fill ingest receipt");
        assert_eq!(response.accepted_count, 16);
    }
    let filled_health = http
        .get(format!("{endpoint}/v1/health"))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("filled health response")
        .error_for_status()
        .expect("filled health status")
        .json::<HealthResponseV1>()
        .await
        .expect("filled health body");
    assert!(filled_health.retained_bytes >= 6 * 1024 * 1024);
    assert!(filled_health.retained_bytes <= 8 * 1024 * 1024);

    let done = Arc::new(AtomicBool::new(false));
    let sampler_done = Arc::clone(&done);
    let pid = child.pid();
    let sampler = std::thread::spawn(move || {
        let mut peak = 0_u64;
        while !sampler_done.load(Ordering::SeqCst) {
            if let Some(rss) = process_rss_bytes(pid) {
                peak = peak.max(rss);
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        if let Some(rss) = process_rss_bytes(pid) {
            peak = peak.max(rss);
        }
        peak
    });

    let outer_degenerate = degenerate_batch(false);
    let record_degenerate = degenerate_batch(true);
    let requests = (0..8_u64).map(|index| {
        let http = http.clone();
        let endpoint = endpoint.clone();
        let body = match index % 4 {
            0 => outer_degenerate.clone(),
            2 => record_degenerate.clone(),
            _ => dense_batch(&format!("rss-bound-concurrent-{index}"), 1),
        };
        async move {
            http.post(format!("{endpoint}/v1/ingest"))
                .bearer_auth(CAPABILITY)
                .body(body)
                .send()
                .await
        }
    });
    let responses = futures::future::join_all(requests).await;
    done.store(true, Ordering::SeqCst);
    let peak_rss = sampler.join().expect("RSS sampler");

    for (index, response) in responses.into_iter().enumerate() {
        let response = response.expect("concurrent ingest response");
        match index % 4 {
            0 => {
                assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
                assert_eq!(
                    response.json::<RejectionReasonV1>().await.unwrap(),
                    RejectionReasonV1::BatchTooLarge
                );
            }
            2 => {
                let receipt = response
                    .error_for_status()
                    .expect("single-record degenerate status")
                    .json::<IngestReceiptV1>()
                    .await
                    .expect("single-record degenerate receipt");
                assert_eq!(receipt.accepted_count, 0);
                assert_eq!(
                    receipt.rejections[0].reason,
                    RejectionReasonV1::RecordTooLarge
                );
            }
            _ => {
                let receipt = response
                    .error_for_status()
                    .expect("maximum batch status")
                    .json::<IngestReceiptV1>()
                    .await
                    .expect("maximum batch receipt");
                assert_eq!(receipt.accepted_count, 16);
            }
        }
    }
    assert!(peak_rss > 0, "RSS sampler produced no samples");
    eprintln!(
        "focused concurrent ingest child peak_rss_bytes={peak_rss} limit_bytes={COLLECTOR_TOTAL_RSS_LIMIT_BYTES}"
    );
    assert!(
        peak_rss <= COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
        "collector peak RSS {peak_rss} exceeded {COLLECTOR_TOTAL_RSS_LIMIT_BYTES}"
    );
    child.shutdown();
}

#[tokio::test]
async fn graceful_shutdown_stops_admission_and_records_one_terminal() {
    let server = start().await;
    let core = server.core();
    core.begin_shutdown();

    let unavailable = post_ingest(&server, &batch(vec![fixture_records()[0].clone()])).await;
    assert_eq!(
        unavailable.status(),
        reqwest::StatusCode::SERVICE_UNAVAILABLE
    );
    let stopping = get_health(&server).await;
    assert_eq!(
        stopping.status,
        proliferate_diagnostics_protocol::v1::types::HealthStatusV1::Stopping
    );

    core.finish_shutdown(TerminalOutcomeV1::Succeeded);
    let shutdown = query(&server, "&name=collector.shutdown").await;
    assert_eq!(shutdown.records.len(), 2);
    assert_eq!(
        shutdown.records[0]
            .record
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        None
    );
    assert_eq!(
        shutdown.records[1]
            .record
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        Some(TerminalOutcomeV1::Succeeded)
    );
    server.shutdown().await.expect("idempotent server shutdown");
}

#[tokio::test]
async fn rust_wire_admission_is_authoritative_and_recovers_after_bad_input() {
    let server = start().await;
    let mut record = fixture_records()[0].clone();
    record["producer_boot_id"] = serde_json::json!("wire-authority-boot");
    record["operation_id"] = serde_json::json!("wire-authority-valid");
    let response = post_ingest(&server, &batch(vec![record.clone()])).await;
    assert!(response.status().is_success());
    let receipt: IngestReceiptV1 = response.json().await.expect("receipt");
    assert_eq!(receipt.accepted_count, 1);

    let mut multi_defect = record.clone();
    multi_defect["operation_id"] = serde_json::json!("wire-multi-defect");
    multi_defect["name"] = serde_json::json!("desktop.prompt.submit");
    multi_defect["record_class"] = serde_json::json!("detailed");
    multi_defect["lifecycle"] = serde_json::json!({
        "phase": "started",
        "finalizer": "producer",
        "model": {"model_id": "model-1"}
    });
    let response = post_ingest(&server, &batch(vec![multi_defect])).await;
    let receipt: IngestReceiptV1 = response.json().await.expect("multi-defect receipt");
    assert_eq!(receipt.accepted_count, 0);
    assert!(receipt.accepted_range.is_none());
    assert_eq!(receipt.rejections[0].index, 0);
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::InvalidShape
    );

    for numeric in ["1.0", "1e3"] {
        let raw = format!(
            "{{\"schema_version\":{{\"major\":1,\"minor\":1}},\"records\":[{{\"schema_version\":{{\"major\":1,\"minor\":1}},\"source_timestamp\":\"2026-08-10T12:00:00.000Z\",\"producer_sequence\":{numeric},\"producer_boot_id\":\"numeric-boot\",\"component\":\"desktop_renderer\",\"source\":\"renderer\",\"release\":\"test\",\"environment\":\"test\",\"operation_id\":\"numeric-op\",\"name\":\"numeric.record\",\"severity\":\"info\",\"arguments\":[],\"record_class\":\"detailed\",\"privacy\":\"operational\",\"redaction\":\"none\",\"detailed\":{{\"kind\":\"message\",\"message\":\"ok\"}}}}]}}"
        );
        let response = client()
            .post(format!("{}/v1/ingest", server.endpoint()))
            .bearer_auth(CAPABILITY)
            .body(raw)
            .send()
            .await
            .expect("numeric response");
        let receipt: IngestReceiptV1 = response.json().await.expect("numeric receipt");
        assert_eq!(receipt.accepted_count, 0);
        assert!(receipt.accepted_range.is_none());
        assert_eq!(receipt.rejections[0].index, 0);
        assert_eq!(
            receipt.rejections[0].reason,
            RejectionReasonV1::InvalidShape
        );
    }

    for raw in [
        r#"{"schema_version":{"major":1,"minor":1},"records":[{"release":"\ud800"}]}"#,
        r#"{"schema_version":{"major":1,"minor":1},"records":[],"ignored":"\ud800"}"#,
    ] {
        let response = client()
            .post(format!("{}/v1/ingest", server.endpoint()))
            .bearer_auth(CAPABILITY)
            .body(raw)
            .send()
            .await
            .expect("surrogate response");
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        assert_eq!(
            response.json::<RejectionReasonV1>().await.expect("reason"),
            RejectionReasonV1::InvalidShape
        );
    }

    record["producer_sequence"] = serde_json::json!(2);
    record["operation_id"] = serde_json::json!("wire-authority-after-invalid");
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![record]))
        .await
        .json()
        .await
        .expect("recovery receipt");
    assert_eq!(receipt.accepted_count, 1);
    let health = get_health(&server).await;
    assert_eq!(health.rejected_records, 3);
    assert_eq!(health.oversized_records, 0);
    assert_eq!(
        health.rejections_by_reason[&RejectionReasonV1::InvalidShape],
        5
    );
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn deterministic_order_query_filters_and_pagination_cover_the_full_contract() {
    let server = start().await;
    let mut record = fixture_records()[0].clone();
    record["schema_version"] = serde_json::json!({"major": 1, "minor": 0});
    record["producer_boot_id"] = serde_json::json!("query-filter-boot");
    record["producer_sequence"] = serde_json::json!(1);
    record["operation_id"] = serde_json::json!("query-filter-op");
    record["parent_operation_id"] = serde_json::json!("query-parent");
    record["trace_id"] = serde_json::json!("query-trace");
    record["workspace_id"] = serde_json::json!("query-workspace");
    record["session_id"] = serde_json::json!("query-session");
    record["turn_id"] = serde_json::json!("query-turn");
    record["item_id"] = serde_json::json!("query-item");
    record["request_id"] = serde_json::json!("query-request");
    record["target_id"] = serde_json::json!("query-target");
    record["prompt_id"] = serde_json::json!("query-prompt");
    record["workflow_id"] = serde_json::json!("query-workflow");
    record["name"] = serde_json::json!("query.filter.record");
    record["severity"] = serde_json::json!("error");
    record["error_classification"] = serde_json::json!("query_failure");
    let mut second = record.clone();
    second["schema_version"] = serde_json::json!({"major": 1, "minor": 1});
    second["producer_sequence"] = serde_json::json!(2);
    second["operation_id"] = serde_json::json!("query-filter-op-2");
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![record, second]))
        .await
        .json()
        .await
        .expect("query ingest receipt");
    assert_eq!(receipt.accepted_count, 2);
    let first = receipt.accepted_range.expect("accepted range").first;

    let filters = [
        "&source_time_from=2026-08-10T11%3A59%3A59.000Z&source_time_to=2026-08-10T12%3A00%3A01.000Z",
        "&component=desktop_renderer",
        "&record_class=detailed",
        "&severity=error",
        "&name=query.filter.record",
        "&operation_id=query-filter-op",
        "&parent_operation_id=query-parent",
        "&trace_id=query-trace",
        "&workspace_id=query-workspace",
        "&session_id=query-session",
        "&turn_id=query-turn",
        "&item_id=query-item",
        "&request_id=query-request",
        "&target_id=query-target",
        "&prompt_id=query-prompt",
        "&workflow_id=query-workflow",
        "&error_classification=query_failure",
    ];
    for filter in filters {
        let page = query(&server, filter).await;
        assert!(
            page.records
                .iter()
                .any(|accepted| accepted.record.operation_id == "query-filter-op"),
            "filter did not return target: {filter}"
        );
    }
    let page = query(&server, "&limit=1&name=query.filter.record").await;
    assert_eq!(page.records.len(), 1);
    assert_eq!(page.records[0].accepted_order, first);
    let cursor = page.next_cursor.expect("page cursor");
    let next = query(
        &server,
        &format!("&limit={MAX_PAGE_RECORDS}&after_cursor={cursor}&name=query.filter.record"),
    )
    .await;
    assert_eq!(next.records.len(), 1);
    assert!(next.records[0].accepted_order > cursor);
    assert!(next
        .versions_present
        .iter()
        .any(|version| version.version.minor == 0));
    assert!(next
        .versions_present
        .iter()
        .any(|version| version.version.minor == 1));
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn golden_ingest_and_export_shapes_match_the_accepted_fixture() {
    let server = start().await;
    let golden: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/api.json"
    )))
    .expect("golden API fixture");
    let response = post_ingest(&server, &golden["ingest_batch"]).await;
    let receipt: IngestReceiptV1 = response
        .error_for_status()
        .expect("golden ingest status")
        .json()
        .await
        .expect("golden ingest receipt");
    assert_eq!(receipt.accepted_count, 1);
    assert!(receipt.rejections.is_empty());

    let export = client()
        .post(format!("{}/v1/export", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .json(&golden["export_request"])
        .send()
        .await
        .expect("golden export response")
        .error_for_status()
        .expect("golden export status")
        .text()
        .await
        .expect("golden export body");
    let frames = export
        .lines()
        .map(|line| serde_json::from_str::<ExportStreamFrameV1>(line).expect("golden frame"))
        .collect::<Vec<_>>();
    let manifest = match &frames[0] {
        ExportStreamFrameV1::Manifest { manifest } => manifest,
        other => panic!("first frame was not manifest: {other:?}"),
    };
    let expected_manifest = serde_json::from_value::<
        proliferate_diagnostics_protocol::v1::types::ExportManifestV1,
    >(golden["export_manifest"].clone())
    .expect("golden manifest");
    assert_eq!(manifest.schema_version, expected_manifest.schema_version);
    assert_eq!(manifest.filters, expected_manifest.filters);
    assert_eq!(manifest.redaction, expected_manifest.redaction);
    assert_eq!(manifest.includes_health, expected_manifest.includes_health);
    assert_eq!(manifest.record_count, 1);
    assert_eq!(
        manifest.versions_present,
        expected_manifest.versions_present
    );

    let expected_record =
        serde_json::from_value::<CollectorAcceptedRecordV1>(golden["collector_record"].clone())
            .expect("golden accepted record");
    let exported_record = frames
        .iter()
        .find_map(|frame| match frame {
            ExportStreamFrameV1::Record { record } => Some(record),
            _ => None,
        })
        .expect("exported golden record");
    assert_eq!(exported_record.record, expected_record.record);
    assert_eq!(
        exported_record.accepted_order,
        receipt.accepted_range.unwrap().first
    );
    assert!(frames
        .iter()
        .any(|frame| matches!(frame, ExportStreamFrameV1::Health { .. })));
    assert!(matches!(
        frames.last(),
        Some(ExportStreamFrameV1::End {
            records: 1,
            bytes
        }) if *bytes == manifest.byte_count
    ));
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn lifecycle_retry_orphan_late_start_and_known_death_are_exact() {
    let server = start().await;
    let records = fixture_records();
    let receipt: IngestReceiptV1 = post_ingest(
        &server,
        &batch(vec![
            records[1].clone(),
            records[2].clone(),
            records[2].clone(),
            records[3].clone(),
        ]),
    )
    .await
    .json()
    .await
    .expect("sequence receipt");
    assert_eq!(receipt.accepted_count, 2);
    assert_eq!(receipt.duplicate_count, 1);
    assert_eq!(receipt.rejections.len(), 1);
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::ConflictingTerminal
    );
    let succeeded = query(&server, "&name=desktop.prompt.submit&outcome=succeeded").await;
    assert_eq!(succeeded.records.len(), 1);
    assert_eq!(
        succeeded.records[0]
            .record
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        Some(TerminalOutcomeV1::Succeeded)
    );

    let orphan = records[6].clone();
    let orphan_operation = orphan["operation_id"].as_str().unwrap().to_owned();
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![orphan.clone()]))
        .await
        .json()
        .await
        .expect("orphan receipt");
    assert_eq!(receipt.accepted_count, 1);
    let mut late_start = orphan;
    late_start["producer_sequence"] = serde_json::json!(999);
    late_start["lifecycle"] = serde_json::json!({"phase": "started", "finalizer": "producer"});
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![late_start]))
        .await
        .json()
        .await
        .expect("late-start receipt");
    assert_eq!(receipt.accepted_count, 0);
    assert!(receipt.accepted_range.is_none());
    assert_eq!(receipt.rejections[0].index, 0);
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::ConflictingTerminal
    );
    let orphan_page = query(&server, &format!("&operation_id={orphan_operation}")).await;
    assert_eq!(orphan_page.records.len(), 1);
    assert_eq!(
        orphan_page.records[0]
            .record
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        Some(TerminalOutcomeV1::Cancelled)
    );

    let open = records[4].clone();
    let boot_id = open["producer_boot_id"].as_str().unwrap().to_owned();
    let operation_id = open["operation_id"].as_str().unwrap().to_owned();
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![open]))
        .await
        .json()
        .await
        .expect("open lifecycle receipt");
    assert_eq!(receipt.accepted_count, 1);
    assert_eq!(server.core().mark_producer_dead(&boot_id), 1);
    let abandoned = query(&server, &format!("&operation_id={operation_id}")).await;
    assert_eq!(abandoned.records.len(), 2);
    let terminal = abandoned.records[1]
        .record
        .lifecycle
        .as_ref()
        .expect("terminal lifecycle");
    assert_eq!(terminal.outcome, Some(TerminalOutcomeV1::Abandoned));
    assert_eq!(terminal.finalizer, LifecycleFinalizerV1::Collector);

    let health = get_health(&server).await;
    assert_eq!(health.duplicate_terminals, 1);
    assert_eq!(health.conflicting_terminals, 2);
    assert!(health.producers.iter().any(|producer| {
        producer.producer_boot_id == "boot-worker-01"
            && producer.last_sequence == Some(999)
            && producer.gap_count == 2
    }));
    assert!(health.producers.iter().any(|producer| {
        producer.producer_boot_id == boot_id
            && producer.liveness
                == proliferate_diagnostics_protocol::v1::types::ProducerLivenessV1::Dead
    }));
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn producer_and_lifecycle_cardinality_caps_end_attach_as_rejected() {
    let server = start().await;
    let template = fixture_records()[0].clone();
    let at_cap = (0..MAX_HEALTH_PRODUCERS)
        .map(|index| {
            let mut record = template.clone();
            record["producer_boot_id"] = serde_json::json!(format!("producer-cap-{index}"));
            record["producer_sequence"] = serde_json::json!(1);
            record["operation_id"] = serde_json::json!(format!("producer-cap-op-{index}"));
            record
        })
        .collect();
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(at_cap))
        .await
        .json()
        .await
        .expect("producer cap receipt");
    assert_eq!(receipt.accepted_count as usize, MAX_HEALTH_PRODUCERS);
    assert!(receipt.rejections.is_empty());

    let mut over = template;
    over["producer_boot_id"] = serde_json::json!("producer-cap-over");
    over["operation_id"] = serde_json::json!("producer-cap-over-op");
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![over]))
        .await
        .json()
        .await
        .expect("over producer cap receipt");
    assert_eq!(receipt.accepted_count, 0);
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::LimitExceeded
    );

    let health = get_health(&server).await;
    assert_eq!(health.producers.len(), MAX_HEALTH_PRODUCERS);
    assert!(
        health.cardinality_counts["lifecycle_operations"]
            <= RuntimeLimits::default().lifecycle_operations as u64
    );
    let succeeded = query(
        &server,
        "&name=collector.producer.attach&outcome=succeeded&limit=500",
    )
    .await;
    assert_eq!(succeeded.records.len(), MAX_HEALTH_PRODUCERS);
    let rejected = query(
        &server,
        "&name=collector.producer.attach&outcome=rejected&limit=500",
    )
    .await;
    assert_eq!(rejected.records.len(), 1);
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn runtime_slots_lifecycle_and_gap_maps_stop_at_their_finite_caps() {
    let mut config = CollectorConfig::standalone(CAPABILITY);
    config.runtime_limits = RuntimeLimits {
        retained_bytes: 1024 * 1024,
        query_page_bytes: 64 * 1024,
        tail_frame_bytes: 64 * 1024,
        open_connections: 8,
        concurrent_handlers: 4,
        concurrent_body_parsers: 1,
        tail_readers: 1,
        tail_queue_frames: 2,
        concurrent_exports: 1,
        lifecycle_operations: 4,
        recorded_gaps: 2,
        body_read_deadline: Duration::from_secs(10),
        shutdown_deadline: Duration::from_secs(1),
    };
    let server = CollectorServer::start(config)
        .await
        .expect("bounded collector starts");

    let template = fixture_records()[4].clone();
    let producer_boot_id = "bounded-open-producer";
    let open = (0..5)
        .map(|index| {
            let mut record = template.clone();
            record["producer_boot_id"] = serde_json::json!(producer_boot_id);
            record["producer_sequence"] = serde_json::json!(index + 1);
            record["operation_id"] = serde_json::json!(format!("bounded-open-{index}"));
            record
        })
        .collect();
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(open))
        .await
        .json()
        .await
        .expect("bounded lifecycle receipt");
    assert_eq!(receipt.accepted_count, 4);
    assert_eq!(receipt.rejections.len(), 1);
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::LimitExceeded
    );
    assert_eq!(server.core().mark_producer_dead(producer_boot_id), 4);

    let mut detail = fixture_records()[0].clone();
    detail["component"] = template["component"].clone();
    for (index, sequence) in [7, 9, 11].into_iter().enumerate() {
        let mut record = detail.clone();
        record["producer_boot_id"] = serde_json::json!(producer_boot_id);
        record["producer_sequence"] = serde_json::json!(sequence);
        record["operation_id"] = serde_json::json!(format!("bounded-gap-{index}"));
        let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![record]))
            .await
            .json()
            .await
            .expect("gap receipt");
        assert_eq!(receipt.accepted_count, 1);
    }
    let page = query(&server, "&limit=1").await;
    assert_eq!(page.gaps.len(), 2);
    let health = get_health(&server).await;
    assert_eq!(health.cardinality_counts["lifecycle_operations"], 4);
    assert!(health.producers.iter().any(|producer| {
        producer.producer_boot_id == producer_boot_id && producer.gap_count == 3
    }));

    let tail = client()
        .get(format!(
            "{}/v1/tail?schema_version=1.1&after_cursor={}",
            server.endpoint(),
            server.core().newest_cursor().unwrap_or(0)
        ))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("first tail");
    assert!(tail.status().is_success());
    let second_tail = client()
        .get(format!(
            "{}/v1/tail?schema_version=1.1&after_cursor=0",
            server.endpoint()
        ))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("second tail");
    assert_eq!(second_tail.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);

    let request = serde_json::json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "purpose": "internal_dogfood",
        "filters": {"components": [], "record_classes": [], "severities": [], "names": [], "outcomes": []},
        "record_limit": 100,
        "byte_limit": 1024 * 1024,
        "include_health": false
    });
    let first_export = client()
        .post(format!("{}/v1/export", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .json(&request)
        .send()
        .await
        .expect("first export");
    assert!(first_export.status().is_success());
    let second_export = client()
        .post(format!("{}/v1/export", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .json(&request)
        .send()
        .await
        .expect("second export");
    assert_eq!(
        second_export.status(),
        reqwest::StatusCode::TOO_MANY_REQUESTS
    );
    drop(first_export);
    drop(tail);
    tokio::time::sleep(Duration::from_millis(50)).await;
    server.shutdown().await.expect("bounded shutdown");
}

fn open_lifecycle_records(
    producer_boot_id: &str,
    tag: &str,
    first_sequence: u64,
    count: u64,
) -> Vec<serde_json::Value> {
    let template = fixture_records()[4].clone();
    (0..count)
        .map(|index| {
            let mut record = template.clone();
            record["producer_boot_id"] = serde_json::json!(producer_boot_id);
            record["producer_sequence"] = serde_json::json!(first_sequence + index);
            record["operation_id"] = serde_json::json!(format!("{tag}-{index}"));
            record
        })
        .collect()
}

async fn saturate_lifecycle_table(
    server: &CollectorServer,
    producer_boot_id: &str,
    tag: &str,
    first_sequence: u64,
    count: u64,
) -> IngestReceiptV1 {
    let records = open_lifecycle_records(producer_boot_id, tag, first_sequence, count);
    post_ingest(server, &batch(records))
        .await
        .json()
        .await
        .expect("saturating receipt")
}

#[tokio::test]
async fn a_saturated_lifecycle_table_costs_counters_and_gaps_not_caller_failures() {
    let mut config = CollectorConfig::standalone(CAPABILITY);
    config.runtime_limits = RuntimeLimits {
        lifecycle_operations: 4,
        ..RuntimeLimits::default()
    };
    let server = CollectorServer::start(config)
        .await
        .expect("collector starts");

    // Every lifecycle slot now holds an operation that never terminates, which
    // is the state the collector's own bookkeeping has to survive.
    let saturating = "saturating-producer";
    let receipt = saturate_lifecycle_table(&server, saturating, "saturating", 1, 4).await;
    assert_eq!(receipt.accepted_count, 4);
    assert!(receipt.rejections.is_empty());
    let saturated = get_health(&server).await;
    assert_eq!(saturated.cardinality_counts["lifecycle_operations"], 4);
    assert_eq!(saturated.cardinality_counts["lifecycle_displacements"], 0);

    // A first batch from a new producer forces the collector to emit its own
    // attach pair. That emission must not turn a valid batch into a 500.
    let mut detail = fixture_records()[0].clone();
    detail["producer_boot_id"] = serde_json::json!("second-producer");
    let response = post_ingest(&server, &batch(vec![detail])).await;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let receipt: IngestReceiptV1 = response.json().await.expect("receipt under saturation");
    assert_eq!(receipt.accepted_count, 1);
    assert!(receipt.rejections.is_empty());

    let displaced = get_health(&server).await;
    assert_eq!(displaced.cardinality_counts["lifecycle_operations"], 4);
    assert!(displaced.cardinality_counts["lifecycle_displacements"] >= 1);
    assert_eq!(displaced.cardinality_counts["dropped_collector_records"], 0);

    // Both attach pairs are retained, and the displaced operation is reported
    // as a gap rather than as a lost request.
    let attached = query(
        &server,
        "&name=collector.producer.attach&outcome=succeeded&limit=500",
    )
    .await;
    assert_eq!(attached.records.len(), 2);
    assert!(attached.gaps.iter().any(|gap| {
        gap.reason == proliferate_diagnostics_protocol::v1::types::GapReasonV1::Evicted
            && gap.producer_boot_id.as_deref() == Some(saturating)
    }));

    // Refill the slot the attach terminal closed, then prove an export start
    // survives the same saturation instead of failing every export.
    let refill = saturate_lifecycle_table(&server, saturating, "refill", 10, 1).await;
    assert_eq!(refill.accepted_count, 1);
    let export_request = serde_json::json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "purpose": "internal_dogfood",
        "filters": {"components": [], "record_classes": [], "severities": [], "names": [], "outcomes": []},
        "record_limit": 100,
        "byte_limit": 1024 * 1024,
        "include_health": false
    });
    let export = client()
        .post(format!("{}/v1/export", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .json(&export_request)
        .send()
        .await
        .expect("export under saturation");
    assert_eq!(export.status(), reqwest::StatusCode::OK);
    drop(export);

    let final_health = get_health(&server).await;
    assert_eq!(
        final_health.cardinality_counts["dropped_collector_records"],
        0
    );
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn a_saturated_lifecycle_table_still_pairs_the_shutdown_terminal() {
    let mut config = CollectorConfig::standalone(CAPABILITY);
    config.runtime_limits = RuntimeLimits {
        lifecycle_operations: 4,
        ..RuntimeLimits::default()
    };
    let server = CollectorServer::start(config)
        .await
        .expect("collector starts");
    let core = server.core();

    let receipt = saturate_lifecycle_table(&server, "shutdown-producer", "shutdown", 1, 4).await;
    assert_eq!(receipt.accepted_count, 4);
    let saturated = get_health(&server).await;
    assert_eq!(saturated.cardinality_counts["lifecycle_operations"], 4);

    core.begin_shutdown();
    core.finish_shutdown(TerminalOutcomeV1::Succeeded);

    let shutdown = query(&server, "&name=collector.shutdown").await;
    assert_eq!(shutdown.records.len(), 2);
    assert_eq!(
        shutdown.records[1]
            .record
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        Some(TerminalOutcomeV1::Succeeded)
    );
    let health = get_health(&server).await;
    assert_eq!(health.cardinality_counts["dropped_collector_records"], 0);
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn stalled_request_bodies_release_their_permits_on_the_read_deadline() {
    let handlers = RuntimeLimits::default().concurrent_handlers;
    let mut config = CollectorConfig::standalone(CAPABILITY);
    config.runtime_limits = RuntimeLimits {
        body_read_deadline: Duration::from_millis(100),
        ..RuntimeLimits::default()
    };
    let server = CollectorServer::start(config)
        .await
        .expect("collector starts");
    let before = get_health(&server).await;

    // Enough peers to own every handler permit, each opening a body and then
    // stalling without disconnecting.
    let stalled = (0..handlers)
        .map(|_| {
            let endpoint = server.endpoint().to_owned();
            tokio::spawn(async move {
                let body = reqwest::Body::wrap_stream(
                    futures::stream::once(async {
                        Ok::<Vec<u8>, std::io::Error>(br#"{"schema_version""#.to_vec())
                    })
                    .chain(futures::stream::pending()),
                );
                client()
                    .post(format!("{endpoint}/v1/ingest"))
                    .bearer_auth(CAPABILITY)
                    .body(body)
                    .send()
                    .await
                    .map(|response| response.status())
            })
        })
        .collect::<Vec<_>>();
    // Only one request owns a body parser at a time, so the stalled peers clear
    // one deadline apart. Waiting past the whole queue proves the wedge is
    // bounded rather than permanent.
    tokio::time::sleep(Duration::from_millis(100 * (handlers as u64 + 12))).await;

    // Past the deadline every permit is back, so health answers and ingest is
    // not wedged collector-wide.
    let health = get_health(&server).await;
    assert_eq!(
        health.status,
        proliferate_diagnostics_protocol::v1::types::HealthStatusV1::Ready
    );
    assert!(
        health
            .rejections_by_reason
            .get(&RejectionReasonV1::InvalidShape)
            .copied()
            .unwrap_or(0)
            >= before
                .rejections_by_reason
                .get(&RejectionReasonV1::InvalidShape)
                .copied()
                .unwrap_or(0)
                + handlers as u64
    );
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![fixture_records()[0].clone()]))
        .await
        .json()
        .await
        .expect("receipt after stalled bodies");
    assert_eq!(receipt.accepted_count, 1);

    for task in stalled {
        task.abort();
    }
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn eviction_tail_lag_and_export_are_bounded_and_contract_valid() {
    let mut config = CollectorConfig::standalone(CAPABILITY);
    config.runtime_limits = RuntimeLimits {
        retained_bytes: 96 * 1024,
        query_page_bytes: 64 * 1024,
        tail_frame_bytes: 64 * 1024,
        tail_queue_frames: 2,
        ..RuntimeLimits::default()
    };
    let server = CollectorServer::start(config)
        .await
        .expect("collector starts");
    let response = client()
        .get(format!(
            "{}/v1/tail?schema_version=1.1&after_cursor=0",
            server.endpoint()
        ))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("tail response");
    assert!(response.status().is_success());
    let mut stream = response.bytes_stream();

    let mut sequence = 1_u64;
    for batch_index in 0..24 {
        let mut values = Vec::new();
        for index in 0..32 {
            let mut record = fixture_records()[0].clone();
            record["producer_boot_id"] = serde_json::json!("slow-tail-producer");
            record["producer_sequence"] = serde_json::json!(sequence);
            record["operation_id"] = serde_json::json!(format!("tail-{batch_index}-{index}"));
            record["detailed"]["message"] = serde_json::json!("x".repeat(12_000));
            sequence += 1;
            values.push(record);
        }
        let receipt: IngestReceiptV1 = post_ingest(&server, &batch(values))
            .await
            .json()
            .await
            .expect("tail pressure receipt");
        assert_eq!(receipt.rejections.len(), 0);
    }

    let mut saw_lag = false;
    let mut pending = Vec::new();
    for _ in 0..20 {
        let Some(chunk) = tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .ok()
            .flatten()
        else {
            break;
        };
        pending.extend_from_slice(&chunk.expect("tail chunk"));
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=newline).collect();
            if let Ok(TailFrameV1::Lag { .. }) =
                serde_json::from_slice::<TailFrameV1>(&line[..line.len() - 1])
            {
                saw_lag = true;
            }
        }
        if saw_lag {
            break;
        }
    }
    assert!(saw_lag, "slow reader must receive lag before disconnect");

    let page = query(&server, "&after_cursor=1&limit=10").await;
    assert!(
        page.gaps
            .iter()
            .any(|gap| gap.reason
                == proliferate_diagnostics_protocol::v1::types::GapReasonV1::Evicted)
    );
    let health = get_health(&server).await;
    assert!(health.retained_bytes <= 96 * 1024);
    assert!(health.retained_bytes <= RETAINED_RECORD_ARENA_LIMIT_BYTES);
    assert!(health.tail_reader_drops > 0);
    assert!(health
        .evictions_by_reason
        .get(&proliferate_diagnostics_protocol::v1::types::GapReasonV1::Evicted)
        .is_some_and(|count| *count > 0));

    let request = serde_json::json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "purpose": "support",
        "support_authorization_id": "test-consent",
        "filters": {
            "components": [], "record_classes": [], "severities": [], "names": [], "outcomes": []
        },
        "record_limit": MAX_EXPORT_RECORDS,
        "byte_limit": MAX_EXPORT_BYTES,
        "include_health": true
    });
    let export_response = client()
        .post(format!("{}/v1/export", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .json(&request)
        .send()
        .await
        .expect("export response")
        .error_for_status()
        .expect("export status");
    let mut after_snapshot = fixture_records()[0].clone();
    after_snapshot["producer_boot_id"] = serde_json::json!("slow-tail-producer");
    after_snapshot["producer_sequence"] = serde_json::json!(sequence);
    after_snapshot["operation_id"] = serde_json::json!("after-export-snapshot");
    after_snapshot["detailed"]["message"] = serde_json::json!("after-export-snapshot-marker");
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![after_snapshot]))
        .await
        .json()
        .await
        .expect("post-snapshot receipt");
    assert_eq!(receipt.accepted_count, 1);
    let export = export_response.text().await.expect("export text");
    let frames: Vec<ExportStreamFrameV1> = export
        .lines()
        .map(|line| serde_json::from_str(line).expect("export frame"))
        .collect();
    assert!(matches!(
        frames.first(),
        Some(ExportStreamFrameV1::Manifest { .. })
    ));
    assert!(matches!(
        frames.last(),
        Some(ExportStreamFrameV1::End { .. })
    ));
    assert!(frames
        .iter()
        .any(|frame| matches!(frame, ExportStreamFrameV1::Health { .. })));
    assert!(!export.contains("support_archive"));
    assert!(!export.contains(CAPABILITY));
    assert!(!export.contains("after-export-snapshot-marker"));

    let cancelled = client()
        .post(format!("{}/v1/export", server.endpoint()))
        .bearer_auth(CAPABILITY)
        .json(&request)
        .send()
        .await
        .expect("cancellable export")
        .error_for_status()
        .expect("cancellable export status");
    drop(cancelled);
    let mut cancelled_page = RecordsPageV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        records: Vec::new(),
        next_cursor: None,
        gaps: Vec::new(),
        versions_present: Vec::new(),
    };
    for _ in 0..20 {
        cancelled_page = query(&server, "&name=collector.export&outcome=cancelled").await;
        if !cancelled_page.records.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(cancelled_page.records.len(), 1);

    let failed_operation = server.core().begin_export();
    server.core().finish_export(
        &failed_operation,
        TerminalOutcomeV1::Failed,
        Some("synthetic_export_failure"),
    );
    let failed = query(
        &server,
        &format!("&operation_id={failed_operation}&outcome=failed"),
    )
    .await;
    assert_eq!(failed.records.len(), 1);
    let collector_lifecycle = query(
        &server,
        "&component=diagnostics_collector&record_class=lifecycle&limit=500",
    )
    .await;
    assert!(collector_lifecycle.records.iter().all(|accepted| matches!(
        accepted.record.name.as_str(),
        "collector.boot" | "collector.shutdown" | "collector.export" | "collector.producer.attach"
    )));
    server.shutdown().await.expect("shutdown");
}

#[tokio::test]
async fn boundary_caps_and_restart_loss_are_pinned_without_using_fixture_boundary_cases() {
    let server = start().await;
    let records = fixture_records();
    let mut at_message = records[0].clone();
    at_message["producer_boot_id"] = serde_json::json!("boundary-producer");
    at_message["operation_id"] = serde_json::json!("message-at");
    at_message["detailed"]["message"] = serde_json::json!("x".repeat(MAX_MESSAGE_BYTES));
    let mut over_message = at_message.clone();
    over_message["producer_sequence"] = serde_json::json!(2);
    over_message["operation_id"] = serde_json::json!("message-over");
    over_message["detailed"]["message"] = serde_json::json!("x".repeat(MAX_MESSAGE_BYTES + 1));
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![at_message, over_message]))
        .await
        .json()
        .await
        .expect("message boundary receipt");
    assert_eq!(receipt.accepted_count, 1);
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::LimitExceeded
    );

    let mut at_record_bytes = records[0].clone();
    at_record_bytes["producer_boot_id"] = serde_json::json!("record-bytes-producer");
    at_record_bytes["producer_sequence"] = serde_json::json!(3);
    at_record_bytes["operation_id"] = serde_json::json!("record-bytes-at");
    pad_compact_json_to(&mut at_record_bytes, "ignored_padding", MAX_RECORD_BYTES);
    let mut over_record_bytes = at_record_bytes.clone();
    over_record_bytes["ignored_padding"] = serde_json::json!(format!(
        "{}x",
        over_record_bytes["ignored_padding"].as_str().unwrap()
    ));
    let receipt: IngestReceiptV1 =
        post_ingest(&server, &batch(vec![at_record_bytes, over_record_bytes]))
            .await
            .json()
            .await
            .expect("record byte boundary receipt");
    assert_eq!(receipt.accepted_count, 1);
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::RecordTooLarge
    );

    let at_count = (0..MAX_BATCH_RECORDS)
        .map(|index| {
            let mut record = records[0].clone();
            record["producer_boot_id"] = serde_json::json!("batch-count-producer");
            record["producer_sequence"] = serde_json::json!(index + 1);
            record["operation_id"] = serde_json::json!(format!("batch-count-{index}"));
            record
        })
        .collect();
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(at_count))
        .await
        .json()
        .await
        .expect("at-count receipt");
    assert_eq!(receipt.accepted_count as usize, MAX_BATCH_RECORDS);

    let too_many = vec![records[0].clone(); MAX_BATCH_RECORDS + 1];
    let response = post_ingest(&server, &batch(too_many)).await;
    assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);

    let mut at_batch_bytes = batch(Vec::new());
    pad_compact_json_to(&mut at_batch_bytes, "ignored_padding", MAX_BATCH_BYTES);
    let response = post_ingest(&server, &at_batch_bytes).await;
    assert!(response.status().is_success());
    let mut over_batch_bytes = at_batch_bytes;
    over_batch_bytes["ignored_padding"] = serde_json::json!(format!(
        "{}x",
        over_batch_bytes["ignored_padding"].as_str().unwrap()
    ));
    let response = post_ingest(&server, &over_batch_bytes).await;
    assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);

    let mut oversized = records[0].clone();
    oversized["producer_boot_id"] = serde_json::json!("oversized-producer");
    oversized["operation_id"] = serde_json::json!("oversized-record");
    oversized["detailed"]["message"] = serde_json::json!("x".repeat(MAX_RECORD_BYTES));
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![oversized]))
        .await
        .json()
        .await
        .expect("oversized receipt");
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::RecordTooLarge
    );

    let over_page = client()
        .get(format!(
            "{}/v1/records?schema_version=1.1&limit={}",
            server.endpoint(),
            u32::from(MAX_PAGE_RECORDS) + 1
        ))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("over-page response");
    assert_eq!(over_page.status(), reqwest::StatusCode::BAD_REQUEST);

    let unsupported_batch = serde_json::json!({
        "schema_version": {"major": 2, "minor": 0},
        "records": []
    });
    let response = post_ingest(&server, &unsupported_batch).await;
    assert_eq!(response.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.json::<RejectionReasonV1>().await.unwrap(),
        RejectionReasonV1::UnsupportedMajor
    );

    let mut unsupported_record = records[0].clone();
    unsupported_record["schema_version"] = serde_json::json!({"major": 1, "minor": 2});
    unsupported_record["producer_boot_id"] = serde_json::json!("unsupported-minor-producer");
    unsupported_record["operation_id"] = serde_json::json!("unsupported-minor-record");
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![unsupported_record]))
        .await
        .json()
        .await
        .expect("unsupported minor receipt");
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::UnsupportedMinor
    );

    let mut secret = records[0].clone();
    secret["producer_boot_id"] = serde_json::json!("secret-producer");
    secret["operation_id"] = serde_json::json!("secret-record");
    secret["privacy"] = serde_json::json!("secret");
    let receipt: IngestReceiptV1 = post_ingest(&server, &batch(vec![secret]))
        .await
        .json()
        .await
        .expect("secret receipt");
    assert_eq!(
        receipt.rejections[0].reason,
        RejectionReasonV1::ProhibitedSecret
    );

    let operation_id = "message-at";
    assert_eq!(
        query(&server, &format!("&operation_id={operation_id}"))
            .await
            .records
            .len(),
        1
    );
    server.shutdown().await.expect("first shutdown");

    let restarted = start().await;
    assert!(query(&restarted, &format!("&operation_id={operation_id}"))
        .await
        .records
        .is_empty());
    restarted.shutdown().await.expect("second shutdown");
}

#[tokio::test]
async fn inherited_capability_process_interface_never_exposes_or_persists_the_token() {
    let temp = tempfile::tempdir().expect("temporary process directory");
    let (mut capability_writer, capability_reader) = UnixStream::pair().expect("capability pair");
    let (mut control_writer, control_reader) = UnixStream::pair().expect("control pair");
    clear_cloexec(capability_reader.as_raw_fd());
    clear_cloexec(control_reader.as_raw_fd());
    let binary = env!("CARGO_BIN_EXE_proliferate-diagnostics-collector");
    let args = [
        "--capability-fd".to_owned(),
        capability_reader.as_raw_fd().to_string(),
        "--control-fd".to_owned(),
        control_reader.as_raw_fd().to_string(),
        "--release".to_owned(),
        "process-test".to_owned(),
        "--environment".to_owned(),
        "proof".to_owned(),
    ];
    assert!(!args.iter().any(|argument| argument.contains(CAPABILITY)));
    let mut child = Command::new(binary)
        .args(&args)
        .current_dir(temp.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn collector process");
    drop(capability_reader);
    drop(control_reader);
    writeln!(capability_writer, "{CAPABILITY}").expect("write capability");
    capability_writer
        .shutdown(Shutdown::Write)
        .expect("close capability channel");
    let mut stdout = BufReader::new(child.stdout.take().expect("collector stdout"));
    let mut descriptor_line = String::new();
    stdout
        .read_line(&mut descriptor_line)
        .expect("read descriptor");
    let descriptor: ConnectionDescriptorV1 =
        serde_json::from_str(&descriptor_line).expect("descriptor JSON");
    assert!(!descriptor_line.contains(CAPABILITY));
    assert!(!descriptor.endpoint.contains(CAPABILITY));
    let health = client()
        .get(format!("{}/v1/health", descriptor.endpoint))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("process health")
        .error_for_status()
        .expect("process ready")
        .text()
        .await
        .expect("health body");
    assert!(!health.contains(CAPABILITY));
    writeln!(control_writer, "{{\"command\":\"shutdown\"}}").expect("write shutdown");
    control_writer.flush().expect("flush shutdown");
    let mut exit_status = None;
    for _ in 0..100 {
        if let Some(status) = child.try_wait().expect("poll child") {
            exit_status = Some(status);
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let status = match exit_status {
        Some(status) => status,
        None => {
            child.kill().expect("kill stuck child");
            let _ = child.wait();
            panic!("collector process did not shut down in 2.5 seconds");
        }
    };
    assert!(status.success());
    let mut stdout_rest = String::new();
    stdout
        .read_to_string(&mut stdout_rest)
        .expect("read stdout");
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .expect("collector stderr")
        .read_to_string(&mut stderr)
        .expect("read stderr");
    assert!(!stdout_rest.contains(CAPABILITY));
    assert!(!stderr.contains(CAPABILITY));
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}

fn clear_cloexec(fd: i32) {
    // SAFETY: fcntl reads and updates flags for a valid descriptor owned by this test.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        assert!(flags >= 0);
        assert_eq!(libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC), 0);
    }
}

#[test]
fn frozen_constants_used_by_the_collector_have_ordered_at_and_over_boundaries() {
    fn rejection(value: &serde_json::Value) -> RejectionReasonV1 {
        parse_producer_record_value(value).expect_err("record must reject")
    }

    let base = fixture_records()[0].clone();

    let mut at = base.clone();
    at["producer_sequence"] = serde_json::json!(MAX_SAFE_INTEGER);
    assert!(parse_producer_record_value(&at).is_ok());
    at["producer_sequence"] = serde_json::json!(MAX_SAFE_INTEGER + 1);
    assert_eq!(rejection(&at), RejectionReasonV1::LimitExceeded);

    for (field, at_len, over_reason) in [
        ("release", MAX_NAME_BYTES, RejectionReasonV1::LimitExceeded),
        ("name", MAX_NAME_BYTES, RejectionReasonV1::LimitExceeded),
        (
            "producer_boot_id",
            MAX_ID_BYTES,
            RejectionReasonV1::LimitExceeded,
        ),
    ] {
        let mut record = base.clone();
        record[field] = serde_json::json!("x".repeat(at_len));
        assert!(parse_producer_record_value(&record).is_ok(), "{field} at");
        record[field] = serde_json::json!("x".repeat(at_len + 1));
        assert_eq!(rejection(&record), over_reason, "{field} over");
    }

    let argument = serde_json::json!({
        "name": "arg",
        "privacy": "operational",
        "value": {"type": "boolean", "value": true}
    });
    let mut record = base.clone();
    record["arguments"] = serde_json::json!([{
        "name": "string", "privacy": "operational",
        "value": {"type": "string", "value": "x".repeat(MAX_STRING_BYTES)}
    }]);
    assert!(parse_producer_record_value(&record).is_ok());
    record["arguments"][0]["value"]["value"] = serde_json::json!("x".repeat(MAX_STRING_BYTES + 1));
    assert_eq!(rejection(&record), RejectionReasonV1::LimitExceeded);

    let mut record = base.clone();
    record["arguments"] = serde_json::json!(vec![argument.clone(); MAX_ARGUMENTS]);
    assert!(parse_producer_record_value(&record).is_ok());
    record["arguments"] = serde_json::json!(vec![argument.clone(); MAX_ARGUMENTS + 1]);
    assert_eq!(rejection(&record), RejectionReasonV1::LimitExceeded);

    let mut record = base.clone();
    record["arguments"] = serde_json::json!([{
        "name": "items", "privacy": "operational",
        "value": {"type": "list", "value": vec![serde_json::json!({"type": "boolean", "value": true}); MAX_ARGUMENT_LIST_ITEMS]}
    }]);
    assert!(parse_producer_record_value(&record).is_ok());
    record["arguments"][0]["value"]["value"] = serde_json::json!(vec![
        serde_json::json!({"type": "boolean", "value": true});
        MAX_ARGUMENT_LIST_ITEMS + 1
    ]);
    assert_eq!(rejection(&record), RejectionReasonV1::LimitExceeded);

    let at_object: serde_json::Map<String, serde_json::Value> = (0..MAX_ARGUMENT_OBJECT_FIELDS)
        .map(|index| {
            (
                format!("k{index}"),
                serde_json::json!({"type": "boolean", "value": true}),
            )
        })
        .collect();
    let mut record = base.clone();
    record["arguments"] = serde_json::json!([{
        "name": "fields", "privacy": "operational",
        "value": {"type": "object", "value": at_object}
    }]);
    assert!(parse_producer_record_value(&record).is_ok());
    record["arguments"][0]["value"]["value"]
        .as_object_mut()
        .expect("argument object")
        .insert(
            format!("k{MAX_ARGUMENT_OBJECT_FIELDS}"),
            serde_json::json!({"type": "boolean", "value": true}),
        );
    assert_eq!(rejection(&record), RejectionReasonV1::LimitExceeded);

    fn nested_list(wrappers: usize) -> serde_json::Value {
        let mut value = serde_json::json!({"type": "boolean", "value": true});
        for _ in 0..wrappers {
            value = serde_json::json!({"type": "list", "value": [value]});
        }
        value
    }
    let mut record = base.clone();
    record["arguments"] = serde_json::json!([{
        "name": "nested", "privacy": "operational",
        "value": nested_list(MAX_ARGUMENT_DEPTH - 1)
    }]);
    assert!(parse_producer_record_value(&record).is_ok());
    record["arguments"][0]["value"] = nested_list(MAX_ARGUMENT_DEPTH);
    assert_eq!(rejection(&record), RejectionReasonV1::LimitExceeded);

    let mut query = serde_json::from_value::<
        proliferate_diagnostics_protocol::v1::types::RecordsQueryV1,
    >(serde_json::json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "limit": MAX_PAGE_RECORDS,
        "filters": {"components": [], "record_classes": [], "severities": [], "names": vec!["n"; MAX_FILTER_VALUES], "outcomes": []}
    }))
    .expect("records query");
    assert!(
        proliferate_diagnostics_protocol::v1::validation::validate_records_query(&query).is_ok()
    );
    query.filters.names.push("over".to_owned());
    assert_eq!(
        proliferate_diagnostics_protocol::v1::validation::validate_records_query(&query),
        Err(RejectionReasonV1::LimitExceeded)
    );
    query.filters.names.clear();
    query.limit = MAX_PAGE_RECORDS + 1;
    assert_eq!(
        proliferate_diagnostics_protocol::v1::validation::validate_records_query(&query),
        Err(RejectionReasonV1::LimitExceeded)
    );

    let accepted = accepted_fixture_record();
    let at_tail = TailFrameV1::Records {
        records: vec![accepted.clone(); MAX_TAIL_FRAME_RECORDS],
        cursor: MAX_TAIL_FRAME_RECORDS as u64,
    };
    assert!(validate_tail_frame(&at_tail).is_ok());
    let over_tail = TailFrameV1::Records {
        records: vec![accepted.clone(); MAX_TAIL_FRAME_RECORDS + 1],
        cursor: (MAX_TAIL_FRAME_RECORDS + 1) as u64,
    };
    assert_eq!(
        validate_tail_frame(&over_tail),
        Err(RejectionReasonV1::LimitExceeded)
    );

    let valid_api: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/api.json"
    )))
    .expect("valid API fixture");
    let mut export: ExportRequestV1 = serde_json::from_value(valid_api["export_request"].clone())
        .expect("export request fixture");
    export.record_limit = MAX_EXPORT_RECORDS;
    export.byte_limit = MAX_EXPORT_BYTES;
    assert!(validate_export_request(&export).is_ok());
    export.record_limit = MAX_EXPORT_RECORDS + 1;
    assert_eq!(
        validate_export_request(&export),
        Err(RejectionReasonV1::LimitExceeded)
    );
    export.record_limit = MAX_EXPORT_RECORDS;
    export.byte_limit = MAX_EXPORT_BYTES + 1;
    assert_eq!(
        validate_export_request(&export),
        Err(RejectionReasonV1::LimitExceeded)
    );

    let mut page = serde_json::from_value::<RecordsPageV1>(valid_api["records_page"].clone())
        .expect("records page fixture");
    page.records.clear();
    page.gaps.clear();
    page.versions_present = vec![
        VersionCountV1 {
            version: CURRENT_SCHEMA_VERSION,
            records: 1,
        };
        MAX_VERSIONS_PRESENT
    ];
    assert!(validate_records_page(&page).is_ok());
    page.versions_present.push(VersionCountV1 {
        version: CURRENT_SCHEMA_VERSION,
        records: 1,
    });
    assert_eq!(
        validate_records_page(&page),
        Err(RejectionReasonV1::LimitExceeded)
    );

    let mut health = serde_json::from_value::<HealthResponseV1>(valid_api["health"].clone())
        .expect("health fixture");
    health.cardinality_counts = (0..MAX_CARDINALITY_ENTRIES)
        .map(|index| (format!("key{index}"), 1))
        .collect();
    health.producers = (0..MAX_HEALTH_PRODUCERS)
        .map(|index| ProducerHealthV1 {
            component: proliferate_diagnostics_protocol::v1::types::ComponentV1::DesktopTauri,
            producer_boot_id: format!("producer{index}"),
            schema_version: CURRENT_SCHEMA_VERSION,
            last_sequence: Some(1),
            gap_count: 0,
            liveness: ProducerLivenessV1::Alive,
        })
        .collect();
    assert!(validate_health(&health).is_ok());
    health
        .cardinality_counts
        .insert("cardinalityover".to_owned(), 1);
    assert_eq!(
        validate_health(&health),
        Err(RejectionReasonV1::LimitExceeded)
    );
    health.cardinality_counts.remove("cardinalityover");
    health.producers.push(ProducerHealthV1 {
        component: proliferate_diagnostics_protocol::v1::types::ComponentV1::DesktopTauri,
        producer_boot_id: "producerover".to_owned(),
        schema_version: CURRENT_SCHEMA_VERSION,
        last_sequence: Some(1),
        gap_count: 0,
        liveness: ProducerLivenessV1::Alive,
    });
    assert_eq!(
        validate_health(&health),
        Err(RejectionReasonV1::LimitExceeded)
    );

    let rss_bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/rss-profile.json"
    ));
    let mut rss: RssMeasurementProfileV1 = serde_json::from_slice(rss_bytes).expect("RSS fixture");
    assert!(validate_rss_profile(&rss).is_ok());
    assert_eq!(
        rss.pass_fail.total_rss_limit_bytes,
        COLLECTOR_TOTAL_RSS_LIMIT_BYTES
    );
    assert_eq!(
        rss.pass_fail.retained_arena_limit_bytes,
        RETAINED_RECORD_ARENA_LIMIT_BYTES
    );
    rss.pass_fail.total_rss_limit_bytes = COLLECTOR_TOTAL_RSS_LIMIT_BYTES + 1;
    assert_eq!(
        validate_rss_profile(&rss),
        Err(RejectionReasonV1::InvalidShape)
    );

    let runtime = RuntimeLimits::default();
    assert!(runtime.retained_bytes <= RETAINED_RECORD_ARENA_LIMIT_BYTES);
    assert!(runtime.query_page_bytes <= runtime.retained_bytes as usize);
    assert!(runtime.tail_frame_bytes <= runtime.retained_bytes as usize);
    assert_eq!(runtime.concurrent_body_parsers, 1);
    assert!(runtime.concurrent_body_parsers <= runtime.concurrent_handlers);
}
