use std::sync::Arc;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};

use crate::{
    desktop_telemetry_mode::{resolve_desktop_telemetry_mode, DesktopTelemetryMode},
    diagnostics_collector::producer::TauriDiagnosticsProducer,
};

mod scrub;

use scrub::{scrub_breadcrumb, scrub_event, scrub_log};

/// The single env-like Sentry tag preserved as bounded deployment identity.
pub(crate) const RUNTIME_ENV_TAG: &str = "runtime_env";

pub struct TelemetryGuards {
    _sentry: Option<sentry::ClientInitGuard>,
}

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

fn env_filter_from_env() -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())
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

pub fn init(native_diagnostics: &TauriDiagnosticsProducer) -> TelemetryGuards {
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
                    env_or_default("PROLIFERATE_DESKTOP_SENTRY_ENVIRONMENT", "production").into(),
                ),
                release: Some(
                    env_or_default(
                        "PROLIFERATE_DESKTOP_SENTRY_RELEASE",
                        &format!("proliferate-desktop-native@{}", env!("CARGO_PKG_VERSION")),
                    )
                    .into(),
                ),
                traces_sample_rate: sample_rate(
                    "PROLIFERATE_DESKTOP_SENTRY_TRACES_SAMPLE_RATE",
                    1.0,
                ),
                attach_stacktrace: true,
                send_default_pii: false,
                before_send: Some(Arc::new(scrub_event)),
                before_breadcrumb: Some(Arc::new(scrub_breadcrumb)),
                before_send_log: Some(Arc::new(scrub_log)),
                ..Default::default()
            },
        ))
    });

    let console_layer = tracing_subscriber::fmt::layer().with_filter(env_filter_from_env());
    let native_writer = native_diagnostics.make_writer();

    tracing_subscriber::registry()
        .with(console_layer)
        .with(sentry_tracing::layer())
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(native_writer)
                .with_filter(env_filter_from_env()),
        )
        .init();

    if telemetry.is_some() {
        sentry::configure_scope(|scope| {
            scope.set_tag("surface", "desktop_native");
            scope.set_tag(RUNTIME_ENV_TAG, "local");
            if let Some(mode_tag) = telemetry_mode_tag(telemetry_mode) {
                scope.set_tag("telemetry_mode", mode_tag);
            }
        });
    }

    TelemetryGuards { _sentry: telemetry }
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
