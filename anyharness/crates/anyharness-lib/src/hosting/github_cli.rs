use std::path::Path;
use std::process::Command;

use super::types::{PullRequestState, PullRequestSummary};

#[derive(Debug)]
pub enum GhError {
    NotInstalled,
    AuthRequired(String),
    NoPrFound,
    CommandFailed(String),
}

impl std::fmt::Display for GhError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GhError::NotInstalled => write!(f, "GitHub CLI (gh) is not installed"),
            GhError::AuthRequired(msg) => write!(f, "GitHub CLI auth required: {msg}"),
            GhError::NoPrFound => write!(f, "No pull request found for this branch"),
            GhError::CommandFailed(msg) => write!(f, "gh command failed: {msg}"),
        }
    }
}

pub fn check_gh_installed() -> Result<(), GhError> {
    Command::new("gh")
        .arg("--version")
        .output()
        .map_err(|_| GhError::NotInstalled)?;
    Ok(())
}

pub fn check_gh_auth(cwd: &Path) -> Result<(), GhError> {
    let output = Command::new("gh")
        .args(["auth", "status"])
        .current_dir(cwd)
        .output()
        .map_err(|_| GhError::NotInstalled)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(GhError::AuthRequired(stderr));
    }
    Ok(())
}

pub fn get_current_pr(cwd: &Path) -> Result<Option<PullRequestSummary>, GhError> {
    check_gh_installed()?;

    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            "--json",
            "number,title,url,state,isDraft,headRefName,baseRefName",
        ])
        .current_dir(cwd)
        .output()
        .map_err(|_| GhError::NotInstalled)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("no pull requests found")
            || stderr.contains("Could not resolve")
            || stderr.contains("no open pull requests")
        {
            return Ok(None);
        }
        if stderr.contains("auth") || stderr.contains("login") {
            return Err(GhError::AuthRequired(stderr));
        }
        return Err(GhError::CommandFailed(stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| GhError::CommandFailed(e.to_string()))?;

    let number = json["number"].as_u64().unwrap_or(0);
    let title = json["title"].as_str().unwrap_or("").to_string();
    let url = json["url"].as_str().unwrap_or("").to_string();
    let state_str = json["state"].as_str().unwrap_or("OPEN");
    let is_draft = json["isDraft"].as_bool().unwrap_or(false);
    let head_branch = json["headRefName"].as_str().unwrap_or("").to_string();
    let base_branch = json["baseRefName"].as_str().unwrap_or("").to_string();

    let state = match state_str {
        "MERGED" => PullRequestState::Merged,
        "CLOSED" => PullRequestState::Closed,
        _ => PullRequestState::Open,
    };

    Ok(Some(PullRequestSummary {
        number,
        title,
        url,
        state,
        draft: is_draft,
        head_branch,
        base_branch,
    }))
}

pub fn create_pr(
    cwd: &Path,
    title: &str,
    body: Option<&str>,
    base_branch: &str,
    draft: bool,
) -> Result<PullRequestSummary, GhError> {
    check_gh_installed()?;
    check_gh_auth(cwd)?;

    let mut args = vec![
        "pr".to_string(),
        "create".to_string(),
        "--title".to_string(),
        title.to_string(),
        "--base".to_string(),
        base_branch.to_string(),
    ];

    if let Some(b) = body {
        if !b.is_empty() {
            args.push("--body".to_string());
            args.push(b.to_string());
        }
    } else {
        args.push("--body".to_string());
        args.push(String::new());
    }

    if draft {
        args.push("--draft".to_string());
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = Command::new("gh")
        .args(&arg_refs)
        .current_dir(cwd)
        .output()
        .map_err(|_| GhError::NotInstalled)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("auth") || stderr.contains("login") {
            return Err(GhError::AuthRequired(stderr));
        }
        return Err(GhError::CommandFailed(stderr));
    }

    match get_current_pr(cwd)? {
        Some(pr) => Ok(pr),
        None => {
            let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(PullRequestSummary {
                number: 0,
                title: title.to_string(),
                url,
                state: PullRequestState::Open,
                draft,
                head_branch: String::new(),
                base_branch: base_branch.to_string(),
            })
        }
    }
}
