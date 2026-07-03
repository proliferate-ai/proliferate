//! Deterministic process steps: `shell.run`, `scm.open_pr`, and `notify`. These
//! shell out in the run's workspace, capturing a bounded output *tail* + exit
//! code, and map failures to typed step outcomes. Process-group kill on timeout
//! is not yet implemented (no runner in the codebase does — see the crate note);
//! `kill_on_drop` reaps the direct child.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::json;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{NotifyChannel, ScmOpenPrStep, ShellRunStep};

/// Bytes of combined output tail retained per shell step.
const MAX_OUTPUT_TAIL: usize = 8 * 1024;
const SCM_TIMEOUT: Duration = Duration::from_secs(180);

struct ShellResult {
    exit_code: Option<i32>,
    tail: String,
    timed_out: bool,
    spawn_error: Option<String>,
}

/// Run a `sh -lc` command in the workspace dir, capturing a bounded combined
/// output tail + exit code, killing the child on timeout.
async fn run_shell(
    workspace_path: &Path,
    command: &str,
    env: &[(String, String)],
    timeout: Duration,
) -> ShellResult {
    let mut cmd = tokio::process::Command::new("/bin/sh");
    cmd.arg("-lc")
        .arg(command)
        .current_dir(workspace_path)
        .envs(env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::process_env::remove_runtime_private_env(&mut cmd);

    let child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            return ShellResult {
                exit_code: None,
                tail: String::new(),
                timed_out: false,
                spawn_error: Some(error.to_string()),
            }
        }
    };
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            ShellResult {
                exit_code: output.status.code(),
                tail: tail_of(&combined),
                timed_out: false,
                spawn_error: None,
            }
        }
        Ok(Err(error)) => ShellResult {
            exit_code: None,
            tail: String::new(),
            timed_out: false,
            spawn_error: Some(error.to_string()),
        },
        Err(_) => ShellResult {
            exit_code: None,
            tail: String::new(),
            timed_out: true,
            spawn_error: None,
        },
    }
}

/// Keep the last `MAX_OUTPUT_TAIL` bytes of `text`, on a char boundary.
fn tail_of(text: &str) -> String {
    if text.len() <= MAX_OUTPUT_TAIL {
        return text.to_string();
    }
    let mut start = text.len() - MAX_OUTPUT_TAIL;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_string()
}

/// A standalone verify shell (used by the `agent.goal` verify gate). Returns the
/// exit code (`None` if it never ran) and the output tail.
pub async fn run_verify_shell(
    workspace_path: &Path,
    env: &[(String, String)],
    shell: &str,
    timeout: Duration,
) -> (Option<i32>, String) {
    let result = run_shell(workspace_path, shell, env, timeout).await;
    (result.exit_code, result.tail)
}

/// Execute a `shell.run` step.
pub async fn run_shell_step(
    workspace_path: &Path,
    env: &[(String, String)],
    step: &ShellRunStep,
) -> StepOutcome {
    let timeout = Duration::from_secs(step.timeout_secs.unwrap_or(600));
    let result = run_shell(workspace_path, &step.command, env, timeout).await;
    let mut output = json!({ "output_tail": result.tail });
    if let Some(name) = &step.output_name {
        output["output_name"] = json!(name);
    }
    if let Some(error) = result.spawn_error {
        output["exit_code"] = json!(-1);
        return StepOutcome::Failed {
            code: "spawn_failed".to_string(),
            message: Some(error),
            output: Some(output),
        };
    }
    if result.timed_out {
        return StepOutcome::Failed {
            code: "timeout".to_string(),
            message: Some(format!("command exceeded {}s", timeout.as_secs())),
            output: Some(output),
        };
    }
    let exit_code = result.exit_code.unwrap_or(-1);
    output["exit_code"] = json!(exit_code);
    if exit_code == 0 {
        StepOutcome::Completed { output }
    } else {
        StepOutcome::Failed {
            code: "nonzero_exit".to_string(),
            message: Some(format!("command exited {exit_code}")),
            output: Some(output),
        }
    }
}

/// Execute an `scm.open_pr` step: push the current branch, then `gh pr create`,
/// parsing the PR URL from stdout. Missing/unauthenticated `gh` is typed as
/// `scm_unavailable` (a cloud-lane concern deferred to W4/W7).
pub async fn open_pr_step(
    workspace_path: &Path,
    env: &[(String, String)],
    step: &ScmOpenPrStep,
) -> StepOutcome {
    let push = run_shell(workspace_path, "git push -u origin HEAD", env, SCM_TIMEOUT).await;
    if push.timed_out {
        return scm_failed("push timed out", &push.tail);
    }
    if push.exit_code != Some(0) {
        return scm_failed("git push failed", &push.tail);
    }

    let mut command = format!("gh pr create --title {}", sh_quote(&step.title));
    match &step.body {
        Some(body) => command.push_str(&format!(" --body {}", sh_quote(body))),
        None => command.push_str(" --body ''"),
    }
    if let Some(base) = &step.base {
        command.push_str(&format!(" --base {}", sh_quote(base)));
    }
    if step.draft {
        command.push_str(" --draft");
    }

    let create = run_shell(workspace_path, &command, env, SCM_TIMEOUT).await;
    if create.timed_out {
        return scm_failed("gh pr create timed out", &create.tail);
    }
    if create.exit_code != Some(0) {
        if is_gh_unavailable(&create.tail) {
            return StepOutcome::Failed {
                code: "scm_unavailable".to_string(),
                message: Some(create.tail),
                output: None,
            };
        }
        return scm_failed("gh pr create failed", &create.tail);
    }
    match parse_pr_url(&create.tail) {
        Some(url) => StepOutcome::Completed {
            output: json!({ "pr_url": url }),
        },
        None => scm_failed("could not parse PR url from gh output", &create.tail),
    }
}

/// Execute a `notify` step. Never a hard failure: the in-app record is the floor.
pub fn notify_step(channel: NotifyChannel, message: &str) -> StepOutcome {
    let channel = match channel {
        NotifyChannel::InApp => "in_app",
        // Slack delivery is a W4 integration concern; the in-app record still
        // lands so the run history shows the intended notification.
        NotifyChannel::Slack => "slack_unavailable",
    };
    StepOutcome::Completed {
        output: json!({ "channel": channel, "message": message }),
    }
}

fn scm_failed(reason: &str, tail: &str) -> StepOutcome {
    StepOutcome::Failed {
        code: "scm_failed".to_string(),
        message: Some(format!("{reason}: {}", tail_of(tail))),
        output: None,
    }
}

fn is_gh_unavailable(tail: &str) -> bool {
    let low = tail.to_ascii_lowercase();
    low.contains("command not found")
        || low.contains("not installed")
        || low.contains("gh: not found")
        || low.contains("auth")
        || low.contains("login")
        || low.contains("gh auth")
}

/// Extract the last `https://` token from gh output (the PR URL gh prints).
fn parse_pr_url(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .rfind(|token| token.starts_with("https://"))
        .map(|token| token.trim().to_string())
}

/// Single-quote a value for safe `sh -lc` interpolation.
fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sh_quote_escapes_single_quotes() {
        assert_eq!(sh_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn parses_the_last_https_url() {
        let output = "Creating pull request\nhttps://github.com/o/r/pull/7\n";
        assert_eq!(
            parse_pr_url(output).as_deref(),
            Some("https://github.com/o/r/pull/7")
        );
    }

    #[test]
    fn detects_gh_unavailable() {
        assert!(is_gh_unavailable("gh: command not found"));
        assert!(is_gh_unavailable("You are not logged into any GitHub hosts. Run gh auth login"));
        assert!(!is_gh_unavailable("a merge conflict occurred"));
    }

    #[test]
    fn tail_keeps_the_end() {
        let text = "x".repeat(MAX_OUTPUT_TAIL + 100);
        assert_eq!(tail_of(&text).len(), MAX_OUTPUT_TAIL);
    }

    #[test]
    fn notify_slack_is_not_a_failure() {
        let outcome = notify_step(NotifyChannel::Slack, "hi");
        let StepOutcome::Completed { output } = outcome else {
            panic!("notify must not fail");
        };
        assert_eq!(output["channel"], "slack_unavailable");
    }
}
