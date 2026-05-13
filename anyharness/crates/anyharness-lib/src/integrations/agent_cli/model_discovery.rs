use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredCliModel {
    pub id: String,
    pub display_name: String,
    pub provider: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ModelDiscoveryError {
    #[error("model discovery command timed out")]
    Timeout,
    #[error("failed to run model discovery command: {0}")]
    Io(#[from] std::io::Error),
    #[error("model discovery command failed: {0}")]
    CommandFailed(String),
}

pub fn discover_cursor_models(
    executable: &Path,
    cwd: Option<&Path>,
) -> Result<Vec<DiscoveredCliModel>, ModelDiscoveryError> {
    let output = run_cli(executable, &["models"], cwd, Duration::from_secs(15))?;
    Ok(parse_cursor_models(&output.stdout))
}

pub fn discover_opencode_models(
    executable: &Path,
    cwd: Option<&Path>,
    force_provider_refresh: bool,
) -> Result<Vec<DiscoveredCliModel>, ModelDiscoveryError> {
    let mut args = vec!["models"];
    if force_provider_refresh {
        args.push("--refresh");
    }
    let output = run_cli(executable, &args, cwd, Duration::from_secs(20))?;
    Ok(parse_opencode_models(&output.stdout))
}

struct CliOutput {
    stdout: String,
}

fn run_cli(
    executable: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<CliOutput, ModelDiscoveryError> {
    let mut stdout = CaptureFile::create("stdout")?;
    let mut stderr = CaptureFile::create("stderr")?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(stdout.child_stdio()?)
        .stderr(stderr.child_stdio()?);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command.spawn()?;
    let start = Instant::now();

    loop {
        if child.try_wait()?.is_some() {
            let status = child.wait()?;
            if !status.success() {
                return Err(ModelDiscoveryError::CommandFailed(public_failure_message(
                    &stderr.read_to_string()?,
                )));
            }
            return Ok(CliOutput {
                stdout: strip_ansi(&stdout.read_to_string()?),
            });
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ModelDiscoveryError::Timeout);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

struct CaptureFile {
    file: File,
    path: PathBuf,
}

impl CaptureFile {
    fn create(label: &str) -> std::io::Result<Self> {
        let path = std::env::temp_dir().join(format!(
            "anyharness-model-discovery-{label}-{}",
            Uuid::new_v4()
        ));
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok(Self { file, path })
    }

    fn child_stdio(&self) -> std::io::Result<Stdio> {
        Ok(Stdio::from(self.file.try_clone()?))
    }

    fn read_to_string(&mut self) -> std::io::Result<String> {
        self.file.seek(SeekFrom::Start(0))?;
        let mut output = String::new();
        self.file.read_to_string(&mut output)?;
        Ok(output)
    }
}

impl Drop for CaptureFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub fn parse_cursor_models(output: &str) -> Vec<DiscoveredCliModel> {
    strip_ansi(output)
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty()
                || line == "Available models"
                || line == "Loading models..."
                || line.starts_with("Tip:")
            {
                return None;
            }

            let (id, label) = line.split_once(" - ")?;
            let id = id.trim();
            if id.is_empty() || id.contains(' ') {
                return None;
            }
            let is_default = label.contains("default");
            let display_name = label
                .split("  (")
                .next()
                .unwrap_or(label)
                .trim()
                .to_string();
            if display_name.is_empty() {
                return None;
            }
            Some(DiscoveredCliModel {
                id: id.to_string(),
                display_name,
                provider: None,
                is_default,
            })
        })
        .collect()
}

pub fn parse_opencode_models(output: &str) -> Vec<DiscoveredCliModel> {
    strip_ansi(output)
        .lines()
        .filter_map(|line| {
            let id = line.trim();
            if id.is_empty() || !id.contains('/') || id.starts_with('{') || id.starts_with('"') {
                return None;
            }
            let (provider, model_id) = id.split_once('/')?;
            if provider.is_empty() || model_id.is_empty() {
                return None;
            }
            Some(DiscoveredCliModel {
                id: id.to_string(),
                display_name: title_model_id(model_id),
                provider: Some(provider.to_string()),
                is_default: false,
            })
        })
        .collect()
}

fn public_failure_message(stderr: &str) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("auth")
        || lower.contains("login")
        || lower.contains("unauthorized")
        || lower.contains("permission")
    {
        "model discovery command failed; check provider authentication".to_string()
    } else {
        "model discovery command failed".to_string()
    }
}

fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if ch == '\r' {
            continue;
        }
        output.push(ch);
    }
    output
}

fn title_model_id(model_id: &str) -> String {
    model_id
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| match part.to_ascii_lowercase().as_str() {
            "gpt" => "GPT".to_string(),
            "claude" => "Claude".to_string(),
            "m2" => "M2".to_string(),
            "v4" => "V4".to_string(),
            "1t" => "1T".to_string(),
            other if other.chars().all(|ch| ch.is_ascii_digit() || ch == '.') => other.to_string(),
            other => {
                let mut chars = other.chars();
                match chars.next() {
                    Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cursor_models_with_default_marker_and_ansi() {
        let output = "\u{1b}[2KAvailable models\n\nauto - Auto\ncomposer-2-fast - Composer 2 Fast  (current, default)\nTip: use --model <id>\n";

        let models = parse_cursor_models(output);

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "auto");
        assert_eq!(models[1].display_name, "Composer 2 Fast");
        assert!(models[1].is_default);
    }

    #[test]
    fn parses_opencode_provider_model_ids() {
        let output = "opencode/big-pickle\nopenai/gpt-5.5\n";

        let models = parse_opencode_models(output);

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].provider.as_deref(), Some("opencode"));
        assert_eq!(models[0].display_name, "Big Pickle");
        assert_eq!(models[1].display_name, "GPT 5.5");
    }

    #[test]
    fn public_failure_message_does_not_include_stderr() {
        let message = public_failure_message("token=secret-login-token unauthorized");

        assert_eq!(
            message,
            "model discovery command failed; check provider authentication",
        );
        assert!(!message.contains("secret-login-token"));
    }
}
