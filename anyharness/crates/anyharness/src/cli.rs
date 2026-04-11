use clap::{Parser, Subcommand};

use crate::commands::install_agents::InstallAgentsArgs;
use crate::commands::mcp_proliferate::McpProliferateArgs;
use crate::commands::serve::ServeArgs;

#[derive(Parser)]
#[command(name = "anyharness")]
#[command(about = "AnyHarness: a runtime for coding agents")]
#[command(version)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    Serve(ServeArgs),
    /// Install or reconcile managed agent artifacts into the runtime home
    InstallAgents(InstallAgentsArgs),
    /// Print the OpenAPI JSON schema for the runtime API
    PrintOpenapi,
    /// Run the built-in Cowork artifact MCP server over stdio
    McpProliferate(McpProliferateArgs),
}
