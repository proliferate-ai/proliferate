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

#[tokio::test]
async fn terminal_shutdown_arm_rejects_setup_boot_before_spawn() {
    let sidecar = create_sidecar(8_457);
    arm_terminal_shutdown(&sidecar).await;

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
