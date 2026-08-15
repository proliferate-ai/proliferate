//! File-backed dev generation refresh: parsing bounds and re-attach behavior
//! against a hand-served loopback collector, no live Desktop host involved.

use std::{
    path::Path,
    sync::Arc,
    time::{Duration, SystemTime},
};

use super::{
    dev_refresh::dev_generation_refresh_with_interval,
    status::ProducerCollectorState,
    tests_support::{
        emit, producer, protected, settle, spawn_worker, wait_for, CollectorFixture,
        TEST_CAPABILITY, TEST_COLLECTOR_BOOT,
    },
    CollectorAvailability, ProducerInner,
};
use crate::{
    bridge::activation::{
        parse_dev_env_file, DEV_CAPABILITY_ENV, DEV_COLLECTOR_BOOT_ID_ENV, DEV_ENDPOINT_ENV,
        DEV_ENV_PATH_ENV,
    },
    DiagnosticsComponent, EmitDisposition,
};

const FRESH_COLLECTOR_BOOT: &str = "collector-boot-0002";
const TEST_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Writes the snippet exactly as the Desktop host renders it (four lines) and
/// forces a strictly increasing mtime so the refresh loop's stat cannot miss a
/// rewrite on filesystems with coarse timestamp granularity.
fn write_snippet(path: &Path, sequence: u64, endpoint: &str, capability: &str, boot_id: &str) {
    let snippet = format!(
        "{DEV_ENDPOINT_ENV}={endpoint}\n{DEV_CAPABILITY_ENV}={capability}\n{DEV_COLLECTOR_BOOT_ID_ENV}={boot_id}\n{DEV_ENV_PATH_ENV}={}\n",
        path.display(),
    );
    write_raw(path, sequence, &snippet);
}

fn write_raw(path: &Path, sequence: u64, content: &str) {
    std::fs::write(path, content).expect("write dev env snippet");
    let file = std::fs::File::options()
        .write(true)
        .open(path)
        .expect("reopen snippet");
    file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + sequence))
        .expect("set snippet mtime");
}

fn ready_snapshot(inner: &ProducerInner) -> Option<(String, u64)> {
    match inner.snapshot().collector_state {
        ProducerCollectorState::Ready {
            collector_boot_id,
            generation_number,
        } => Some((collector_boot_id, generation_number)),
        _ => None,
    }
}

#[test]
fn parse_accepts_the_published_four_line_snippet() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("diagnostics-dev.env");
    write_snippet(
        &path,
        1,
        "http://127.0.0.1:53421/",
        TEST_CAPABILITY,
        TEST_COLLECTOR_BOOT,
    );
    let parsed = parse_dev_env_file(&path).expect("valid snippet parses");
    assert_eq!(parsed.endpoint, "http://127.0.0.1:53421/");
    assert_eq!(parsed.capability, TEST_CAPABILITY);
    assert_eq!(parsed.collector_boot_id, TEST_COLLECTOR_BOOT);
}

#[test]
fn parse_rejects_missing_keys_out_of_bound_values_and_oversized_files() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("diagnostics-dev.env");

    // Missing capability line.
    write_raw(
        &path,
        1,
        &format!("{DEV_ENDPOINT_ENV}=http://127.0.0.1:1/\n{DEV_COLLECTOR_BOOT_ID_ENV}=boot\n"),
    );
    assert!(parse_dev_env_file(&path).is_none());

    // Boot id past the protocol id bound (128 bytes).
    write_snippet(
        &path,
        2,
        "http://127.0.0.1:1/",
        TEST_CAPABILITY,
        &"b".repeat(129),
    );
    assert!(parse_dev_env_file(&path).is_none());

    // Empty value.
    write_snippet(&path, 3, "", TEST_CAPABILITY, TEST_COLLECTOR_BOOT);
    assert!(parse_dev_env_file(&path).is_none());

    // A file that is clearly not the four-line snippet.
    write_raw(&path, 4, &"x".repeat(10_000));
    assert!(parse_dev_env_file(&path).is_none());

    // Missing file.
    assert!(parse_dev_env_file(&directory.path().join("absent.env")).is_none());
}

/// A rewrite carrying a new collector boot id swaps the producer onto the new
/// endpoint as generation 2, and records dispatch to the new collector.
#[tokio::test(flavor = "multi_thread")]
async fn rewrite_with_new_boot_id_reattaches_as_generation_two() {
    let old = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let fresh = CollectorFixture::accepting(FRESH_COLLECTOR_BOOT).await;
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("diagnostics-dev.env");
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(old.generation(1))),
        None,
    );
    let refresh = tokio::spawn(dev_generation_refresh_with_interval(
        Arc::clone(&inner),
        path.clone(),
        TEST_POLL_INTERVAL,
    ));

    write_snippet(
        &path,
        1,
        fresh.endpoint(),
        TEST_CAPABILITY,
        FRESH_COLLECTOR_BOOT,
    );
    assert!(
        wait_for(|| { ready_snapshot(&inner) == Some((FRESH_COLLECTOR_BOOT.to_owned(), 2)) }).await,
        "producer must re-attach to the new boot id as generation 2"
    );

    // Delivery proof: the swapped-in client points at the fresh endpoint.
    assert_eq!(
        emit(&inner, protected("post-restart")),
        EmitDisposition::Admitted
    );
    let worker = spawn_worker(&inner);
    assert!(
        wait_for(|| fresh.batch_count() == 1).await,
        "records must dispatch to the new collector endpoint"
    );
    assert_eq!(old.batch_count(), 0);
    worker.abort();
    refresh.abort();
}

/// The host re-publishes the snippet for our own boot too (e.g. app restart
/// racing us); an unchanged boot id must not churn the generation.
#[tokio::test(flavor = "multi_thread")]
async fn rewrite_with_same_boot_id_does_not_swap() {
    let old = CollectorFixture::accepting(TEST_COLLECTOR_BOOT).await;
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("diagnostics-dev.env");
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(old.generation(1))),
        None,
    );
    let refresh = tokio::spawn(dev_generation_refresh_with_interval(
        Arc::clone(&inner),
        path.clone(),
        TEST_POLL_INTERVAL,
    ));

    write_snippet(
        &path,
        1,
        old.endpoint(),
        TEST_CAPABILITY,
        TEST_COLLECTOR_BOOT,
    );
    settle().await;
    assert_eq!(
        ready_snapshot(&inner),
        Some((TEST_COLLECTOR_BOOT.to_owned(), 1)),
        "a republished snippet for the same boot id must leave generation 1 in place"
    );
    refresh.abort();
}

/// Garbage never swaps, and the unavailable latch survives it — but a later
/// valid snippet still supersedes the latch (the outage this fixes).
#[tokio::test(flavor = "multi_thread")]
async fn garbage_preserves_latch_and_valid_rewrite_supersedes_it() {
    let fresh = CollectorFixture::accepting(FRESH_COLLECTOR_BOOT).await;
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("diagnostics-dev.env");
    // Boot-id-mismatched receipts latch the boot generation unusable.
    let inner = producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Unavailable { generation: 1 },
        None,
    );
    let refresh = tokio::spawn(dev_generation_refresh_with_interval(
        Arc::clone(&inner),
        path.clone(),
        TEST_POLL_INTERVAL,
    ));

    write_raw(&path, 1, "not=the\nsnippet\n");
    settle().await;
    assert!(
        matches!(
            inner.snapshot().collector_state,
            ProducerCollectorState::Unavailable
        ),
        "garbage must not disturb the unavailable latch"
    );

    write_snippet(
        &path,
        2,
        fresh.endpoint(),
        TEST_CAPABILITY,
        FRESH_COLLECTOR_BOOT,
    );
    assert!(
        wait_for(|| { ready_snapshot(&inner) == Some((FRESH_COLLECTOR_BOOT.to_owned(), 2)) }).await,
        "a valid rewrite must supersede the unavailable latch"
    );
    refresh.abort();
}
