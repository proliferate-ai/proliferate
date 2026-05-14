mod config;
mod error;
mod install;
mod logging;
mod process;

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "proliferate-supervisor")]
struct Args {
    #[arg(long)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Run,
    PrintService,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    logging::init();
    let args = Args::parse();
    let config = config::SupervisorConfig::load(args.config)?;
    match args.command {
        Command::Run => process::run(config).await?,
        Command::PrintService => println!("{}", install::service::systemd_user_unit(&config)),
    }
    Ok(())
}
