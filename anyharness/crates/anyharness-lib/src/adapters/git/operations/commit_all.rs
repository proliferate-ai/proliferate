use std::path::{Path, PathBuf};

use super::super::executor::{run_git, run_git_ok};
use super::commit::commit_staged;

pub fn commit_all_if_dirty(workspace_path: &Path, summary: &str) -> anyhow::Result<Option<String>> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);

    let unstaged = run_git(&repo_root_path, &["diff", "--quiet"])?;
    let staged = run_git(&repo_root_path, &["diff", "--cached", "--quiet"])?;
    if unstaged.success && staged.success {
        return Ok(None);
    }

    run_git_ok(&repo_root_path, &["add", "-A"])?;
    let staged_check = run_git_ok(&repo_root_path, &["diff", "--cached", "--stat"])?;
    if staged_check.trim().is_empty() {
        return Ok(None);
    }

    let (oid, _) = commit_staged(&repo_root_path, summary, None).map_err(anyhow::Error::from)?;
    Ok(Some(oid))
}
