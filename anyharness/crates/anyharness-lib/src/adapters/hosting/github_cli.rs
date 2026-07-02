use std::path::Path;
use std::process::Command;

use super::types::{
    BranchPullRequestStatus, PullRequestChecksState, PullRequestReviewDecision, PullRequestState,
    PullRequestSummary,
};

/// Max branches per `gh api graphql` request. Each branch adds an aliased
/// `pullRequests` selection; 40 stays well under GraphQL complexity limits
/// while keeping the common case (a handful of active branches) to one call.
const BRANCH_PRS_CHUNK_SIZE: usize = 40;

#[derive(Debug)]
pub enum GhError {
    NotInstalled,
    AuthRequired(String),
    NoPrFound,
    /// The repo root's `origin` remote is missing or not github.com (v1
    /// supports github.com only).
    UnsupportedRemote(String),
    CommandFailed(String),
}

impl std::fmt::Display for GhError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GhError::NotInstalled => write!(f, "GitHub CLI (gh) is not installed"),
            GhError::AuthRequired(msg) => write!(f, "GitHub CLI auth required: {msg}"),
            GhError::NoPrFound => write!(f, "No pull request found for this branch"),
            GhError::UnsupportedRemote(msg) => write!(f, "Unsupported git remote: {msg}"),
            GhError::CommandFailed(msg) => write!(f, "gh command failed: {msg}"),
        }
    }
}

/// A github.com repository resolved from a repo root's `origin` remote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubRepo {
    pub owner: String,
    pub name: String,
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

/// Resolve the github.com `owner`/`name` for a repo root by parsing
/// `git config --get remote.origin.url` locally. No network. Non-github.com
/// remotes (and repos without an `origin` remote) are `UnsupportedRemote`.
pub fn resolve_github_repo(repo_root_path: &Path) -> Result<GithubRepo, GhError> {
    let output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(repo_root_path)
        .output()
        .map_err(|e| GhError::CommandFailed(format!("failed to run git config: {e}")))?;

    if !output.status.success() {
        // `git config --get` exits 1 when the key is unset: no origin remote.
        return Err(GhError::UnsupportedRemote(
            "repository has no origin remote".to_string(),
        ));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_github_remote_url(&url).ok_or_else(|| {
        GhError::UnsupportedRemote(format!(
            "origin remote is not a github.com repository: {url}"
        ))
    })
}

/// Parse a github.com remote URL into `(owner, name)`. Supported forms:
/// - SSH scp-like: `git@github.com:owner/repo.git`
/// - HTTPS: `https://github.com/owner/repo(.git)`
/// - SSH URL: `ssh://git@github.com/owner/repo.git`
///
/// Any other host returns `None` (github.com only in v1).
pub fn parse_github_remote_url(url: &str) -> Option<GithubRepo> {
    let url = url.trim();

    let rest = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest
    } else if let Some(rest) = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
    {
        rest
    } else if let Some(rest) = url
        .strip_prefix("ssh://git@github.com/")
        .or_else(|| url.strip_prefix("ssh://github.com/"))
    {
        rest
    } else {
        url.strip_prefix("git://github.com/")?
    };

    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut segments = rest.split('/');
    let owner = segments.next()?.trim();
    let name = segments.next()?.trim();
    if owner.is_empty() || name.is_empty() || segments.next().is_some() {
        return None;
    }
    Some(GithubRepo {
        owner: owner.to_string(),
        name: name.to_string(),
    })
}

/// Fetch the latest pull request per head branch with ONE `gh api graphql`
/// request per chunk of [`BRANCH_PRS_CHUNK_SIZE`] branches (sequential
/// chunks). Branch names are passed as GraphQL variables — never
/// string-interpolated into the query.
///
/// Every requested branch produces an entry; `pull_request: None` is an
/// authoritative "no PR for this branch".
pub fn fetch_branch_prs(
    cwd: &Path,
    repo: &GithubRepo,
    branches: &[String],
) -> Result<Vec<BranchPullRequestStatus>, GhError> {
    check_gh_installed()?;

    let mut entries = Vec::with_capacity(branches.len());
    for chunk in branches.chunks(BRANCH_PRS_CHUNK_SIZE) {
        let query = build_branch_prs_query(chunk.len());
        let mut command = Command::new("gh");
        command
            .args(["api", "graphql", "-f"])
            .arg(format!("query={query}"))
            .arg("-f")
            .arg(format!("owner={}", repo.owner))
            .arg("-f")
            .arg(format!("name={}", repo.name));
        for (index, branch) in chunk.iter().enumerate() {
            command.arg("-f").arg(format!("b{index}={branch}"));
        }

        let output = command
            .current_dir(cwd)
            .output()
            .map_err(|_| GhError::NotInstalled)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(classify_gh_failure(stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let json: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| GhError::CommandFailed(e.to_string()))?;
        entries.extend(parse_branch_prs_response(&json, chunk)?);
    }

    Ok(entries)
}

/// Build the aliased branch-scoped pullRequests query for `count` branches.
/// Branch names arrive via variables `$b0..$bN`; owner/name via `$owner` and
/// `$name`.
fn build_branch_prs_query(count: usize) -> String {
    let mut variables = String::from("$owner: String!, $name: String!");
    let mut selections = String::new();
    for index in 0..count {
        variables.push_str(&format!(", $b{index}: String!"));
        selections.push_str(&format!(
            "pr{index}: pullRequests(headRefName: $b{index}, states: [OPEN, MERGED, CLOSED], \
             first: 1, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ nodes {{ number url \
             title state isDraft baseRefName headRefName reviewDecision commits(last: 1) {{ \
             nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }} }} }} "
        ));
    }
    format!("query({variables}) {{ repository(owner: $owner, name: $name) {{ {selections}}} }}")
}

/// Map one `gh api graphql` response to per-branch statuses. Aliases `prN`
/// are matched back to `branches[N]`. An empty `nodes` array (or missing
/// alias) is an authoritative "no PR".
fn parse_branch_prs_response(
    json: &serde_json::Value,
    branches: &[String],
) -> Result<Vec<BranchPullRequestStatus>, GhError> {
    let repository = &json["data"]["repository"];
    if repository.is_null() {
        return Err(GhError::CommandFailed(
            "GraphQL response missing data.repository".to_string(),
        ));
    }

    let mut entries = Vec::with_capacity(branches.len());
    for (index, branch) in branches.iter().enumerate() {
        let node = repository[format!("pr{index}")]["nodes"]
            .as_array()
            .and_then(|nodes| nodes.first());
        entries.push(BranchPullRequestStatus {
            head_branch: branch.clone(),
            pull_request: node.map(|node| graphql_node_to_summary(node, branch)),
        });
    }
    Ok(entries)
}

fn graphql_node_to_summary(node: &serde_json::Value, branch: &str) -> PullRequestSummary {
    let rollup_state = node["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"].as_str();
    PullRequestSummary {
        number: node["number"].as_u64().unwrap_or(0),
        title: node["title"].as_str().unwrap_or("").to_string(),
        url: node["url"].as_str().unwrap_or("").to_string(),
        state: parse_pr_state(node["state"].as_str().unwrap_or("OPEN")),
        draft: node["isDraft"].as_bool().unwrap_or(false),
        head_branch: node["headRefName"].as_str().unwrap_or(branch).to_string(),
        base_branch: node["baseRefName"].as_str().unwrap_or("").to_string(),
        checks: Some(checks_from_rollup_state(rollup_state)),
        review_decision: Some(parse_review_decision(node["reviewDecision"].as_str())),
    }
}

fn parse_pr_state(state: &str) -> PullRequestState {
    match state {
        "MERGED" => PullRequestState::Merged,
        "CLOSED" => PullRequestState::Closed,
        _ => PullRequestState::Open,
    }
}

/// Reduce a GraphQL `statusCheckRollup.state` (a single aggregate value;
/// absent when the head commit has no checks) to the contract state.
fn checks_from_rollup_state(state: Option<&str>) -> PullRequestChecksState {
    match state {
        None => PullRequestChecksState::None,
        Some("SUCCESS") => PullRequestChecksState::Passing,
        Some("FAILURE") | Some("ERROR") => PullRequestChecksState::Failing,
        // PENDING / EXPECTED / anything unknown: checks exist but have not
        // settled.
        Some(_) => PullRequestChecksState::Pending,
    }
}

/// Reduce `gh pr view --json statusCheckRollup` output — an array of check
/// contexts (CheckRun `status`/`conclusion` or StatusContext `state`) — to
/// the contract state. Failing wins over pending wins over passing.
fn reduce_check_rollup(rollup: &serde_json::Value) -> PullRequestChecksState {
    let Some(contexts) = rollup.as_array() else {
        return PullRequestChecksState::None;
    };
    if contexts.is_empty() {
        return PullRequestChecksState::None;
    }

    let mut any_pending = false;
    for context in contexts {
        // StatusContext: `state` in EXPECTED|ERROR|FAILURE|PENDING|SUCCESS.
        // CheckRun: `status` (COMPLETED|IN_PROGRESS|QUEUED|…) + `conclusion`
        // (SUCCESS|FAILURE|CANCELLED|TIMED_OUT|ACTION_REQUIRED|NEUTRAL|
        // SKIPPED|STALE|"").
        let verdict = context["state"]
            .as_str()
            .or_else(|| context["conclusion"].as_str())
            .unwrap_or("");
        match verdict {
            "FAILURE" | "ERROR" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED"
            | "STARTUP_FAILURE" => {
                return PullRequestChecksState::Failing;
            }
            "SUCCESS" | "NEUTRAL" | "SKIPPED" | "STALE" => {}
            _ => {
                // PENDING/EXPECTED states, or a CheckRun that has no
                // conclusion yet (still queued or in progress).
                any_pending = true;
            }
        }
    }

    if any_pending {
        PullRequestChecksState::Pending
    } else {
        PullRequestChecksState::Passing
    }
}

/// Map a GitHub `reviewDecision` (APPROVED | CHANGES_REQUESTED |
/// REVIEW_REQUIRED | null) to the contract decision.
fn parse_review_decision(decision: Option<&str>) -> PullRequestReviewDecision {
    match decision {
        Some("APPROVED") => PullRequestReviewDecision::Approved,
        Some("CHANGES_REQUESTED") => PullRequestReviewDecision::ChangesRequested,
        _ => PullRequestReviewDecision::None,
    }
}

fn classify_gh_failure(stderr: String) -> GhError {
    if stderr.contains("auth") || stderr.contains("login") || stderr.contains("logged") {
        GhError::AuthRequired(stderr)
    } else {
        GhError::CommandFailed(stderr)
    }
}

pub fn get_current_pr(cwd: &Path) -> Result<Option<PullRequestSummary>, GhError> {
    check_gh_installed()?;

    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            "--json",
            "number,title,url,state,isDraft,headRefName,baseRefName,reviewDecision,statusCheckRollup",
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
    let checks = reduce_check_rollup(&json["statusCheckRollup"]);
    let review_decision = parse_review_decision(json["reviewDecision"].as_str());

    Ok(Some(PullRequestSummary {
        number,
        title,
        url,
        state: parse_pr_state(state_str),
        draft: is_draft,
        head_branch,
        base_branch,
        checks: Some(checks),
        review_decision: Some(review_decision),
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
                checks: None,
                review_decision: None,
            })
        }
    }
}

#[cfg(test)]
#[path = "github_cli_tests.rs"]
mod github_cli_tests;
