use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use super::super::executor::{run_git, GitOutput};
use super::super::types::{GitDiffError, GitDiffFile, GitDiffResult, GitDiffScope, GitFileStatus};
use super::diff_base::BranchDiffBase;

const MAX_DIFF_PATCH_BYTES: usize = 500_000;

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct DiffStats {
    pub(super) additions: u32,
    pub(super) deletions: u32,
    pub(super) binary: bool,
}

#[derive(Debug, Clone)]
pub(super) struct LoadedDiff {
    pub(super) patch: Option<String>,
    pub(super) stats: DiffStats,
}

pub(super) fn load_untracked_path_diff(
    repo_root: &Path,
    file_path: &str,
) -> Result<LoadedDiff, GitDiffError> {
    let patch = run_git_diff_allow_difference(
        repo_root,
        &[
            "diff".to_string(),
            "--no-index".to_string(),
            "--".to_string(),
            "/dev/null".to_string(),
            file_path.to_string(),
        ],
    )?;
    let numstat = run_git_diff_allow_difference(
        repo_root,
        &[
            "diff".to_string(),
            "--no-index".to_string(),
            "--numstat".to_string(),
            "-z".to_string(),
            "--".to_string(),
            "/dev/null".to_string(),
            file_path.to_string(),
        ],
    )?;

    Ok(LoadedDiff {
        patch: normalize_patch(patch.stdout),
        stats: parse_numstat_z_map(&numstat.stdout)
            .values()
            .copied()
            .fold(DiffStats::default(), combine_stats),
    })
}

pub(super) fn branch_diff_base_args(merge_base_oid: &str) -> Vec<String> {
    vec![
        "diff".to_string(),
        "--find-renames".to_string(),
        "--find-copies".to_string(),
        merge_base_oid.to_string(),
        "HEAD".to_string(),
    ]
}

pub(super) fn base_worktree_cached_args(merge_base_oid: &str) -> Vec<String> {
    vec![
        "diff".to_string(),
        "--cached".to_string(),
        "--find-renames".to_string(),
        "--find-copies".to_string(),
        merge_base_oid.to_string(),
    ]
}

pub(super) fn base_worktree_worktree_args(merge_base_oid: &str) -> Vec<String> {
    vec![
        "diff".to_string(),
        "--find-renames".to_string(),
        "--find-copies".to_string(),
        merge_base_oid.to_string(),
    ]
}

pub(super) fn diff_result(
    path: &str,
    scope: GitDiffScope,
    loaded: LoadedDiff,
    base: Option<BranchDiffBase>,
) -> GitDiffResult {
    let (patch, truncated) = match loaded.patch {
        Some(patch) => {
            let truncated = patch.len() > MAX_DIFF_PATCH_BYTES;
            (Some(truncate_patch(patch)), truncated)
        }
        None => (None, false),
    };

    GitDiffResult {
        path: path.to_string(),
        scope,
        binary: loaded.stats.binary,
        truncated,
        additions: loaded.stats.additions,
        deletions: loaded.stats.deletions,
        base_ref: base.as_ref().map(|base| base.base_ref.clone()),
        resolved_base_oid: base.as_ref().map(|base| base.resolved_base_oid.clone()),
        merge_base_oid: base.as_ref().map(|base| base.merge_base_oid.clone()),
        head_oid: base.as_ref().map(|base| base.head_oid.clone()),
        patch,
    }
}

pub(super) fn normalize_patch(patch: String) -> Option<String> {
    if patch.trim().is_empty() {
        None
    } else {
        Some(patch)
    }
}

pub(super) fn run_git_checked(
    repo_root: &Path,
    args: &[String],
) -> Result<GitOutput, GitDiffError> {
    run_git_command_checked(repo_root, args, "git diff failed")
}

pub(super) fn run_git_command_checked(
    repo_root: &Path,
    args: &[String],
    fallback: &str,
) -> Result<GitOutput, GitDiffError> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_git(repo_root, &refs)?;
    if output.success {
        Ok(output)
    } else {
        Err(GitDiffError::GitFailed {
            message: git_command_message(&output.stderr, fallback),
        })
    }
}

pub(super) fn run_git_no_index_diff(
    repo_root: &Path,
    args: &[String],
    fallback: &str,
) -> Result<GitOutput, GitDiffError> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_git(repo_root, &refs)?;
    if output.success || !output.stdout.trim().is_empty() {
        Ok(output)
    } else {
        Err(GitDiffError::GitFailed {
            message: git_command_message(&output.stderr, fallback),
        })
    }
}

pub(super) fn parse_name_status_z(raw: &str) -> Vec<GitDiffFile> {
    let parts = raw
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut i = 0;

    while i < parts.len() {
        let status_token = parts[i];
        i += 1;
        let Some(status_code) = status_token.chars().next() else {
            continue;
        };

        let status = match status_code {
            'A' => GitFileStatus::Added,
            'D' => GitFileStatus::Deleted,
            'R' => GitFileStatus::Renamed,
            'C' => GitFileStatus::Copied,
            'U' => GitFileStatus::Conflicted,
            'M' | 'T' => GitFileStatus::Modified,
            _ => GitFileStatus::Modified,
        };

        if matches!(status_code, 'R' | 'C') {
            if i + 1 >= parts.len() {
                break;
            }
            let old_path = parts[i].to_string();
            let path = parts[i + 1].to_string();
            i += 2;
            files.push(GitDiffFile {
                path,
                old_path: Some(old_path),
                status,
                additions: 0,
                deletions: 0,
                binary: false,
            });
        } else {
            if i >= parts.len() {
                break;
            }
            let path = parts[i].to_string();
            i += 1;
            files.push(GitDiffFile {
                path,
                old_path: None,
                status,
                additions: 0,
                deletions: 0,
                binary: false,
            });
        }
    }

    files
}

pub(super) fn parse_numstat_z_map(raw: &str) -> BTreeMap<(Option<String>, String), DiffStats> {
    let parts = raw
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut stats = BTreeMap::new();
    let mut i = 0;

    while i < parts.len() {
        let fields = parts[i].splitn(3, '\t').collect::<Vec<_>>();
        i += 1;
        if fields.len() < 3 {
            continue;
        }

        let stat = parse_numstat_parts(fields[0], fields[1]);
        if fields[2].is_empty() {
            if i + 1 >= parts.len() {
                break;
            }
            let old_path = parts[i].to_string();
            let path = parts[i + 1].to_string();
            i += 2;
            stats.insert((Some(old_path), path), stat);
        } else {
            stats.insert((None, fields[2].to_string()), stat);
        }
    }

    stats
}

pub(super) fn parse_numstat_summary(raw: &str) -> DiffStats {
    raw.lines()
        .filter_map(|line| {
            let parts = line.splitn(3, '\t').collect::<Vec<_>>();
            if parts.len() < 2 {
                return None;
            }
            Some(parse_numstat_parts(parts[0], parts[1]))
        })
        .fold(DiffStats::default(), combine_stats)
}

pub(super) fn combine_stats(mut left: DiffStats, right: DiffStats) -> DiffStats {
    left.additions = left.additions.saturating_add(right.additions);
    left.deletions = left.deletions.saturating_add(right.deletions);
    left.binary |= right.binary;
    left
}

pub(super) fn git_command_message(stderr: &str, fallback: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn run_git_diff_allow_difference(
    repo_root: &Path,
    args: &[String],
) -> Result<GitOutput, GitDiffError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|error| GitDiffError::GitFailed {
            message: format!("failed to run git {}: {error}", args.join(" ")),
        })?;
    let success = output.status.success();
    let code = output.status.code();
    let git_output = GitOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success,
    };
    if success || code == Some(1) {
        Ok(git_output)
    } else {
        Err(GitDiffError::GitFailed {
            message: git_command_message(&git_output.stderr, "git diff failed"),
        })
    }
}

fn truncate_patch(mut patch: String) -> String {
    if patch.len() <= MAX_DIFF_PATCH_BYTES {
        return patch;
    }

    let boundary = patch
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= MAX_DIFF_PATCH_BYTES)
        .last()
        .unwrap_or(0);
    patch.truncate(boundary);
    patch.push_str("\n\n[diff truncated]");
    patch
}

fn parse_numstat_parts(additions: &str, deletions: &str) -> DiffStats {
    if additions == "-" && deletions == "-" {
        return DiffStats {
            additions: 0,
            deletions: 0,
            binary: true,
        };
    }

    DiffStats {
        additions: additions.parse().unwrap_or(0),
        deletions: deletions.parse().unwrap_or(0),
        binary: false,
    }
}
