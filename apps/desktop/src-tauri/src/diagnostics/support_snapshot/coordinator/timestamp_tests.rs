//! REL-09B proof: one raw clock read produces one canonical fixed-millisecond
//! 15-minute window, that exact text passes the unchanged strict permit, and a
//! genuinely noncanonical window is the only cause that gains bounded terminal
//! detail.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

use chrono::{DateTime, SecondsFormat, Utc};
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, LifecyclePhaseV1, PrivacyClassificationV1, ProducerRecordV1, TerminalOutcomeV1,
};
use tokio::time::Duration;

use crate::diagnostics_collector::support_export::{probe, SupportExportIssuanceError as Issuance};

use super::super::artifact_store::{SupportArtifactReference, SupportArtifactStore};
use super::super::schema::enums::SupportSessionOmissionReasonV1;
use super::super::schema::model::health::SupportChildProducerStatusV1;
use super::super::schema::model::manifest::SupportSessionCollectionManifestV1;
use super::super::schema::model::snapshot::SupportSnapshotV3;
use super::super::schema::validate::validate_timestamp;
use super::capture::CaptureError;
use super::control::PreparationInterruption;
use super::fake_runtime::FakeRuntime;
use super::model::{CancelSupportSnapshotInput, FinishSupportSnapshotInput};
use super::state::ReadinessState;
use super::tests::{begin_input, test_coordinator};
use super::SupportSnapshotCoordinator;

const END_TO_END_CHILD_ENV: &str = "PROLIFERATE_REL09B_TIMESTAMP_CHILD";
const END_TO_END_CHILD_FIXTURE: &str =
    "diagnostics::support_snapshot::coordinator::timestamp_tests::native_clock_precision_child";
const FAILURE_STAGE: &str = "failure_stage";
const FAILURE_REASON: &str = "failure_reason";
const EXPORT_PERMIT: &str = "export_permit";
const NONCANONICAL_WINDOW: &str = "noncanonical_window";

struct ClockCase {
    name: &'static str,
    raw: &'static str,
    captured_at: &'static str,
    source_time_from: &'static str,
}

const CLOCK_CASES: [ClockCase; 5] = [
    ClockCase {
        name: "whole second",
        raw: "2026-08-12T00:00:00Z",
        captured_at: "2026-08-12T00:00:00.000Z",
        source_time_from: "2026-08-11T23:45:00.000Z",
    },
    ClockCase {
        name: "milliseconds",
        raw: "2026-08-12T00:00:00.123Z",
        captured_at: "2026-08-12T00:00:00.123Z",
        source_time_from: "2026-08-11T23:45:00.123Z",
    },
    ClockCase {
        name: "microseconds",
        raw: "2026-08-12T00:00:00.123456Z",
        captured_at: "2026-08-12T00:00:00.123Z",
        source_time_from: "2026-08-11T23:45:00.123Z",
    },
    ClockCase {
        name: "nanoseconds",
        raw: "2026-08-12T00:00:00.999999999Z",
        captured_at: "2026-08-12T00:00:00.999Z",
        source_time_from: "2026-08-11T23:45:00.999Z",
    },
    ClockCase {
        name: "minute and date boundary",
        raw: "2026-09-01T00:00:00.000999Z",
        captured_at: "2026-09-01T00:00:00.000Z",
        source_time_from: "2026-08-31T23:45:00.000Z",
    },
];

/// The real begin/permit/finish/staged-artifact composition needs a private
/// `HOME`, so it runs in a child test process rather than mutating shared
/// process environment under test parallelism.
#[test]
fn native_clock_precision_reaches_a_verified_staged_snapshot() {
    if std::env::var_os(END_TO_END_CHILD_ENV).is_some() {
        return;
    }
    let marker = std::env::temp_dir().join(format!("rel09b-timestamp-{}", uuid::Uuid::new_v4()));
    let home = std::env::temp_dir().join(format!("rel09b-home-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&home).expect("child home");
    let output = Command::new(std::env::current_exe().expect("test executable"))
        .arg("--exact")
        .arg(END_TO_END_CHILD_FIXTURE)
        .arg("--ignored")
        .env(END_TO_END_CHILD_ENV, &marker)
        .env("HOME", &home)
        .env_remove("USERPROFILE")
        .env_remove("PROLIFERATE_DEV")
        .env_remove("PROLIFERATE_DEV_HOME")
        .env_remove("ANYHARNESS_DEV_RUNTIME_HOME")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn timestamp end-to-end fixture");
    let marker_contents = std::fs::read_to_string(&marker).ok();
    let _ = std::fs::remove_file(marker);
    let _ = std::fs::remove_dir_all(home);
    assert!(
        output.status.success(),
        "timestamp end-to-end fixture failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    assert_eq!(marker_contents.as_deref(), Some("completed"));
}

#[test]
#[ignore]
fn native_clock_precision_child() {
    let Some(marker) = std::env::var_os(END_TO_END_CHILD_ENV).map(PathBuf::from) else {
        return;
    };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");
    runtime.block_on(async {
        for case in CLOCK_CASES {
            exercise_clock_case(&case).await;
        }
    });
    std::fs::write(marker, b"completed").expect("mark timestamp fixture completion");
}

async fn exercise_clock_case(case: &ClockCase) {
    let root = std::env::temp_dir().join(format!("rel09b-store-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("store root");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .expect("store root mode");
    }
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    store
        .reconcile(
            &[],
            &[],
            std::time::Instant::now() + std::time::Duration::from_secs(5),
        )
        .expect("store ready");
    let runtime = Arc::new(FakeRuntime::new());
    runtime.set_utc(parse(case.raw));
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    coordinator.state.lock().await.readiness = ReadinessState::Ready;
    probe::reset();

    let output = coordinator
        .begin_preparation(begin_input())
        .await
        .unwrap_or_else(|error| panic!("{}: begin_preparation rejected: {error}", case.name));

    // 1. Exact native response strings from the one truncated instant.
    assert_eq!(output.captured_at, case.captured_at, "{}", case.name);
    assert_eq!(
        output.window.source_time_from, case.source_time_from,
        "{}",
        case.name
    );
    assert_eq!(
        output.window.source_time_to, case.captured_at,
        "{}",
        case.name
    );
    // 2. Byte identity and an exact 900-second parsed interval.
    assert_eq!(
        output.captured_at, output.window.source_time_to,
        "{}: captured_at is the window end byte-for-byte",
        case.name
    );
    assert_fixed_milliseconds(&output.captured_at, case.name);
    assert_fixed_milliseconds(&output.window.source_time_from, case.name);
    assert_exact_window(
        &output.window.source_time_from,
        &output.window.source_time_to,
    );
    // No `AutoSi` spelling of the raw instant can reach the response. For a
    // raw clock already at whole-millisecond precision both spellings agree,
    // so the assertion applies only where `AutoSi` would differ.
    let auto_si = parse(case.raw).to_rfc3339_opts(SecondsFormat::AutoSi, true);
    let auto_si_differs = auto_si != case.captured_at;
    if auto_si_differs {
        for value in [
            output.captured_at.as_str(),
            output.window.source_time_to.as_str(),
        ] {
            assert_ne!(value, auto_si.as_str(), "{}", case.name);
        }
    }

    // 3. The real permit accepted and consumed exactly those request bytes
    // before any downstream collector response was observed.
    let observed = probe::observed();
    assert_eq!(
        observed.len(),
        2,
        "{}: one issuance and one consumption",
        case.name
    );
    assert_eq!(
        observed[0].stage,
        probe::IssuanceStage::Issued,
        "{}",
        case.name
    );
    assert_eq!(
        observed[1].stage,
        probe::IssuanceStage::Consumed,
        "{}",
        case.name
    );
    for entry in &observed {
        assert_eq!(
            entry.source_time_from, case.source_time_from,
            "{}",
            case.name
        );
        assert_eq!(entry.source_time_to, case.captured_at, "{}", case.name);
    }

    let prepared = coordinator
        .finish_preparation(FinishSupportSnapshotInput {
            preparation_id: output.preparation_id.clone(),
            consent_epoch: begin_input().consent_epoch,
            session_evidence_json: None,
            session_collection: SupportSessionCollectionManifestV1::Omitted {
                reason: SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
            },
        })
        .await
        .unwrap_or_else(|error| panic!("{}: finish_preparation failed: {error}", case.name));
    assert_eq!(prepared.generated_at, case.captured_at, "{}", case.name);

    // 4. Read the staged bytes back through the verified-read path and parse
    // the canonical JSON as a schema-3 snapshot.
    let reference = staged_reference(&coordinator, &prepared.artifact_id).await;
    let bytes = store
        .read_verified(&reference)
        .unwrap_or_else(|_| panic!("{}: verified staged read", case.name));
    let snapshot: SupportSnapshotV3 = serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!(
            "{}: staged artifact is not a SupportSnapshotV3: {error}",
            case.name
        )
    });
    assert_eq!(snapshot.schema_version, 3, "{}", case.name);
    assert_eq!(snapshot.generated_at, case.captured_at, "{}", case.name);
    assert_eq!(
        snapshot.selection.source_time_to, case.captured_at,
        "{}",
        case.name
    );
    assert_eq!(
        snapshot.selection.source_time_from, case.source_time_from,
        "{}",
        case.name
    );
    assert_eq!(
        snapshot.collector.captured_at, case.captured_at,
        "{}",
        case.name
    );
    assert_eq!(
        snapshot.generated_at, snapshot.selection.source_time_to,
        "{}: generatedAt is the selection end byte-for-byte",
        case.name
    );
    assert_eq!(
        snapshot.collector.captured_at, snapshot.selection.source_time_to,
        "{}: collector captured_at is the selection end byte-for-byte",
        case.name
    );
    assert_fixed_milliseconds(&snapshot.selection.source_time_from, case.name);
    assert_fixed_milliseconds(&snapshot.selection.source_time_to, case.name);
    assert_exact_window(
        &snapshot.selection.source_time_from,
        &snapshot.selection.source_time_to,
    );
    // An export manifest exists only when a packaged collector process actually
    // answered the export. This fixture deliberately runs with no collector
    // installed under its private HOME, so the manifest is absent by
    // construction and asserting on it would be vacuous. The exact request
    // window bytes are instead proven above by `probe::observed()`, which
    // records the real permit's own filters at issue and at consume.
    assert!(
        snapshot.collector.export_manifest.is_none(),
        "{}: no collector process runs in this fixture",
        case.name
    );
    if auto_si_differs {
        for value in [
            snapshot.generated_at.as_str(),
            snapshot.selection.source_time_to.as_str(),
            snapshot.collector.captured_at.as_str(),
        ] {
            assert_ne!(value, auto_si.as_str(), "{}", case.name);
        }
    }

    // 5. The real child-status sampler is on the proven path: no test seam
    // substitutes its response, so its own stamp must be canonical
    // fixed-millisecond UTC `Z` text the schema validator accepts.
    for (component, status) in [
        ("anyharness", &snapshot.producer_health.anyharness),
        ("desktop worker", &snapshot.producer_health.desktop_worker),
    ] {
        let captured_at = match status {
            SupportChildProducerStatusV1::Available { captured_at, .. }
            | SupportChildProducerStatusV1::Omitted { captured_at, .. } => captured_at,
        };
        assert_fixed_milliseconds(captured_at, case.name);
        validate_timestamp(captured_at).unwrap_or_else(|error| {
            let name = case.name;
            panic!("{name}: {component} captured_at {captured_at} rejected: {error:?}")
        });
    }

    let terminal = sole_terminal(&coordinator);
    assert!(
        terminal.arguments.is_empty(),
        "{}: a successful preparation carries no permit detail",
        case.name
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn noncanonical_window_terminal_carries_only_the_two_bounded_arguments() {
    let runtime = Arc::new(FakeRuntime::new());
    runtime.fail_capture_with(CaptureError::Issuance(Issuance::NoncanonicalWindow));
    let coordinator = ready_coordinator(Arc::clone(&runtime)).await;

    let error = coordinator
        .begin_preparation(begin_input())
        .await
        .expect_err("a noncanonical export window is refused");

    assert_eq!(error, "support_snapshot_preparation_rejected");
    let records = prepare_records(&coordinator);
    assert_eq!(records.len(), 2, "exactly one start and one terminal");
    let start = phase(&records, LifecyclePhaseV1::Started);
    assert!(
        start.arguments.is_empty(),
        "the started record stays argument-free"
    );
    let terminal = phase(&records, LifecyclePhaseV1::Terminal);
    assert_eq!(
        terminal.lifecycle.as_ref().and_then(|value| value.outcome),
        Some(TerminalOutcomeV1::Rejected)
    );
    assert_eq!(
        terminal.error_classification.as_deref(),
        Some("preparation_rejected")
    );
    assert_eq!(terminal.arguments.len(), 2, "exactly two bounded arguments");
    assert_eq!(terminal.arguments[0].name, FAILURE_STAGE);
    assert_eq!(
        terminal.arguments[0].privacy,
        PrivacyClassificationV1::Operational
    );
    assert_eq!(
        terminal.arguments[0].value,
        ArgumentValueV1::Enum(EXPORT_PERMIT.to_string())
    );
    assert_eq!(terminal.arguments[1].name, FAILURE_REASON);
    assert_eq!(
        terminal.arguments[1].privacy,
        PrivacyClassificationV1::Operational
    );
    assert_eq!(
        terminal.arguments[1].value,
        ArgumentValueV1::Enum(NONCANONICAL_WINDOW.to_string())
    );

    // No timestamp, identifier, path, or raw input rides the record.
    let encoded = serde_json::to_string(&terminal.arguments).expect("arguments JSON");
    for forbidden in [
        "2026-",
        "Z\"",
        "/",
        "support_snapshot_preparation_rejected",
        "NoncanonicalWindow",
    ] {
        assert!(
            !encoded.contains(forbidden),
            "bounded arguments must not contain {forbidden}: {encoded}"
        );
    }

    // Nothing was authorized and the preparation cleaned itself up.
    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none());
    assert!(state.closing_preparation.is_none());
    assert!(state.artifacts.is_empty(), "no artifact is authorized");
    assert!(state.read_proofs.is_empty());
    assert!(state.submission.is_none());
}

#[tokio::test]
async fn every_other_failure_cause_carries_neither_argument() {
    let causes = [
        (
            "invalid preparation id",
            CaptureError::Issuance(Issuance::InvalidPreparationId),
        ),
        (
            "expired deadline",
            CaptureError::Issuance(Issuance::ExpiredDeadline),
        ),
        (
            "request invariant",
            CaptureError::Issuance(Issuance::RequestInvariant),
        ),
        ("generic invalid capture", CaptureError::Invalid),
    ];
    for (name, cause) in causes {
        let runtime = Arc::new(FakeRuntime::new());
        runtime.fail_capture_with(cause);
        let coordinator = ready_coordinator(Arc::clone(&runtime)).await;

        let error = coordinator
            .begin_preparation(begin_input())
            .await
            .expect_err("the capture failure is rejected");

        assert_eq!(error, "support_snapshot_preparation_rejected", "{name}");
        let terminal = sole_terminal(&coordinator);
        assert_eq!(
            terminal.error_classification.as_deref(),
            Some("preparation_rejected"),
            "{name}"
        );
        assert!(
            terminal.arguments.is_empty(),
            "{name} must carry no permit detail"
        );
    }
}

#[tokio::test]
async fn interruption_wins_over_a_window_rejection_and_suppresses_permit_detail() {
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_capture_failure(CaptureError::Issuance(Issuance::NoncanonicalWindow));
    let coordinator = ready_coordinator(Arc::clone(&runtime)).await;

    let begin = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        async move { coordinator.begin_preparation(begin_input()).await }
    });
    runtime.wait_invalid_capture_result().await;
    // The cancellation owns the closing fence and waits for the gated begin
    // call to become idle, so the gate must be released concurrently.
    let cancel = coordinator.cancel_preparation(CancelSupportSnapshotInput {
        client_job_id: begin_input().client_job_id,
        consent_epoch: begin_input().consent_epoch,
        preparation_id: None,
    });
    let release = async {
        runtime.release_invalid_capture_result();
    };
    let (cancelled, ()) = tokio::join!(cancel, release);
    cancelled.expect("cancel wins the terminal");

    let error = begin
        .await
        .expect("begin task")
        .expect_err("a cancelled preparation returns the cancellation");
    assert_eq!(error, "support_snapshot_preparation_cancelled");

    let terminal = sole_terminal(&coordinator);
    assert_eq!(
        terminal.lifecycle.as_ref().and_then(|value| value.outcome),
        Some(TerminalOutcomeV1::Cancelled)
    );
    assert_eq!(terminal.error_classification, None);
    assert!(
        terminal.arguments.is_empty(),
        "a winning interruption owns the terminal and suppresses permit detail"
    );
    assert_eq!(
        coordinator
            .state
            .lock()
            .await
            .closed_preparation
            .as_ref()
            .map(|closed| closed.interruption),
        Some(PreparationInterruption::Cancelled)
    );
}

#[tokio::test]
async fn a_deadline_interruption_also_suppresses_permit_detail() {
    let runtime = Arc::new(FakeRuntime::new());
    runtime.pause_capture_failure(CaptureError::Issuance(Issuance::NoncanonicalWindow));
    let coordinator = ready_coordinator(Arc::clone(&runtime)).await;

    let begin = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        async move { coordinator.begin_preparation(begin_input()).await }
    });
    runtime.wait_invalid_capture_result().await;
    runtime.advance(Duration::from_secs(25));
    runtime.release_invalid_capture_result();

    let error = begin
        .await
        .expect("begin task")
        .expect_err("an expired preparation times out");
    assert_eq!(error, "support_snapshot_preparation_timeout");

    let terminal = sole_terminal(&coordinator);
    assert_eq!(
        terminal.lifecycle.as_ref().and_then(|value| value.outcome),
        Some(TerminalOutcomeV1::TimedOut)
    );
    assert_eq!(
        terminal.error_classification.as_deref(),
        Some("preparation_timeout")
    );
    assert!(terminal.arguments.is_empty());
}

#[test]
fn truncation_never_rounds_a_raw_clock_read() {
    for case in CLOCK_CASES {
        let truncated = super::runtime::truncate_to_milliseconds(parse(case.raw));
        assert_eq!(
            truncated.to_rfc3339_opts(SecondsFormat::Millis, true),
            case.captured_at,
            "{}",
            case.name
        );
        assert!(
            truncated <= parse(case.raw),
            "{}: never rounds up",
            case.name
        );
    }
}

async fn ready_coordinator(runtime: Arc<FakeRuntime>) -> Arc<SupportSnapshotCoordinator> {
    let root = std::env::temp_dir().join(format!("rel09b-reject-{}", uuid::Uuid::new_v4()));
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    let coordinator = test_coordinator(Some(store), runtime);
    coordinator.state.lock().await.readiness = ReadinessState::Ready;
    coordinator
}

async fn staged_reference(
    coordinator: &Arc<SupportSnapshotCoordinator>,
    artifact_id: &str,
) -> SupportArtifactReference {
    coordinator
        .state
        .lock()
        .await
        .artifacts
        .get(artifact_id)
        .expect("authorized staged artifact")
        .reference
        .clone()
}

fn prepare_records(coordinator: &Arc<SupportSnapshotCoordinator>) -> Vec<ProducerRecordV1> {
    coordinator
        .producer
        .support_lifecycle_snapshot()
        .into_iter()
        .filter(|record| record.name == "desktop.support_snapshot.prepare")
        .collect()
}

fn sole_terminal(coordinator: &Arc<SupportSnapshotCoordinator>) -> ProducerRecordV1 {
    let records = prepare_records(coordinator);
    assert_eq!(records.len(), 2, "exactly one start and one terminal");
    phase(&records, LifecyclePhaseV1::Terminal).clone()
}

fn phase(records: &[ProducerRecordV1], phase: LifecyclePhaseV1) -> &ProducerRecordV1 {
    records
        .iter()
        .find(|record| record.lifecycle.as_ref().map(|value| value.phase) == Some(phase))
        .expect("lifecycle phase")
}

fn parse(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .expect("fixture timestamp")
        .with_timezone(&Utc)
}

fn assert_fixed_milliseconds(value: &str, name: &str) {
    let (seconds, fraction) = value
        .split_once('.')
        .unwrap_or_else(|| panic!("{name}: {value} has no millisecond fraction"));
    assert_eq!(seconds.len(), 19, "{name}: {value}");
    assert_eq!(fraction.len(), 4, "{name}: {value} is not exactly .mmmZ");
    assert!(fraction.ends_with('Z'), "{name}: {value}");
    assert!(
        fraction[..3].chars().all(|digit| digit.is_ascii_digit()),
        "{name}: {value}"
    );
}

fn assert_exact_window(from: &str, to: &str) {
    assert_eq!(
        parse(to).signed_duration_since(parse(from)),
        chrono::Duration::seconds(900),
        "the window is exactly 900 parsed seconds"
    );
}
