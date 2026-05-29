use std::path::PathBuf;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};

use proliferate::diagnostics::{export_debug_bundle_to_path, ExportDebugBundleOptions};

#[derive(Parser)]
#[command(name = "proliferate-debug")]
#[command(about = "Export local Proliferate diagnostics")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    ExportDebugBundle {
        #[arg(long)]
        output: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Cli::parse();

    match args.command {
        Commands::ExportDebugBundle { output } => {
            let result = export_debug_bundle_to_path(ExportDebugBundleOptions {
                output_path: output,
                runtime_url_override: None,
                runtime_status_override: None,
            })
            .await
            .map_err(|error| anyhow!(error))?;
            println!("{}", result.output_path);
        }
    }

    Ok(())
}
