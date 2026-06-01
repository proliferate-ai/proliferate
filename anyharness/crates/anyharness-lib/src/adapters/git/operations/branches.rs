use std::path::{Path, PathBuf};

use super::super::default_branch::detect_default_branch;
use super::super::executor::run_git_ok;
use super::super::types::GitBranch;

pub fn list_branches(workspace_path: &Path) -> anyhow::Result<Vec<GitBranch>> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);

    let raw = run_git_ok(
        &repo_root_path,
        &[
            "for-each-ref",
            "--format=%(refname:short)\t%(objecttype)\t%(HEAD)\t%(upstream:short)",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?;

    let default_branch = detect_default_branch(&repo_root_path);
    let mut branches = Vec::new();

    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].to_string();
        let is_head = parts[2] == "*";
        let upstream = parts.get(3).and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        });
        let is_remote = name.contains('/');
        let is_default = default_branch.as_deref() == Some(&name);

        branches.push(GitBranch {
            name,
            is_remote,
            is_head,
            is_default,
            upstream,
        });
    }

    Ok(branches)
}

pub fn head_is_ancestor_of(workspace_path: &Path, base_ref: &str) -> anyhow::Result<bool> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);
    let output = std::process::Command::new("git")
        .args(["merge-base", "--is-ancestor", "HEAD", base_ref])
        .current_dir(&repo_root_path)
        .output()?;
    if output.status.success() {
        return Ok(true);
    }
    if output.status.code() == Some(1) {
        return Ok(false);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    anyhow::bail!("{}", git_command_message(&stderr, "merge-base failed"))
}

pub fn resolve_ref_oid(workspace_path: &Path, ref_name: &str) -> anyhow::Result<String> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);
    Ok(
        run_git_ok(&repo_root_path, &["rev-parse", "--verify", ref_name])?
            .trim()
            .to_string(),
    )
}

pub fn rename_branch(workspace_path: &Path, new_name: &str) -> anyhow::Result<(String, String)> {
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);

    let old_name = run_git_ok(&repo_root_path, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();

    if old_name == "HEAD" {
        anyhow::bail!("cannot rename a detached HEAD");
    }

    run_git_ok(&repo_root_path, &["branch", "-m", new_name])?;

    Ok((old_name, new_name.to_string()))
}

fn git_command_message(stderr: &str, fallback: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}
