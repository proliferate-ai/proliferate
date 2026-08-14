//! Shared terminal-deadline and parent/natural race proofs.

use std::time::Duration;
use std::{future::pending, sync::Arc};

use tokio::time::Instant;

#[cfg(unix)]
use super::tests_support::{emit, ordinary, ready_producer, unavailable_producer, with_state};
#[cfg(unix)]
use super::worker::{take_work, Work, TERMINAL_FALLBACK_ALLOWANCE};
use super::{transport::transport_deadline_at, DiagnosticsProducerGuard};
#[cfg(unix)]
use crate::fallback::FallbackReason;
#[cfg(unix)]
use crate::EmitDisposition;

#[test]
fn terminal_transport_uses_the_shared_deadline_when_it_is_sooner() {
    let now = Instant::now();
    let shared = now + Duration::from_millis(37);
    assert_eq!(transport_deadline_at(now, Some(shared)), shared);
    assert_eq!(
        transport_deadline_at(now, None),
        now + Duration::from_millis(500)
    );
    assert_eq!(
        transport_deadline_at(now, Some(now + Duration::from_secs(2))),
        now + Duration::from_millis(500)
    );
}

#[tokio::test]
#[cfg(unix)]
async fn shutdown_signal_alone_cannot_start_a_fixed_http_deadline() {
    let inner = ready_producer().await;
    assert_eq!(
        emit(&inner, ordinary("waiting-for-parent-window")),
        EmitDisposition::Admitted
    );
    inner.arm_parent_shutdown();

    assert!(take_work(&inner).is_none());
    with_state(&inner, |state| {
        assert!(state.parent_shutdown_observed);
        assert!(state.terminal_deadline.is_none());
        assert_eq!(state.queue.len(), 1);
        assert!(state.in_flight.is_empty());
    });
}

#[tokio::test]
#[cfg(unix)]
async fn terminal_reserve_routes_remaining_queue_without_an_http_dispatch() {
    let inner = ready_producer().await;
    assert_eq!(
        emit(&inner, ordinary("fallback-before-parent-deadline")),
        EmitDisposition::Admitted
    );
    inner.arm_parent_shutdown();
    inner.begin_parent_flush(TERMINAL_FALLBACK_ALLOWANCE);

    let work = take_work(&inner).expect("terminal fallback work");
    match work {
        Work::Fallback { records, deadline } => {
            assert_eq!(records.len(), 1);
            assert_eq!(
                records[0].fallback_reason,
                Some(FallbackReason::FinalTeardown)
            );
            assert!(deadline.is_some());
        }
        Work::Ingest { .. } => panic!("terminal reserve must not dispatch HTTP"),
    }
}

#[test]
#[cfg(unix)]
fn parent_flush_result_and_deadline_win_over_natural_guard_budget() {
    let inner = unavailable_producer();
    inner.arm_parent_shutdown();
    inner.begin_parent_flush(Duration::from_millis(80));
    let parent_deadline = with_state(&inner, |state| {
        state.terminal_deadline.expect("parent deadline")
    });
    let parent_snapshot = inner.snapshot();
    inner.finish_parent_flush(parent_snapshot.clone());

    let guard_deadline = inner.begin_guard_shutdown(Duration::from_millis(500));
    assert_eq!(guard_deadline, parent_deadline);
    assert_eq!(inner.parent_flush_snapshot(), Some(parent_snapshot));
}

#[test]
#[cfg(unix)]
fn parent_shutdown_without_flush_grants_natural_guard_no_second_wait() {
    let inner = unavailable_producer();
    inner.arm_parent_shutdown();
    let deadline = inner.begin_guard_shutdown(Duration::from_millis(500));
    assert!(deadline <= Instant::now());
    assert_eq!(inner.guard_deadline(deadline), None);
}

#[tokio::test]
#[cfg(unix)]
async fn parent_shutdown_without_flush_cannot_block_guard_shutdown() {
    let inner = unavailable_producer();
    inner.arm_parent_shutdown();
    let guard = DiagnosticsProducerGuard {
        inner: Arc::clone(&inner),
        join: Some(tokio::spawn(async { pending::<()>().await })),
        bridge: None,
    };

    tokio::time::timeout(
        Duration::from_millis(50),
        guard.shutdown_inner(Duration::from_millis(500)),
    )
    .await
    .expect("parent signal cannot start or await another 500 ms budget");
}

#[test]
#[cfg(unix)]
fn parent_signal_preempts_an_already_started_natural_budget() {
    let inner = unavailable_producer();
    let natural_deadline = inner.begin_guard_shutdown(Duration::from_millis(500));
    assert!(natural_deadline > Instant::now());

    inner.arm_parent_shutdown();
    assert_eq!(inner.guard_deadline(natural_deadline), None);

    inner.begin_parent_flush(Duration::from_millis(40));
    let parent_deadline = with_state(&inner, |state| state.terminal_deadline.unwrap());
    assert_eq!(
        inner.guard_deadline(natural_deadline),
        Some(parent_deadline)
    );
}
