use super::*;

fn hosted_env_lookup(key: &str) -> Option<String> {
    match key {
        "ANYHARNESS_SENTRY_DSN" => Some("https://example.invalid/1".to_string()),
        "ANYHARNESS_SENTRY_ENVIRONMENT" => Some("production".to_string()),
        "ANYHARNESS_SENTRY_RELEASE" => Some("anyharness@1.2.3".to_string()),
        "ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE" => Some("0.5".to_string()),
        _ => None,
    }
}

#[test]
fn sidecar_launch_env_is_empty_outside_hosted_product() {
    assert!(default_anyharness_launch_env_for_mode(
        DesktopTelemetryMode::Disabled,
        hosted_env_lookup
    )
    .is_empty());
    assert!(default_anyharness_launch_env_for_mode(
        DesktopTelemetryMode::LocalDev,
        hosted_env_lookup
    )
    .is_empty());
    assert!(default_anyharness_launch_env_for_mode(
        DesktopTelemetryMode::SelfManaged,
        hosted_env_lookup,
    )
    .is_empty());
}

#[test]
fn sidecar_launch_env_includes_sentry_values_in_hosted_product() {
    let env = default_anyharness_launch_env_for_mode(
        DesktopTelemetryMode::HostedProduct,
        hosted_env_lookup,
    );

    assert_eq!(
        env.get("ANYHARNESS_SENTRY_DSN"),
        Some(&"https://example.invalid/1".to_string())
    );
    assert_eq!(
        env.get("ANYHARNESS_SENTRY_ENVIRONMENT"),
        Some(&"production".to_string())
    );
    assert_eq!(
        env.get("ANYHARNESS_SENTRY_RELEASE"),
        Some(&"anyharness@1.2.3".to_string())
    );
    assert_eq!(
        env.get("ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE"),
        Some(&"0.5".to_string())
    );
}

#[test]
fn sidecar_observer_generation_replacement_makes_old_task_inert() {
    let first = observer::next_generation(0);
    let replacement = observer::next_generation(first);
    assert!(observer::generation_matches(first, first));
    assert!(!observer::generation_matches(first, replacement));
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[test]
fn protected_anyharness_requires_a_canonical_executable_native_image() {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().expect("tempdir");
    let native = directory.path().join("native-anyharness");
    let script = directory.path().join("script-anyharness");
    let cpu = if cfg!(target_arch = "aarch64") {
        0x0100_000c_u32
    } else {
        0x0100_0007_u32
    };
    let mut native_header = vec![0xcf, 0xfa, 0xed, 0xfe];
    native_header.extend_from_slice(&cpu.to_le_bytes());
    std::fs::File::create(&native)
        .expect("native fixture")
        .write_all(&native_header)
        .expect("native header");
    std::fs::write(&script, b"#!/bin/sh\nexit 0\n").expect("script fixture");
    std::fs::set_permissions(&native, std::fs::Permissions::from_mode(0o755))
        .expect("native permissions");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
        .expect("script permissions");

    assert_eq!(
        diagnostics::protected_anyharness_binary(native.to_str().expect("utf8")),
        Some(
            std::fs::canonicalize(&native)
                .expect("canonical native")
                .to_str()
                .expect("utf8 canonical native")
                .to_owned()
        )
    );
    assert!(diagnostics::protected_anyharness_binary(script.to_str().expect("utf8")).is_none());
    assert!(diagnostics::protected_anyharness_binary("anyharness").is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn observer_is_installed_for_a_retained_nonhealthy_child() {
    let sidecar = create_sidecar(8_457);
    let child = Command::new("/bin/sh")
        .args(["-c", "sleep 0.2"])
        .kill_on_drop(true)
        .spawn()
        .expect("spawn retained AnyHarness fixture");
    {
        let mut guard = sidecar.lock().await;
        guard.child = Some(child);
        guard.info.status = RuntimeStatus::Failed;
        guard.suppress_runtime_info_persistence = true;
    }

    observer::start(&sidecar).await;
    let guard = sidecar.lock().await;
    assert!(guard.child.is_some());
    assert!(guard.exit_observer.is_some());
}

#[tokio::test]
async fn terminal_shutdown_arm_rejects_setup_boot_before_spawn() {
    let sidecar = create_sidecar(8_457);
    arm_terminal_shutdown(&sidecar);

    // The rejected boot must never consult the collector supervisor, so a
    // fake launcher-error supervisor is sufficient here.
    let root = std::env::temp_dir().join(format!("sidecar-boot-reject-{}", uuid::Uuid::new_v4()));
    let fallback =
        crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter::open_for_test(
            root.join("desktop-native.log"),
        )
        .expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    let supervisor = DiagnosticsCollectorSupervisor::with_fake_launch_error(
        producer,
        fallback,
        crate::diagnostics_collector::process::CollectorLaunchError::new(
            crate::diagnostics_collector::process::CollectorLaunchErrorKind::UnsupportedTarget,
            "fake unsupported launcher",
        ),
    );

    assert!(matches!(
        lifecycle::boot_inner(&sidecar, &supervisor).await,
        BootOutcome::Rejected
    ));
    assert!(sidecar.lock().await.child.is_none());
    let _ = std::fs::remove_dir_all(&root);
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[tokio::test]
async fn arm_signals_anyharness_while_process_owner_is_held() {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let sidecar = create_sidecar(8_457);
    let mut descriptors = [0_i32; 2];
    assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
    let (reader, writer) = unsafe {
        (
            OwnedFd::from_raw_fd(descriptors[0]),
            OwnedFd::from_raw_fd(descriptors[1]),
        )
    };
    sidecar.set_child_shutdown_signal(Some(
        crate::diagnostics_collector::child_bridge::shutdown_signal::ChildShutdownSignal::for_test(
            writer,
        ),
    ));
    let _owner = sidecar.lock().await;

    let started = std::time::Instant::now();
    arm_terminal_shutdown(&sidecar);
    let mut byte = [0_u8; 1];
    assert_eq!(
        unsafe { libc::read(reader.as_raw_fd(), byte.as_mut_ptr().cast(), 1) },
        1
    );
    assert_eq!(byte, [1]);
    assert!(started.elapsed() < Duration::from_millis(500));
}

#[cfg(unix)]
#[tokio::test]
async fn sole_sidecar_observer_reaps_natural_exit_after_healthy_startup() {
    let sidecar = create_sidecar(8_457);
    let child = Command::new("/bin/sh")
        .args(["-c", "exit 0"])
        .kill_on_drop(true)
        .spawn()
        .expect("spawn natural-exit AnyHarness fixture");
    {
        let mut guard = sidecar.lock().await;
        guard.child = Some(child);
        guard.info.status = RuntimeStatus::Healthy;
        guard.suppress_runtime_info_persistence = true;
    }
    observer::start(&sidecar).await;
    let first_generation = sidecar.lock().await.observer_generation;
    observer::start(&sidecar).await;
    {
        let guard = sidecar.lock().await;
        assert!(guard.observer_generation > first_generation);
        assert!(guard.exit_observer.is_some());
    }

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if sidecar.lock().await.child.is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("natural-exit observer must reconcile AnyHarness");
    let guard = sidecar.lock().await;
    assert!(guard.exit_observer.is_none());
    assert_eq!(guard.info.status, RuntimeStatus::Failed);
}
