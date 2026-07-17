use std::{
    env, fs,
    process::Stdio,
    sync::{atomic::Ordering, Arc},
    thread,
    time::Duration,
};

use tokio::process::Command;
use tokio::time::{sleep, timeout, Instant};

use super::lifecycle::{lock_for_worker_start, prepare_desktop_dispatch_worker_update};
use super::{
    acquire_worker_database_lock, read_worker_log_tail, startup_watch_window,
    worker_database_lock_is_held, worker_startup_failure_message, write_worker_config,
    CloudWorkerProcess, CloudWorkerState, WORKER_LOG_TAIL_MAX_BYTES,
};

const TEST_WORKER_LOCK_PATH_ENV: &str = "PROLIFERATE_TEST_WORKER_LOCK_PATH";

#[test]
fn worker_config_uses_the_desktop_sidecar_url() {
    let root = env::temp_dir().join(format!(
        "proliferate-worker-config-{}",
        uuid::Uuid::new_v4()
    ));
    let config_path = root.join("config.toml");
    let worker_db_path = root.join("worker.sqlite3");
    let integration_gateway_home = root.join("anyharness");

    write_worker_config(
        &config_path,
        "https://app.proliferate.com/api",
        Some("enrollment-token"),
        &worker_db_path,
        &integration_gateway_home,
        "http://127.0.0.1:50746",
    )
    .expect("write worker config");

    let contents = fs::read_to_string(config_path).expect("read worker config");
    assert!(contents.contains("runtime_base_url = \"http://127.0.0.1:50746\""));
    fs::remove_dir_all(root).expect("remove temporary worker config root");
}

#[tokio::test]
async fn update_preparation_only_stops_worker_for_direct_exit_installers() {
    let root = env::temp_dir().join(format!(
        "proliferate-worker-exit-lock-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create temporary worker root");
    let database_path = root.join("worker.sqlite3");
    let config_path = root.join("config.toml");

    let mut child = Command::new(env::current_exe().expect("resolve test executable"))
        .arg("worker_database_lock_holder_fixture")
        .arg("--ignored")
        .env(TEST_WORKER_LOCK_PATH_ENV, &database_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn lock-holding worker stand-in");

    let lock_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if worker_database_lock_is_held(&database_path).expect("inspect worker lock") {
            break;
        }
        if let Some(status) = child.try_wait().expect("inspect lock holder") {
            panic!("lock holder exited before acquiring the lock: {status}");
        }
        assert!(Instant::now() < lock_deadline, "lock holder did not start");
        sleep(Duration::from_millis(20)).await;
    }

    let state = Arc::new(CloudWorkerState::default());
    state.lifecycle.lock().await.process = Some(CloudWorkerProcess {
        target_id: "desktop-install".to_string(),
        child,
        config_path,
    });

    prepare_desktop_dispatch_worker_update(&state, false)
        .await
        .expect("prepare non-exiting installer");
    assert!(worker_database_lock_is_held(&database_path).expect("inspect retained worker lock"));
    let admitted_start = lock_for_worker_start(&state)
        .await
        .expect("non-exiting installer keeps worker starts enabled");
    assert!(admitted_start.process.is_some());
    drop(admitted_start);

    let lifecycle_guard = state.lifecycle.lock().await;
    let shutdown_state = Arc::clone(&state);
    let shutdown =
        tokio::spawn(
            async move { prepare_desktop_dispatch_worker_update(&shutdown_state, true).await },
        );
    timeout(Duration::from_secs(1), async {
        while !state.terminal_shutdown_armed.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("terminal shutdown was not armed");
    let late_start_state = Arc::clone(&state);
    let late_start =
        tokio::spawn(async move { lock_for_worker_start(&late_start_state).await.is_some() });
    drop(lifecycle_guard);

    shutdown
        .await
        .expect("join update shutdown")
        .expect("prepare direct-exit installer");
    assert!(!late_start.await.expect("join queued worker start"));
    assert!(!worker_database_lock_is_held(&database_path).expect("inspect released worker lock"));
    assert!(state.lifecycle.lock().await.process.is_none());
    assert!(lock_for_worker_start(&state).await.is_none());

    fs::remove_dir_all(root).expect("remove temporary worker root");
}

#[test]
#[ignore = "subprocess fixture for update_preparation_only_stops_worker_for_direct_exit_installers"]
fn worker_database_lock_holder_fixture() {
    let Some(database_path) = env::var_os(TEST_WORKER_LOCK_PATH_ENV) else {
        return;
    };
    let database_path = std::path::PathBuf::from(database_path);
    let _lock = acquire_worker_database_lock(&database_path).expect("acquire fixture lock");
    thread::sleep(Duration::from_secs(60));
}

#[test]
fn fresh_enrollment_gets_the_longer_startup_watch() {
    assert_eq!(startup_watch_window(true), Duration::from_secs(3));
    assert_eq!(startup_watch_window(false), Duration::from_millis(500));
}

#[test]
fn worker_log_tail_returns_only_the_requested_final_lines() {
    let root = env::temp_dir().join(format!(
        "proliferate-worker-log-tail-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create temporary worker log root");
    let log_path = root.join("worker.log");
    let contents = (1..=20)
        .map(|line| format!("line {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&log_path, contents).expect("write worker log");

    assert_eq!(
        read_worker_log_tail(&log_path, 3),
        "line 18\nline 19\nline 20"
    );
    fs::remove_dir_all(root).expect("remove temporary worker log root");
}

#[test]
fn missing_worker_log_has_no_tail() {
    let missing = env::temp_dir().join(format!(
        "proliferate-worker-missing-log-{}",
        uuid::Uuid::new_v4()
    ));

    assert_eq!(read_worker_log_tail(&missing, 12), "");
}

#[test]
fn worker_log_tail_scrubs_secrets_and_user_paths() {
    let root = env::temp_dir().join(format!(
        "proliferate-worker-scrubbed-log-tail-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create temporary worker log root");
    let log_path = root.join("worker.log");
    let home = crate::app_config::home_dir().expect("resolve user home");
    let private_path = home.join("projects/private-repository");
    fs::write(
        &log_path,
        format!(
            "Authorization: Bearer auth-secret-value\nPROLIFERATE_TOKEN=env-secret-value\nworkspace={}",
            private_path.display()
        ),
    )
    .expect("write worker log");

    let tail = read_worker_log_tail(&log_path, 12);

    assert!(!tail.contains("auth-secret-value"));
    assert!(!tail.contains("env-secret-value"));
    assert!(!tail.contains(&home.to_string_lossy().to_string()));
    assert!(tail.contains("[REDACTED]"));
    assert!(tail.contains("~/projects/private-repository"));
    fs::remove_dir_all(root).expect("remove temporary worker log root");
}

#[test]
fn startup_failure_message_scrubs_the_worker_log_path() {
    let home = crate::app_config::home_dir().expect("resolve user home");
    let log_path = home.join(".proliferate-local/dev/profiles/private/cloud-worker/worker.log");

    let message = worker_startup_failure_message("exit status: 1", &log_path, "safe tail");

    assert!(!message.contains(&home.to_string_lossy().to_string()));
    assert!(message.contains("See ~/"));
    assert!(message.contains("safe tail"));
}

#[test]
fn worker_log_tail_reads_only_the_bounded_suffix() {
    let root = env::temp_dir().join(format!(
        "proliferate-worker-bounded-log-tail-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create temporary worker log root");
    let log_path = root.join("worker.log");
    let old_prefix = "old-prefix-that-must-not-be-read";
    let oversized_middle = "x".repeat(WORKER_LOG_TAIL_MAX_BYTES as usize + 1024);
    fs::write(
        &log_path,
        format!("{old_prefix}\n{oversized_middle}\nrecent line one\nrecent line two\n"),
    )
    .expect("write oversized worker log");

    let tail = read_worker_log_tail(&log_path, 3);

    assert!(!tail.contains(old_prefix));
    assert!(tail.contains("recent line one"));
    assert!(tail.contains("recent line two"));
    fs::remove_dir_all(root).expect("remove temporary worker log root");
}
