use std::path::{Path, PathBuf};

use super::super::executor::{run_git, run_git_ok};
use super::super::types::CommitError;

pub fn commit_staged(
    workspace_path: &Path,
    summary: &str,
    body: Option<&str>,
) -> Result<(String, String), CommitError> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);

    let staged_check = run_git_ok(&repo_root_path, &["diff", "--cached", "--stat"])?;
    if staged_check.trim().is_empty() {
        return Err(CommitError::NothingStaged);
    }

    let mut msg = summary.to_string();
    if let Some(b) = body {
        if !b.is_empty() {
            msg.push_str("\n\n");
            msg.push_str(b);
        }
    }

    let commit = run_git(&repo_root_path, &["commit", "-m", &msg])?;
    if !commit.success {
        return Err(CommitError::Failed {
            message: git_command_message(&commit.stderr, "commit failed"),
        });
    }
    let oid = run_git_ok(&repo_root_path, &["rev-parse", "HEAD"])?
        .trim()
        .to_string();

    Ok((oid, summary.to_string()))
}

fn git_command_message(stderr: &str, fallback: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}
