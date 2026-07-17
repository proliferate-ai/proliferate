//! Remote-identity parsing and destination path safety for materialization.

use std::path::{Path, PathBuf};

use crate::domains::workspaces::resolver::parse_remote_url;

/// A parsed GitHub-style repository identity, lower-cased for case-folded
/// comparison (GitHub owner/repo names are case-insensitive).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteIdentity {
    pub provider: String,
    pub owner: String,
    pub repo: String,
}

impl RemoteIdentity {
    pub fn new(provider: &str, owner: &str, repo: &str) -> Self {
        Self {
            provider: provider.trim().to_ascii_lowercase(),
            owner: owner.trim().to_ascii_lowercase(),
            repo: repo.trim().trim_end_matches(".git").to_ascii_lowercase(),
        }
    }
}

/// Parse an HTTPS or SSH GitHub remote URL into a case-folded identity.
/// Returns None for anything unparseable.
pub fn parse_remote_identity(url: &str) -> Option<RemoteIdentity> {
    let parsed = parse_remote_url(url)?;
    Some(RemoteIdentity::new(
        &parsed.provider,
        &parsed.owner,
        &parsed.repo,
    ))
}

/// Whether a clone URL embeds userinfo (credentials) in its authority, e.g.
/// `https://user:token@github.com/...`. Such URLs must never be echoed back in
/// a response payload.
pub fn url_contains_userinfo(url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(url) {
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return true;
        }
    }
    false
}

/// Produce a response-safe form of a clone URL: reject (None) if it embeds
/// userinfo, otherwise return it unchanged. SSH URLs (`git@host:...`) carry no
/// inline secret and pass through.
pub fn response_safe_clone_url(url: &str) -> Option<String> {
    if url_contains_userinfo(url) {
        return None;
    }
    Some(url.to_string())
}

/// Validate that a clone URL is a supported GitHub HTTPS/SSH form AND that its
/// owner/repo match the requested identity. Returns the parsed identity on
/// success. Rejects option-like or otherwise malformed URLs BEFORE git runs so
/// no attacker-controlled value can reach the clone as an option (PR3-GIT-INPUT).
///
/// Accepted forms:
///   - `https://github.com/{owner}/{repo}` (optional `.git`)
///   - `git@github.com:{owner}/{repo}` (optional `.git`)
pub fn validate_clone_url_matches_identity(
    clone_url: &str,
    expected: &RemoteIdentity,
) -> Result<(), String> {
    let trimmed = clone_url.trim();
    // Defense-in-depth: reject anything that could be read as a git option even
    // if a later `--` separator is present.
    if trimmed.starts_with('-') {
        return Err("clone URL must not begin with '-'".into());
    }
    let is_https = trimmed.starts_with("https://github.com/");
    let is_ssh = trimmed.starts_with("git@github.com:");
    if !is_https && !is_ssh {
        return Err(
            "clone URL must be a github.com HTTPS (https://github.com/owner/repo) \
             or SSH (git@github.com:owner/repo) URL"
                .into(),
        );
    }
    let actual = parse_remote_identity(trimmed)
        .ok_or_else(|| "clone URL could not be parsed as a github.com repository".to_string())?;
    if actual != *expected {
        return Err(format!(
            "clone URL identity {}/{}/{} does not match requested {}/{}/{}",
            actual.provider,
            actual.owner,
            actual.repo,
            expected.provider,
            expected.owner,
            expected.repo
        ));
    }
    Ok(())
}

/// Validate a branch name against git `check-ref-format --branch` semantics so
/// that no value the custom validator accepts can still be rejected by git
/// later (after prune/fetch side effects have already run). Rejects the empty
/// string, a leading `-` (option injection), the pseudo-ref `HEAD`, and every
/// documented ref-format violation, checked per slash-separated component so
/// leading-dot / trailing-`.lock` components anywhere in the path fail
/// (PR3-GIT-INPUT-06).
///
/// git's rules (from `git-check-ref-format(1)`): a ref may not
///   1. have a component that begins with `.` or ends with `.lock`;
///   2. contain `..`, `@{`, control chars/space/DEL, or any of `~ ^ : ? * [ \`;
///   3. begin or end with `/`, or contain `//` (empty components);
///   4. end with `.`;
///   5. be the single character `@`;
/// and, for a *branch* name, may not be exactly `HEAD` or begin with `-`.
pub fn validate_branch_name(branch_name: &str) -> Result<(), String> {
    let name = branch_name;
    if name.is_empty() {
        return Err("branch name is required".into());
    }
    if name.starts_with('-') {
        return Err("branch name must not begin with '-'".into());
    }
    // `git check-ref-format --branch HEAD` is rejected (HEAD is a pseudo-ref).
    if name == "HEAD" {
        return Err("branch name must not be 'HEAD'".into());
    }
    if name.starts_with('/') || name.ends_with('/') || name.contains("//") {
        return Err("branch name has an invalid '/' component".into());
    }
    if name.ends_with('.') || name.contains("..") {
        return Err("branch name must not contain '..' or end with '.'".into());
    }
    if name.contains("@{") {
        return Err("branch name must not contain '@{'".into());
    }
    if name == "@" {
        return Err("branch name must not be '@'".into());
    }
    // Per-component rules: no component may begin with '.' or end with '.lock'
    // (git applies these to EVERY slash-separated component, so `.foo`,
    // `foo/.bar`, `foo.lock/bar`, and `foo/bar.lock` are all invalid).
    for component in name.split('/') {
        if component.starts_with('.') {
            return Err("branch name component must not begin with '.'".into());
        }
        if component.ends_with(".lock") {
            return Err("branch name component must not end with '.lock'".into());
        }
    }
    // git check-ref-format forbids: space, ~ ^ : ? * [ \ and ASCII control
    // (incl. DEL).
    for ch in name.chars() {
        if ch.is_ascii_control()
            || matches!(
                ch,
                ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\' | '\u{7f}'
            )
        {
            return Err("branch name contains a forbidden character".into());
        }
    }
    Ok(())
}

/// Validate a head SHA is a full lowercase hex object id: 40 hex (sha1) or 64
/// hex (sha256). Rejects abbreviated, uppercase, or non-hex values so it can
/// never be read as a git option or ambiguous rev.
pub fn validate_head_sha(head_sha: &str) -> Result<(), String> {
    let len_ok = head_sha.len() == 40 || head_sha.len() == 64;
    if !len_ok || !head_sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("head sha must be a full 40- or 64-character lowercase hex object id".into());
    }
    if head_sha.bytes().any(|b| b.is_ascii_uppercase()) {
        return Err("head sha must be lowercase hex".into());
    }
    Ok(())
}

/// Symlink-escape-protected canonicalization of a destination path. The
/// destination itself may not exist yet (clone target), so we canonicalize the
/// nearest existing ancestor and re-append the remaining components. This
/// collapses any symlink in the existing prefix so downstream containment
/// checks compare real paths.
pub fn canonicalize_destination(destination: &Path) -> anyhow::Result<PathBuf> {
    if !destination.is_absolute() {
        anyhow::bail!("destination path must be absolute");
    }
    // Walk up to the nearest existing ancestor.
    let mut existing = destination;
    let mut trailing: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if existing.exists() {
            break;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                trailing.push(name.to_os_string());
                existing = parent;
            }
            _ => anyhow::bail!("destination path has no existing ancestor to canonicalize"),
        }
    }
    let mut canonical = std::fs::canonicalize(existing)
        .map_err(|error| anyhow::anyhow!("canonicalizing destination ancestor: {error}"))?;
    for name in trailing.into_iter().rev() {
        canonical.push(name);
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_github_remote() {
        let identity = parse_remote_identity("https://github.com/Owner/Repo.git").unwrap();
        assert_eq!(identity.provider, "github");
        assert_eq!(identity.owner, "owner");
        assert_eq!(identity.repo, "repo");
    }

    #[test]
    fn parses_ssh_github_remote() {
        let identity = parse_remote_identity("git@github.com:Owner/Repo.git").unwrap();
        assert_eq!(identity.provider, "github");
        assert_eq!(identity.owner, "owner");
        assert_eq!(identity.repo, "repo");
    }

    #[test]
    fn case_folds_for_comparison() {
        let a = parse_remote_identity("https://github.com/ACME/Widget").unwrap();
        let b = RemoteIdentity::new("github", "acme", "widget");
        assert_eq!(a, b);
    }

    #[test]
    fn detects_userinfo_in_https_url() {
        assert!(url_contains_userinfo(
            "https://user:token@github.com/o/r.git"
        ));
        assert!(!url_contains_userinfo("https://github.com/o/r.git"));
        assert!(!url_contains_userinfo("git@github.com:o/r.git"));
    }

    #[test]
    fn response_safe_url_rejects_credentials() {
        assert!(response_safe_clone_url("https://x:y@github.com/o/r.git").is_none());
        assert_eq!(
            response_safe_clone_url("https://github.com/o/r.git").as_deref(),
            Some("https://github.com/o/r.git")
        );
    }

    #[test]
    fn validate_clone_url_accepts_matching_https_and_ssh() {
        let expected = RemoteIdentity::new("github", "acme", "widget");
        assert!(validate_clone_url_matches_identity(
            "https://github.com/acme/widget.git",
            &expected
        )
        .is_ok());
        assert!(
            validate_clone_url_matches_identity("https://github.com/Acme/Widget", &expected)
                .is_ok()
        );
        assert!(
            validate_clone_url_matches_identity("git@github.com:acme/widget.git", &expected)
                .is_ok()
        );
    }

    #[test]
    fn validate_clone_url_rejects_identity_mismatch() {
        let expected = RemoteIdentity::new("github", "acme", "widget");
        assert!(validate_clone_url_matches_identity(
            "https://github.com/attacker/widget.git",
            &expected
        )
        .is_err());
    }

    #[test]
    fn validate_clone_url_rejects_option_injection_and_unsupported_hosts() {
        let expected = RemoteIdentity::new("github", "acme", "widget");
        // Option-like payloads never pass shape validation.
        assert!(
            validate_clone_url_matches_identity("--upload-pack=touch /tmp/x", &expected).is_err()
        );
        assert!(
            validate_clone_url_matches_identity("-c protocol.ext.allow=always", &expected).is_err()
        );
        // Non-github and file/ext transports are rejected.
        assert!(
            validate_clone_url_matches_identity("https://evil.com/acme/widget.git", &expected)
                .is_err()
        );
        assert!(
            validate_clone_url_matches_identity("ext::sh -c touch% /tmp/x", &expected).is_err()
        );
        assert!(validate_clone_url_matches_identity("file:///etc/passwd", &expected).is_err());
    }

    #[test]
    fn validate_branch_name_rules() {
        assert!(validate_branch_name("main").is_ok());
        assert!(validate_branch_name("feature/x-y_z.1").is_ok());
        assert!(validate_branch_name("").is_err());
        assert!(validate_branch_name("-delete").is_err());
        assert!(validate_branch_name("a..b").is_err());
        assert!(validate_branch_name("a/").is_err());
        assert!(validate_branch_name("/a").is_err());
        assert!(validate_branch_name("a b").is_err());
        assert!(validate_branch_name("a~b").is_err());
        assert!(validate_branch_name("a\u{0}b").is_err());
        assert!(validate_branch_name("a.lock").is_err());
        assert!(validate_branch_name("a@{b").is_err());
        assert!(validate_branch_name(".hidden").is_err());
        assert!(validate_branch_name("feature/.hidden").is_err());
        assert!(validate_branch_name("feature.lock/child").is_err());
        assert!(validate_branch_name("feature/child.lock").is_err());
        assert!(validate_branch_name("HEAD").is_err());
    }

    #[test]
    fn validate_head_sha_rules() {
        assert!(validate_head_sha(&"a".repeat(40)).is_ok());
        assert!(validate_head_sha(&"0".repeat(64)).is_ok());
        assert!(validate_head_sha(&"a".repeat(39)).is_err());
        assert!(validate_head_sha("main").is_err());
        assert!(validate_head_sha(&"A".repeat(40)).is_err());
        assert!(validate_head_sha(&"g".repeat(40)).is_err());
        assert!(validate_head_sha("--all").is_err());
    }
}
