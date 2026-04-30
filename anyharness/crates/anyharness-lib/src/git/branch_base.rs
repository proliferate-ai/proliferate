use std::path::Path;

use super::default_branch::detect_default_branch;
use super::executor::run_git;
use super::types::GitDiffError;

#[derive(Debug, Clone)]
pub(super) struct BranchDiffBase {
    pub(super) base_ref: String,
    pub(super) resolved_base_oid: String,
    pub(super) merge_base_oid: String,
    pub(super) head_oid: String,
}

pub(super) fn resolve_branch_diff_base(
    repo_root: &Path,
    base_ref: Option<&str>,
) -> Result<BranchDiffBase, GitDiffError> {
    let candidates = branch_base_candidates(repo_root, base_ref)?;
    for candidate in candidates {
        if let Some(resolved_base_oid) = resolve_branch_ref_to_commit(repo_root, &candidate)? {
            let head_oid = resolve_commit_expr(repo_root, "HEAD^{commit}")
                .map_err(|_| GitDiffError::BaseRefNotFound)?;
            let merge_base_oid = resolve_merge_base(repo_root, &resolved_base_oid, &head_oid)?;
            return Ok(BranchDiffBase {
                base_ref: display_ref_name(&candidate),
                resolved_base_oid,
                merge_base_oid,
                head_oid,
            });
        }
    }

    Err(GitDiffError::BaseRefNotFound)
}

fn branch_base_candidates(
    repo_root: &Path,
    base_ref: Option<&str>,
) -> Result<Vec<String>, GitDiffError> {
    let mut candidates = Vec::new();

    if let Some(base_ref) = base_ref {
        let trimmed = base_ref.trim();
        if trimmed.is_empty() || invalid_base_ref_text(trimmed) {
            return Err(GitDiffError::InvalidBaseRef);
        }
        append_branch_ref_candidates(&mut candidates, trimmed)?;
    } else {
        if let Some(default_branch) = detect_default_branch(repo_root) {
            if !invalid_base_ref_text(&default_branch) {
                append_branch_ref_candidates(&mut candidates, &default_branch)?;
            }
        }
        push_unique(&mut candidates, "refs/remotes/origin/HEAD".to_string());
        for fallback in ["main", "master", "develop"] {
            append_branch_ref_candidates(&mut candidates, fallback)?;
        }
    }

    Ok(candidates)
}

fn append_branch_ref_candidates(
    candidates: &mut Vec<String>,
    base_ref: &str,
) -> Result<(), GitDiffError> {
    if base_ref.starts_with("refs/heads/") || base_ref.starts_with("refs/remotes/") {
        if !is_plausible_full_ref(base_ref) {
            return Err(GitDiffError::InvalidBaseRef);
        }
        push_unique(candidates, base_ref.to_string());
        return Ok(());
    }
    if base_ref.starts_with("refs/") {
        return Err(GitDiffError::InvalidBaseRef);
    }

    if base_ref.contains('/') {
        push_unique(candidates, format!("refs/remotes/{base_ref}"));
        push_unique(candidates, format!("refs/heads/{base_ref}"));
    } else {
        push_unique(candidates, format!("refs/heads/{base_ref}"));
        push_unique(candidates, format!("refs/remotes/origin/{base_ref}"));
    }
    Ok(())
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn invalid_base_ref_text(value: &str) -> bool {
    value.starts_with('-')
        || value.contains("..")
        || value.contains("@{")
        || value.contains('\\')
        || value.contains('^')
        || value.contains('~')
        || value.contains(':')
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
}

fn is_plausible_full_ref(value: &str) -> bool {
    !value.ends_with('/')
        && !value.contains("//")
        && !value
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn resolve_branch_ref_to_commit(
    repo_root: &Path,
    full_ref: &str,
) -> Result<Option<String>, GitDiffError> {
    let check_format = run_git(repo_root, &["check-ref-format", full_ref])?;
    if !check_format.success {
        return Err(GitDiffError::InvalidBaseRef);
    }

    let ref_hash = run_git(repo_root, &["show-ref", "--verify", "--hash", full_ref])?;
    if !ref_hash.success {
        return Ok(None);
    }
    let hash = ref_hash.stdout.trim();
    if hash.is_empty() {
        return Ok(None);
    }

    resolve_commit_expr(repo_root, &format!("{hash}^{{commit}}")).map(Some)
}

fn resolve_commit_expr(repo_root: &Path, expr: &str) -> Result<String, GitDiffError> {
    let output = run_git(
        repo_root,
        &["rev-parse", "--verify", "--quiet", "--end-of-options", expr],
    )?;
    if !output.success {
        return Err(GitDiffError::BaseRefNotFound);
    }
    let oid = output.stdout.trim();
    if oid.is_empty() {
        return Err(GitDiffError::BaseRefNotFound);
    }
    Ok(oid.to_string())
}

fn resolve_merge_base(
    repo_root: &Path,
    resolved_base_oid: &str,
    head_oid: &str,
) -> Result<String, GitDiffError> {
    let merge_base = run_git(repo_root, &["merge-base", resolved_base_oid, head_oid])?;
    if !merge_base.success {
        return Err(GitDiffError::MergeBaseNotFound);
    }
    let oid = merge_base.stdout.trim();
    if oid.is_empty() {
        return Err(GitDiffError::MergeBaseNotFound);
    }
    Ok(oid.to_string())
}

fn display_ref_name(full_ref: &str) -> String {
    full_ref
        .strip_prefix("refs/heads/")
        .or_else(|| full_ref.strip_prefix("refs/remotes/"))
        .unwrap_or(full_ref)
        .to_string()
}
