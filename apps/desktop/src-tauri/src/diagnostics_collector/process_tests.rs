use super::*;
use crate::diagnostics_collector::test_binary::built_collector_binary;

const CLOEXEC_CHILD_ENV: &str = "PROLIFERATE_PR3_CLOEXEC_FDS";
const CLOEXEC_CHILD_FIXTURE: &str = "diagnostics_collector::process::tests::cloexec_child_fixture";

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
#[ignore]
fn cloexec_child_fixture() {
    for descriptor in std::env::var(CLOEXEC_CHILD_ENV)
        .expect("descriptor inventory")
        .split(',')
        .map(|value| value.parse::<i32>().expect("descriptor number"))
    {
        // SAFETY: F_GETFD only inspects the numeric descriptor.
        assert_eq!(unsafe { libc::fcntl(descriptor, libc::F_GETFD) }, -1);
    }
}

#[tokio::test]
async fn concurrent_exec_never_inherits_parent_protected_descriptors() {
    let pairs = (0..8)
        .map(|_| protected_pair().expect("protected pair"))
        .collect::<Vec<_>>();
    let descriptors = pairs
        .iter()
        .flat_map(|(parent, child)| [parent.as_raw_fd(), child.as_raw_fd()])
        .map(|descriptor| descriptor.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let mut children = Vec::new();
    for _ in 0..8 {
        children.push(
            Command::new(std::env::current_exe().expect("test executable"))
                .arg("--exact")
                .arg(CLOEXEC_CHILD_FIXTURE)
                .arg("--ignored")
                .env(CLOEXEC_CHILD_ENV, &descriptors)
                .spawn()
                .expect("spawn CLOEXEC fixture"),
        );
    }
    for mut child in children {
        assert!(child.wait().await.expect("wait CLOEXEC fixture").success());
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
        install_id: None,
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

#[tokio::test]
async fn rv_2_05_malformed_control_causes_child_exit_not_graceful_shutdown() {
    let root = std::env::temp_dir().join(format!(
        "collector-malformed-control-{}",
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
    process
        .control
        .as_mut()
        .expect("control channel")
        .write_all(b"{\"command\":\"not_allowed\"}\n")
        .await
        .expect("malformed trusted control fixture");

    let status = tokio::time::timeout(Duration::from_secs(2), process.wait())
        .await
        .expect("malformed control exit deadline")
        .expect("observe malformed control exit");
    assert!(!status.success());
    assert!(!process.orderly_shutdown_requested);

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[tokio::test]
async fn rv_2_05_oversized_control_causes_child_exit_not_graceful_shutdown() {
    let root = std::env::temp_dir().join(format!(
        "collector-oversized-control-{}",
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
    let mut command = vec![b'x'; MAX_CONTROL_COMMAND_BYTES + 1];
    command.push(b'\n');
    process
        .control
        .as_mut()
        .expect("control channel")
        .write_all(&command)
        .await
        .expect("oversized trusted control fixture");

    let status = tokio::time::timeout(Duration::from_secs(2), process.wait())
        .await
        .expect("oversized control exit deadline")
        .expect("observe oversized control exit");
    assert!(!status.success());
    assert!(!process.orderly_shutdown_requested);

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

fn install_id_launcher(
    install_id: Option<&str>,
    fallback: &FallbackDiagnosticsWriter,
) -> CollectorProcessLauncher {
    CollectorProcessLauncher {
        binary: built_collector_binary(),
        release: "desktop-test".to_string(),
        environment: "test".to_string(),
        install_id: install_id.map(str::to_owned),
        fallback: fallback.clone(),
    }
}

/// The install id crosses the process seam as an argument, the same way
/// `--release` and `--environment` do, and the real collector binary accepts
/// it. This is the desktop half of the `proliferate.install_id` resource
/// attribute; the collector half is proven in `otlp_dogfood.rs`.
#[tokio::test]
async fn an_install_id_crosses_the_process_seam_to_the_real_collector() {
    let root = std::env::temp_dir().join(format!("collector-install-id-{}", uuid::Uuid::new_v4()));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let launcher = install_id_launcher(Some("install-desktop-test-4b71"), &fallback);

    let mut process = launcher.launch().await.expect("launch with an install id");
    let health = process.client().health().await.expect("authenticated health");
    assert_eq!(health.status, HealthStatusV1::Ready);
    assert_eq!(
        process.orderly_shutdown().await.expect("shutdown"),
        CollectorShutdownOutcome::Graceful
    );

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

/// The signed-in user's id crosses the same seam as the install id, read at
/// launch time from the host's identity cell, and the real collector accepts
/// it. The collector half (the resource attribute) is proven in `otlp_tests`.
#[tokio::test]
async fn a_user_id_crosses_the_process_seam_to_the_real_collector() {
    let _identity_guard = crate::diagnostics_collector::identity::test_identity_lock();
    let root = std::env::temp_dir().join(format!("collector-user-id-{}", uuid::Uuid::new_v4()));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    crate::diagnostics_collector::identity::set_current_user_id(Some(
        "user-desktop-test-77a1".to_owned(),
    ));
    let launcher = install_id_launcher(Some("install-desktop-test-4b71"), &fallback);

    let mut process = launcher.launch().await.expect("launch with a user id");
    let health = process.client().health().await.expect("authenticated health");
    assert_eq!(health.status, HealthStatusV1::Ready);
    assert_eq!(
        process.orderly_shutdown().await.expect("shutdown"),
        CollectorShutdownOutcome::Graceful
    );
    crate::diagnostics_collector::identity::set_current_user_id(None);

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn install_id_filter_accepts_exactly_the_collectors_domain() {
    assert!(retain_valid_install_id(None).is_none());

    for (install_id, accepted) in install_id_domain_cases() {
        let retained = retain_valid_install_id(Some(install_id.clone()));
        assert_eq!(
            retained.as_deref(),
            accepted.then_some(install_id.as_str()),
            "unexpected filter result for install id {install_id:?}"
        );
    }
}

/// On the supported target, the real-binary discovery path delegates persisted
/// install IDs to the platform-neutral filter before constructing the launcher.
#[cfg(target_os = "macos")]
#[test]
fn discover_drops_an_unusable_persisted_install_id() {
    let root = std::env::temp_dir().join(format!("collector-bad-install-{}", uuid::Uuid::new_v4()));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let launcher = CollectorProcessLauncher::discover_with_binary(
        built_collector_binary(),
        "desktop-test".to_owned(),
        "test".to_owned(),
        Some("has space".to_owned()),
        fallback.clone(),
    )
    .expect("discover real collector");
    assert!(launcher.install_id.is_none());

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

fn install_id_domain_cases() -> [(String, bool); 7] {
    [
        ("install-desktop-test-4b71".to_owned(), true),
        ("x".repeat(128), true),
        (String::new(), false),
        ("x".repeat(129), false),
        ("has space".to_owned(), false),
        ("has\nnewline".to_owned(), false),
        ("non-ascii-é".to_owned(), false),
    ]
}
