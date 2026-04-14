use std::path::PathBuf;

use anyharness_lib::app::default_runtime_home;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};

use crate::{
    cli::Commands,
    commands::{install_agents::InstallAgentsArgs, serve::ServeArgs},
    file_logging::create_file_log_sink,
};

const ANYHARNESS_TELEMETRY_MODE: &str = "hosted_product";

pub struct TelemetryGuards {
    _sentry: Option<sentry::ClientInitGuard>,
    _file_log: Option<tracing_appender::non_blocking::WorkerGuard>,
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
    tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())
}

fn runtime_home_from_serve(args: &ServeArgs) -> PathBuf {
    args.runtime_home
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_runtime_home)
}

fn runtime_home_from_install(args: &InstallAgentsArgs) -> PathBuf {
    args.runtime_home
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_runtime_home)
}

fn log_path_for_command(command: &Commands) -> Option<PathBuf> {
    match command {
        Commands::Serve(args) => Some(runtime_home_from_serve(args).join("logs/anyharness.log")),
        Commands::InstallAgents(args) => {
            Some(runtime_home_from_install(args).join("logs/anyharness.log"))
        }
        Commands::PrintOpenapi => None,
    }
}

pub fn init(command: &Commands) -> TelemetryGuards {
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

    let file_sink = log_path_for_command(command).and_then(|path| {
        match create_file_log_sink(&path) {
            Ok(sink) => Some(sink),
            Err(error) => {
                eprintln!(
                    "[anyharness] file logging disabled for {}: {error}",
                    path.display()
                );
                None
            }
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
            for (key, value) in sentry_scope_tags() {
                scope.set_tag(key, value);
            }
        });
    }

    if let Some(sink) = file_sink.as_ref() {
        tracing::info!(log_path = %sink.path.display(), "AnyHarness file logging enabled");
    }

    TelemetryGuards {
        _sentry: telemetry,
        _file_log: file_sink.map(|sink| sink.guard),
    }
}

fn sentry_scope_tags() -> [(&'static str, &'static str); 2] {
    [
        ("surface", "anyharness_runtime"),
        ("telemetry_mode", ANYHARNESS_TELEMETRY_MODE),
    ]
}

#[cfg(test)]
mod tests {
    use super::{
        log_path_for_command,
        runtime_home_from_install,
        runtime_home_from_serve,
        sentry_scope_tags,
    };
    use crate::{
        cli::Commands,
        commands::{install_agents::InstallAgentsArgs, serve::ServeArgs},
    };

    #[test]
    fn sentry_scope_tags_include_runtime_surface_and_mode() {
        assert_eq!(
            sentry_scope_tags(),
            [
                ("surface", "anyharness_runtime"),
                ("telemetry_mode", "hosted_product"),
            ]
        );
    }

    #[test]
    fn serve_runtime_home_uses_override_when_present() {
        let args = ServeArgs {
            host: "127.0.0.1".to_string(),
            port: 8457,
            runtime_home: Some("/tmp/anyharness-test".to_string()),
            require_bearer_auth: false,
            disable_cors: false,
        };

        assert_eq!(
            runtime_home_from_serve(&args).to_string_lossy(),
            "/tmp/anyharness-test"
        );
    }

    #[test]
    fn install_runtime_home_uses_override_when_present() {
        let args = InstallAgentsArgs {
            runtime_home: Some("/tmp/anyharness-install".to_string()),
            reinstall: false,
            agents: Vec::new(),
        };

        assert_eq!(
            runtime_home_from_install(&args).to_string_lossy(),
            "/tmp/anyharness-install"
        );
    }

    #[test]
    fn print_openapi_has_no_file_log_path() {
        assert!(log_path_for_command(&Commands::PrintOpenapi).is_none());
    }

    #[test]
    fn serve_command_log_path_lands_under_runtime_home_logs() {
        let path = log_path_for_command(&Commands::Serve(ServeArgs {
            host: "127.0.0.1".to_string(),
            port: 8457,
            runtime_home: Some("/tmp/anyharness-serve".to_string()),
            require_bearer_auth: false,
            disable_cors: false,
        }))
        .expect("serve should use file logging");

        assert_eq!(
            path.to_string_lossy(),
            "/tmp/anyharness-serve/logs/anyharness.log"
        );
    }

    #[test]
    fn install_command_log_path_lands_under_runtime_home_logs() {
        let path = log_path_for_command(&Commands::InstallAgents(InstallAgentsArgs {
            runtime_home: Some("/tmp/anyharness-install".to_string()),
            reinstall: false,
            agents: Vec::new(),
        }))
        .expect("install should use file logging");

        assert_eq!(
            path.to_string_lossy(),
            "/tmp/anyharness-install/logs/anyharness.log"
        );
    }
}
