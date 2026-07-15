//! Flow tests for the activation state machine: download/stage/checksum
//! admission, dedup, restart order, health gate, rollback, and the crash-safety
//! integration paths that exercise the journal end-to-end through `run_pending`.

use super::test_support::*;
use super::*;

use super::journal::{activation_journal_path, write_activation_journal, ActivationJournal};
use proliferate_runtime_update_protocol::{result_exists, result_file_name, write_request};

#[tokio::test]
async fn anyharness_update_activates_restarts_in_order_and_retains_prev() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    fs::write(&config.worker_binary, b"worker-bin").expect("seed worker");
    let new_bytes = b"new-anyharness-binary";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
    let previous = prev_path_for(&config.anyharness_binary);
    assert_eq!(fs::read(&previous).unwrap(), b"old-anyharness");
    // AnyHarness restarts before the dependent Worker.
    assert_eq!(host.restart_log, vec!["anyharness", "worker"]);
    assert_eq!(host.fetch_count, 1);
    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Activated);
    assert_eq!(result.observed_version.as_deref(), Some("0.2.16"));
}

#[tokio::test]
async fn duplicate_request_activates_exactly_once() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old").expect("seed active");
    let new_bytes = b"new";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("first drain");
    // A replayed heartbeat rewrites the same file; a second drain must not
    // re-activate.
    write_request(&config.update_request_dir, &request).expect("replay request");
    run_pending(&config, &mut host).await.expect("second drain");

    assert_eq!(host.fetch_count, 1, "exactly one activation");
}

#[tokio::test]
async fn wrong_checksum_is_invalid_and_leaves_no_active_change() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    // The request's sha256/size describe "declared", but the fetch returns
    // different bytes.
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", b"declared-bytes");
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(b"totally-different-bytes".to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Invalid);
    assert!(
        host.restart_log.is_empty(),
        "no restart on a rejected artifact"
    );
    assert_eq!(
        fs::read(&config.anyharness_binary).unwrap(),
        b"old-anyharness"
    );
    assert!(!prev_path_for(&config.anyharness_binary).exists());
}

#[tokio::test]
async fn wrong_size_is_invalid() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old").expect("seed active");
    let new_bytes = b"new-bytes";
    let mut request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    request.size_bytes += 1; // correct checksum, wrong declared size
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Invalid);
    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old");
}

#[tokio::test]
async fn download_status_failure_is_invalid_and_never_restarts() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old").expect("seed active");
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", b"new");
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Status, // definitive non-2xx: terminal
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Invalid);
    assert_eq!(host.fetch_count, 1);
    assert!(host.restart_log.is_empty());
    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old");
}

#[tokio::test]
async fn transient_download_failure_stays_pending_then_next_drain_converges() {
    // R9-002: a transport blip must NOT latch a terminal Invalid — the
    // request stays pending and the next drain retries and converges.
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    let new_bytes = b"new-anyharness";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    // First drain: the fetch fails transiently, so no result is written.
    let mut host = FakeHost {
        fetch: FetchMode::Transient,
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("first drain");
    assert!(
        !result_exists(&config.update_request_dir, &request.request_id),
        "a transient failure must not write a terminal result"
    );
    assert_eq!(
        fs::read(&config.anyharness_binary).unwrap(),
        b"old-anyharness"
    );

    // Next drain: the network recovered — the same still-pending request now
    // converges to Activated.
    host.fetch = FetchMode::Bytes(new_bytes.to_vec());
    run_pending(&config, &mut host).await.expect("retry drain");
    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Activated);
    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
}

#[tokio::test]
async fn crash_after_activate_on_unhealthy_path_preserves_last_good() {
    // R9-004: a crash after activate but before result must not let the
    // re-drain clobber the true last-good. On the UNHEALTHY path the drain
    // must roll back onto the ORIGINAL last-good, not the new bad binary.
    let dir = temp_dir();
    let config = test_config(&dir.0);
    let new_bytes = b"new-bad-anyharness";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    // On-disk state a crash-after-activate leaves: the two renames already
    // happened (active = new, .prev = the true last-good) and NO result.
    fs::write(&config.anyharness_binary, new_bytes).expect("active = activated new");
    fs::write(prev_path_for(&config.anyharness_binary), b"old-good").expect(".prev = last-good");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: false, // the new binary is unhealthy
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host)
        .await
        .expect("recovery drain");

    // The fast path recognized the already-activated artifact and never
    // re-downloaded or re-moved active->.prev; the health-fail restored the
    // genuine last-good, not the bad binary.
    assert_eq!(
        host.fetch_count, 0,
        "already-activated artifact is not re-fetched"
    );
    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old-good");
    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::RolledBack);
}

#[tokio::test]
async fn version_mismatch_fails_the_health_gate_and_rolls_back() {
    // R9-008: a checksum-valid but lagging artifact that answers /health 2xx
    // on the PRIOR version must still fail the gate.
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    let new_bytes = b"new-anyharness-binary";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        // The runtime answers 2xx but on the LAGGING version, not 0.2.16.
        anyharness_version: Some("0.2.15".to_string()),
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::RolledBack);
    assert_eq!(
        fs::read(&config.anyharness_binary).unwrap(),
        b"old-anyharness"
    );
    // The gate was asked to check the activated version, not just 2xx.
    assert!(host
        .health_expected
        .iter()
        .any(|expected| expected.as_deref() == Some("0.2.16")));
}

#[tokio::test]
async fn staging_interruption_leaves_no_active_change_and_rerequest_converges() {
    // R9-013: a staging interruption (here modeled as a wrong-size artifact
    // that fails re-verify at stage time) must leave the active binary
    // untouched and no `.prev`; a corrected re-request then converges.
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    let new_bytes = b"new-anyharness";
    let mut request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    request.size_bytes += 1; // declared size disagrees: staging re-verify fails

    write_request(&config.update_request_dir, &request).expect("write request");
    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("first drain");
    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Invalid);
    assert!(
        host.restart_log.is_empty(),
        "no restart on a rejected stage"
    );
    assert_eq!(
        fs::read(&config.anyharness_binary).unwrap(),
        b"old-anyharness"
    );
    assert!(
        !prev_path_for(&config.anyharness_binary).exists(),
        "no active change staged"
    );

    // A corrected re-request (same version, now with the honest size) mints
    // the same request_id; drop the stale Invalid result so the re-request
    // is actionable, then confirm it converges.
    fs::remove_file(
        config
            .update_request_dir
            .join(result_file_name(&request.request_id)),
    )
    .expect("clear stale result");
    let good = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &good).expect("re-request");
    run_pending(&config, &mut host)
        .await
        .expect("re-request drain");
    let result = result_for(&config.update_request_dir, &good.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Activated);
    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
}

#[tokio::test]
async fn unhealthy_activation_rolls_back_to_last_good() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    let new_bytes = b"new-anyharness";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: false, // unhealthy after activation
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    // Last-good restored; the new version is never left active.
    assert_eq!(
        fs::read(&config.anyharness_binary).unwrap(),
        b"old-anyharness"
    );
    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::RolledBack);
    // Restart for the activation, then again for the rollback.
    assert_eq!(
        host.restart_log,
        vec!["anyharness", "worker", "anyharness", "worker"]
    );
    // SUF-001 regression: the rollback reachability probe must still cover the
    // Worker-liveness leg. The activation health gate short-circuits on the
    // unhealthy AnyHarness before ever reaching `worker_alive`, so the only path
    // that can bump this counter is the post-rollback probe. Before the fix it
    // was 0 (the probe checked AnyHarness only) — a Worker that failed to come
    // back on rollback went unobserved.
    assert_eq!(
        host.worker_alive_calls, 1,
        "rollback must probe Worker liveness, not only AnyHarness /health"
    );
}

#[tokio::test]
async fn worker_component_update_replaces_only_the_worker() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"anyharness-untouched").expect("seed anyharness");
    fs::write(&config.worker_binary, b"old-worker").expect("seed worker");
    let new_bytes = b"new-worker-binary";
    let request = make_request(UpdateComponent::Worker, "0.3.0", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    assert_eq!(fs::read(&config.worker_binary).unwrap(), new_bytes);
    assert_eq!(
        fs::read(prev_path_for(&config.worker_binary)).unwrap(),
        b"old-worker"
    );
    // AnyHarness is left entirely alone; only the Worker is restarted.
    assert_eq!(
        fs::read(&config.anyharness_binary).unwrap(),
        b"anyharness-untouched"
    );
    assert_eq!(host.restart_log, vec!["worker"]);
    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Activated);
}

#[tokio::test]
async fn worker_bytes_reporting_a_different_version_fail_the_gate_and_roll_back() {
    // R9R-001 mislabel-close: even after a checksum-valid activation, if the
    // ACTIVE worker binary reports a version other than the requested one
    // (bytes A behind a request labelled B), the gate fails and the change
    // rolls back — never a false Activated=B for bytes that are A.
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"anyharness-untouched").expect("seed anyharness");
    fs::write(&config.worker_binary, b"old-worker").expect("seed worker");
    let new_bytes = b"new-worker-binary";
    let request = make_request(UpdateComponent::Worker, "0.3.0", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        // The activated bytes report a DIFFERENT version than requested.
        worker_reports: Some(false),
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::RolledBack);
    // Last-good restored; the mislabelled bytes are never left active.
    assert_eq!(fs::read(&config.worker_binary).unwrap(), b"old-worker");
}

#[tokio::test]
async fn unrepresentable_component_is_invalid_without_fetching() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old").expect("seed active");
    // "supervisor" is not a representable component: the read fails, so the
    // machine records Invalid and never downloads or activates.
    let path = config
        .update_request_dir
        .join("request-supervisor-9.9.9.json");
    fs::create_dir_all(&config.update_request_dir).expect("create updates dir");
    fs::write(
        &path,
        br#"{"requestId":"supervisor-9.9.9","component":"supervisor","version":"9.9.9","targetTriple":"linux-x86_64","artifactUrl":"https://x.test/a","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":1,"requestedAt":"2026-07-15T00:00:00Z"}"#,
    )
    .expect("write malformed request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(b"never-used".to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("run pending");

    assert_eq!(host.fetch_count, 0, "a rejected request is never fetched");
    assert!(result_exists(
        &config.update_request_dir,
        "supervisor-9.9.9"
    ));
    let result = result_for(&config.update_request_dir, "supervisor-9.9.9");
    assert_eq!(result.outcome, UpdateOutcome::Invalid);
    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), b"old");
}

#[tokio::test]
async fn crash_before_result_reprocesses_and_converges_once() {
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    let new_bytes = b"new-anyharness";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };

    // First attempt: run the machine but "crash" before the result is
    // recorded (simulating a Supervisor restart mid-activation).
    let pending = request::next_pending(&config.update_request_dir)
        .expect("scan")
        .expect("pending");
    let _crashed = activate_one(&config, &mut host, &pending).await;
    assert!(!result_exists(
        &config.update_request_dir,
        &request.request_id
    ));

    // Recovery: the request has no result, so it is reprocessed and
    // converges, writing exactly one terminal Activated result.
    run_pending(&config, &mut host)
        .await
        .expect("recovery drain");

    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Activated);
    assert_eq!(fs::read(&config.anyharness_binary).unwrap(), new_bytes);
    // A second drain is a no-op (idempotent).
    let fetches_after_recovery = host.fetch_count;
    run_pending(&config, &mut host)
        .await
        .expect("idempotent drain");
    assert_eq!(host.fetch_count, fetches_after_recovery);
}

#[tokio::test]
async fn reconcile_completes_a_between_renames_crash_then_converges() {
    // R9R-004: restart from the EXACT filesystem state a crash between the
    // two activation renames leaves — `active` ABSENT, `.prev` = last-good,
    // `staged` = the new binary, plus the activation journal — must recover
    // to a consistent `active` and then converge (no livelock on the missing
    // binary, no re-download).
    let dir = temp_dir();
    let config = test_config(&dir.0);
    let new_bytes = b"new-anyharness-binary";
    let active = config.anyharness_binary.clone();
    let prev = prev_path_for(&active);
    fs::write(&prev, b"old-good").expect("seed .prev = last-good");
    fs::create_dir_all(&config.staging_dir).expect("staging dir");
    let staged = config.staging_dir.join("anyharness-0.2.16");
    fs::write(&staged, new_bytes).expect("seed staged = new");
    assert!(!active.exists(), "the crash landed with active absent");
    write_activation_journal(
        &config,
        &ActivationJournal {
            component: "anyharness".to_string(),
            active_path: active.clone(),
            prev_path: prev.clone(),
            staged_path: staged.clone(),
        },
    )
    .expect("write journal");

    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");

    // Startup reconcile completes the interrupted swap: active exists again.
    reconcile_activation_journal(&config).expect("reconcile");
    assert_eq!(
        fs::read(&active).unwrap(),
        new_bytes,
        "active recovered from the staged binary"
    );
    assert!(
        !activation_journal_path(&config).exists(),
        "journal cleared after reconcile"
    );

    // The drain converges via the crash-recovery fast path (active already
    // hashes to the request): no re-fetch, exactly one Activated.
    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("drain");
    assert_eq!(host.fetch_count, 0, "recovered active is not re-fetched");
    let result = result_for(&config.update_request_dir, &request.request_id);
    assert_eq!(result.outcome, UpdateOutcome::Activated);
}

#[tokio::test]
async fn a_clean_activation_leaves_no_journal_behind() {
    // The journal is an in-flight-swap marker: a normal activation must clear
    // it so a later startup reconcile is a no-op.
    let dir = temp_dir();
    let config = test_config(&dir.0);
    fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
    let new_bytes = b"new-anyharness";
    let request = make_request(UpdateComponent::Anyharness, "0.2.16", new_bytes);
    write_request(&config.update_request_dir, &request).expect("write request");
    let mut host = FakeHost {
        fetch: FetchMode::Bytes(new_bytes.to_vec()),
        healthy: true,
        worker_live: true,
        ..Default::default()
    };
    run_pending(&config, &mut host).await.expect("drain");
    assert!(
        !activation_journal_path(&config).exists(),
        "a clean activation leaves no journal"
    );
}
