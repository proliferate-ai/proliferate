use std::io::{self, Read};
use std::os::fd::{FromRawFd, IntoRawFd, OwnedFd};
use std::os::unix::net::UnixStream as StdUnixStream;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::task::{Context, Poll};
use std::time::Duration;

use super::*;
use tokio::io::AsyncWrite;

const COLLECTOR_BOOT: &str = "collector-boot-0001";
const GENERATION: u64 = 7;
const ANYHARNESS_BOOT: &str = "anyharness-boot-0001";
const WORKER_BOOT: &str = "worker-boot-0001";

#[test]
fn producer_dead_command_is_the_exact_pr2_typed_document() {
    let encoded = typed_producer_dead_command(ANYHARNESS_BOOT).expect("typed command");
    assert_eq!(
        encoded,
        br#"{"command":"producer_dead","producer_boot_id":"anyharness-boot-0001"}"#
    );
    assert!(typed_producer_dead_command("").is_err());
    assert!(typed_producer_dead_command(&"x".repeat(MAX_ID_BYTES + 1)).is_err());
}

#[tokio::test]
async fn fixed_slots_accept_both_producers_after_shutdown_is_armed() {
    let state = TerminalControlState::default();
    let current = current_view(true);
    let anyharness = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current),
        )
        .expect("post-arm AnyHarness reservation");
    let worker = state
        .reserve_if_current(
            TerminalProducerSlot::DesktopWorker,
            COLLECTOR_BOOT,
            GENERATION,
            WORKER_BOOT,
            Some(current),
        )
        .expect("post-arm Worker reservation");

    let lines = Arc::new(StdMutex::new(Vec::new()));
    let anyharness_lines = Arc::clone(&lines);
    let worker_lines = Arc::clone(&lines);
    let first = state.dispatch(
        anyharness,
        typed_producer_dead_command(ANYHARNESS_BOOT).expect("AnyHarness command"),
        move |line| async move {
            anyharness_lines.lock().expect("line lock").push(line);
            Ok(())
        },
    );
    let second = state.dispatch(
        worker,
        typed_producer_dead_command(WORKER_BOOT).expect("Worker command"),
        move |line| async move {
            worker_lines.lock().expect("line lock").push(line);
            Ok(())
        },
    );
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first, TerminalControlOutcome::Recorded);
    assert_eq!(second, TerminalControlOutcome::Recorded);
    let lines = lines.lock().expect("line lock");
    assert_eq!(lines.len(), 2);
    assert!(lines.iter().all(|line| {
        serde_json::from_slice::<serde_json::Value>(line)
            .ok()
            .and_then(|value| value.get("command").cloned())
            == Some(serde_json::Value::String("producer_dead".into()))
    }));
}

#[test]
fn stale_restart_and_stopped_collector_fail_before_slot_consumption() {
    let state = TerminalControlState::default();
    let restarted = TerminalCollectorView {
        collector_boot_id: "collector-boot-0002",
        generation: GENERATION + 1,
        available: true,
        shutdown_armed: false,
    };
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(restarted),
        ),
        Err(TerminalControlOutcome::Stale)
    ));
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            None,
        ),
        Err(TerminalControlOutcome::Unavailable)
    ));
    let stopped = TerminalCollectorView {
        available: false,
        ..current_view(true)
    };
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(stopped),
        ),
        Err(TerminalControlOutcome::Unavailable)
    ));
    assert!(state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(false)),
        )
        .is_ok());
}

#[tokio::test]
async fn partial_or_unknown_write_consumes_the_boot_slot_without_retry() {
    let state = TerminalControlState::default();
    let reservation = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        )
        .expect("reservation");
    let partial = Arc::new(StdMutex::new(Vec::new()));
    let written = Arc::clone(&partial);
    let outcome = state
        .dispatch(
            reservation,
            typed_producer_dead_command(ANYHARNESS_BOOT).expect("typed command"),
            move |line| async move {
                written
                    .lock()
                    .expect("partial lock")
                    .extend_from_slice(&line[..8]);
                Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "injected partial write",
                ))
            },
        )
        .await;
    assert_eq!(outcome, TerminalControlOutcome::Ambiguous);
    assert!(state.writer_is_ambiguous());
    assert_eq!(partial.lock().expect("partial lock").len(), 8);
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        ),
        Err(TerminalControlOutcome::Ambiguous)
    ));
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::DesktopWorker,
            COLLECTOR_BOOT,
            GENERATION,
            WORKER_BOOT,
            Some(current_view(true)),
        ),
        Err(TerminalControlOutcome::Ambiguous)
    ));

    state.reset_for_new_collector();
    assert!(!state.writer_is_ambiguous());
    let replacement = TerminalCollectorView {
        collector_boot_id: "collector-boot-0002",
        generation: GENERATION + 1,
        available: true,
        shutdown_armed: true,
    };
    assert!(state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            "collector-boot-0002",
            GENERATION + 1,
            ANYHARNESS_BOOT,
            Some(replacement),
        )
        .is_ok());
}

#[tokio::test]
async fn async_writer_gate_serializes_the_two_fixed_slots() {
    let state = TerminalControlState::default();
    let anyharness = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        )
        .expect("AnyHarness reservation");
    let worker = state
        .reserve_if_current(
            TerminalProducerSlot::DesktopWorker,
            COLLECTOR_BOOT,
            GENERATION,
            WORKER_BOOT,
            Some(current_view(true)),
        )
        .expect("Worker reservation");
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));

    let first = delayed_write(Arc::clone(&active), Arc::clone(&maximum));
    let second = delayed_write(Arc::clone(&active), Arc::clone(&maximum));
    let (first, second) = tokio::join!(
        state.dispatch(
            anyharness,
            typed_producer_dead_command(ANYHARNESS_BOOT).expect("AnyHarness command"),
            move |_| first,
        ),
        state.dispatch(
            worker,
            typed_producer_dead_command(WORKER_BOOT).expect("Worker command"),
            move |_| second,
        ),
    );
    assert_eq!(first, TerminalControlOutcome::Recorded);
    assert_eq!(second, TerminalControlOutcome::Recorded);
    assert_eq!(maximum.load(Ordering::Acquire), 1);
}

#[tokio::test]
async fn duplicate_after_success_and_alternating_boot_replay_are_closed() {
    let state = TerminalControlState::default();
    let second_boot = "anyharness-boot-0002";

    for producer_boot_id in [ANYHARNESS_BOOT, second_boot] {
        let reservation = state
            .reserve_if_current(
                TerminalProducerSlot::AnyHarness,
                COLLECTOR_BOOT,
                GENERATION,
                producer_boot_id,
                Some(current_view(true)),
            )
            .expect("new producer boot reservation");
        assert_eq!(
            state
                .dispatch(
                    reservation,
                    typed_producer_dead_command(producer_boot_id).expect("typed command"),
                    |_| async { Ok(()) },
                )
                .await,
            TerminalControlOutcome::Recorded
        );
    }

    for producer_boot_id in [ANYHARNESS_BOOT, second_boot] {
        assert!(matches!(
            state.reserve_if_current(
                TerminalProducerSlot::AnyHarness,
                COLLECTOR_BOOT,
                GENERATION,
                producer_boot_id,
                Some(current_view(true)),
            ),
            Err(TerminalControlOutcome::Ambiguous)
        ));
    }
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::DesktopWorker,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        ),
        Err(TerminalControlOutcome::Ambiguous)
    ));
    for index in 3..=MAX_TERMINAL_BOOTS_PER_SLOT {
        let producer_boot_id = format!("anyharness-boot-{index:04}");
        let reservation = state
            .reserve_if_current(
                TerminalProducerSlot::AnyHarness,
                COLLECTOR_BOOT,
                GENERATION,
                &producer_boot_id,
                Some(current_view(true)),
            )
            .expect("bounded history entry");
        assert_eq!(
            state
                .dispatch(
                    reservation,
                    typed_producer_dead_command(&producer_boot_id).expect("typed command"),
                    |_| async { Ok(()) },
                )
                .await,
            TerminalControlOutcome::Recorded
        );
    }
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            "anyharness-boot-overflow",
            Some(current_view(true)),
        ),
        Err(TerminalControlOutcome::Ambiguous)
    ));
}

#[tokio::test]
async fn definite_pre_write_timeout_releases_the_boot_slot() {
    let state = TerminalControlState::default();
    let reservation = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        )
        .expect("initial reservation");
    let held_writer = state.writer.lock().await;
    let writes = Arc::new(AtomicUsize::new(0));
    let observed_writes = Arc::clone(&writes);
    assert_eq!(
        state
            .dispatch_with_timeout(
                reservation,
                typed_producer_dead_command(ANYHARNESS_BOOT).expect("typed command"),
                Duration::from_millis(5),
                move |_| {
                    observed_writes.fetch_add(1, Ordering::AcqRel);
                    async { Ok(()) }
                },
            )
            .await,
        TerminalControlOutcome::Unavailable
    );
    assert_eq!(writes.load(Ordering::Acquire), 0);
    drop(held_writer);

    let retry = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        )
        .expect("pre-write retry");
    assert_eq!(
        state
            .dispatch(
                retry,
                typed_producer_dead_command(ANYHARNESS_BOOT).expect("typed command"),
                |_| async { Ok(()) },
            )
            .await,
        TerminalControlOutcome::Recorded
    );
}

#[tokio::test]
async fn bounded_write_timeout_consumes_the_slot_and_poisons_the_writer() {
    let state = TerminalControlState::default();
    let reservation = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        )
        .expect("reservation");
    let outcome = state
        .dispatch_with_timeout(
            reservation,
            typed_producer_dead_command(ANYHARNESS_BOOT).expect("typed command"),
            Duration::from_millis(5),
            |_| std::future::pending::<Result<(), io::Error>>(),
        )
        .await;

    assert_eq!(outcome, TerminalControlOutcome::Ambiguous);
    assert!(state.writer_is_ambiguous());
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        ),
        Err(TerminalControlOutcome::Ambiguous)
    ));
}

#[tokio::test]
async fn canceled_in_flight_write_consumes_the_slot_and_poisons_the_writer() {
    let state = TerminalControlState::default();
    let reservation = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        )
        .expect("reservation");
    let (started_tx, mut started_rx) = tokio::sync::oneshot::channel();
    {
        let dispatch = state.dispatch_with_timeout(
            reservation,
            typed_producer_dead_command(ANYHARNESS_BOOT).expect("typed command"),
            Duration::from_secs(1),
            move |_| async move {
                let _ = started_tx.send(());
                std::future::pending::<Result<(), io::Error>>().await
            },
        );
        tokio::pin!(dispatch);
        tokio::select! {
            outcome = &mut dispatch => panic!("dispatch completed unexpectedly: {outcome:?}"),
            started = &mut started_rx => started.expect("write attempt started"),
        }
    }

    assert!(state.writer_is_ambiguous());
    assert!(matches!(
        state.reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            ANYHARNESS_BOOT,
            Some(current_view(true)),
        ),
        Err(TerminalControlOutcome::Ambiguous)
    ));
}

#[tokio::test]
async fn owned_writer_appends_one_newline_and_consumes_its_descriptor() {
    let (writer, mut reader) = StdUnixStream::pair().expect("control pair");
    let raw = writer.into_raw_fd();
    // SAFETY: ownership was transferred out of the UnixStream exactly once.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    let command = typed_producer_dead_command(WORKER_BOOT).expect("typed command");
    let mut control = crate::diagnostics_collector::process::OwnedCollectorProcess::prepare_terminal_control_stream(
        descriptor,
    )
    .expect("prepared terminal stream");
    crate::diagnostics_collector::process::OwnedCollectorProcess::write_terminal_control_line(
        &mut control,
        &command,
    )
    .await
    .expect("typed line write");
    drop(control);

    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).expect("control line");
    assert_eq!(bytes.last(), Some(&b'\n'));
    assert_eq!(bytes.iter().filter(|byte| **byte == b'\n').count(), 1);
    assert_eq!(&bytes[..bytes.len() - 1], command);
}

#[tokio::test]
async fn ordinary_shutdown_retries_short_writes_but_terminal_write_does_not() {
    let shutdown = br#"{"command":"shutdown"}"#;
    let mut orderly = ChunkedWriter::new(3);
    crate::diagnostics_collector::process::OwnedCollectorProcess::write_shutdown_control_line_for_test(
        &mut orderly,
        shutdown,
    )
    .await
    .expect("orderly shutdown line");
    assert_eq!(
        orderly.bytes,
        br#"{"command":"shutdown"}
"#
    );
    assert!(orderly.write_calls > 2);
    assert_eq!(orderly.flush_calls, 1);

    let terminal = typed_producer_dead_command(WORKER_BOOT).expect("typed terminal command");
    let mut one_shot = ChunkedWriter::new(8);
    let error =
        crate::diagnostics_collector::process::OwnedCollectorProcess::write_terminal_control_line(
            &mut one_shot,
            &terminal,
        )
        .await
        .expect_err("partial terminal write is ambiguous");
    assert_eq!(error.kind(), io::ErrorKind::WriteZero);
    assert_eq!(one_shot.write_calls, 1);
    assert_eq!(one_shot.bytes.len(), 8);
    assert_eq!(one_shot.flush_calls, 0);
}

struct ChunkedWriter {
    max_chunk: usize,
    bytes: Vec<u8>,
    write_calls: usize,
    flush_calls: usize,
}

impl ChunkedWriter {
    fn new(max_chunk: usize) -> Self {
        Self {
            max_chunk,
            bytes: Vec::new(),
            write_calls: 0,
            flush_calls: 0,
        }
    }
}

impl AsyncWrite for ChunkedWriter {
    fn poll_write(
        mut self: Pin<&mut Self>,
        _context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<Result<usize, io::Error>> {
        self.write_calls += 1;
        let written = bytes.len().min(self.max_chunk);
        self.bytes.extend_from_slice(&bytes[..written]);
        Poll::Ready(Ok(written))
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        _context: &mut Context<'_>,
    ) -> Poll<Result<(), io::Error>> {
        self.flush_calls += 1;
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(
        self: Pin<&mut Self>,
        _context: &mut Context<'_>,
    ) -> Poll<Result<(), io::Error>> {
        Poll::Ready(Ok(()))
    }
}

fn current_view(shutdown_armed: bool) -> TerminalCollectorView<'static> {
    TerminalCollectorView {
        collector_boot_id: COLLECTOR_BOOT,
        generation: GENERATION,
        available: true,
        shutdown_armed,
    }
}

async fn delayed_write(
    active: Arc<AtomicUsize>,
    maximum: Arc<AtomicUsize>,
) -> Result<(), io::Error> {
    let concurrent = active.fetch_add(1, Ordering::AcqRel) + 1;
    maximum.fetch_max(concurrent, Ordering::AcqRel);
    tokio::time::sleep(Duration::from_millis(5)).await;
    active.fetch_sub(1, Ordering::AcqRel);
    Ok(())
}
