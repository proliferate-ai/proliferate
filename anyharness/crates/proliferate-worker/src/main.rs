pub mod anyharness_client;
pub mod cloud_client;
pub mod commands;
pub mod config;
pub mod error;
pub mod identity;
pub mod inventory;
pub mod lifecycle;
pub mod logging;
pub mod runtime;
pub mod store;
pub mod sync;
pub mod updates;

use std::path::PathBuf;

use clap::Parser;

use crate::config::WorkerConfig;
use crate::error::Result;

#[derive(Debug, Parser)]
#[command(name = "proliferate-worker")]
#[command(about = "Target-side worker for Proliferate Cloud sync")]
#[command(version)]
struct Cli {
    /// Optional worker config file. Env vars still take precedence.
    #[arg(long)]
    config: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let config = WorkerConfig::load(cli.config.as_deref())?;
    logging::init(&config.logging)?;
    runtime::run(config).await
}
