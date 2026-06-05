mod anyharness_client;
mod cloud_client;
mod config;
mod control;
mod error;
mod identity;
mod inventory;
mod lifecycle;
mod logging;
mod materialization;
mod observability;
mod process_lock;
mod runtime;
mod store;
mod tail;
mod versions;

use std::path::PathBuf;

use clap::Parser;
use sentry_anyhow::capture_anyhow;

#[derive(Debug, Parser)]
#[command(name = "proliferate-worker", version)]
struct Args {
    #[arg(long)]
    config: Option<PathBuf>,
    #[arg(long)]
    once: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _telemetry = logging::init();
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

    result
}
