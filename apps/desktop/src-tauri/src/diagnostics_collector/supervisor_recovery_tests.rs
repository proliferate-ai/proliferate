use super::*;
use crate::diagnostics_collector::test_binary::built_collector_binary;
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, ComponentV1, LifecyclePhaseV1, ProducerRecordV1, RecordClassV1,
    RecordsFilterV1,
};
use std::io::Read;
use std::path::PathBuf;

fn argument(record: &ProducerRecordV1, name: &str) -> Option<ArgumentValueV1> {
    record
        .arguments
        .iter()
        .find(|argument| argument.name == name)
        .map(|argument| argument.value.clone())
}

fn lifecycle_query(name: &str) -> RecordsQueryV1 {
    RecordsQueryV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        after_cursor: None,
        limit: 16,
        filters: RecordsFilterV1 {
            source_time_from: None,
            source_time_to: None,
            components: vec![ComponentV1::DesktopTauri],
            record_classes: vec![RecordClassV1::Lifecycle],
            severities: Vec::new(),
            names: vec![name.to_string()],
            outcomes: Vec::new(),
            operation_id: None,
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
            error_classification: None,
        },
    }
}

async fn running_supervisor(
    name: &str,
) -> (
    PathBuf,
    FallbackDiagnosticsWriter,
    TauriDiagnosticsProducer,
    Arc<DiagnosticsCollectorSupervisor>,
) {
    let root = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    producer.start_pump();
    let launcher = CollectorProcessLauncher::for_test(
        built_collector_binary(),
        "desktop-test".to_string(),
        "test".to_string(),
        fallback.clone(),
    );
    let supervisor = DiagnosticsCollectorSupervisor::with_launcher(
        producer.clone(),
        fallback.clone(),
        Ok(launcher),
    );
    assert_eq!(supervisor.start().await, StartupBarrierResult::Ready);
    assert!(producer.drain(PRODUCER_DRAIN_TIMEOUT).await);
    (root, fallback, producer, supervisor)
}

async fn stop_fixture(
    root: PathBuf,
    fallback: FallbackDiagnosticsWriter,
    producer: TauriDiagnosticsProducer,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
) {
    supervisor.arm_shutdown();
    supervisor.stop_collector().await.expect("collector stop");
    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn killed_collector_restarts_with_new_generation_capability_and_query() {
    let (root, fallback, producer, supervisor) = running_supervisor("collector-kill-restart").await;
    let mut old_handoff = supervisor
        .protected_child_handoff()
        .expect("old protected handoff");
    let old_boot = old_handoff.descriptor.collector_boot_id.clone();
    let old_generation = old_handoff.generation;
    let mut old_capability = String::new();
    old_handoff
        .inherited_channel
        .read_to_string(&mut old_capability)
        .expect("old capability");
    let cursor = supervisor
        .health()
        .await
        .collector
        .as_ref()
        .and_then(|value| value.newest_cursor)
        .unwrap_or(0);
    let mut old_lease = supervisor.tail(Some(cursor)).await.expect("old tail lease");

    supervisor
        .kill_current_process_for_test()
        .expect("kill owned collector");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if matches!(
                supervisor.state(),
                DesktopDiagnosticsSupervisorStateV1::Ready {
                    ref collector_boot_id,
                    restart_count: 1,
                    ..
                } if collector_boot_id != &old_boot
            ) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("bounded automatic restart");
    tokio::time::timeout(
        Duration::from_secs(1),
        old_lease.generation_changed.changed(),
    )
    .await
    .expect("old lease invalidated")
    .expect("generation channel remains open");
    assert_ne!(*old_lease.generation_changed.borrow(), old_generation);

    let mut new_handoff = supervisor
        .protected_child_handoff()
        .expect("replacement protected handoff");
    assert_ne!(new_handoff.generation, old_generation);
    assert_ne!(new_handoff.descriptor.collector_boot_id, old_boot);
    let mut new_capability = String::new();
    new_handoff
        .inherited_channel
        .read_to_string(&mut new_capability)
        .expect("new capability");
    assert_ne!(new_capability, old_capability);

    assert!(producer.drain(PRODUCER_DRAIN_TIMEOUT).await);
    let page = supervisor
        .records(&lifecycle_query("desktop.collector.restart"))
        .await
        .expect("query replacement collector");
    assert_eq!(page.records.len(), 2);
    assert_eq!(
        page.records[0].record.operation_id,
        page.records[1].record.operation_id
    );
    // The death certificate rides both phases: a killed child restarts with
    // the signal that took it, the trigger, and the attempt count on record.
    for stored in &page.records {
        assert_eq!(
            argument(&stored.record, "trigger"),
            Some(ArgumentValueV1::String("child_exited".to_owned()))
        );
        assert_eq!(
            argument(&stored.record, "restart_count"),
            Some(ArgumentValueV1::Integer(1))
        );
        assert_eq!(
            argument(&stored.record, "signal"),
            Some(ArgumentValueV1::Integer(i64::from(libc::SIGKILL)))
        );
        assert_eq!(argument(&stored.record, "exit_code"), None);
    }

    stop_fixture(root, fallback, producer, supervisor).await;
}

/// The end-to-end companion to the handoff proof above: a real
/// `ChildDiagnosticsBridge` is attached over a socketpair to the running
/// supervisor, the owned collector is killed, and the child endpoint is
/// asserted to receive a well-formed `GenerationReady` for the restarted
/// collector — a new generation and boot id with a readable capability
/// descriptor — rather than silence. `child_bridge` is macOS-only, so this
/// gates exactly like the module it exercises.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
// Multi-threaded on purpose: the child-endpoint frame reads below block the
// calling thread, and the supervisor monitor plus the bridge's generation
// task must keep running while they do.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn killed_collector_sends_new_generation_ready_over_the_child_bridge() {
    use std::io::Read;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::net::UnixStream;

    use proliferate_diagnostics_client::bridge::{
        framing::{receive_frame_until, FrameError},
        wire::{
            BootstrapCollectorState, FallbackUnavailableClassification, ParentFrame, WireComponent,
        },
    };

    use crate::diagnostics_collector::child_bridge::{
        fallback_root::FallbackRootOutcome, runtime::ChildDiagnosticsBridge,
    };

    // Reads the one-shot capability channel the parent handed across the
    // bridge to EOF. The supervisor drops its writer end after emitting the
    // token, so a plain read to end yields the whole capability.
    fn read_capability(fd: OwnedFd) -> String {
        let mut channel = UnixStream::from(fd);
        let mut capability = String::new();
        channel
            .read_to_string(&mut capability)
            .expect("capability bytes");
        capability.trim().to_owned()
    }

    let (root, fallback, producer, supervisor) =
        running_supervisor("collector-kill-bridge-frame").await;

    let mut shutdown_fds = [0_i32; 2];
    assert_eq!(unsafe { libc::pipe(shutdown_fds.as_mut_ptr()) }, 0);
    let (_shutdown_read, shutdown_write) = unsafe {
        (
            OwnedFd::from_raw_fd(shutdown_fds[0]),
            OwnedFd::from_raw_fd(shutdown_fds[1]),
        )
    };
    let (parent, child) = UnixStream::pair().expect("bridge socketpair");

    let bridge = ChildDiagnosticsBridge::start(
        WireComponent::Anyharness,
        parent,
        shutdown_write,
        Arc::clone(&supervisor),
        FallbackRootOutcome::Unavailable(FallbackUnavailableClassification::DirectoryUnavailable),
    );

    // The initial bootstrap frame carries the current generation and its
    // capability descriptor.
    let bootstrap =
        receive_frame_until::<ParentFrame>(&child, Instant::now() + Duration::from_secs(2))
            .expect("bootstrap frame");
    assert_eq!(
        bootstrap.descriptors.len(),
        1,
        "bootstrap carries the capability"
    );
    let (old_generation, old_boot) = match bootstrap.frame {
        ParentFrame::Bootstrap {
            initial_state:
                BootstrapCollectorState::Ready {
                    generation,
                    descriptor,
                    ..
                },
            ..
        } => (generation, descriptor.collector_boot_id),
        other => panic!("expected a ready bootstrap, got {other:?}"),
    };
    let old_capability = read_capability(bootstrap.descriptors.into_iter().next().unwrap());
    assert!(
        !old_capability.is_empty(),
        "bootstrap capability is readable"
    );

    supervisor
        .kill_current_process_for_test()
        .expect("kill owned collector");

    // Wait for the supervisor to observe the death and restart the collector,
    // yielding so the monitor and the bridge's generation task can run.
    let restarted = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let DesktopDiagnosticsSupervisorStateV1::Ready {
                collector_boot_id,
                restart_count,
                ..
            } = supervisor.state()
            {
                if restart_count >= 1 && collector_boot_id != old_boot {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await;
    restarted.expect("supervisor restarts the killed collector");

    // The bridge's generation task converges by sending GenerationReady for
    // the new collector. Intermediate GenerationUnavailable frames (the
    // Starting window) are skipped.
    let overall_deadline = Instant::now() + Duration::from_secs(5);
    let (descriptors, new_generation, new_descriptor) = loop {
        assert!(
            Instant::now() < overall_deadline,
            "no GenerationReady arrived after the restart; supervisor state = {:?}",
            supervisor.state()
        );
        let per_call = (Instant::now() + Duration::from_secs(1)).min(overall_deadline);
        match receive_frame_until::<ParentFrame>(&child, per_call) {
            Ok(received) => match received.frame {
                ParentFrame::GenerationReady {
                    generation,
                    descriptor,
                    ..
                } => break (received.descriptors, generation, descriptor),
                ParentFrame::GenerationUnavailable { .. } => continue,
                other => panic!("unexpected parent frame after restart: {other:?}"),
            },
            Err(FrameError::Deadline) => continue,
            Err(error) => panic!("child bridge frame error: {error:?}"),
        }
    };

    assert!(
        new_generation > old_generation,
        "the restart advances the generation"
    );
    assert_ne!(
        new_descriptor.collector_boot_id, old_boot,
        "the restarted collector has a fresh boot id"
    );
    assert_eq!(
        descriptors.len(),
        1,
        "GenerationReady carries exactly the new capability"
    );
    let capability_fd = descriptors.into_iter().next().unwrap();
    // `FIONREAD` is sampled before the read so a failure can distinguish
    // "bytes never arrived on the transferred channel" from "bytes read but
    // wrong". Observed once locally (empty read, unreproduced in 50 further
    // runs); keep the forensics in the message.
    let mut queued: libc::c_int = -1;
    unsafe { libc::ioctl(capability_fd.as_raw_fd(), libc::FIONREAD, &mut queued) };
    let new_capability = read_capability(capability_fd);
    assert!(
        !new_capability.is_empty() && new_capability != old_capability,
        "the new capability is readable and distinct; \
         new={new_capability:?} old={old_capability:?} queued_bytes_at_receive={queued} \
         generation={new_generation} supervisor_state={:?}",
        supervisor.state()
    );

    drop(bridge);
    drop(child);
    stop_fixture(root, fallback, producer, supervisor).await;
}

#[tokio::test]
async fn stop_of_an_already_exited_child_records_the_death_certificate() {
    let (root, fallback, producer, supervisor) = running_supervisor("collector-stop-exited").await;
    supervisor.arm_shutdown();
    supervisor
        .kill_current_process_for_test()
        .expect("kill owned collector");
    // SIGKILL delivery is asynchronous; the child must be observably exited
    // before the stop path inspects it.
    tokio::time::sleep(Duration::from_millis(250)).await;
    supervisor
        .stop_collector()
        .await
        .expect("stop over exited child");

    let terminal: Vec<ProducerRecordV1> = producer
        .lifecycle_snapshot("desktop.collector.stop")
        .into_iter()
        .filter(|record| {
            record
                .lifecycle
                .as_ref()
                .is_some_and(|lifecycle| lifecycle.phase == LifecyclePhaseV1::Terminal)
        })
        .collect();
    assert_eq!(terminal.len(), 1);
    let record = &terminal[0];
    assert_eq!(record.error_classification.as_deref(), Some("child_exited"));
    assert_eq!(
        argument(record, "trigger"),
        Some(ArgumentValueV1::String("child_exited".to_owned()))
    );
    assert_eq!(
        argument(record, "signal"),
        Some(ArgumentValueV1::Integer(i64::from(libc::SIGKILL)))
    );
    assert_eq!(argument(record, "exit_code"), None);
    assert_eq!(
        argument(record, "restart_count"),
        Some(ArgumentValueV1::Integer(0))
    );

    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[cfg(unix)]
#[test]
fn death_certificate_distinguishes_clean_exit_from_signal() {
    use std::os::unix::process::ExitStatusExt;

    let clean = super::death_certificate::CollectorDeathCertificate::new(
        "child_exited",
        Some(std::process::ExitStatus::from_raw(0)),
    );
    let clean_record = certificate_record(clean);
    assert_eq!(
        argument(&clean_record, "exit_code"),
        Some(ArgumentValueV1::Integer(0))
    );
    assert_eq!(argument(&clean_record, "signal"), None);

    let signalled = super::death_certificate::CollectorDeathCertificate::new(
        "child_exited",
        Some(std::process::ExitStatus::from_raw(libc::SIGKILL)),
    );
    let signalled_record = certificate_record(signalled);
    assert_eq!(argument(&signalled_record, "exit_code"), None);
    assert_eq!(
        argument(&signalled_record, "signal"),
        Some(ArgumentValueV1::Integer(i64::from(libc::SIGKILL)))
    );

    let uninspected =
        super::death_certificate::CollectorDeathCertificate::new("health_unavailable", None);
    let uninspected_record = certificate_record(uninspected);
    assert_eq!(
        argument(&uninspected_record, "trigger"),
        Some(ArgumentValueV1::String("health_unavailable".to_owned()))
    );
    assert_eq!(argument(&uninspected_record, "exit_code"), None);
    assert_eq!(argument(&uninspected_record, "signal"), None);
}

/// Runs a certificate through the real producer admission path so the
/// arguments asserted on are the ones a stored record would carry.
fn certificate_record(
    certificate: super::death_certificate::CollectorDeathCertificate,
) -> ProducerRecordV1 {
    let root = std::env::temp_dir().join(format!("certificate-args-{}", uuid::Uuid::new_v4()));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    let operation = producer
        .begin_lifecycle_with_arguments("desktop.collector.restart", certificate.arguments(1));
    drop(operation);
    let record = producer
        .lifecycle_snapshot("desktop.collector.restart")
        .into_iter()
        .next()
        .expect("admitted certificate record");
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
    record
}

#[tokio::test]
async fn injected_inspection_and_kill_failures_retain_the_owned_handle() {
    use crate::diagnostics_collector::process::CollectorProcessTestFault;

    let (root, fallback, producer, supervisor) =
        running_supervisor("collector-retained-handle").await;
    supervisor.arm_shutdown();
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::TryWait)
        .expect("inject inspection fault");
    assert_eq!(
        supervisor.stop_collector().await,
        Err(SupervisorUnavailable::Protocol)
    );
    assert!(supervisor.has_owned_process_for_test());

    supervisor
        .clear_process_faults_for_test()
        .expect("clear inspection fault");
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::ControlWrite)
        .expect("inject control fault");
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::Kill)
        .expect("inject kill fault");
    assert_eq!(
        supervisor.stop_collector().await,
        Err(SupervisorUnavailable::Protocol)
    );
    assert!(supervisor.has_owned_process_for_test());

    supervisor
        .clear_process_faults_for_test()
        .expect("clear kill fault");
    supervisor
        .stop_collector()
        .await
        .expect("retry through retained handle");
    assert!(!supervisor.has_owned_process_for_test());
    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn injected_graceful_deadline_is_timed_out_after_verified_reap() {
    use crate::diagnostics_collector::process::CollectorProcessTestFault;

    let (root, fallback, producer, supervisor) =
        running_supervisor("collector-stop-deadline").await;
    supervisor.arm_shutdown();
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::GracefulDeadline)
        .expect("inject graceful deadline");
    assert_eq!(
        supervisor.stop_collector().await,
        Err(SupervisorUnavailable::Deadline)
    );
    assert!(!supervisor.has_owned_process_for_test());
    assert!(matches!(
        supervisor.state(),
        DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false }
    ));

    let records = std::fs::read_to_string(root.join("desktop-native.log"))
        .expect("teardown fallback")
        .lines()
        .map(|line| serde_json::from_str::<ProducerRecordV1>(line).expect("fallback record"))
        .filter(|record| {
            record.name == "desktop.collector.stop"
                && record.lifecycle.as_ref().map(|value| value.phase)
                    == Some(LifecyclePhaseV1::Terminal)
        })
        .collect::<Vec<_>>();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0]
            .lifecycle
            .as_ref()
            .and_then(|value| value.outcome),
        Some(TerminalOutcomeV1::TimedOut)
    );
    assert_eq!(
        records[0].error_classification.as_deref(),
        Some("shutdown_timeout")
    );

    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}
