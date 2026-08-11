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
        cli::Commands::InstallAgents(install_args) => commands::install_agents::run(install_args),
        cli::Commands::PrintOpenapi => commands::print_openapi::run(),
        cli::Commands::CatalogProbe(probe_args) => commands::catalog_probe::run(probe_args).await,
    };

    if let Err(error) = &result {
        capture_anyhow(error);
    }

    telemetry
        .shutdown(std::time::Duration::from_millis(500))
        .await;

    result
}
