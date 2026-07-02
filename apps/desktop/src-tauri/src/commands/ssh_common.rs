//! SSH plumbing shared by the tunnel and installer commands: connection
//! parsing, common ssh(1) options, and child-process output collection with
//! secret redaction.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_SSH_PORT: u16 = 22;
pub(crate) const DEFAULT_ANYHARNESS_PORT: u16 = 8457;
const SSH_CONNECT_TIMEOUT_SECONDS: u16 = 12;

#[derive(Debug)]
pub(crate) struct SshConnection {
    pub(crate) ssh_host: String,
    pub(crate) ssh_user: String,
    pub(crate) ssh_port: u16,
    pub(crate) identity_file: Option<PathBuf>,
}

pub(crate) struct CommandOutput {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

pub(crate) fn parse_ssh_connection(
    ssh_host: String,
    ssh_user: String,
    ssh_port: Option<u16>,
    identity_file: Option<String>,
) -> Result<SshConnection, String> {
    let ssh_host = ssh_host.trim().to_string();
    let ssh_user = ssh_user.trim().to_string();
    if ssh_host.is_empty() || ssh_user.is_empty() {
        return Err("SSH host and user are required.".to_string());
    }
    let identity_file = identity_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_home_path)
        .transpose()?;
    Ok(SshConnection {
        ssh_host,
        ssh_user,
        ssh_port: normalize_port(ssh_port, DEFAULT_SSH_PORT, "SSH port")?,
        identity_file,
    })
}

pub(crate) fn normalize_port(
    value: Option<u16>,
    fallback: u16,
    label: &str,
) -> Result<u16, String> {
    match value {
        Some(0) => Err(format!("{label} must be between 1 and 65535.")),
        Some(port) => Ok(port),
        None => Ok(fallback),
    }
}

pub(crate) fn append_common_ssh_options(command: &mut Command, connection: &SshConnection) {
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg(format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECONDS}"))
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-p")
        .arg(connection.ssh_port.to_string());

    if let Some(identity_file) = &connection.identity_file {
        command.arg("-i").arg(identity_file);
    }
}

pub(crate) fn ssh_destination(connection: &SshConnection) -> String {
    format!("{}@{}", connection.ssh_user, connection.ssh_host)
}

pub(crate) fn wait_for_child_output(
    mut child: Child,
    timeout: Duration,
    context: &str,
    tokens: &[&str],
) -> Result<CommandOutput, String> {
    let stdout_reader = spawn_reader(child.stdout.take());
    let stderr_reader = spawn_reader(child.stderr.take());
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_reader.join().unwrap_or_default();
                let stderr = stderr_reader.join().unwrap_or_default();
                return Ok(CommandOutput {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let stdout = stdout_reader.join().unwrap_or_default();
                let stderr = stderr_reader.join().unwrap_or_default();
                let detail = command_output_error(context, &stdout, &stderr, tokens);
                return Err(format!(
                    "{context} timed out after {}s: {detail}",
                    timeout.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!("Failed to wait for {context}: {error}"));
            }
        }
    }
}

fn spawn_reader<R>(reader: Option<R>) -> thread::JoinHandle<String>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let Some(mut reader) = reader else {
            return String::new();
        };
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        output
    })
}

pub(crate) fn redact_tokens(value: String, tokens: &[&str]) -> String {
    tokens.iter().fold(value, |redacted, token| {
        redacted.replace(token, "[redacted]")
    })
}

pub(crate) fn command_output_error(
    prefix: &str,
    stdout: &str,
    stderr: &str,
    tokens: &[&str],
) -> String {
    let stdout = stdout.trim();
    let stderr = stderr.trim();
    let mut detail = String::new();
    if !stderr.is_empty() {
        detail.push_str(stderr);
    }
    if !stdout.is_empty() {
        if !detail.is_empty() {
            detail.push_str("\n\n");
        }
        detail.push_str(stdout);
    }
    detail = redact_tokens(detail, tokens);
    if detail.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}: {detail}")
    }
}

fn expand_home_path(path: &str) -> Result<PathBuf, String> {
    if path == "~" {
        return std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set.".to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set.".to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(path))
}
