use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::super::executor::run_git_ok;

pub fn stage_paths(workspace_path: &Path, paths: &[String]) -> anyhow::Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);
    let mut args = vec!["add", "--"];
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    args.extend(path_refs);
    run_git_ok(&repo_root_path, &args)?;
    Ok(())
}

pub fn unstage_paths(workspace_path: &Path, paths: &[String]) -> anyhow::Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);
    let mut args = vec!["reset", "HEAD", "--"];
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    args.extend(path_refs);
    run_git_ok(&repo_root_path, &args)?;
    Ok(())
}

/// Stage a single hunk (or subset of hunks) by applying patch text to the index.
/// Uses `git apply --cached` to add the patch content to the staging area without
/// touching the working tree.
pub fn stage_patch(workspace_path: &Path, patch: &str) -> anyhow::Result<()> {
    if patch.trim().is_empty() {
        anyhow::bail!("patch is empty");
    }
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);

    let output = run_git_apply_stdin(
        &repo_root_path,
        &["apply", "--cached", "--recount", "--whitespace=nowarn", "--unidiff-zero"],
        patch,
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr.trim();
        anyhow::bail!(
            "{}",
            if msg.is_empty() { "patch could not be applied to index" } else { msg }
        );
    }
    Ok(())
}

/// Unstage a single hunk by reverse-applying patch text from the index.
/// Uses `git apply --cached --reverse` to remove the patch content from the
/// staging area without touching the working tree.
pub fn unstage_patch(workspace_path: &Path, patch: &str) -> anyhow::Result<()> {
    if patch.trim().is_empty() {
        anyhow::bail!("patch is empty");
    }
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);

    let output = run_git_apply_stdin(
        &repo_root_path,
        &["apply", "--cached", "--reverse", "--recount", "--whitespace=nowarn", "--unidiff-zero"],
        patch,
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr.trim();
        anyhow::bail!(
            "{}",
            if msg.is_empty() { "patch could not be removed from index" } else { msg }
        );
    }
    Ok(())
}

fn run_git_apply_stdin(
    cwd: &Path,
    args: &[&str],
    stdin_data: &str,
) -> anyhow::Result<std::process::Output> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to run git {}: {e}", args.join(" ")))?;

    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin.write_all(stdin_data.as_bytes())?;
    }
    let output = child.wait_with_output()?;
    Ok(output)
}
