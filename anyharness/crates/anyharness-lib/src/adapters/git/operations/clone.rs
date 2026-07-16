use std::path::Path;
use std::process::Command;
use std::time::Instant;

/// Outcome of a `git clone` attempt. Auth failures are classified separately so
/// the domain can surface a typed `REPOSITORY_AUTH_REQUIRED` without leaking the
/// clone URL or any credential material.
#[derive(Debug)]
pub enum CloneError {
    /// The remote rejected the local credential chain (missing/invalid auth).
    AuthRequired(String),
    /// Any other clone failure (network, invalid ref, disk, etc.).
    Failed(String),
}

impl std::fmt::Display for CloneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CloneError::AuthRequired(detail) => {
                write!(f, "repository authentication required: {detail}")
            }
            CloneError::Failed(detail) => write!(f, "git clone failed: {detail}"),
        }
    }
}

impl std::error::Error for CloneError {}

/// Clone `clone_url` into `target_path` using the ambient local credential
/// chain (`GIT_TERMINAL_PROMPT=0` so a missing helper fails fast instead of
/// prompting). The URL is never logged; only the sanitized destination is.
pub fn clone_repository(clone_url: &str, target_path: &str) -> Result<(), CloneError> {
    let started = Instant::now();
    tracing::info!(
        target_path = %target_path,
        "[workspace-latency] repo_root.clone.start"
    );
    // The positional `--` separator guarantees neither the URL nor the
    // destination can be parsed as a git option even if a caller slips an
    // option-like value past upstream validation (PR3-GIT-INPUT).
    let output = Command::new("git")
        .args(["clone", "--", clone_url, target_path])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| CloneError::Failed(format!("failed to spawn git clone: {error}")))?;

    if output.status.success() {
        tracing::info!(
            target_path = %target_path,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] repo_root.clone.success"
        );
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let redacted = redact_stderr(&stderr, clone_url);
    tracing::warn!(
        target_path = %target_path,
        elapsed_ms = started.elapsed().as_millis(),
        stderr = %redacted,
        "[workspace-latency] repo_root.clone.failed"
    );
    if stderr_indicates_auth_failure(&stderr) {
        Err(CloneError::AuthRequired(redacted))
    } else {
        Err(CloneError::Failed(redacted))
    }
}

/// Heuristic classifier for local Git auth failures. Kept unit-testable and
/// independent of any live network so tests can pin the exact patterns.
pub fn stderr_indicates_auth_failure(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    const NEEDLES: [&str; 8] = [
        "authentication failed",
        "could not read username",
        "could not read password",
        "permission denied",
        "terminal prompts disabled",
        "invalid username or password",
        "access denied",
        "fatal: could not read from remote repository",
    ];
    NEEDLES.iter().any(|needle| lower.contains(needle))
}

/// Remove any occurrence of the raw clone URL (which may embed userinfo) from a
/// diagnostic string so credentials never reach a response or log line.
fn redact_stderr(stderr: &str, clone_url: &str) -> String {
    stderr.replace(clone_url, "<clone-url>")
}

/// Best-effort remove of a directory this operation created. Only called by the
/// domain after it has proven it owns cleanup (created an empty dir it cloned
/// into); never used against a user-selected pre-existing path.
pub fn remove_created_dir_best_effort(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}
