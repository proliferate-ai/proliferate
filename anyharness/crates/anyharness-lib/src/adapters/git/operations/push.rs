use std::path::{Path, PathBuf};
use std::time::Duration;

use super::super::executor::{run_git, run_git_ok, run_git_with_timeout, TimedGitOutput};
use super::super::types::PushError;

pub fn push_current_branch(
    workspace_path: &Path,
    remote: Option<&str>,
) -> Result<(String, String, bool), PushError> {
    push_current_branch_inner(workspace_path, remote, None)
}

pub fn push_current_branch_with_timeout(
    workspace_path: &Path,
    remote: Option<&str>,
    timeout: Duration,
) -> Result<(String, String, bool), PushError> {
    push_current_branch_inner(workspace_path, remote, Some(timeout))
}

fn push_current_branch_inner(
    workspace_path: &Path,
    remote: Option<&str>,
    timeout: Option<Duration>,
) -> Result<(String, String, bool), PushError> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);

    let branch = run_git_ok(&repo_root_path, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();

    if branch == "HEAD" {
        return Err(PushError::DetachedHead);
    }

    let upstream = run_git(
        &repo_root_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            &format!("{branch}@{{upstream}}"),
        ],
    )?;

    let upstream_name = if upstream.success {
        let upstream_ref = upstream.stdout.trim().to_string();
        upstream_ref
            .split_once('/')
            .map(|(remote_name, _)| remote_name.to_string())
    } else {
        None
    };
    let remote_name = remote
        .map(str::to_string)
        .or(upstream_name)
        .unwrap_or_else(|| "origin".to_string());

    let push_args: Vec<&str> = if upstream.success {
        vec!["push", remote_name.as_str(), &branch]
    } else {
        vec!["push", "-u", remote_name.as_str(), &branch]
    };
    let push = if let Some(timeout) = timeout {
        match run_git_with_timeout(&repo_root_path, &push_args, timeout)? {
            TimedGitOutput::Completed(output) => output,
            TimedGitOutput::TimedOut => {
                return Err(PushError::Failed {
                    message: format!("push timed out after {}s", timeout.as_secs()),
                });
            }
        }
    } else {
        run_git(&repo_root_path, &push_args)?
    };

    if !push.success {
        let message = git_command_message(&push.stderr, "push failed");
        if push.stderr.to_ascii_lowercase().contains("rejected") {
            return Err(PushError::Rejected { message });
        }
        return Err(PushError::Failed { message });
    }

    let published = if upstream.success { false } else { true };

    Ok((remote_name.to_string(), branch, published))
}

fn git_command_message(stderr: &str, fallback: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}
