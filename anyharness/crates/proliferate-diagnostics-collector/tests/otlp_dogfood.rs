//! Dogfood proof for the internal OTLP exporter.
//!
//! Each case runs the real release-shape collector binary as a child process
//! with the destination supplied the way an internal build receives it, drives
//! real records through the real authenticated `/v1/ingest` route, and reads
//! the real `/v1/health`. The destination is a strict local OTLP receiver this
//! test owns.
//!
//! What this establishes: the exporter emits OTLP/HTTP JSON logs that conform
//! to the OTLP encoding, carries the configured headers, reports its own state
//! through `/v1/health`, and cannot change local ingestion or retention when
//! the destination fails, is missing, or is misconfigured.
//!
//! What this does not establish: that any specific vendor accepts the payload.
//! No live export to a hosted destination is performed by this suite.

#![cfg(feature = "internal-dogfood-export")]

use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, ExporterStateV1, HealthResponseV1, HealthStatusV1, IngestReceiptV1,
    RecordsPageV1,
};
use serde_json::Value;

mod otlp_receiver;

const CAPABILITY: &str = "collector-otlp-dogfood-capability-31c4";
const TEAM_HEADER: &str = "x-proof-team";
const DATASET_HEADER: &str = "x-proof-dataset";
/// Stands in for a provider credential. Nothing in the crate knows this name.
const TEAM_CREDENTIAL: &str = "dogfood-destination-credential";

/// The golden records, minus the fixture's deliberate conflicting terminal.
/// Admission is not what this suite proves, and dropping it keeps every local
/// counter at zero so an exporter-caused change would stand out.
fn fixture_records() -> Vec<Value> {
    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/records.json"
    )))
    .expect("valid records fixture");
    fixture["records"]
        .as_array()
        .expect("record array")
        .iter()
        .filter(|record| {
            record["operation_id"] != "op-prompt-01" || record["lifecycle"]["outcome"] != "failed"
        })
        .cloned()
        .collect()
}

/// Producer identity of one record, stable across the collector and the wire.
fn identity(producer_boot_id: &str, producer_sequence: &str) -> String {
    format!("{producer_boot_id}#{producer_sequence}")
}

fn batch(records: &[Value]) -> Value {
    serde_json::json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "records": records,
    })
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("test client")
}

struct CollectorChild {
    child: Child,
    control: UnixStream,
    endpoint: String,
}

impl CollectorChild {
    fn shutdown(&mut self) {
        let _ = writeln!(self.control, "{{\"command\":\"shutdown\"}}");
        let _ = self.control.flush();
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = self.child.try_wait().expect("poll collector child") {
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

fn clear_cloexec(fd: i32) {
    // SAFETY: fcntl reads and updates flags for a valid descriptor owned by this test.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        assert!(flags >= 0);
        assert_eq!(libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC), 0);
    }
}

/// Starts the packaged collector binary with the destination supplied exactly
/// the way an internal build receives it: out of band, never in the contract.
/// The install id the suite passes through the real `--install-id` process
/// seam, the same way the desktop host passes the one it owns.
const INSTALL_ID: &str = "install-dogfood-4b71";

fn spawn_collector(destination: Option<(&str, &str)>) -> CollectorChild {
    let (mut capability_writer, capability_reader) = UnixStream::pair().expect("capability pair");
    let (control_writer, control_reader) = UnixStream::pair().expect("control pair");
    clear_cloexec(capability_reader.as_raw_fd());
    clear_cloexec(control_reader.as_raw_fd());
    let mut command = Command::new(env!("CARGO_BIN_EXE_proliferate-diagnostics-collector"));
    command
        .arg("--capability-fd")
        .arg(capability_reader.as_raw_fd().to_string())
        .arg("--control-fd")
        .arg(control_reader.as_raw_fd().to_string())
        .arg("--install-id")
        .arg(INSTALL_ID)
        .env_remove("PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT")
        .env_remove("PROLIFERATE_DIAGNOSTICS_OTLP_HEADERS")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some((endpoint, headers)) = destination {
        command
            .env("PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT", endpoint)
            .env("PROLIFERATE_DIAGNOSTICS_OTLP_HEADERS", headers);
    }
    let mut child = command.spawn().expect("spawn collector child");
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
    CollectorChild {
        child,
        control: control_writer,
        endpoint: descriptor.endpoint,
    }
}

async fn ingest(collector: &CollectorChild, records: &[Value]) -> IngestReceiptV1 {
    let response = client()
        .post(format!("{}/v1/ingest", collector.endpoint))
        .bearer_auth(CAPABILITY)
        .body(serde_json::to_vec(&batch(records)).expect("serialize ingest"))
        .send()
        .await
        .expect("ingest response");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    response.json().await.expect("ingest receipt")
}

async fn health(collector: &CollectorChild) -> HealthResponseV1 {
    client()
        .get(format!("{}/v1/health", collector.endpoint))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("health response")
        .json()
        .await
        .expect("health body")
}

async fn records(collector: &CollectorChild) -> RecordsPageV1 {
    client()
        .get(format!(
            "{}/v1/records?schema_version=1.1&limit=500",
            collector.endpoint
        ))
        .bearer_auth(CAPABILITY)
        .send()
        .await
        .expect("records response")
        .json()
        .await
        .expect("records body")
}

/// Reads a scalar attribute regardless of which `AnyValue` variant carries it.
fn attribute<'a>(log: &'a Value, key: &str) -> Option<&'a str> {
    let value = &log["attributes"]
        .as_array()?
        .iter()
        .find(|attribute| attribute["key"] == key)?["value"];
    value["stringValue"]
        .as_str()
        .or_else(|| value["intValue"].as_str())
}

/// Waits until a condition holds or the bounded deadline passes.
async fn until(deadline: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let expiry = std::time::Instant::now() + deadline;
    loop {
        if condition() {
            return true;
        }
        if std::time::Instant::now() >= expiry {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Polls `/v1/health` until the exporter reaches a state or the deadline passes.
async fn until_exporter(
    collector: &CollectorChild,
    deadline: Duration,
    state: ExporterStateV1,
) -> bool {
    let expiry = std::time::Instant::now() + deadline;
    loop {
        if health(collector).await.exporter.state == state {
            return true;
        }
        if std::time::Instant::now() >= expiry {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn accepted_records_reach_the_destination_as_conformant_otlp_with_its_headers() {
    let receiver = otlp_receiver::start().await;
    // The endpoint carries no logs path, proving the adapter appends the
    // provider-neutral OTLP signal path itself.
    let mut collector = spawn_collector(Some((
        receiver.endpoint.as_str(),
        &format!("{TEAM_HEADER}={TEAM_CREDENTIAL},{DATASET_HEADER}=proliferate"),
    )));

    let fixtures = fixture_records();
    let receipt = ingest(&collector, &fixtures).await;
    assert_eq!(receipt.accepted_count as usize, fixtures.len());
    assert!(receipt.rejections.is_empty());

    // Everything the collector retained locally, including its own boot and
    // producer-attach evidence, must reach the destination.
    let expected = records(&collector)
        .await
        .records
        .iter()
        .map(|accepted| {
            identity(
                &accepted.record.producer_boot_id,
                &accepted.record.producer_sequence.to_string(),
            )
        })
        .collect::<BTreeSet<_>>();
    assert!(expected.len() >= fixtures.len());
    let state = &receiver.state;
    let arrived = until(Duration::from_secs(20), || {
        let identities = state
            .log_records()
            .iter()
            .filter_map(|log| {
                Some(identity(
                    attribute(log, "proliferate.producer_boot_id")?,
                    attribute(log, "proliferate.producer_sequence")?,
                ))
            })
            .collect::<BTreeSet<_>>();
        expected.is_subset(&identities)
    })
    .await;
    assert!(
        arrived,
        "every accepted record must reach the destination; violations={:?}",
        state.violations()
    );
    assert!(
        state.violations().is_empty(),
        "the destination rejected non-conformant OTLP: {:?}",
        state.violations()
    );
    assert!(state.request_count() >= 1);
    for value in state.header_values(TEAM_HEADER) {
        assert_eq!(value, TEAM_CREDENTIAL);
    }
    assert_eq!(
        state.header_values(DATASET_HEADER).first().map(String::as_str),
        Some("proliferate")
    );

    // The install id is stamped by the collector from the value the host
    // passed on the process seam, so it rides every resource stream regardless
    // of which producer boot each record came from. No producer sent it, and
    // no producer could have.
    let resource_sets = state.resource_attribute_sets();
    assert!(
        resource_sets.len() > 1,
        "the fixture must span several resource streams"
    );
    for attributes in &resource_sets {
        let stamped = attributes
            .as_array()
            .expect("resource attributes")
            .iter()
            .find(|attribute| attribute["key"] == "proliferate.install_id")
            .expect("proliferate.install_id resource attribute");
        assert_eq!(stamped["value"]["stringValue"], Value::from(INSTALL_ID));
    }

    let health = health(&collector).await;
    assert_eq!(health.status, HealthStatusV1::Ready);
    assert_eq!(health.exporter.state, ExporterStateV1::Ready);
    assert_eq!(health.exporter.dropped_records, 0);
    assert_eq!(health.exporter.last_error_classification, None);
    collector.shutdown();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_failing_destination_degrades_only_the_exporter_and_never_local_evidence() {
    let receiver = otlp_receiver::start().await;
    receiver.state.start_rejecting();
    let mut collector = spawn_collector(Some((
        receiver.endpoint.as_str(),
        &format!("{TEAM_HEADER}={TEAM_CREDENTIAL}"),
    )));

    let fixtures = fixture_records();
    let receipt = ingest(&collector, &fixtures).await;
    assert_eq!(
        receipt.accepted_count as usize,
        fixtures.len(),
        "a failing destination must not change what ingestion accepted"
    );
    assert!(receipt.rejections.is_empty());

    let degraded =
        until_exporter(&collector, Duration::from_secs(30), ExporterStateV1::Degraded).await;
    assert!(degraded, "a failing destination must show in exporter health");

    let health = health(&collector).await;
    assert_eq!(health.exporter.state, ExporterStateV1::Degraded);
    assert_eq!(
        health.exporter.last_error_classification.as_deref(),
        Some("http_server_error")
    );
    assert!(health.exporter.dropped_records > 0);
    // Everything the collector owns locally is untouched.
    assert_eq!(health.status, HealthStatusV1::Ready);
    assert_eq!(health.rejected_records, 0);
    assert_eq!(health.oversized_records, 0);
    assert_eq!(health.conflicting_terminals, 0);
    let page = records(&collector).await;
    let names = page
        .records
        .iter()
        .map(|accepted| accepted.record.name.as_str())
        .collect::<BTreeSet<_>>();
    for record in &fixtures {
        let name = record["name"].as_str().expect("record name");
        assert!(names.contains(name), "{name} must remain locally retained");
    }
    assert!(
        !health
            .exporter
            .last_error_classification
            .as_deref()
            .unwrap_or_default()
            .contains(TEAM_CREDENTIAL),
        "health must never echo the destination credential"
    );
    collector.shutdown();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_internal_build_without_a_destination_exports_nothing() {
    let receiver = otlp_receiver::start().await;
    let mut collector = spawn_collector(None);

    let fixtures = fixture_records();
    let receipt = ingest(&collector, &fixtures).await;
    assert_eq!(receipt.accepted_count as usize, fixtures.len());
    tokio::time::sleep(Duration::from_secs(2)).await;

    let health = health(&collector).await;
    assert_eq!(health.exporter.state, ExporterStateV1::Disabled);
    assert_eq!(health.exporter.dropped_records, 0);
    assert_eq!(health.exporter.last_error_classification, None);
    assert_eq!(receiver.state.request_count(), 0);
    collector.shutdown();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_plaintext_remote_destination_is_refused_and_reported_not_silently_used() {
    let mut collector = spawn_collector(Some((
        "http://otlp.invalid.example",
        &format!("{TEAM_HEADER}={TEAM_CREDENTIAL}"),
    )));

    let fixtures = fixture_records();
    let receipt = ingest(&collector, &fixtures).await;
    assert_eq!(receipt.accepted_count as usize, fixtures.len());

    let health = health(&collector).await;
    assert_eq!(health.exporter.state, ExporterStateV1::Degraded);
    assert_eq!(
        health.exporter.last_error_classification.as_deref(),
        Some("invalid_configuration")
    );
    assert!(health.exporter.dropped_records > 0);
    assert_eq!(health.status, HealthStatusV1::Ready);
    assert_eq!(health.rejected_records, 0);
    collector.shutdown();
}
