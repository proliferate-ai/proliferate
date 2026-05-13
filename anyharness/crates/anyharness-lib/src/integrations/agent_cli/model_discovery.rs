use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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
) -> Result<Vec<DiscoveredCliModel>, ModelDiscoveryError> {
    let output = run_cli(executable, &["models"], Duration::from_secs(15))?;
    Ok(parse_cursor_models(&output.stdout))
}

pub fn discover_opencode_models(
    executable: &Path,
    force_provider_refresh: bool,
) -> Result<Vec<DiscoveredCliModel>, ModelDiscoveryError> {
    let mut args = vec!["models"];
    if force_provider_refresh {
        args.push("--refresh");
    }
    let output = run_cli(executable, &args, Duration::from_secs(20))?;
    Ok(parse_opencode_models(&output.stdout))
}

struct CliOutput {
    stdout: String,
}

fn run_cli(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<CliOutput, ModelDiscoveryError> {
    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let start = Instant::now();

    loop {
        if child.try_wait()?.is_some() {
            let output = child.wait_with_output()?;
            if !output.status.success() {
                return Err(ModelDiscoveryError::CommandFailed(redact_stderr(
                    &String::from_utf8_lossy(&output.stderr),
                )));
            }
            return Ok(CliOutput {
                stdout: strip_ansi(&String::from_utf8_lossy(&output.stdout)),
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

fn redact_stderr(stderr: &str) -> String {
    stderr
        .lines()
        .take(12)
        .map(|line| {
            line.replace("token", "[redacted]")
                .replace("key", "[redacted]")
        })
        .collect::<Vec<_>>()
        .join("\n")
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
}
