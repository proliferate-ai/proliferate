use std::path::{Path, PathBuf};
use std::process::Command;

pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub fn run_git(cwd: &Path, args: &[&str]) -> anyhow::Result<GitOutput> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("failed to run git {}: {e}", args.join(" ")))?;

    Ok(GitOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
    })
}

pub fn run_git_ok(cwd: &Path, args: &[&str]) -> anyhow::Result<String> {
    let out = run_git(cwd, args)?;
    if !out.success {
        anyhow::bail!("git {} failed: {}", args.join(" "), out.stderr.trim());
    }
    Ok(out.stdout)
}

pub fn resolve_git_repo_root(cwd: &Path) -> anyhow::Result<PathBuf> {
    let repo_root = run_git_ok(cwd, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(repo_root.trim()))
}
