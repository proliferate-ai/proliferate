use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::*;

const COLLECTOR_BOOT: &str = "collector-boot-deadline";
const PRODUCER_BOOT: &str = "producer-boot-deadline";
const GENERATION: u64 = 7;

#[tokio::test]
async fn exhausted_caller_deadline_starts_no_second_terminal_wait_or_write() {
    let state = TerminalControlState::default();
    let current = TerminalCollectorView {
        collector_boot_id: COLLECTOR_BOOT,
        generation: GENERATION,
        available: true,
        shutdown_armed: true,
    };
    let reservation = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            PRODUCER_BOOT,
            Some(current),
        )
        .expect("initial reservation");
    let writes = Arc::new(AtomicUsize::new(0));
    let observed_writes = Arc::clone(&writes);

    assert_eq!(
        state
            .dispatch_until(
                reservation,
                typed_producer_dead_command(PRODUCER_BOOT).expect("typed command"),
                tokio::time::Instant::now(),
                move |_| {
                    observed_writes.fetch_add(1, Ordering::AcqRel);
                    async { Ok(()) }
                },
            )
            .await,
        TerminalControlOutcome::Unavailable
    );
    assert_eq!(writes.load(Ordering::Acquire), 0);
    assert!(state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            PRODUCER_BOOT,
            Some(current),
        )
        .is_ok());
}

#[tokio::test]
async fn lifecycle_decision_wait_uses_the_existing_caller_deadline_before_reservation() {
    let root = std::env::temp_dir().join(format!(
        "terminal-control-deadline-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).expect("temporary fallback root");
    let fallback =
        crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter::open_for_test(
            root.join("desktop-native.log"),
        )
        .expect("fallback");
    let producer = crate::diagnostics_collector::producer::TauriDiagnosticsProducer::new(
        fallback.clone(),
        "test".into(),
        "test".into(),
    );
    let supervisor = DiagnosticsCollectorSupervisor::with_launcher(
        producer,
        fallback.clone(),
        Err(
            crate::diagnostics_collector::process::CollectorLaunchError::new(
                crate::diagnostics_collector::process::CollectorLaunchErrorKind::BinaryMissing,
                "test launcher is intentionally absent",
            ),
        ),
    );
    let held_decision = supervisor.hold_lifecycle_decision_for_test().await;
    let started = tokio::time::Instant::now();
    let outcome = supervisor
        .send_producer_dead_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            PRODUCER_BOOT,
            started + std::time::Duration::from_millis(10),
        )
        .await;

    assert_eq!(outcome, TerminalControlOutcome::Unavailable);
    assert!(started.elapsed() < std::time::Duration::from_millis(200));
    assert!(!supervisor
        .terminal_control
        .slots
        .lock()
        .expect("terminal slots")
        .contains_producer_boot(PRODUCER_BOOT));
    assert!(!supervisor.terminal_control.writer_is_ambiguous());
    drop(held_decision);
    drop(supervisor);
    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("remove fallback root");
}

#[tokio::test]
async fn shutdown_writer_gate_blocks_terminal_dispatch_without_interleaving() {
    let state = TerminalControlState::default();
    let current = TerminalCollectorView {
        collector_boot_id: COLLECTOR_BOOT,
        generation: GENERATION,
        available: true,
        shutdown_armed: true,
    };
    let reservation = state
        .reserve_if_current(
            TerminalProducerSlot::AnyHarness,
            COLLECTOR_BOOT,
            GENERATION,
            PRODUCER_BOOT,
            Some(current),
        )
        .expect("terminal reservation");
    let shutdown_writer = state.lock_writer().await;
    let writes = Arc::new(AtomicUsize::new(0));
    let observed_writes = Arc::clone(&writes);
    let dispatch = state.dispatch_until(
        reservation,
        typed_producer_dead_command(PRODUCER_BOOT).expect("typed command"),
        tokio::time::Instant::now() + std::time::Duration::from_secs(1),
        move |_| {
            observed_writes.fetch_add(1, Ordering::AcqRel);
            async { Ok(()) }
        },
    );
    tokio::pin!(dispatch);
    tokio::select! {
        outcome = &mut dispatch => panic!("terminal write overtook shutdown gate: {outcome:?}"),
        _ = tokio::time::sleep(std::time::Duration::from_millis(10)) => {}
    }
    assert_eq!(writes.load(Ordering::Acquire), 0);
    drop(shutdown_writer);
    assert_eq!(dispatch.await, TerminalControlOutcome::Recorded);
    assert_eq!(writes.load(Ordering::Acquire), 1);
}
