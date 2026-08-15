//! Fallback ownership and parent-deadline regression proofs.

use std::{
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

use super::{
    tests_support::{
        emit, fallback_bytes, fallback_directory, fallback_writer, ordinary, producer, spawn_worker,
    },
    CollectorAvailability, DiagnosticsProducerHandle, ProducerFailureClassification,
};
use crate::{DiagnosticsComponent, EmitDisposition};

const PARENT_PRODUCER_DEADLINE: Duration = Duration::from_millis(500);

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stalled_fallback_cannot_block_status_or_extend_the_parent_deadline() {
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Unavailable { generation: 0 },
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );
    let (write_entered, release_write) = inner.fallback.stall_next_write();
    assert_eq!(
        emit(&inner, ordinary("one bounded fallback record")),
        EmitDisposition::Admitted
    );
    let worker = spawn_worker(&inner);
    write_entered
        .recv_timeout(Duration::from_secs(1))
        .expect("the sole fallback operation started");
    assert_eq!(
        emit(&inner, ordinary("queued behind the sole writer")),
        EmitDisposition::Admitted
    );

    // The status path reads only cached atomics. It neither owns nor waits for
    // the writer that is currently blocked in the offloaded operation.
    let handle = DiagnosticsProducerHandle {
        inner: Arc::clone(&inner),
    };
    let (status_tx, status_rx) = mpsc::sync_channel(1);
    let status_thread = std::thread::spawn(move || {
        let _ = status_tx.send(handle.status_snapshot());
    });
    let live = status_rx
        .recv_timeout(Duration::from_millis(100))
        .expect("status remains inside the bridge status budget");
    status_thread.join().expect("status thread");
    assert!(live.fallback_active);
    assert_eq!(live.resident_records, 2);

    // This is Tauri's complete one absolute producer window. There is no
    // fallback-local allowance after it.
    inner.arm_parent_shutdown();
    let started = Instant::now();
    let expired = inner.flush_until(PARENT_PRODUCER_DEADLINE).await;
    assert!(started.elapsed() < Duration::from_millis(750));
    assert!(!expired.fallback_active);
    assert_eq!(expired.resident_records, 0);
    assert_eq!(expired.resident_bytes, 0);
    assert!(!expired.in_flight);
    assert_eq!(expired.dropped_by_reason.shutdown_timeout, 2);
    assert_eq!(expired.dropped_by_reason.fallback_write_failed, 0);
    assert_eq!(expired.fallback_write_failures, 0);
    assert_eq!(expired.fallback_routed, 0);
    assert!(!expired.delivery_fence_eligible);
    assert_eq!(
        expired.last_failure,
        Some(ProducerFailureClassification::ShutdownTimeout)
    );
    let loss_range = inner
        .state
        .lock()
        .expect("admission state")
        .pending_loss_range;
    assert_eq!(
        loss_range,
        super::admission::PendingLossRange::Exact { first: 1, last: 2 }
    );
    assert_eq!(
        emit(&inner, ordinary("never retried")),
        EmitDisposition::Inactive
    );

    // A running OS write cannot be cancelled. Once released it may leave one
    // line, but its detached result never updates status, restores authority,
    // retries the record, or claims fallback success.
    release_write.send(()).expect("release stalled write");
    tokio::time::timeout(Duration::from_secs(1), async {
        while fallback_bytes(&directory, "anyharness.jsonl").last() != Some(&b'\n') {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the already-running OS operation may finish");
    tokio::time::timeout(Duration::from_millis(200), worker)
        .await
        .expect("producer worker does not wait for the abandoned operation")
        .expect("producer worker exits cleanly");
    let late_bytes = fallback_bytes(&directory, "anyharness.jsonl");
    assert_eq!(late_bytes.iter().filter(|byte| **byte == b'\n').count(), 1);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(
        fallback_bytes(&directory, "anyharness.jsonl"),
        late_bytes,
        "the abandoned record is never retried"
    );
    let final_status = inner.snapshot();
    assert!(!final_status.fallback_active);
    assert_eq!(final_status.fallback_bytes, 0);
    assert_eq!(final_status.dropped_by_reason.shutdown_timeout, 2);
    assert_eq!(final_status.dropped_by_reason.fallback_write_failed, 0);
    assert_eq!(final_status.fallback_routed, 0);
}

// Stays macOS-only for its wall-clock budget, not for the rotation primitive:
// this asserts a sub-750ms deadline return, which a loaded shared runner cannot
// promise. Rotation itself is covered on every unix by `fallback::tests`.
#[cfg(target_os = "macos")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stalled_rotation_cannot_extend_the_parent_deadline_or_rejoin() {
    use std::fs::{self, File};
    use std::os::unix::fs::PermissionsExt;

    use crate::fallback::{FALLBACK_SEGMENT_BYTES, FALLBACK_TOTAL_BYTES};

    let directory = fallback_directory();
    let active_path = directory.path().join("anyharness.jsonl");
    let active = File::create(&active_path).expect("active fallback segment");
    active
        .set_len(u64::from(FALLBACK_SEGMENT_BYTES))
        .expect("force the next record through rotation");
    fs::set_permissions(&active_path, fs::Permissions::from_mode(0o600))
        .expect("secure active mode");
    drop(active);

    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Unavailable { generation: 0 },
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );
    let (rotation_entered, release_rotation) = inner.fallback.stall_next_write();
    assert_eq!(
        emit(&inner, ordinary("record that requires rotation")),
        EmitDisposition::Admitted
    );
    let worker = spawn_worker(&inner);
    rotation_entered
        .recv_timeout(Duration::from_secs(1))
        .expect("the sole rotation operation started");

    inner.arm_parent_shutdown();
    let started = Instant::now();
    let expired = inner.flush_until(PARENT_PRODUCER_DEADLINE).await;
    assert!(started.elapsed() < Duration::from_millis(750));
    assert!(!expired.fallback_active);
    assert_eq!(expired.resident_records, 0);
    assert_eq!(expired.dropped_by_reason.shutdown_timeout, 1);
    assert_eq!(expired.dropped_by_reason.fallback_write_failed, 0);
    assert_eq!(expired.fallback_routed, 0);

    release_rotation.send(()).expect("release stalled rotation");
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if fs::read(&active_path)
                .ok()
                .is_some_and(|bytes| bytes.last() == Some(&b'\n'))
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the already-running rotation may finish");
    tokio::time::timeout(Duration::from_millis(200), worker)
        .await
        .expect("producer worker does not wait again")
        .expect("producer worker exits cleanly");

    let family_bytes: u64 = [
        "anyharness.jsonl",
        "anyharness.jsonl.1",
        "anyharness.jsonl.2",
        "anyharness.jsonl.3",
    ]
    .into_iter()
    .map(|name| {
        fs::metadata(directory.path().join(name))
            .expect("fixed fallback segment")
            .len()
    })
    .sum();
    assert!(family_bytes <= u64::from(FALLBACK_TOTAL_BYTES));
    let final_status = inner.snapshot();
    assert!(!final_status.fallback_active);
    assert_eq!(final_status.dropped_by_reason.shutdown_timeout, 1);
    assert_eq!(final_status.dropped_by_reason.fallback_write_failed, 0);
    assert_eq!(final_status.fallback_routed, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deadline_wins_a_completed_write_racing_writer_restoration() {
    let directory = fallback_directory();
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Unavailable { generation: 0 },
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );
    let (restore_entered, release_restore) = inner.fallback.stall_next_restore();
    assert_eq!(
        emit(&inner, ordinary("completed before restore")),
        EmitDisposition::Admitted
    );
    let worker = spawn_worker(&inner);
    restore_entered
        .recv_timeout(Duration::from_secs(1))
        .expect("write completed and reached the restore barrier");
    let completed_bytes = u32::try_from(fallback_bytes(&directory, "anyharness.jsonl").len())
        .expect("bounded fallback byte count");
    assert!(completed_bytes > 0);

    inner.arm_parent_shutdown();
    let flush_inner = Arc::clone(&inner);
    let flush =
        tokio::spawn(async move { flush_inner.flush_until(Duration::from_millis(40)).await });
    tokio::time::sleep(Duration::from_millis(80)).await;
    release_restore.send(()).expect("release restore race");
    let snapshot = flush.await.expect("flush task");
    assert!(!snapshot.fallback_active);
    assert_eq!(snapshot.fallback_bytes, completed_bytes);
    assert_eq!(snapshot.dropped_by_reason.shutdown_timeout, 1);
    assert_eq!(snapshot.dropped_by_reason.fallback_write_failed, 0);
    assert_eq!(snapshot.fallback_routed, 0);
    assert!(!snapshot.delivery_fence_eligible);
    tokio::time::timeout(Duration::from_millis(200), worker)
        .await
        .expect("worker observes the terminal owner")
        .expect("worker exits cleanly");
}
