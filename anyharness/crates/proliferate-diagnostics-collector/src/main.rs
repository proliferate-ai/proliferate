use std::io::Write;

use clap::Parser;
use proliferate_diagnostics_collector::process::{
    read_capability_from_fd, wait_for_process_shutdown,
};
use proliferate_diagnostics_collector::{CollectorConfig, CollectorServer};

#[derive(Debug, Parser)]
#[command(name = "proliferate-diagnostics-collector")]
struct Args {
    /// Print the export policy this binary was compiled with and exit zero.
    ///
    /// The desktop release job runs the packaged collector with this flag and
    /// requires `lifecycle_only`. It is a positive assertion about behaviour,
    /// and it fails closed: a binary that cannot run, does not know the flag,
    /// or answers anything else fails the bundle.
    #[arg(long)]
    print_export_policy: bool,
    /// Inherited descriptor containing one newline-terminated bearer capability.
    #[arg(long)]
    capability_fd: Option<i32>,
    /// Optional inherited descriptor for bounded newline-delimited control commands.
    #[arg(long)]
    control_fd: Option<i32>,
    #[arg(long, default_value = "standalone")]
    release: String,
    #[arg(long, default_value = "local")]
    environment: String,
    /// Stable identity of this installation, stamped on exported records as
    /// the `proliferate.install_id` resource attribute.
    ///
    /// The host that owns the identity passes it in; the collector never
    /// derives, generates, or persists one. Omitted means no attribute.
    #[arg(long)]
    install_id: Option<String>,
    /// The signed-in user's id, stamped on exported records as the
    /// `proliferate.user_id` resource attribute. Id only, never an email;
    /// the host passes it when a user is signed in and omits it otherwise.
    #[arg(long)]
    user_id: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    if args.print_export_policy {
        // Both literals are printed: the bare policy name is what the release
        // job asserts on, and the marker is the same string the job greps the
        // packaged binary for, which keeps the compiled constant reachable so
        // the linker cannot drop it.
        println!(
            "{}",
            proliferate_diagnostics_collector::export_policy_name()
        );
        eprintln!(
            "{}",
            proliferate_diagnostics_collector::export_policy_marker()
        );
        std::io::stdout().flush()?;
        return Ok(());
    }
    let Some(capability_fd) = args.capability_fd else {
        anyhow::bail!("--capability-fd is required");
    };
    if args.control_fd == Some(capability_fd) {
        anyhow::bail!("capability and control descriptors must be distinct");
    }
    let mut capability = read_capability_from_fd(capability_fd)?;
    let mut config = CollectorConfig::standalone(capability.clone());
    config.release = args.release;
    config.environment = args.environment;
    config.install_id = args.install_id;
    config.user_id = args.user_id;
    let server = CollectorServer::start(config).await?;
    let descriptor = server.connection_descriptor(capability_fd as u32)?;
    let core = server.core();
    println!("{}", serde_json::to_string(&descriptor)?);
    std::io::stdout().flush()?;
    capability.fill(0);
    // A malformed control line or a signal error still owes the guaranteed
    // `collector.shutdown` terminal, so the wait result is held until after the
    // server has been shut down.
    let waited = wait_for_process_shutdown(core, args.control_fd).await;
    let stopped = server.shutdown().await;
    waited?;
    stopped?;
    Ok(())
}
