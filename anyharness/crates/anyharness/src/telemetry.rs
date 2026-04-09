use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn sample_rate(key: &str, default: f32) -> f32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(default)
}

pub fn init() -> Option<sentry::ClientInitGuard> {
    let env_filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    let dsn = std::env::var("ANYHARNESS_SENTRY_DSN")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let telemetry = dsn.map(|dsn| {
        sentry::init((
            dsn,
            sentry::ClientOptions {
                environment: Some(
                    env_or_default("ANYHARNESS_SENTRY_ENVIRONMENT", "trusted-beta").into(),
                ),
                release: Some(
                    env_or_default("ANYHARNESS_SENTRY_RELEASE", "anyharness@0.1.0").into(),
                ),
                traces_sample_rate: sample_rate("ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE", 1.0),
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
            scope.set_tag("surface", "anyharness_runtime");
        });
    }

    telemetry
}
