mod cli;
mod commands;
mod telemetry;

use anyhow::Result;
use clap::Parser;
use sentry_anyhow::capture_anyhow;

#[tokio::main]
async fn main() -> Result<()> {
    let _telemetry = telemetry::init();

    let args = cli::Cli::parse();

    let result = match args.command {
        cli::Commands::Serve(serve_args) => commands::serve::run(serve_args).await,
        cli::Commands::InstallAgents(install_args) => commands::install_agents::run(install_args),
        cli::Commands::PrintOpenapi => commands::print_openapi::run(),
    };

    if let Err(error) = &result {
        capture_anyhow(error);
    }

    result
}
