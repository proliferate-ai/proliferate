mod anyharness_client;
mod cloud_client;
mod commands;
mod config;
mod error;
mod identity;
mod inventory;
mod logging;
mod materialization;
mod observability;
mod runtime;
mod store;
mod sync;
mod updates;
mod versions;

use std::path::PathBuf;

use clap::Parser;

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
    logging::init();
    let args = Args::parse();
    let config = config::WorkerConfig::load(args.config)?;
    runtime::run(config, args.once).await?;
    Ok(())
}
