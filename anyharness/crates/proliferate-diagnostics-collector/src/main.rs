use std::io::Write;

use clap::Parser;
use proliferate_diagnostics_collector::process::{
    read_capability_from_fd, wait_for_process_shutdown,
};
use proliferate_diagnostics_collector::{CollectorConfig, CollectorServer};

#[derive(Debug, Parser)]
#[command(name = "proliferate-diagnostics-collector")]
struct Args {
    /// Inherited descriptor containing one newline-terminated bearer capability.
    #[arg(long)]
    capability_fd: i32,
    /// Optional inherited descriptor for bounded newline-delimited control commands.
    #[arg(long)]
    control_fd: Option<i32>,
    #[arg(long, default_value = "standalone")]
    release: String,
    #[arg(long, default_value = "local")]
    environment: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    if args.control_fd == Some(args.capability_fd) {
        anyhow::bail!("capability and control descriptors must be distinct");
    }
    let mut capability = read_capability_from_fd(args.capability_fd)?;
    let mut config = CollectorConfig::standalone(capability.clone());
    config.release = args.release;
    config.environment = args.environment;
    let server = CollectorServer::start(config).await?;
    let descriptor = server.connection_descriptor(args.capability_fd as u32)?;
    let core = server.core();
    println!("{}", serde_json::to_string(&descriptor)?);
    std::io::stdout().flush()?;
    capability.fill(0);
    wait_for_process_shutdown(core, args.control_fd).await?;
    server.shutdown().await?;
    Ok(())
}
