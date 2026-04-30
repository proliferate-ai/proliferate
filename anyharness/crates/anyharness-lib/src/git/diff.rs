use std::collections::BTreeMap;
use std::path::Path;

use super::branch_base::{resolve_branch_diff_base, BranchDiffBase};
use super::executor::{run_git, run_git_ok, GitOutput};
use super::types::{
    GitBranchDiffFilesResult, GitDiffError, GitDiffFile, GitDiffResult, GitDiffScope, GitFileStatus,
};

#[derive(Debug, Clone, Copy, Default)]
struct DiffStats {
    additions: u32,
    deletions: u32,
    binary: bool,
}

#[derive(Debug, Clone)]
struct LoadedDiff {
    patch: Option<String>,
    stats: DiffStats,
}

const MAX_DIFF_PATCH_BYTES: usize = 500_000;

pub(super) fn diff_for_path_with_scope(
    workspace_path: &Path,
    file_path: &str,
    scope: GitDiffScope,
    base_ref: Option<&str>,
    old_path: Option<&str>,
) -> Result<GitDiffResult, GitDiffError> {
    if file_path.trim().is_empty() {
        return Err(GitDiffError::GitFailed {
            message: "diff path is required".to_string(),
        });
    }
    if scope != GitDiffScope::Branch && (base_ref.is_some() || old_path.is_some()) {
        return Err(GitDiffError::InvalidBaseRef);
    }

    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = std::path::PathBuf::from(&repo_root);

    match scope {
        GitDiffScope::WorkingTree => {
            let loaded = load_working_tree_diff(&repo_root_path, file_path)?;
            Ok(diff_result(
                file_path,
                GitDiffScope::WorkingTree,
                loaded,
                None,
            ))
        }
        GitDiffScope::Unstaged => {
            let loaded = load_simple_diff(&repo_root_path, &["diff"], file_path)?;
            Ok(diff_result(file_path, GitDiffScope::Unstaged, loaded, None))
        }
        GitDiffScope::Staged => {
            let loaded = load_simple_diff(&repo_root_path, &["diff", "--cached"], file_path)?;
            Ok(diff_result(file_path, GitDiffScope::Staged, loaded, None))
        }
        GitDiffScope::Branch => {
            let base = resolve_branch_diff_base(&repo_root_path, base_ref)?;
            let loaded = load_branch_path_diff(&repo_root_path, &base, file_path, old_path)?;
            Ok(diff_result(
                file_path,
                GitDiffScope::Branch,
                loaded,
                Some(base),
            ))
        }
    }
}

pub(super) fn branch_diff_files(
    workspace_path: &Path,
    base_ref: Option<&str>,
) -> Result<GitBranchDiffFilesResult, GitDiffError> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = std::path::PathBuf::from(&repo_root);
    let base = resolve_branch_diff_base(&repo_root_path, base_ref)?;

    let name_status = run_git_checked(
        &repo_root_path,
        &[
            "diff".to_string(),
            "--name-status".to_string(),
            "-z".to_string(),
            "--find-renames".to_string(),
            "--find-copies".to_string(),
            base.merge_base_oid.clone(),
            "HEAD".to_string(),
            "--".to_string(),
        ],
    )?;
    let numstat = run_git_checked(
        &repo_root_path,
        &[
            "diff".to_string(),
            "--numstat".to_string(),
            "-z".to_string(),
            "--find-renames".to_string(),
            "--find-copies".to_string(),
            base.merge_base_oid.clone(),
            "HEAD".to_string(),
            "--".to_string(),
        ],
    )?;

    let stats = parse_numstat_z_map(&numstat.stdout);
    let mut files = parse_name_status_z(&name_status.stdout)
        .into_iter()
        .map(|mut file| {
            if let Some(stat) = stats.get(&(file.old_path.clone(), file.path.clone())) {
                file.additions = stat.additions;
                file.deletions = stat.deletions;
                file.binary = stat.binary;
            }
            file
        })
        .collect::<Vec<_>>();
    files.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.old_path.cmp(&b.old_path))
    });

    Ok(GitBranchDiffFilesResult {
        base_ref: base.base_ref,
        resolved_base_oid: base.resolved_base_oid,
        merge_base_oid: base.merge_base_oid,
        head_oid: base.head_oid,
        files,
    })
}

fn load_working_tree_diff(repo_root: &Path, file_path: &str) -> Result<LoadedDiff, GitDiffError> {
    let unstaged = load_simple_diff(repo_root, &["diff"], file_path)?;
    if unstaged.patch.is_some() {
        return Ok(unstaged);
    }

    let staged = load_simple_diff(repo_root, &["diff", "--cached"], file_path)?;
    if staged.patch.is_some() {
        return Ok(staged);
    }

    Ok(LoadedDiff {
        patch: None,
        stats: DiffStats::default(),
    })
}

fn load_simple_diff(
    repo_root: &Path,
    diff_prefix: &[&str],
    file_path: &str,
) -> Result<LoadedDiff, GitDiffError> {
    let mut patch_args = diff_prefix
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    patch_args.push("--".to_string());
    patch_args.push(file_path.to_string());
    let patch = run_git_checked(repo_root, &patch_args)?;

    let mut numstat_args = diff_prefix
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    numstat_args.push("--numstat".to_string());
    numstat_args.push("--".to_string());
    numstat_args.push(file_path.to_string());
    let numstat = run_git_checked(repo_root, &numstat_args)?;

    Ok(LoadedDiff {
        patch: normalize_patch(patch.stdout),
        stats: parse_numstat_summary(&numstat.stdout),
    })
}

fn load_branch_path_diff(
    repo_root: &Path,
    base: &BranchDiffBase,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<LoadedDiff, GitDiffError> {
    let mut patch_args = branch_diff_base_args(&base.merge_base_oid);
    patch_args.push("--".to_string());
    patch_args.push(file_path.to_string());
    if let Some(old_path) = old_path {
        if !old_path.trim().is_empty() && old_path != file_path {
            patch_args.push(old_path.to_string());
        }
    }
    let patch = run_git_checked(repo_root, &patch_args)?;

    let mut numstat_args = vec![
        "diff".to_string(),
        "--numstat".to_string(),
        "-z".to_string(),
        "--find-renames".to_string(),
        "--find-copies".to_string(),
        base.merge_base_oid.clone(),
        "HEAD".to_string(),
        "--".to_string(),
        file_path.to_string(),
    ];
    if let Some(old_path) = old_path {
        if !old_path.trim().is_empty() && old_path != file_path {
            numstat_args.push(old_path.to_string());
        }
    }
    let numstat = run_git_checked(repo_root, &numstat_args)?;

    Ok(LoadedDiff {
        patch: normalize_patch(patch.stdout),
        stats: parse_numstat_z_map(&numstat.stdout)
            .values()
            .copied()
            .fold(DiffStats::default(), combine_stats),
    })
}

fn branch_diff_base_args(merge_base_oid: &str) -> Vec<String> {
    vec![
        "diff".to_string(),
        "--find-renames".to_string(),
        "--find-copies".to_string(),
        merge_base_oid.to_string(),
        "HEAD".to_string(),
    ]
}

fn diff_result(
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

fn normalize_patch(patch: String) -> Option<String> {
    if patch.trim().is_empty() {
        None
    } else {
        Some(patch)
    }
}

fn run_git_checked(repo_root: &Path, args: &[String]) -> Result<GitOutput, GitDiffError> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_git(repo_root, &refs)?;
    if output.success {
        Ok(output)
    } else {
        Err(GitDiffError::GitFailed {
            message: git_command_message(&output.stderr, "git diff failed"),
        })
    }
}

fn parse_name_status_z(raw: &str) -> Vec<GitDiffFile> {
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

fn parse_numstat_z_map(raw: &str) -> BTreeMap<(Option<String>, String), DiffStats> {
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

fn parse_numstat_summary(raw: &str) -> DiffStats {
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

fn combine_stats(mut left: DiffStats, right: DiffStats) -> DiffStats {
    left.additions = left.additions.saturating_add(right.additions);
    left.deletions = left.deletions.saturating_add(right.deletions);
    left.binary |= right.binary;
    left
}

fn git_command_message(stderr: &str, fallback: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}
