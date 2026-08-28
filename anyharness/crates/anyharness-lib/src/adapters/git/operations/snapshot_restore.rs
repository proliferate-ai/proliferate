use std::path::Path;
use std::process::Command;

use super::snapshot::{ancestor_repo_guard, WorkspaceSnapshot};
use crate::adapters::git::types::SnapshotError;

/// Restore `workspace_path`'s disk and index to exactly what `snap` captured.
/// Precondition, owned by the caller's scenario tiers: HEAD already sits at
/// the archived SHA.
pub fn restore_snapshot(
    workspace_path: &Path,
    snap: &WorkspaceSnapshot,
) -> Result<(), SnapshotError> {
    restore_trees(workspace_path, &snap.work_tree, &snap.index_tree)
}

/// The tree-source variant for R4's ref-driven restore, which holds resolved
/// ref OIDs rather than a `WorkspaceSnapshot`. Both arguments are peeled via
/// `^{tree}` unconditionally: correct for a bare tree (identity) and for an
/// LFS anchor commit (yields exactly the wrapped tree).
pub fn restore_trees(
    workspace_path: &Path,
    work_tree: &str,
    index_tree: &str,
) -> Result<(), SnapshotError> {
    ancestor_repo_guard(workspace_path)?;
    let work_tree = peel_to_tree(workspace_path, work_tree)?;
    let index_tree = peel_to_tree(workspace_path, index_tree)?;

    // ORDER IS THE INVARIANT: read-tree always rewrites the index, so the
    // index-only step must come last. No `reset --hard`: it would force-move
    // the checked-out branch and double the checkout for nothing.
    run_git(
        workspace_path,
        &["read-tree", "--reset", "-u", &work_tree],
        "restore the working tree",
    )?;
    // Single `-f`: `-ff` would also delete nested git repos, and an embedded
    // repo surviving on disk at restore time is user data.
    run_git(workspace_path, &["clean", "-fd"], "clear stray extras")?;
    run_git(
        workspace_path,
        &["read-tree", "--reset", &index_tree],
        "restore the staged index",
    )?;
    Ok(())
}

fn peel_to_tree(workspace_path: &Path, oid: &str) -> Result<String, SnapshotError> {
    let output = Command::new("git")
        .current_dir(workspace_path)
        .args(["rev-parse", "--verify", &format!("{oid}^{{tree}}")])
        .output()
        .map_err(|error| {
            SnapshotError::Internal(anyhow::anyhow!("git rev-parse failed: {error}"))
        })?;
    if !output.status.success() {
        return Err(SnapshotError::Internal(anyhow::anyhow!(
            "could not resolve tree for {oid}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_git(workspace_path: &Path, args: &[&str], action: &str) -> Result<(), SnapshotError> {
    let output = Command::new("git")
        .current_dir(workspace_path)
        .args(args)
        .output()
        .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("failed to {action}: {error}")))?;
    if !output.status.success() {
        return Err(SnapshotError::Internal(anyhow::anyhow!(
            "failed to {action}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}
