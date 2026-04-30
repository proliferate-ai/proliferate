use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub enum TimedGitOutput {
    Completed(GitOutput),
    TimedOut,
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

pub fn run_git_with_timeout(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> anyhow::Result<TimedGitOutput> {
    let started_at = Instant::now();
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to run git {}: {e}", args.join(" ")))?;

    loop {
        if child.try_wait()?.is_some() {
            let output = child.wait_with_output()?;
            return Ok(TimedGitOutput::Completed(GitOutput {
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                success: output.status.success(),
            }));
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait_with_output();
            return Ok(TimedGitOutput::TimedOut);
        }

        thread::sleep(Duration::from_millis(50));
    }
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
