use std::fs::OpenOptions;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use proliferate::diagnostics::{export_debug_bundle_to_path, ExportDebugBundleOptions};
use proliferate::diagnostics_collector::broker::client::DiagnosticsBrokerClient;
use proliferate_diagnostics_protocol::v1::types::{ExportRequestV1, RecordsQueryV1};
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::io::{AsyncWrite, AsyncWriteExt};

const MAX_REQUEST_DOCUMENT_BYTES: u64 = 1_048_576;
const CLI_OUTPUT_FRAME_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Parser)]
#[command(name = "proliferate-debug")]
#[command(about = "Export and query local Proliferate diagnostics")]
#[command(version)]
struct Cli {
    #[arg(long, global = true)]
    profile: Option<String>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    ExportDebugBundle {
        #[arg(long)]
        output: PathBuf,
    },
    Records {
        #[arg(long)]
        request: String,
    },
    Tail {
        #[arg(long)]
        after_cursor: Option<u64>,
    },
    Export {
        #[arg(long)]
        request: String,
        #[arg(long, default_value = "-")]
        output: String,
    },
    Health,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Cli::parse();
    let client = DiagnosticsBrokerClient::new(args.profile);
    match args.command {
        Commands::ExportDebugBundle { output } => {
            let result = export_debug_bundle_to_path(ExportDebugBundleOptions {
                output_path: output,
                runtime_url_override: None,
                runtime_status_override: None,
            })
            .await
            .map_err(|_| anyhow!("export_debug_bundle_failed"))?;
            println!("{}", result.output_path);
        }
        Commands::Records { request } => {
            let request = read_exact_document::<RecordsQueryV1>(&request)?;
            let page = client
                .records(request)
                .await
                .map_err(|error| anyhow!(error.classification_name()))?;
            write_json_line(&mut tokio::io::stdout(), &page).await?;
        }
        Commands::Tail { after_cursor } => {
            let mut tail = client
                .tail(after_cursor)
                .await
                .map_err(|error| anyhow!(error.classification_name()))?;
            let mut stdout = tokio::io::stdout();
            loop {
                tokio::select! {
                    signal = tokio::signal::ctrl_c() => {
                        signal.map_err(|_| anyhow!("cancelled"))?;
                        return Err(anyhow!("cancelled"));
                    }
                    frame = tail.next() => match frame
                        .map_err(|error| anyhow!(error.classification_name()))?
                    {
                        Some(frame) => write_json_line_cancellable(&mut stdout, &frame).await?,
                        None => break,
                    }
                }
            }
        }
        Commands::Export { request, output } => {
            let request = read_exact_document::<ExportRequestV1>(&request)?;
            let mut export = client
                .export(request)
                .await
                .map_err(|error| anyhow!(error.classification_name()))?;
            let mut writer = output_writer(&output)?;
            loop {
                tokio::select! {
                    signal = tokio::signal::ctrl_c() => {
                        signal.map_err(|_| anyhow!("cancelled"))?;
                        return Err(anyhow!("cancelled"));
                    }
                    frame = export.next() => match frame
                        .map_err(|error| anyhow!(error.classification_name()))?
                    {
                        Some(frame) => write_json_line_cancellable(&mut writer, &frame).await?,
                        None => break,
                    }
                }
            }
        }
        Commands::Health => {
            let health = client
                .health()
                .await
                .map_err(|error| anyhow!(error.classification_name()))?;
            write_json_line(&mut tokio::io::stdout(), &health).await?;
        }
    }
    Ok(())
}

fn read_exact_document<T>(path: &str) -> Result<T>
where
    T: DeserializeOwned + Serialize,
{
    let mut bytes = Vec::new();
    if path == "-" {
        io::stdin()
            .lock()
            .take(MAX_REQUEST_DOCUMENT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| anyhow!("invalid_request"))?;
    } else {
        std::fs::File::open(Path::new(path))
            .map_err(|_| anyhow!("invalid_request"))?
            .take(MAX_REQUEST_DOCUMENT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| anyhow!("invalid_request"))?;
    }
    if bytes.is_empty() || bytes.len() as u64 > MAX_REQUEST_DOCUMENT_BYTES {
        return Err(anyhow!("invalid_request"));
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| anyhow!("invalid_request"))?;
    let document: T =
        serde_json::from_value(value.clone()).map_err(|_| anyhow!("invalid_request"))?;
    if serde_json::to_value(&document).ok().as_ref() != Some(&value) {
        return Err(anyhow!("invalid_request"));
    }
    Ok(document)
}

fn output_writer(path: &str) -> Result<Box<dyn AsyncWrite + Unpin>> {
    if path == "-" {
        return Ok(Box::new(tokio::io::stdout()));
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|_| anyhow!("protocol_error"))?;
    set_owner_only(&file)?;
    Ok(Box::new(tokio::fs::File::from_std(file)))
}

#[cfg(unix)]
fn set_owner_only(file: &std::fs::File) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|_| anyhow!("protocol_error"))
}

#[cfg(not(unix))]
fn set_owner_only(_file: &std::fs::File) -> Result<()> {
    Ok(())
}

async fn write_json_line(
    writer: &mut (impl AsyncWrite + Unpin + ?Sized),
    value: &impl Serialize,
) -> Result<()> {
    let mut encoded = serde_json::to_vec(value).map_err(|_| anyhow!("protocol_error"))?;
    encoded.push(b'\n');
    writer
        .write_all(&encoded)
        .await
        .map_err(|_| anyhow!("protocol_error"))?;
    writer.flush().await.map_err(|_| anyhow!("protocol_error"))
}

async fn write_json_line_cancellable(
    writer: &mut (impl AsyncWrite + Unpin + ?Sized),
    value: &impl Serialize,
) -> Result<()> {
    tokio::select! {
        signal = tokio::signal::ctrl_c() => {
            signal.map_err(|_| anyhow!("cancelled"))?;
            Err(anyhow!("cancelled"))
        }
        result = tokio::time::timeout(CLI_OUTPUT_FRAME_TIMEOUT, write_json_line(writer, value)) => {
            result.map_err(|_| anyhow!("deadline_exceeded"))?
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_request_reader_rejects_unknown_fields() {
        let path = std::env::temp_dir().join(format!("debug-request-{}.json", std::process::id()));
        std::fs::write(
            &path,
            br#"{"schema_version":{"major":1,"minor":1},"after_cursor":null,"limit":1,"filters":{"source_time_from":null,"source_time_to":null,"components":[],"record_classes":[],"severities":[],"names":[],"outcomes":[],"operation_id":null,"parent_operation_id":null,"trace_id":null,"workspace_id":null,"session_id":null,"turn_id":null,"item_id":null,"request_id":null,"target_id":null,"prompt_id":null,"workflow_id":null,"error_classification":null},"endpoint":"forbidden"}"#,
        )
        .expect("request fixture");
        assert!(read_exact_document::<RecordsQueryV1>(&path.to_string_lossy()).is_err());
        std::fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn cli_surface_has_no_direct_collector_flags() {
        use clap::CommandFactory;
        let mut command = Cli::command();
        let rendered = command.render_long_help().to_string();
        assert!(!rendered.contains("--endpoint"));
        assert!(!rendered.contains("--token"));
        assert!(rendered.contains("records"));
        assert!(rendered.contains("tail"));
        assert!(rendered.contains("export"));
        assert!(rendered.contains("health"));
    }
}
