use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use anyhow::Context;

use crate::files::safety::resolve_safe_path;
use crate::git::executor::run_git_ok;
use crate::mobility::model::MobilityFileData;

#[derive(Debug, Clone)]
pub struct WorkspaceDelta {
    pub files: Vec<MobilityFileData>,
    pub deleted_paths: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct WorkspaceDeltaEstimate {
    pub file_count: usize,
    pub deleted_file_count: usize,
    pub total_bytes: u64,
    pub oversized_paths: Vec<String>,
}

pub fn current_branch_name(repo_root: &Path) -> anyhow::Result<Option<String>> {
    let branch = run_git_ok(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    if branch == "HEAD" || branch.is_empty() {
        Ok(None)
    } else {
        Ok(Some(branch))
    }
}

pub fn collect_workspace_delta(
    repo_root: &Path,
    exclude_paths: &[String],
) -> anyhow::Result<WorkspaceDelta> {
    let delta_paths = collect_delta_paths(repo_root, exclude_paths)?;
    let mut files = Vec::with_capacity(delta_paths.file_paths.len());
    for relative_path in delta_paths.file_paths {
        let resolved = resolve_safe_path(repo_root, &relative_path)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let content = fs::read(&resolved)
            .with_context(|| format!("reading changed workspace file {}", resolved.display()))?;
        files.push(MobilityFileData {
            relative_path,
            mode: file_mode(&resolved)?,
            content,
        });
    }

    Ok(WorkspaceDelta {
        files,
        deleted_paths: delta_paths.deleted_paths.into_iter().collect(),
    })
}

pub fn estimate_workspace_delta(
    repo_root: &Path,
    exclude_paths: &[String],
    per_file_limit_bytes: u64,
) -> anyhow::Result<WorkspaceDeltaEstimate> {
    let delta_paths = collect_delta_paths(repo_root, exclude_paths)?;
    let mut total_bytes = 0u64;
    let mut oversized_paths = Vec::new();

    for relative_path in &delta_paths.file_paths {
        let resolved = resolve_safe_path(repo_root, relative_path)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let len = fs::metadata(&resolved)
            .with_context(|| format!("reading metadata for {}", resolved.display()))?
            .len();
        total_bytes = total_bytes.saturating_add(len);
        if len > per_file_limit_bytes {
            oversized_paths.push(relative_path.clone());
        }
    }

    Ok(WorkspaceDeltaEstimate {
        file_count: delta_paths.file_paths.len(),
        deleted_file_count: delta_paths.deleted_paths.len(),
        total_bytes,
        oversized_paths,
    })
}

struct WorkspaceDeltaPaths {
    file_paths: BTreeSet<String>,
    deleted_paths: BTreeSet<String>,
}

fn collect_delta_paths(
    repo_root: &Path,
    exclude_paths: &[String],
) -> anyhow::Result<WorkspaceDeltaPaths> {
    let excludes = normalize_excludes(exclude_paths);
    let diff_output = run_git_ok(
        repo_root,
        &["diff", "--name-status", "--no-renames", "-z", "HEAD"],
    )?;
    let untracked_output = run_git_ok(
        repo_root,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;

    let mut file_paths = BTreeSet::new();
    let mut deleted_paths = BTreeSet::new();
    let tokens: Vec<&str> = diff_output
        .split('\0')
        .filter(|token| !token.is_empty())
        .collect();
    let mut cursor = 0usize;
    while cursor + 1 < tokens.len() {
        let status = tokens[cursor];
        let path = tokens[cursor + 1];
        cursor += 2;
        if is_excluded(path, &excludes) {
            continue;
        }
        if status.starts_with('D') {
            deleted_paths.insert(path.to_string());
        } else {
            file_paths.insert(path.to_string());
        }
    }

    for path in untracked_output
        .split('\0')
        .filter(|token| !token.is_empty())
    {
        if is_excluded(path, &excludes) {
            continue;
        }
        file_paths.insert(path.to_string());
    }

    Ok(WorkspaceDeltaPaths {
        file_paths,
        deleted_paths,
    })
}

fn normalize_excludes(paths: &[String]) -> BTreeSet<String> {
    paths
        .iter()
        .filter_map(|path| {
            let trimmed = path.trim().trim_matches('/');
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect()
}

fn is_excluded(path: &str, excludes: &BTreeSet<String>) -> bool {
    excludes
        .iter()
        .any(|exclude| path == exclude || path.starts_with(&format!("{exclude}/")))
}

fn file_mode(path: &Path) -> anyhow::Result<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(path)?;
        Ok(metadata.permissions().mode())
    }

    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(0)
    }
}
