mod cli;
mod commands;
mod file_logging;
mod telemetry;

use anyhow::Result;
use clap::Parser;
use sentry_anyhow::capture_anyhow;

#[tokio::main]
async fn main() -> Result<()> {
    let desktop_diagnostics = proliferate_diagnostics_client::take_desktop_activation(
        proliferate_diagnostics_client::DiagnosticsComponent::AnyHarness,
    );
    let args = cli::Cli::parse();
    let telemetry = telemetry::init(&args.command, desktop_diagnostics);

    let result = match args.command {
        cli::Commands::Serve(serve_args) => commands::serve::run(serve_args).await,
        // `install_agents::run` is synchronous and fetches artifacts via
        // `reqwest::blocking`, which drops its own runtime. Under `#[tokio::main]`
        // that must happen off the async runtime or it panics ("cannot drop a
        // runtime in a context where blocking is not allowed").
        cli::Commands::InstallAgents(install_args) => {
            anyharness_lib::domains::agents::installer::off_runtime::run_installer_off_runtime(
                move || commands::install_agents::run(install_args),
            )
            .await
        }
        cli::Commands::PrintOpenapi => commands::print_openapi::run(),
        cli::Commands::CatalogProbe(probe_args) => commands::catalog_probe::run(probe_args).await,
        // Blocking by design: the tail owns the terminal until interrupted,
        // and spawn_blocking keeps the runtime's workers out of it.
        cli::Commands::Logs(logs_args) => {
            tokio::task::spawn_blocking(move || commands::logs::run(logs_args))
                .await
                .unwrap_or_else(|join_error| Err(anyhow::anyhow!(join_error)))
        }
    };

    if let Err(error) = &result {
        capture_anyhow(error);
    }

    telemetry
        .shutdown(std::time::Duration::from_millis(500))
        .await;

    result
}
