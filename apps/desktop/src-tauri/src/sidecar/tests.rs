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

#[tokio::test]
async fn terminal_shutdown_arm_rejects_setup_boot_before_spawn() {
    let sidecar = create_sidecar(8_457);
    arm_terminal_shutdown(&sidecar).await;

    assert!(matches!(
        lifecycle::boot_inner(&sidecar).await,
        BootOutcome::Rejected
    ));
    assert!(sidecar.lock().await.child.is_none());
}
