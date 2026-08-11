use super::*;

fn built_collector_binary() -> PathBuf {
    std::env::current_exe()
        .expect("current test executable")
        .parent()
        .and_then(Path::parent)
        .expect("target profile directory")
        .join(if cfg!(windows) {
            "proliferate-diagnostics-collector.exe"
        } else {
            "proliferate-diagnostics-collector"
        })
}

#[test]
fn capability_is_url_safe_unpadded_and_not_debuggable() {
    let capability = generate_capability().expect("capability");
    assert_eq!(capability.as_bytes().len(), 43);
    assert!(capability
        .as_bytes()
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')));
    let rendered = format!("{capability:?}");
    assert!(!rendered
        .as_bytes()
        .windows(capability.as_bytes().len())
        .any(|window| { window == capability.as_bytes() }));
}

#[test]
fn parent_descriptors_remain_cloexec() {
    let (parent, child) = protected_pair().expect("protected pair");
    for fd in [parent.as_raw_fd(), child.as_raw_fd()] {
        // SAFETY: both descriptors are owned and live in this test.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        assert_ne!(flags & libc::FD_CLOEXEC, 0);
    }
}

#[test]
fn placeholder_is_binary_invalid_on_a_supported_target() {
    let root = std::env::temp_dir().join(format!("collector-placeholder-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("temp root");
    let binary = root.join("collector");
    std::fs::write(&binary, b"#!/bin/sh\ndiagnostics collector placeholder\n")
        .expect("placeholder");
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).expect("mode");
    assert_eq!(
        validate_binary(&binary)
            .expect_err("placeholder rejected")
            .kind,
        CollectorLaunchErrorKind::BinaryInvalid
    );
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn control_channel_accepts_only_the_closed_typed_shutdown_command() {
    let command = typed_shutdown_command().expect("typed command");
    assert_eq!(command, br#"{"command":"shutdown"}"#);
    assert!(command.len() + 1 <= MAX_CONTROL_COMMAND_BYTES);
}

#[tokio::test]
async fn accepted_collector_binary_round_trips_protected_launch_health_and_shutdown() {
    let root = std::env::temp_dir().join(format!("collector-real-launch-{}", uuid::Uuid::new_v4()));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let launcher = CollectorProcessLauncher {
        binary: built_collector_binary(),
        release: "desktop-test".to_string(),
        environment: "test".to_string(),
        fallback: fallback.clone(),
    };
    assert!(launcher.binary.is_file(), "collector binary must be built");

    let mut first = launcher.launch().await.expect("first protected launch");
    let first_boot = first.descriptor().collector_boot_id.clone();
    let first_capability = first.capability_bytes().to_vec();
    let health = first.client().health().await.expect("authenticated health");
    assert_eq!(health.collector_boot_id, first_boot);
    assert_eq!(health.status, HealthStatusV1::Ready);
    assert_eq!(
        first.orderly_shutdown().await.expect("first shutdown"),
        CollectorShutdownOutcome::Graceful
    );

    let mut second = launcher.launch().await.expect("second protected launch");
    assert_ne!(second.descriptor().collector_boot_id, first_boot);
    assert!(
        second.capability_bytes() != first_capability.as_slice(),
        "collector restart must rotate its private capability"
    );
    assert_eq!(
        second.orderly_shutdown().await.expect("second shutdown"),
        CollectorShutdownOutcome::Graceful
    );

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[tokio::test]
async fn rv_2_05_child_exit_during_launch_is_never_graceful_shutdown() {
    let mut command = Command::new("/usr/bin/false");
    command.kill_on_drop(true);
    let child = command.spawn().expect("spawn exit fixture");
    tokio::time::sleep(Duration::from_millis(50)).await;
    let error = failed_launch(
        child,
        None,
        CollectorLaunchErrorKind::EndpointUnavailable,
        "malformed trusted control fixture",
    )
    .await;
    assert_eq!(error.kind, CollectorLaunchErrorKind::ChildExited);
}

#[tokio::test]
async fn control_write_failure_uses_owned_handle_and_never_claims_graceful_shutdown() {
    let root = std::env::temp_dir().join(format!(
        "collector-control-failure-{}",
        uuid::Uuid::new_v4()
    ));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let launcher = CollectorProcessLauncher::for_test(
        built_collector_binary(),
        "desktop-test".to_string(),
        "test".to_string(),
        fallback.clone(),
    );
    let mut process = launcher.launch().await.expect("protected launch");
    process.control.take();

    assert_eq!(
        process.orderly_shutdown().await.expect("owned reap"),
        CollectorShutdownOutcome::ControlWriteFailed
    );
    assert!(process.child.is_none(), "owned child must be reaped");

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}
