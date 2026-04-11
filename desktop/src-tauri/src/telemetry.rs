use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::desktop_telemetry_mode::{resolve_desktop_telemetry_mode, DesktopTelemetryMode};

fn baked_env(key: &str) -> Option<&'static str> {
    match key {
        "PROLIFERATE_DESKTOP_SENTRY_DSN" => option_env!("PROLIFERATE_DESKTOP_SENTRY_DSN"),
        "PROLIFERATE_DESKTOP_SENTRY_ENVIRONMENT" => {
            option_env!("PROLIFERATE_DESKTOP_SENTRY_ENVIRONMENT")
        }
        "PROLIFERATE_DESKTOP_SENTRY_RELEASE" => {
            option_env!("PROLIFERATE_DESKTOP_SENTRY_RELEASE")
        }
        "PROLIFERATE_DESKTOP_SENTRY_TRACES_SAMPLE_RATE" => {
            option_env!("PROLIFERATE_DESKTOP_SENTRY_TRACES_SAMPLE_RATE")
        }
        _ => None,
    }
}

fn env_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .or_else(|| baked_env(key).map(str::to_string))
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
}

fn env_or_default(key: &str, default: &str) -> String {
    env_value(key).unwrap_or_else(|| default.to_string())
}

fn sample_rate(key: &str, default: f32) -> f32 {
    env_value(key)
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(default)
}

fn vendor_sentry_enabled(mode: DesktopTelemetryMode) -> bool {
    mode == DesktopTelemetryMode::HostedProduct
}

fn telemetry_mode_tag(mode: DesktopTelemetryMode) -> Option<&'static str> {
    match mode {
        DesktopTelemetryMode::Disabled => None,
        DesktopTelemetryMode::LocalDev => Some("local_dev"),
        DesktopTelemetryMode::SelfManaged => Some("self_managed"),
        DesktopTelemetryMode::HostedProduct => Some("hosted_product"),
    }
}

pub fn init() -> Option<sentry::ClientInitGuard> {
    let env_filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    let telemetry_mode = resolve_desktop_telemetry_mode();
    let dsn = if vendor_sentry_enabled(telemetry_mode) {
        env_value("PROLIFERATE_DESKTOP_SENTRY_DSN")
    } else {
        None
    };
    let telemetry = dsn.map(|dsn| {
        sentry::init((
            dsn,
            sentry::ClientOptions {
                environment: Some(
                    env_or_default("PROLIFERATE_DESKTOP_SENTRY_ENVIRONMENT", "trusted-beta").into(),
                ),
                release: Some(
                    env_or_default(
                        "PROLIFERATE_DESKTOP_SENTRY_RELEASE",
                        "proliferate-desktop-native@0.1.0",
                    )
                    .into(),
                ),
                traces_sample_rate: sample_rate(
                    "PROLIFERATE_DESKTOP_SENTRY_TRACES_SAMPLE_RATE",
                    1.0,
                ),
                attach_stacktrace: true,
                ..Default::default()
            },
        ))
    });

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .with(sentry_tracing::layer())
        .init();

    if telemetry.is_some() {
        sentry::configure_scope(|scope| {
            scope.set_tag("surface", "desktop_native");
            if let Some(mode_tag) = telemetry_mode_tag(telemetry_mode) {
                scope.set_tag("telemetry_mode", mode_tag);
            }
        });
    }

    telemetry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendor_sentry_is_hosted_product_only() {
        assert!(!vendor_sentry_enabled(DesktopTelemetryMode::Disabled));
        assert!(!vendor_sentry_enabled(DesktopTelemetryMode::LocalDev));
        assert!(!vendor_sentry_enabled(DesktopTelemetryMode::SelfManaged));
        assert!(vendor_sentry_enabled(DesktopTelemetryMode::HostedProduct));
    }

    #[test]
    fn telemetry_mode_tag_matches_runtime_mode() {
        assert_eq!(telemetry_mode_tag(DesktopTelemetryMode::Disabled), None);
        assert_eq!(
            telemetry_mode_tag(DesktopTelemetryMode::LocalDev),
            Some("local_dev")
        );
        assert_eq!(
            telemetry_mode_tag(DesktopTelemetryMode::SelfManaged),
            Some("self_managed")
        );
        assert_eq!(
            telemetry_mode_tag(DesktopTelemetryMode::HostedProduct),
            Some("hosted_product")
        );
    }
}
