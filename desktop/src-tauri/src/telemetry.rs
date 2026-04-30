use std::path::PathBuf;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};

use crate::{
    app_config::logs_dir_path,
    desktop_telemetry_mode::{resolve_desktop_telemetry_mode, DesktopTelemetryMode},
    telemetry_file_logging::create_file_log_sink,
};

pub struct TelemetryGuards {
    _sentry: Option<sentry::ClientInitGuard>,
    _file_log: Option<tracing_appender::non_blocking::WorkerGuard>,
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

fn desktop_native_log_path() -> Result<PathBuf, String> {
    Ok(logs_dir_path()?.join("desktop-native.log"))
}

pub fn init() -> TelemetryGuards {
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

    let file_sink =
        desktop_native_log_path()
            .ok()
            .and_then(|path| match create_file_log_sink(&path) {
                Ok(sink) => Some(sink),
                Err(error) => {
                    eprintln!(
                        "[desktop-native] file logging disabled for {}: {error}",
                        path.display()
                    );
                    None
                }
            });

    let console_layer = tracing_subscriber::fmt::layer().with_filter(env_filter_from_env());

    tracing_subscriber::registry()
        .with(console_layer)
        .with(sentry_tracing::layer())
        .with(file_sink.as_ref().map(|sink| {
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(sink.writer.clone())
                .with_filter(env_filter_from_env())
        }))
        .init();

    if telemetry.is_some() {
        sentry::configure_scope(|scope| {
            scope.set_tag("surface", "desktop_native");
            if let Some(mode_tag) = telemetry_mode_tag(telemetry_mode) {
                scope.set_tag("telemetry_mode", mode_tag);
            }
        });
    }

    if let Some(sink) = file_sink.as_ref() {
        tracing::info!(log_path = %sink.path.display(), "Desktop native file logging enabled");
    }

    TelemetryGuards {
        _sentry: telemetry,
        _file_log: file_sink.map(|sink| sink.guard),
    }
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
