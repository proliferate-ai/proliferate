use std::cell::RefCell;
use std::fs::{self, File};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
use std::path::Path;

use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, DetailedDiagnosticV1, DetailedKindV1, PrivacyClassificationV1, ProducerRecordV1,
    RecordClassV1, RedactionClassificationV1, SeverityV1, SourceV1,
};
use serde_json::Value;
use tempfile::TempDir;

use super::unix::{WriteInjection, MAX_CONSECUTIVE_WRITE_FAILURES};
use super::wire::FallbackRecordV1;
use super::{
    FallbackError, FallbackReason, FallbackWriter, FALLBACK_SEGMENT_BYTES, FALLBACK_TOTAL_BYTES,
};
use crate::{bridge::activation::FallbackDirectoryHandle, DiagnosticsComponent};

const ANYHARNESS_ACTIVE: &str = "anyharness.jsonl";
const ANYHARNESS_LOCK: &str = "anyharness.lock";

type RotationHook = Box<dyn FnMut(&'static str, &'static str)>;

std::thread_local! {
    static ROTATION_HOOK: RefCell<Option<RotationHook>> = RefCell::new(None);
}

pub(super) fn run_rotation_hook(source: &'static str, destination: &'static str) {
    ROTATION_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().as_mut() {
            hook(source, destination);
        }
    });
}

struct RotationHookReset;

impl Drop for RotationHookReset {
    fn drop(&mut self) {
        ROTATION_HOOK.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

fn with_rotation_hook<T>(
    hook: impl FnMut(&'static str, &'static str) + 'static,
    run: impl FnOnce() -> T,
) -> T {
    ROTATION_HOOK.with(|slot| {
        assert!(slot.borrow_mut().replace(Box::new(hook)).is_none());
    });
    let _reset = RotationHookReset;
    run()
}

type WriteHook = Box<dyn FnMut() -> Option<WriteInjection>>;

std::thread_local! {
    static WRITE_HOOK: RefCell<Option<WriteHook>> = RefCell::new(None);
}

pub(super) fn run_write_hook() -> Option<WriteInjection> {
    WRITE_HOOK.with(|slot| slot.borrow_mut().as_mut().and_then(|hook| hook()))
}

struct WriteHookReset;

impl Drop for WriteHookReset {
    fn drop(&mut self) {
        WRITE_HOOK.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

fn with_write_hook<T>(
    hook: impl FnMut() -> Option<WriteInjection> + 'static,
    run: impl FnOnce() -> T,
) -> T {
    WRITE_HOOK.with(|slot| {
        assert!(slot.borrow_mut().replace(Box::new(hook)).is_none());
    });
    let _reset = WriteHookReset;
    run()
}

/// Fails the next `count` writes with `errno`, then lets the kernel through.
fn fail_next_writes(count: usize, errno: i32) -> impl FnMut() -> Option<WriteInjection> {
    let mut remaining = count;
    move || {
        if remaining == 0 {
            return None;
        }
        remaining -= 1;
        Some(WriteInjection::Errno(errno))
    }
}

#[test]
fn wrapper_has_exact_schema_reason_vocabulary_and_component_binding() {
    let anyharness = record(DiagnosticsComponent::AnyHarness);
    let reasons = [
        (
            FallbackReason::CollectorUnavailable,
            "collector_unavailable",
        ),
        (FallbackReason::GenerationChanged, "generation_changed"),
        (FallbackReason::TransportCooldown, "transport_cooldown"),
        (FallbackReason::DeliveryUnknown, "delivery_unknown"),
        (FallbackReason::FinalTeardown, "final_teardown"),
    ];

    for (reason, expected) in reasons {
        let encoded =
            FallbackRecordV1::encode(DiagnosticsComponent::AnyHarness, reason, &anyharness)
                .expect("valid wrapper");
        assert_eq!(encoded.last(), Some(&b'\n'));
        let value: Value = serde_json::from_slice(&encoded).expect("JSON line");
        let object = value.as_object().expect("wrapper object");
        let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(keys, ["fallback_schema", "reason", "record"]);
        assert_eq!(value["fallback_schema"], 1);
        assert_eq!(value["reason"], expected);
        assert_eq!(value["record"]["component"], "anyharness");
        let decoded: FallbackRecordV1 = serde_json::from_value(value).expect("known wrapper");
        decoded
            .validate_for(DiagnosticsComponent::AnyHarness)
            .expect("component-bound wrapper");
    }

    let worker = record(DiagnosticsComponent::DesktopWorker);
    assert_eq!(
        FallbackRecordV1::encode(
            DiagnosticsComponent::AnyHarness,
            FallbackReason::CollectorUnavailable,
            &worker,
        ),
        Err(FallbackError::ComponentMismatch)
    );
}

#[test]
fn wrapper_rejects_unknown_keys_reasons_schema_and_noncurrent_records() {
    let record = record(DiagnosticsComponent::AnyHarness);
    let encoded = FallbackRecordV1::encode(
        DiagnosticsComponent::AnyHarness,
        FallbackReason::CollectorUnavailable,
        &record,
    )
    .expect("valid wrapper");
    let baseline: Value = serde_json::from_slice(&encoded).expect("JSON line");

    let mut unknown_key = baseline.clone();
    unknown_key["retry_context"] = Value::String("not allowed".into());
    assert!(serde_json::from_value::<FallbackRecordV1>(unknown_key).is_err());

    let mut unknown_reason = baseline.clone();
    unknown_reason["reason"] = Value::String("future_reason".into());
    assert!(serde_json::from_value::<FallbackRecordV1>(unknown_reason).is_err());

    let mut unknown_schema: FallbackRecordV1 =
        serde_json::from_value(baseline).expect("known wrapper");
    unknown_schema.fallback_schema = 2;
    assert_eq!(
        unknown_schema.validate_for(DiagnosticsComponent::AnyHarness),
        Err(FallbackError::InvalidRecord)
    );

    let mut old_record = record;
    old_record.schema_version.minor = 0;
    assert_eq!(
        FallbackRecordV1::encode(
            DiagnosticsComponent::AnyHarness,
            FallbackReason::CollectorUnavailable,
            &old_record,
        ),
        Err(FallbackError::InvalidRecord)
    );
}

#[test]
fn writer_creates_exact_family_and_reopens_without_replay_or_truncation() {
    let directory = safe_directory();
    let mut active_writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let record = record(DiagnosticsComponent::AnyHarness);
    let line_bytes = active_writer
        .write(FallbackReason::CollectorUnavailable, &record)
        .expect("fallback write");

    assert_eq!(active_writer.bytes(), line_bytes);
    assert_eq!(
        active_writer.current_status(),
        super::FallbackStatus {
            active: true,
            bytes: line_bytes,
        }
    );
    assert_secure_regular(&directory.path().join(ANYHARNESS_LOCK));
    assert_secure_regular(&directory.path().join(ANYHARNESS_ACTIVE));
    assert!(!directory.path().join("desktop-worker.lock").exists());
    assert!(!directory.path().join("desktop-worker.jsonl").exists());

    let first_bytes = fs::read(directory.path().join(ANYHARNESS_ACTIVE)).expect("active bytes");
    let wrappers = decode_segment(
        &directory.path().join(ANYHARNESS_ACTIVE),
        DiagnosticsComponent::AnyHarness,
    );
    assert_eq!(wrappers.len(), 1);
    assert_eq!(wrappers[0].record, record);
    drop(active_writer);

    let mut reopened = writer(&directory, DiagnosticsComponent::AnyHarness).expect("reopen");
    assert_eq!(reopened.bytes(), line_bytes);
    assert_eq!(
        fs::read(directory.path().join(ANYHARNESS_ACTIVE)).expect("preserved bytes"),
        first_bytes
    );
    reopened
        .write(FallbackReason::FinalTeardown, &record)
        .expect("append after reopen");
    assert_eq!(
        decode_segment(
            &directory.path().join(ANYHARNESS_ACTIVE),
            DiagnosticsComponent::AnyHarness,
        )
        .len(),
        2
    );
}

#[test]
fn component_locks_are_exclusive_and_replacement_overlap_fails_closed() {
    let directory = safe_directory();
    let mut original = writer(&directory, DiagnosticsComponent::AnyHarness).expect("first writer");
    assert!(matches!(
        writer(&directory, DiagnosticsComponent::AnyHarness),
        Err(FallbackError::LockContended)
    ));
    let _worker = writer(&directory, DiagnosticsComponent::DesktopWorker)
        .expect("independent component lock");

    fs::rename(
        directory.path().join(ANYHARNESS_LOCK),
        directory.path().join("displaced-anyharness.lock"),
    )
    .expect("replace lock pathname");
    let mut replacement =
        writer(&directory, DiagnosticsComponent::AnyHarness).expect("replacement owner");
    let record = record(DiagnosticsComponent::AnyHarness);
    assert_eq!(
        original.write(FallbackReason::CollectorUnavailable, &record),
        Err(FallbackError::UnsafeEntry)
    );
    assert!(!original.current_status().active);
    replacement
        .write(FallbackReason::CollectorUnavailable, &record)
        .expect("new lock owner writes");
}

#[test]
fn writer_refuses_unsafe_directory_and_existing_entries_without_repairing_them() {
    let wrong_mode = tempfile::tempdir().expect("tempdir");
    fs::set_permissions(wrong_mode.path(), fs::Permissions::from_mode(0o755))
        .expect("directory mode");
    assert!(matches!(
        writer(&wrong_mode, DiagnosticsComponent::AnyHarness),
        Err(FallbackError::UnsafeDirectory)
    ));

    let symlinked = safe_directory();
    let victim = symlinked.path().join("victim");
    fs::write(&victim, b"do not touch").expect("victim");
    symlink(&victim, symlinked.path().join(ANYHARNESS_ACTIVE)).expect("active symlink");
    assert!(matches!(
        writer(&symlinked, DiagnosticsComponent::AnyHarness),
        Err(FallbackError::UnsafeEntry)
    ));
    assert_eq!(fs::read(&victim).expect("victim bytes"), b"do not touch");

    let hardlinked = safe_directory();
    let active = hardlinked.path().join(ANYHARNESS_ACTIVE);
    fs::write(&active, b"owned bytes").expect("active");
    fs::set_permissions(&active, fs::Permissions::from_mode(0o600)).expect("active mode");
    fs::hard_link(&active, hardlinked.path().join("alias")).expect("hard link");
    assert!(matches!(
        writer(&hardlinked, DiagnosticsComponent::AnyHarness),
        Err(FallbackError::UnsafeEntry)
    ));
    assert_eq!(fs::read(&active).expect("active bytes"), b"owned bytes");

    let permissive = safe_directory();
    let active = permissive.path().join(ANYHARNESS_ACTIVE);
    fs::write(&active, b"preserve me").expect("active");
    fs::set_permissions(&active, fs::Permissions::from_mode(0o644)).expect("wrong mode");
    assert!(matches!(
        writer(&permissive, DiagnosticsComponent::AnyHarness),
        Err(FallbackError::UnsafeEntry)
    ));
    assert_eq!(fs::read(&active).expect("active bytes"), b"preserve me");
    assert_eq!(
        fs::metadata(&active).expect("metadata").mode() & 0o777,
        0o644
    );
}

#[test]
fn writer_refuses_oversized_existing_or_new_lines_without_partial_output() {
    let existing = safe_directory();
    let active = existing.path().join(ANYHARNESS_ACTIVE);
    let file = File::create(&active).expect("active");
    file.set_len(u64::from(FALLBACK_SEGMENT_BYTES) + 1)
        .expect("oversize existing file");
    fs::set_permissions(&active, fs::Permissions::from_mode(0o600)).expect("active mode");
    assert!(matches!(
        writer(&existing, DiagnosticsComponent::AnyHarness),
        Err(FallbackError::UnsafeEntry)
    ));
    assert_eq!(fs::metadata(&active).expect("metadata").len(), 524_289);

    let directory = safe_directory();
    let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let oversized = vec![b'x'; FALLBACK_SEGMENT_BYTES as usize + 1];
    assert_eq!(
        writer.write_encoded_for_test(&oversized),
        Err(FallbackError::RecordTooLarge)
    );
    assert_eq!(writer.bytes(), 0);
    assert!(writer.current_status().active);
    assert_eq!(
        fs::metadata(directory.path().join(ANYHARNESS_ACTIVE))
            .expect("active metadata")
            .len(),
        0
    );
}

#[test]
fn active_path_swap_is_refused_before_append_and_disables_writer() {
    let directory = safe_directory();
    let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let active = directory.path().join(ANYHARNESS_ACTIVE);
    fs::rename(&active, directory.path().join("displaced-active")).expect("displace active");
    let victim = directory.path().join("victim");
    fs::write(&victim, b"immutable victim").expect("victim");
    symlink(&victim, &active).expect("replacement symlink");

    let record = record(DiagnosticsComponent::AnyHarness);
    assert_eq!(
        writer.write(FallbackReason::DeliveryUnknown, &record),
        Err(FallbackError::UnsafeEntry)
    );
    assert!(!writer.current_status().active);
    assert_eq!(
        fs::read(&victim).expect("victim bytes"),
        b"immutable victim"
    );
    assert_eq!(
        writer.write(FallbackReason::DeliveryUnknown, &record),
        Err(FallbackError::WriteFailed)
    );
}

#[test]
fn an_interrupted_write_is_retried_within_the_budget_and_costs_no_record() {
    let directory = safe_directory();
    let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let record = record(DiagnosticsComponent::AnyHarness);

    let line_bytes = with_write_hook(fail_next_writes(1, libc::EINTR), || {
        writer.write(FallbackReason::CollectorUnavailable, &record)
    })
    .expect("an interrupted write is retried, not lost");

    assert!(writer.current_status().active);
    assert_eq!(writer.bytes(), line_bytes);
    let active = directory.path().join(ANYHARNESS_ACTIVE);
    assert_eq!(
        decode_segment(&active, DiagnosticsComponent::AnyHarness).len(),
        1
    );

    writer
        .write(FallbackReason::FinalTeardown, &record)
        .expect("writer survives the interruption");
    assert_eq!(
        decode_segment(&active, DiagnosticsComponent::AnyHarness).len(),
        2
    );
}

#[test]
fn a_transient_write_failure_drops_one_record_without_retiring_the_writer() {
    let directory = safe_directory();
    let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let record = record(DiagnosticsComponent::AnyHarness);

    // ENOSPC during a collector outage, and an exhausted interrupt budget, are
    // outages rather than integrity failures: the record is gone, the sink is
    // not.
    for errno in [libc::ENOSPC, libc::EINTR] {
        let attempts = usize::try_from(MAX_CONSECUTIVE_WRITE_FAILURES).expect("budget fits");
        assert_eq!(
            with_write_hook(fail_next_writes(attempts, errno), || {
                writer.write(FallbackReason::CollectorUnavailable, &record)
            }),
            Err(FallbackError::WriteFailed)
        );
        assert!(writer.current_status().active);
        assert_eq!(writer.bytes(), 0);
    }

    writer
        .write(FallbackReason::CollectorUnavailable, &record)
        .expect("writer survives a transient filesystem failure");
    assert_eq!(
        decode_segment(
            &directory.path().join(ANYHARNESS_ACTIVE),
            DiagnosticsComponent::AnyHarness,
        )
        .len(),
        1
    );
}

#[test]
fn a_short_write_rolls_back_its_partial_line_and_keeps_the_writer() {
    let directory = safe_directory();
    let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let record = record(DiagnosticsComponent::AnyHarness);
    let active = directory.path().join(ANYHARNESS_ACTIVE);

    let result = with_write_hook(
        {
            let mut short = Some(WriteInjection::Short(4));
            move || short.take()
        },
        || writer.write(FallbackReason::CollectorUnavailable, &record),
    );

    assert_eq!(result, Err(FallbackError::WriteFailed));
    assert!(writer.current_status().active);
    assert_eq!(writer.bytes(), 0);
    assert_eq!(fs::metadata(&active).expect("active metadata").len(), 0);

    writer
        .write(FallbackReason::CollectorUnavailable, &record)
        .expect("writer survives a short write");
    assert_eq!(
        decode_segment(&active, DiagnosticsComponent::AnyHarness).len(),
        1
    );
}

#[test]
fn an_unbroken_run_of_write_failures_retires_the_writer_and_a_success_resets_it() {
    let directory = safe_directory();
    let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let record = record(DiagnosticsComponent::AnyHarness);

    // One short of the cap, then a success, must leave no accumulated debt.
    for _ in 1..MAX_CONSECUTIVE_WRITE_FAILURES {
        assert_eq!(
            with_write_hook(fail_next_writes(usize::MAX, libc::ENOSPC), || {
                writer.write(FallbackReason::CollectorUnavailable, &record)
            }),
            Err(FallbackError::WriteFailed)
        );
        assert!(writer.current_status().active);
    }
    writer
        .write(FallbackReason::CollectorUnavailable, &record)
        .expect("write between failure runs");

    for attempt in 1..=MAX_CONSECUTIVE_WRITE_FAILURES {
        assert_eq!(
            with_write_hook(fail_next_writes(usize::MAX, libc::ENOSPC), || {
                writer.write(FallbackReason::CollectorUnavailable, &record)
            }),
            Err(FallbackError::WriteFailed)
        );
        assert_eq!(
            writer.current_status().active,
            attempt < MAX_CONSECUTIVE_WRITE_FAILURES
        );
    }
    assert_eq!(
        writer.write(FallbackReason::CollectorUnavailable, &record),
        Err(FallbackError::WriteFailed)
    );
}

#[test]
fn rotation_is_oldest_first_whole_line_and_stays_within_exact_family_cap() {
    let directory = safe_directory();
    let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
    let mut record = record(DiagnosticsComponent::AnyHarness);
    record.detailed.as_mut().expect("detail").message = Some("x".repeat(16_000));

    for sequence in 1..=180_u64 {
        record.producer_sequence = sequence;
        writer
            .write(FallbackReason::TransportCooldown, &record)
            .expect("bounded rotation write");
    }

    let names = [
        "anyharness.jsonl.3",
        "anyharness.jsonl.2",
        "anyharness.jsonl.1",
        ANYHARNESS_ACTIVE,
    ];
    let mut total = 0_u64;
    let mut sequences = Vec::new();
    for name in names {
        let path = directory.path().join(name);
        let metadata = fs::metadata(&path).expect("all four segments");
        assert!(metadata.len() <= u64::from(FALLBACK_SEGMENT_BYTES));
        total += metadata.len();
        sequences.extend(
            decode_segment(&path, DiagnosticsComponent::AnyHarness)
                .into_iter()
                .map(|wrapper| wrapper.record.producer_sequence),
        );
    }
    assert_eq!(u64::from(writer.bytes()), total);
    assert!(total <= u64::from(FALLBACK_TOTAL_BYTES));
    assert!(sequences.first().is_some_and(|first| *first > 1));
    assert_eq!(sequences.last(), Some(&180));
    assert!(sequences.windows(2).all(|pair| pair[1] == pair[0] + 1));
    assert_eq!(1_048_576_u32 + 2 * FALLBACK_TOTAL_BYTES, 5_242_880);
}

#[test]
fn rotation_races_preserve_replacements_disable_writer_and_keep_the_cap() {
    let cases = [
        (
            "anyharness.jsonl.2",
            "anyharness.jsonl.3",
            "anyharness.jsonl.2",
            "swap-23-source",
        ),
        (
            "anyharness.jsonl.2",
            "anyharness.jsonl.3",
            "anyharness.jsonl.3",
            "swap-23-destination-oldest",
        ),
        (
            "anyharness.jsonl.1",
            "anyharness.jsonl.2",
            "anyharness.jsonl.1",
            "swap-12-source",
        ),
        (
            "anyharness.jsonl.1",
            "anyharness.jsonl.2",
            "anyharness.jsonl.2",
            "swap-12-destination",
        ),
        (
            ANYHARNESS_ACTIVE,
            "anyharness.jsonl.1",
            ANYHARNESS_ACTIVE,
            "swap-01-source",
        ),
        (
            ANYHARNESS_ACTIVE,
            "anyharness.jsonl.1",
            "anyharness.jsonl.1",
            "swap-01-destination",
        ),
        (
            ANYHARNESS_ACTIVE,
            ANYHARNESS_ACTIVE,
            ANYHARNESS_ACTIVE,
            "retire",
        ),
    ];

    for (hook_source, hook_destination, raced_name, label) in cases {
        let directory = safe_directory();
        let mut writer = writer(&directory, DiagnosticsComponent::AnyHarness).expect("writer");
        let full_segment = vec![b'x'; FALLBACK_SEGMENT_BYTES as usize];
        for _ in 0..4 {
            writer
                .write_encoded_for_test(&full_segment)
                .expect("fill family segment");
        }

        let raced_path = directory.path().join(raced_name);
        let displaced_path = directory.path().join(format!("displaced-{label}"));
        let canary = format!("replacement-{label}").into_bytes();
        let injected_canary = canary.clone();
        let result = with_rotation_hook(
            move |source, destination| {
                if source == hook_source && destination == hook_destination {
                    fs::rename(&raced_path, &displaced_path).expect("displace validated entry");
                    fs::write(&raced_path, &injected_canary).expect("inject replacement");
                    fs::set_permissions(&raced_path, fs::Permissions::from_mode(0o600))
                        .expect("replacement mode");
                }
            },
            || writer.write_encoded_for_test(b"z"),
        );

        assert_eq!(result, Err(FallbackError::UnsafeEntry), "{label}");
        assert!(!writer.current_status().active, "{label}");
        assert_eq!(
            fs::read(directory.path().join(raced_name)).expect("replacement"),
            canary
        );
        assert_eq!(
            fs::metadata(directory.path().join(format!("displaced-{label}")))
                .expect("displaced metadata")
                .len(),
            u64::from(FALLBACK_SEGMENT_BYTES)
        );
        let mut total = 0_u64;
        for name in [
            ANYHARNESS_ACTIVE,
            "anyharness.jsonl.1",
            "anyharness.jsonl.2",
            "anyharness.jsonl.3",
        ] {
            let bytes = fs::metadata(directory.path().join(name))
                .expect("family metadata")
                .len();
            assert!(bytes <= u64::from(FALLBACK_SEGMENT_BYTES));
            total += bytes;
        }
        assert!(total <= u64::from(FALLBACK_TOTAL_BYTES), "{label}: {total}");
    }
}

fn safe_directory() -> TempDir {
    let directory = tempfile::tempdir().expect("tempdir");
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))
        .expect("secure directory mode");
    directory
}

fn writer(
    directory: &TempDir,
    component: DiagnosticsComponent,
) -> Result<FallbackWriter, FallbackError> {
    let file = File::open(directory.path()).expect("directory descriptor");
    let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) };
    assert!(flags >= 0);
    assert!(
        unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETFD, flags & !libc::FD_CLOEXEC,) } >= 0
    );
    FallbackWriter::from_directory(
        component,
        FallbackDirectoryHandle {
            descriptor: file.into(),
        },
    )
}

fn record(component: DiagnosticsComponent) -> ProducerRecordV1 {
    let (component, source, name) = match component {
        DiagnosticsComponent::AnyHarness => (
            ComponentV1::Anyharness,
            SourceV1::Anyharness,
            "anyharness.transport.status",
        ),
        DiagnosticsComponent::DesktopWorker => (
            ComponentV1::DesktopWorker,
            SourceV1::Worker,
            "desktop_worker.transport.status",
        ),
    };
    ProducerRecordV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        source_timestamp: "2026-08-11T12:00:00.000Z".into(),
        producer_sequence: 1,
        producer_boot_id: "producer-boot-0001".into(),
        component,
        source,
        release: "test-release".into(),
        environment: "test".into(),
        operation_id: "operation-0001".into(),
        parent_operation_id: None,
        trace_id: None,
        workspace_id: None,
        session_id: None,
        turn_id: None,
        item_id: None,
        request_id: None,
        target_id: None,
        prompt_id: None,
        workflow_id: None,
        name: name.into(),
        severity: SeverityV1::Warn,
        arguments: Vec::new(),
        error_classification: None,
        record_class: RecordClassV1::Detailed,
        privacy: PrivacyClassificationV1::Operational,
        redaction: RedactionClassificationV1::Structural,
        detailed: Some(DetailedDiagnosticV1 {
            kind: DetailedKindV1::Log,
            message: Some("collector unavailable".into()),
            stream: None,
            dropped_count: None,
            milestone: None,
        }),
        lifecycle: None,
    }
}

fn decode_segment(path: &Path, component: DiagnosticsComponent) -> Vec<FallbackRecordV1> {
    let bytes = fs::read(path).expect("segment bytes");
    assert!(!bytes.is_empty());
    assert_eq!(bytes.last(), Some(&b'\n'));
    let text = std::str::from_utf8(&bytes).expect("UTF-8 JSONL");
    text.lines()
        .map(|line| {
            let wrapper: FallbackRecordV1 = serde_json::from_str(line).expect("whole JSON line");
            wrapper.validate_for(component).expect("valid wrapper");
            wrapper
        })
        .collect()
}

fn assert_secure_regular(path: &Path) {
    let metadata = fs::metadata(path).expect("entry metadata");
    assert!(metadata.is_file());
    assert_eq!(metadata.mode() & 0o777, 0o600);
    assert_eq!(metadata.nlink(), 1);
    assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
}
