mod cloud_client;
mod config;
mod error;
mod identity;
mod integration_gateway;
mod launch_options_sync;
mod lifecycle;
mod logging;
mod observability;
mod process_lock;
mod runtime;
mod store;
mod supervisor_bridge;
#[cfg(test)]
mod test_support;
mod versions;

use std::path::PathBuf;

use clap::Parser;
use sentry_anyhow::capture_anyhow;

#[derive(Debug, Parser)]
#[command(name = "proliferate-worker", version = env!("PROLIFERATE_STAMPED_VERSION"))]
struct Args {
    #[arg(long)]
    config: Option<PathBuf>,
    #[arg(long)]
    once: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let desktop_diagnostics = proliferate_diagnostics_client::take_desktop_activation(
        proliferate_diagnostics_client::DiagnosticsComponent::DesktopWorker,
    );
    let telemetry = logging::init(desktop_diagnostics);
    let result = async {
        let args = Args::parse();
        let config = config::WorkerConfig::load(args.config)?;
        runtime::run(config, args.once).await?;
        Ok(())
    }
    .await;

    if let Err(error) = &result {
        capture_anyhow(error);
    }

    telemetry
        .shutdown(std::time::Duration::from_millis(500))
        .await;

    result
}
