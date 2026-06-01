use std::collections::BTreeMap;
use std::path::Path;

use super::super::executor::run_git_ok;
use super::super::types::{GitBranchDiffFilesResult, GitDiffError, GitDiffFile, GitFileStatus};
use super::diff_base::resolve_branch_diff_base;
use super::diff_support::{
    base_worktree_cached_args, base_worktree_worktree_args, load_untracked_path_diff,
    parse_name_status_z, parse_numstat_z_map, run_git_checked,
};

pub fn branch_diff_files(
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

pub fn base_worktree_diff_files(
    workspace_path: &Path,
    base_ref: Option<&str>,
) -> Result<GitBranchDiffFilesResult, GitDiffError> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = std::path::PathBuf::from(&repo_root);
    let base = resolve_branch_diff_base(&repo_root_path, base_ref)?;

    let cached = diff_files_for_args(
        &repo_root_path,
        base_worktree_cached_args(&base.merge_base_oid),
    )?;
    let worktree = diff_files_for_args(
        &repo_root_path,
        base_worktree_worktree_args(&base.merge_base_oid),
    )?;
    let untracked = untracked_diff_files(&repo_root_path)?;
    let mut files_by_path = BTreeMap::<String, GitDiffFile>::new();

    for file in cached {
        files_by_path.insert(file.path.clone(), file);
    }
    for file in worktree {
        files_by_path.insert(file.path.clone(), file);
    }
    for file in untracked {
        files_by_path.insert(file.path.clone(), file);
    }

    let files = files_by_path.into_values().collect();

    Ok(GitBranchDiffFilesResult {
        base_ref: base.base_ref,
        resolved_base_oid: base.resolved_base_oid,
        merge_base_oid: base.merge_base_oid,
        head_oid: base.head_oid,
        files,
    })
}

fn diff_files_for_args(
    repo_root: &Path,
    base_args: Vec<String>,
) -> Result<Vec<GitDiffFile>, GitDiffError> {
    let mut name_status_args = base_args.clone();
    name_status_args.push("--name-status".to_string());
    name_status_args.push("-z".to_string());
    name_status_args.push("--".to_string());
    let name_status = run_git_checked(repo_root, &name_status_args)?;

    let mut numstat_args = base_args;
    numstat_args.push("--numstat".to_string());
    numstat_args.push("-z".to_string());
    numstat_args.push("--".to_string());
    let numstat = run_git_checked(repo_root, &numstat_args)?;

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
    Ok(files)
}

fn untracked_diff_files(repo_root: &Path) -> Result<Vec<GitDiffFile>, GitDiffError> {
    let raw = run_git_checked(
        repo_root,
        &[
            "ls-files".to_string(),
            "--others".to_string(),
            "--exclude-standard".to_string(),
            "-z".to_string(),
        ],
    )?;
    raw.stdout
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(|path| {
            let diff = load_untracked_path_diff(repo_root, path)?;
            Ok(GitDiffFile {
                path: path.to_string(),
                old_path: None,
                status: GitFileStatus::Untracked,
                additions: diff.stats.additions,
                deletions: diff.stats.deletions,
                binary: diff.stats.binary,
            })
        })
        .collect()
}
