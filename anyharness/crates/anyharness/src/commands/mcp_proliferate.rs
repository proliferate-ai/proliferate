use std::path::PathBuf;

use anyhow::Result;
use clap::Args;

use anyharness_lib::cowork::provider;

#[derive(Args)]
pub struct McpProliferateArgs {
    #[arg(long)]
    pub workspace: String,
}

pub fn run(args: McpProliferateArgs) -> Result<()> {
    provider::run_stdio_server(&PathBuf::from(args.workspace))
}
