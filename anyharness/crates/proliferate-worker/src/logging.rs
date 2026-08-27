use std::path::PathBuf;
use std::sync::Arc;

use proliferate_diagnostics_client::{
    install_desktop_producer, BundledDesktopDiagnosticsBootstrap, DesktopDiagnosticsActivation,
    DiagnosticsComponent, DiagnosticsProducerGuard, TargetMappingConfig,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};

mod file_sink;
mod format;
mod scrub;

use file_sink::{create_file_log_sink, FileLogSink};
use format::{log_format_from_env, LogFormat};
use scrub::{scrub_breadcrumb, scrub_event, scrub_log};

const TARGET_SENTRY_DSN_ENV: &str = "PROLIFERATE_TARGET_SENTRY_DSN";
const TARGET_SENTRY_ENVIRONMENT_ENV: &str = "PROLIFERATE_TARGET_SENTRY_ENVIRONMENT";
// Component-specific emergency override. The shared
// PROLIFERATE_TARGET_SENTRY_RELEASE was removed because one value could not
// distinguish worker from supervisor events; each binary otherwise stamps its
// own `<component>@<version>+<sha>` from its compile-time build stamp.
const WORKER_SENTRY_RELEASE_ENV: &str = "PROLIFERATE_WORKER_SENTRY_RELEASE";
const TARGET_SENTRY_TRACES_SAMPLE_RATE_ENV: &str = "PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE";
/// The single env-like Sentry tag preserved as bounded deployment identity.
/// Its allowed live value is `e2b`; every other env-like tag stays redacted.
const RUNTIME_ENV_TAG: &str = "runtime_env";
const WORKER_RECORD_NAME_PREFIX: &str = "desktop_worker.";

pub struct TelemetryGuards {
    _sentry: Option<sentry::ClientInitGuard>,
    diagnostics: Option<DiagnosticsProducerGuard>,
    _file_log: Option<FileLogSink>,
}

impl TelemetryGuards {
    pub async fn shutdown(mut self, deadline: std::time::Duration) {
        if let Some(guard) = self.diagnostics.take() {
            let _ = guard.shutdown(deadline).await;
        }
    }
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
        .unwrap_or_else(|_| "proliferate_worker=info,info".into())
}

/// The build SHA stamped by `build.rs`, or `None` for an unstamped dev build.
fn stamped_git_sha() -> Option<&'static str> {
    let sha = env!("PROLIFERATE_STAMPED_GIT_SHA");
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

/// This binary's canonical release ID: `proliferate-worker@<version>+<sha>`.
/// The SHA is omitted only for an unstamped local/dev build.
fn default_release() -> String {
    let version = env!("PROLIFERATE_STAMPED_VERSION");
    match stamped_git_sha() {
        Some(sha) => format!("proliferate-worker@{version}+{sha}"),
        None => format!("proliferate-worker@{version}"),
    }
}

/// Sentry user context for the authenticated owner, when known. The `user_id`
/// scope tag remains only as a temporary adapter fallback during the migration
/// to user context (support-system "Sentry users").
fn sentry_user_from_env() -> Option<sentry::User> {
    sentry_user_from_id(std::env::var("PROLIFERATE_USER_ID").ok().as_deref())
}

/// Pure: build Sentry user context from an optional raw user-id value.
fn sentry_user_from_id(raw: Option<&str>) -> Option<sentry::User> {
    let user_id = raw?.trim();
    if user_id.is_empty() {
        return None;
    }
    Some(sentry::User {
        id: Some(user_id.to_string()),
        ..Default::default()
    })
}

pub fn init(activation: DesktopDiagnosticsActivation) -> TelemetryGuards {
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
                release: Some(env_or_default(WORKER_SENTRY_RELEASE_ENV, &default_release()).into()),
                traces_sample_rate: sample_rate(TARGET_SENTRY_TRACES_SAMPLE_RATE_ENV, 1.0),
                attach_stacktrace: true,
                send_default_pii: false,
                before_send: Some(Arc::new(scrub_event)),
                before_breadcrumb: Some(Arc::new(scrub_breadcrumb)),
                before_send_log: Some(Arc::new(scrub_log)),
                ..Default::default()
            },
        ))
    });

    let installation = match activation {
        DesktopDiagnosticsActivation::Disabled => None,
        DesktopDiagnosticsActivation::Bundled(bootstrap) => {
            install_local(BundledDesktopDiagnosticsBootstrap::Ready(bootstrap))
        }
        DesktopDiagnosticsActivation::BundledDegraded(bootstrap) => {
            install_local(BundledDesktopDiagnosticsBootstrap::Degraded(bootstrap))
        }
        #[cfg(debug_assertions)]
        DesktopDiagnosticsActivation::DevEnv(bootstrap) => {
            install_local(BundledDesktopDiagnosticsBootstrap::DevEnv(bootstrap))
        }
    };
    let (diagnostics_layer, diagnostics) = match installation {
        Some(installation) => {
            let admission = worker_target_mappings();
            (
                Some(
                    installation
                        .layer
                        .with_target_mappings(worker_target_mappings())
                        .with_filter(tracing_subscriber::filter::FilterFn::new(move |metadata| {
                            admission.admits(metadata.target(), metadata.level())
                        })),
                ),
                Some(installation.guard),
            )
        }
        None => (None, None),
    };
    // One format decision per process, applied to every fmt sink: JSON when a
    // machine is the reader (cloud runtime env), human text locally.
    let log_format = log_format_from_env();
    let console_layer: Box<dyn Layer<tracing_subscriber::Registry> + Send + Sync> = match log_format
    {
        LogFormat::Json => tracing_subscriber::fmt::layer()
            .json()
            .with_filter(env_filter_from_env())
            .boxed(),
        LogFormat::Text => tracing_subscriber::fmt::layer()
            .with_filter(env_filter_from_env())
            .boxed(),
    };
    let file_log = match create_file_log_sink(&worker_log_path()) {
        Ok(sink) => Some(sink),
        Err(error) => {
            eprintln!("[proliferate-worker] file logging disabled: {error}");
            None
        }
    };
    let file_layer = file_log.as_ref().map(|sink| {
        let layer: Box<dyn Layer<_> + Send + Sync> = match log_format {
            LogFormat::Json => tracing_subscriber::fmt::layer()
                .json()
                .with_ansi(false)
                .with_writer(sink.writer.clone())
                .with_filter(env_filter_from_env())
                .boxed(),
            LogFormat::Text => tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(sink.writer.clone())
                .with_filter(env_filter_from_env())
                .boxed(),
        };
        layer
    });
    let _ = tracing_subscriber::registry()
        .with(console_layer)
        .with(sentry_tracing::layer())
        .with(diagnostics_layer)
        .with(file_layer)
        .try_init();
    if let Some(sink) = &file_log {
        tracing::debug!(log_file = %sink.path.display(), "local file logging active");
    }

    if telemetry.is_some() {
        sentry::configure_scope(|scope| {
            scope.set_tag("surface", "proliferate_worker");
            scope.set_tag("telemetry_mode", "hosted_product");

            let runtime_env =
                std::env::var("PROLIFERATE_RUNTIME_ENV").unwrap_or_else(|_| "local".to_string());
            scope.set_tag(RUNTIME_ENV_TAG, &runtime_env);

            if let Ok(org_id) = std::env::var("PROLIFERATE_ORG_ID") {
                if !org_id.trim().is_empty() {
                    scope.set_tag("org_id", &org_id);
                }
            }
            if let Ok(sandbox_id) = std::env::var("PROLIFERATE_SANDBOX_ID") {
                if !sandbox_id.trim().is_empty() {
                    scope.set_tag("sandbox_id", &sandbox_id);
                }
            }
            if let Ok(user_id) = std::env::var("PROLIFERATE_USER_ID") {
                if !user_id.trim().is_empty() {
                    scope.set_tag("user_id", &user_id);
                }
            }
            if let Some(user) = sentry_user_from_env() {
                scope.set_user(Some(user));
            }
        });
    }

    TelemetryGuards {
        _sentry: telemetry,
        diagnostics,
        _file_log: file_log,
    }
}

/// The worker's log home: `<home>/.proliferate/worker/logs/worker.log`,
/// beside its config (`default_config_path`). One known place per process
/// so the local tail can interleave every runtime log.
fn worker_log_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".proliferate")
        .join("worker")
        .join("logs")
        .join("worker.log")
}

/// Record naming for this component: no rewritten targets, so every
/// `desktop_worker.` target simply names its own record and everything else
/// stays anonymous.
fn worker_target_mappings() -> TargetMappingConfig {
    TargetMappingConfig::new(Vec::new()).with_passthrough_prefix(WORKER_RECORD_NAME_PREFIX)
}

fn install_local(
    activation: BundledDesktopDiagnosticsBootstrap,
) -> Option<proliferate_diagnostics_client::DiagnosticsInstallation> {
    let environment = std::env::var("PROLIFERATE_RUNTIME_ENV")
        .ok()
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .unwrap_or_else(|| "local".to_owned());
    match install_desktop_producer(
        DiagnosticsComponent::DesktopWorker,
        activation,
        &default_release(),
        &environment,
    ) {
        Ok(installation) => Some(installation),
        Err(_) => {
            eprintln!("[desktop-diagnostics] worker adapter unavailable");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use proliferate_diagnostics_client::ResolvedRecordName;

    use super::{default_release, sentry_user_from_id, stamped_git_sha, worker_target_mappings};

    #[test]
    fn worker_targets_resolve_to_record_names_by_pass_through() {
        let mappings = worker_target_mappings();
        let cases: [(&str, ResolvedRecordName<'_>); 5] = [
            (
                "desktop_worker.runtime.boot",
                ResolvedRecordName::PassThrough("desktop_worker.runtime.boot"),
            ),
            (
                "desktop_worker.anyharness_update.rollback",
                ResolvedRecordName::PassThrough("desktop_worker.anyharness_update.rollback"),
            ),
            ("proliferate_worker::runtime", ResolvedRecordName::Anonymous),
            ("anyharness.turn.finished", ResolvedRecordName::Anonymous),
            ("desktop_worker.", ResolvedRecordName::Anonymous),
        ];

        for (target, expected) in cases {
            assert_eq!(
                mappings.resolve(target),
                expected,
                "unexpected record identity for target {target}"
            );
        }
    }

    #[test]
    fn default_release_is_canonical_for_this_component() {
        let release = default_release();
        assert!(
            release.starts_with("proliferate-worker@"),
            "release must name this component: {release}"
        );
        let expected = match stamped_git_sha() {
            Some(sha) => {
                assert_eq!(sha.len(), 12, "stamped sha is exactly 12 chars");
                format!(
                    "proliferate-worker@{}+{sha}",
                    env!("PROLIFERATE_STAMPED_VERSION")
                )
            }
            None => format!("proliferate-worker@{}", env!("PROLIFERATE_STAMPED_VERSION")),
        };
        assert_eq!(release, expected);
    }

    #[test]
    fn sentry_user_context_is_id_only_and_trimmed() {
        let user = sentry_user_from_id(Some("  user-123  ")).expect("user present");
        assert_eq!(user.id.as_deref(), Some("user-123"));
        assert!(user.email.is_none());
        assert!(user.username.is_none());
    }

    #[test]
    fn sentry_user_absent_for_blank_or_missing() {
        assert!(sentry_user_from_id(None).is_none());
        assert!(sentry_user_from_id(Some("   ")).is_none());
    }

    #[test]
    fn json_mode_emits_one_parseable_json_line_per_event() {
        // Cloud mode's contract with CloudWatch/Grafana (grafana-logging
        // spec): one event = one JSON line, fields addressable by name. A
        // machine reader must never have to parse human text.
        use std::io::Write;
        use std::sync::{Arc, Mutex};
        use tracing_subscriber::layer::SubscriberExt;

        #[derive(Clone)]
        struct SharedBuf(Arc<Mutex<Vec<u8>>>);
        impl Write for SharedBuf {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.lock().expect("buffer lock").extend_from_slice(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let buffer = SharedBuf(Arc::new(Mutex::new(Vec::new())));
        let writer = buffer.clone();
        let subscriber = tracing_subscriber::registry().with(
            tracing_subscriber::fmt::layer()
                .json()
                .with_ansi(false)
                .with_writer(move || writer.clone()),
        );
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(
                session_id = "0191d1f0-0000-7000-8000-000000000000",
                outcome = "succeeded",
                "json mode probe"
            );
        });

        let bytes = buffer.0.lock().expect("buffer lock").clone();
        let text = String::from_utf8(bytes).expect("utf8 log output");
        let line = text.lines().next().expect("one log line emitted");
        let value: serde_json::Value = serde_json::from_str(line).expect("log line parses as JSON");
        let fields = &value["fields"];
        assert_eq!(fields["message"], "json mode probe");
        assert_eq!(fields["session_id"], "0191d1f0-0000-7000-8000-000000000000");
        assert_eq!(fields["outcome"], "succeeded");
        assert!(value["timestamp"].is_string(), "timestamp present");
        assert_eq!(value["level"], "INFO");
    }

    #[test]
    fn tracing_error_reaches_the_sentry_client() {
        // Regression (B2 amendment): a `sentry` / `sentry-tracing` version split
        // links two `sentry-core` instances, so the tracing layer captures into
        // a clientless Hub and every ERROR event is silently dropped (observed
        // live in production from 2026-06-14). Fails with 0 events on any
        // future divergence.
        use tracing_subscriber::layer::SubscriberExt;
        let subscriber = tracing_subscriber::registry().with(sentry_tracing::layer());
        let events = sentry::test::with_captured_events(|| {
            tracing::subscriber::with_default(subscriber, || {
                tracing::error!("sentry emission regression probe");
            });
        });
        assert_eq!(
            events.len(),
            1,
            "tracing ERROR must reach the Sentry client"
        );
    }
}
