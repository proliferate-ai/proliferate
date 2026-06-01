use std::path::Path;

use super::super::executor::{run_git, run_git_ok};
use super::super::types::{GitDiffError, GitDiffResult, GitDiffScope};
use super::diff_base::{resolve_branch_diff_base, BranchDiffBase};
use super::diff_support::{
    base_worktree_cached_args, base_worktree_worktree_args, branch_diff_base_args, combine_stats,
    diff_result, git_command_message, load_untracked_path_diff, normalize_patch,
    parse_numstat_summary, parse_numstat_z_map, run_git_checked, run_git_command_checked,
    run_git_no_index_diff, DiffStats, LoadedDiff,
};

pub fn diff_for_path_with_scope(
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
    if !matches!(scope, GitDiffScope::Branch | GitDiffScope::BaseWorktree)
        && (base_ref.is_some() || old_path.is_some())
    {
        return Err(GitDiffError::InvalidBaseRef);
    }
    if old_path.is_some() && !matches!(scope, GitDiffScope::Branch | GitDiffScope::BaseWorktree) {
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
        GitDiffScope::BaseWorktree => {
            let base = resolve_branch_diff_base(&repo_root_path, base_ref)?;
            let loaded = load_base_worktree_path_diff(&repo_root_path, &base, file_path, old_path)?;
            Ok(diff_result(
                file_path,
                GitDiffScope::BaseWorktree,
                loaded,
                Some(base),
            ))
        }
    }
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

    let loaded = LoadedDiff {
        patch: normalize_patch(patch.stdout),
        stats: parse_numstat_summary(&numstat.stdout),
    };

    if loaded.patch.is_none() && diff_prefix.len() == 1 && diff_prefix[0] == "diff" {
        if let Some(untracked) = load_untracked_file_diff(repo_root, file_path)? {
            return Ok(untracked);
        }
    }

    Ok(loaded)
}

fn load_untracked_file_diff(
    repo_root: &Path,
    file_path: &str,
) -> Result<Option<LoadedDiff>, GitDiffError> {
    if !is_exact_untracked_path(repo_root, file_path)?
        || !is_regular_file_inside_repo(repo_root, file_path)
    {
        return Ok(None);
    }

    let numstat_args = vec![
        "diff".to_string(),
        "--no-index".to_string(),
        "--numstat".to_string(),
        "--".to_string(),
        "/dev/null".to_string(),
        file_path.to_string(),
    ];
    let numstat = run_git_no_index_diff(repo_root, &numstat_args, "git diff --no-index failed")?;
    let stats = parse_numstat_summary(&numstat.stdout);

    if stats.binary {
        return Ok(Some(LoadedDiff { patch: None, stats }));
    }

    let patch_args = vec![
        "diff".to_string(),
        "--no-index".to_string(),
        "--".to_string(),
        "/dev/null".to_string(),
        file_path.to_string(),
    ];
    let patch = run_git_no_index_diff(repo_root, &patch_args, "git diff --no-index failed")?;

    Ok(Some(LoadedDiff {
        patch: normalize_patch(patch.stdout),
        stats,
    }))
}

fn is_exact_untracked_path(repo_root: &Path, file_path: &str) -> Result<bool, GitDiffError> {
    let args = vec![
        "ls-files".to_string(),
        "--others".to_string(),
        "--exclude-standard".to_string(),
        "--".to_string(),
        file_path.to_string(),
    ];
    let output = run_git_command_checked(repo_root, &args, "git ls-files failed")?;
    Ok(output.stdout.lines().any(|path| path == file_path))
}

fn is_regular_file_inside_repo(repo_root: &Path, file_path: &str) -> bool {
    let Ok(repo_root) = repo_root.canonicalize() else {
        return false;
    };
    let candidate = repo_root.join(file_path);
    let Ok(metadata) = std::fs::symlink_metadata(&candidate) else {
        return false;
    };
    if !metadata.file_type().is_file() {
        return false;
    }
    let Ok(candidate) = candidate.canonicalize() else {
        return false;
    };
    candidate.starts_with(repo_root)
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

fn load_base_worktree_path_diff(
    repo_root: &Path,
    base: &BranchDiffBase,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<LoadedDiff, GitDiffError> {
    if is_untracked_path(repo_root, file_path)? {
        return load_untracked_path_diff(repo_root, file_path);
    }

    let worktree = load_base_worktree_path_diff_with_args(
        repo_root,
        base_worktree_worktree_args(&base.merge_base_oid),
        file_path,
        old_path,
    )?;
    if worktree.patch.is_some() {
        return Ok(worktree);
    }

    let cached = load_base_worktree_path_diff_with_args(
        repo_root,
        base_worktree_cached_args(&base.merge_base_oid),
        file_path,
        old_path,
    )?;
    if cached.patch.is_some() {
        return Ok(cached);
    }

    Ok(LoadedDiff {
        patch: None,
        stats: DiffStats::default(),
    })
}

fn load_base_worktree_path_diff_with_args(
    repo_root: &Path,
    base_args: Vec<String>,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<LoadedDiff, GitDiffError> {
    let mut patch_args = base_args.clone();
    patch_args.push("--".to_string());
    patch_args.push(file_path.to_string());
    if let Some(old_path) = old_path {
        if !old_path.trim().is_empty() && old_path != file_path {
            patch_args.push(old_path.to_string());
        }
    }
    let patch = run_git_checked(repo_root, &patch_args)?;

    let mut numstat_args = base_args;
    numstat_args.push("--numstat".to_string());
    numstat_args.push("-z".to_string());
    numstat_args.push("--".to_string());
    numstat_args.push(file_path.to_string());
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

fn is_untracked_path(repo_root: &Path, file_path: &str) -> Result<bool, GitDiffError> {
    let output = run_git(
        repo_root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            file_path,
        ],
    )?;
    if !output.success {
        return Err(GitDiffError::GitFailed {
            message: git_command_message(&output.stderr, "git ls-files failed"),
        });
    }
    Ok(output.stdout.lines().any(|path| path == file_path))
}
