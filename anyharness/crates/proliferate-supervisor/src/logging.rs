use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};

const TARGET_SENTRY_DSN_ENV: &str = "PROLIFERATE_TARGET_SENTRY_DSN";
const TARGET_SENTRY_ENVIRONMENT_ENV: &str = "PROLIFERATE_TARGET_SENTRY_ENVIRONMENT";
const TARGET_SENTRY_RELEASE_ENV: &str = "PROLIFERATE_TARGET_SENTRY_RELEASE";
const TARGET_SENTRY_TRACES_SAMPLE_RATE_ENV: &str = "PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE";

pub struct TelemetryGuards {
    _sentry: Option<sentry::ClientInitGuard>,
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn sample_rate(key: &str, default: f32) -> f32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(default)
}

fn env_filter_from_env() -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "proliferate_supervisor=info,info".into())
}

fn default_release() -> String {
    format!("proliferate-supervisor@{}", env!("CARGO_PKG_VERSION"))
}

pub fn init() -> TelemetryGuards {
    let dsn = std::env::var(TARGET_SENTRY_DSN_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty());
    let telemetry = dsn.map(|dsn| {
        sentry::init((
            dsn,
            sentry::ClientOptions {
                environment: Some(
                    env_or_default(TARGET_SENTRY_ENVIRONMENT_ENV, "trusted-beta").into(),
                ),
                release: Some(env_or_default(TARGET_SENTRY_RELEASE_ENV, &default_release()).into()),
                traces_sample_rate: sample_rate(TARGET_SENTRY_TRACES_SAMPLE_RATE_ENV, 1.0),
                attach_stacktrace: true,
                ..Default::default()
            },
        ))
    });

    let console_layer = tracing_subscriber::fmt::layer().with_filter(env_filter_from_env());
    let _ = tracing_subscriber::registry()
        .with(console_layer)
        .with(sentry_tracing::layer())
        .try_init();

    if telemetry.is_some() {
        sentry::configure_scope(|scope| {
            scope.set_tag("surface", "proliferate_supervisor");
            scope.set_tag("telemetry_mode", "hosted_product");
        });
    }

    TelemetryGuards { _sentry: telemetry }
}
