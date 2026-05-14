mod config;
mod error;
mod install;
mod logging;
mod observability;
mod process;
mod update;

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
    VerifyUpdate {
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long)]
        component: String,
        #[arg(long)]
        version: String,
        #[arg(long)]
        os: String,
        #[arg(long)]
        arch: String,
        #[arg(long)]
        artifact: PathBuf,
    },
    StageUpdate {
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long)]
        component: String,
        #[arg(long)]
        version: String,
        #[arg(long)]
        os: String,
        #[arg(long)]
        arch: String,
        #[arg(long)]
        artifact: PathBuf,
        #[arg(long)]
        staging_dir: PathBuf,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    logging::init();
    let args = Args::parse();
    let Args {
        config: config_path,
        command,
    } = args;
    match command {
        Command::Run => {
            let config = config::SupervisorConfig::load(config_path)?;
            process::run(config).await?
        }
        Command::PrintService => {
            let config = config::SupervisorConfig::load(config_path)?;
            println!("{}", install::service::systemd_user_unit(&config))
        }
        Command::VerifyUpdate {
            manifest,
            component,
            version,
            os,
            arch,
            artifact,
        } => {
            let manifest = std::fs::read_to_string(&manifest)?;
            let manifest = update::manifest::UpdateManifest::parse(&manifest)?;
            let artifact_definition = manifest.artifact_for(&component, &version, &os, &arch)?;
            let bytes = std::fs::read(&artifact)?;
            update::manifest::verify_sha256(artifact_definition, &bytes)?;
            println!("verified");
        }
        Command::StageUpdate {
            manifest,
            component,
            version,
            os,
            arch,
            artifact,
            staging_dir,
        } => {
            let manifest = std::fs::read_to_string(&manifest)?;
            let manifest = update::manifest::UpdateManifest::parse(&manifest)?;
            let artifact_definition = manifest.artifact_for(&component, &version, &os, &arch)?;
            let staged =
                update::staging::stage_artifact_file(&staging_dir, artifact_definition, &artifact)?;
            observability::artifact_staged(&staged);
            println!("{}", staged.path.display());
        }
    }
    Ok(())
}
