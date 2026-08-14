use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;

use super::snapshot_repair::{reap_lock_files, repair_conflict_sentinel};
use super::status_operation::{conflict_sentinel, resolve_worktree_git_path};
use crate::adapters::git::types::{QuiesceReport, SnapshotError, SnapshotNotice};

/// A stable, AnyHarness-owned, non-personal Git identity for LFS anchor
/// commits, matching the scratch-identity precedent
/// (`operations/scratch.rs:14-15`).
const ANCHOR_IDENTITY_NAME: &str = "AnyHarness Archive";
const ANCHOR_IDENTITY_EMAIL: &str = "archive@anyharness.local";

/// A capture of a workspace's git state: HEAD, branch, the exact staged
/// tree, and the working tree (staged ∪ unstaged ∪ untracked non-ignored).
#[derive(Debug, Clone)]
pub struct WorkspaceSnapshot {
    pub head_sha: String,
    pub branch: Option<String>,
    pub work_tree: String,
    pub index_tree: String,
    pub notices: Vec<SnapshotNotice>,
    /// Some(oid) when the capture contained LFS pointer files and the
    /// working tree was wrapped in a lightweight anchor commit; None for the
    /// bare-tree common case.
    pub work_tree_anchor: Option<String>,
    /// The R2-4 symmetric extension: the same LFS detection bit also governs
    /// the staged tree, so a half-staged LFS file's OLD pointer stays
    /// reachable through `archive-indexes/<id>` too.
    pub index_tree_anchor: Option<String>,
}

impl WorkspaceSnapshot {
    /// Folds the `partial_capture_*` notices into the row-persisted shape
    /// `{"tracked": [...], "untracked": [...]}`; `None` when no skips.
    pub fn partial_capture_json(&self) -> Option<String> {
        let mut tracked: Vec<&str> = Vec::new();
        let mut untracked: Vec<&str> = Vec::new();
        for notice in &self.notices {
            match notice {
                SnapshotNotice::PartialCaptureTracked { paths } => {
                    tracked.extend(paths.iter().map(String::as_str))
                }
                SnapshotNotice::PartialCaptureUntracked { paths } => {
                    untracked.extend(paths.iter().map(String::as_str))
                }
                _ => {}
            }
        }
        if tracked.is_empty() && untracked.is_empty() {
            return None;
        }
        Some(serde_json::json!({ "tracked": tracked, "untracked": untracked }).to_string())
    }

    /// The OID `archive-worktrees/<id>` is written to: the anchor commit
    /// when present, otherwise the bare working tree tree.
    pub fn work_tree_ref_oid(&self) -> &str {
        self.work_tree_anchor.as_deref().unwrap_or(&self.work_tree)
    }

    /// The OID `archive-indexes/<id>` is written to (R2-4's symmetric
    /// extension of the same rule).
    pub fn index_tree_ref_oid(&self) -> &str {
        self.index_tree_anchor.as_deref().unwrap_or(&self.index_tree)
    }
}

/// Verify the physical `git rev-parse --show-toplevel` equals
/// `workspace_path` (covers symlinks via canonicalization). A hollow checkout
/// under a git-controlled ancestor would otherwise silently snapshot — and
/// `restore_snapshot` would destructively rewrite — the WRONG repo.
pub(super) fn ancestor_repo_guard(workspace_path: &Path) -> Result<(), SnapshotError> {
    let hollow = || SnapshotError::HollowCheckout {
        path: workspace_path.display().to_string(),
    };
    let canonical_workspace = std::fs::canonicalize(workspace_path).map_err(|_| hollow())?;
    let output = Command::new("git")
        .current_dir(&canonical_workspace)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git rev-parse failed: {error}")))?;
    if !output.status.success() {
        return Err(hollow());
    }
    let toplevel_raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let toplevel = std::fs::canonicalize(&toplevel_raw).map_err(|_| hollow())?;
    if toplevel != canonical_workspace {
        return Err(hollow());
    }
    Ok(())
}

fn is_unborn_head(workspace_path: &Path) -> Result<bool, SnapshotError> {
    let output = Command::new("git")
        .current_dir(workspace_path)
        .args(["rev-parse", "--verify", "-q", "HEAD"])
        .output()
        .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git rev-parse HEAD failed: {error}")))?;
    Ok(!output.status.success())
}

/// The read-only surface covering all three business-rule refusals (hollow
/// checkout, conflict-bearing operation, unborn HEAD), so a caller can refuse
/// before quiescing anything. Writes nothing to the worktree. Lock files are
/// deliberately not a probe refusal — `repair_kill_debris` reaps them after
/// quiesce.
pub fn probe_refusals(workspace_path: &Path) -> Result<(), SnapshotError> {
    ancestor_repo_guard(workspace_path)?;
    if let Some(sentinel) = conflict_sentinel(workspace_path) {
        return Err(SnapshotError::GitOperationInProgress {
            operation: sentinel.label().to_string(),
        });
    }
    if is_unborn_head(workspace_path)? {
        return Err(SnapshotError::UnbornHead);
    }
    Ok(())
}

pub fn snapshot_workspace(workspace_path: &Path) -> Result<WorkspaceSnapshot, SnapshotError> {
    ancestor_repo_guard(workspace_path)?;
    if let Some(sentinel) = conflict_sentinel(workspace_path) {
        return Err(SnapshotError::GitOperationInProgress {
            operation: sentinel.label().to_string(),
        });
    }

    let index_tree = git_write_tree(workspace_path, None)?;
    let (work_tree, mut notices, temp_index) = capture_work_tree(workspace_path, &index_tree)?;
    notices.extend(detect_gitlink_notices(workspace_path, &work_tree, &index_tree));

    let has_lfs = detect_lfs_pointers(workspace_path, &temp_index, &work_tree);
    let _ = std::fs::remove_file(&temp_index);

    let (work_tree_anchor, index_tree_anchor) = if has_lfs {
        let label = anchor_label(workspace_path);
        (
            Some(create_anchor_commit(workspace_path, &work_tree, &label)?),
            Some(create_anchor_commit(workspace_path, &index_tree, &label)?),
        )
    } else {
        (None, None)
    };

    if is_unborn_head(workspace_path)? {
        return Err(SnapshotError::UnbornHead);
    }
    let head_sha = git_rev_parse(workspace_path, "HEAD")?;
    let branch = resolve_branch(workspace_path);

    Ok(WorkspaceSnapshot {
        head_sha,
        branch,
        work_tree,
        index_tree,
        notices,
        work_tree_anchor,
        index_tree_anchor,
    })
}

fn anchor_label(workspace_path: &Path) -> String {
    workspace_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string())
}

fn git_write_tree(workspace_path: &Path, index_file: Option<&Path>) -> Result<String, SnapshotError> {
    let mut cmd = Command::new("git");
    cmd.current_dir(workspace_path);
    if let Some(index_file) = index_file {
        cmd.env("GIT_INDEX_FILE", index_file);
    }
    cmd.arg("write-tree");
    let output = cmd
        .output()
        .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git write-tree failed to run: {error}")))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    // Exit 128 is byte-identical for a locked index and for every other
    // fatal write-tree failure (a corrupt index, a broken object store,
    // unmerged entries left by a `--quit`), so the mapping is CONDITIONAL on
    // a real stat of the lock path — the same stat-conditional shape
    // `remove_worktree_force` uses. Claiming `GitLocked` without the file
    // would tell the user to delete a path that does not exist and would
    // suppress the retryable generic path.
    if output.status.code() == Some(128) {
        if let Some(file) = resolve_worktree_git_path(workspace_path, "index.lock") {
            if file.exists() {
                return Err(SnapshotError::GitLocked {
                    file: file.display().to_string(),
                });
            }
        }
    }
    Err(SnapshotError::Internal(anyhow::anyhow!(
        "git write-tree failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

/// Seed a fresh temp index from `index_tree`, `add -A --ignore-errors`, then
/// `write-tree` it into the working tree tree. Returns the temp index path so
/// LFS detection can run against the same content before cleanup.
fn capture_work_tree(
    workspace_path: &Path,
    index_tree: &str,
) -> Result<(String, Vec<SnapshotNotice>, PathBuf), SnapshotError> {
    let temp_index = std::env::temp_dir().join(format!("anyharness-snapshot-index-{}", uuid::Uuid::new_v4()));
    // Seed by COPYING the real index when one exists: the copy carries git's
    // stat cache, so the `git add -A` below only re-hashes paths whose stat
    // data actually changed. A `read-tree` seed is tree-identical (index_tree
    // was just written from this same index) but stat-empty, which forces a
    // full re-hash of every tracked file — seconds on a large worktree.
    let real_index = resolve_worktree_git_path(workspace_path, "index");
    let seeded_by_copy = real_index
        .as_deref()
        .is_some_and(|index| std::fs::copy(index, &temp_index).is_ok());
    if seeded_by_copy {
        // The copy also carries skip-worktree bits, and `git add -A` honors
        // them — it would keep the INDEX content for those paths and silently
        // drop their on-disk edits from the capture (spec §6.8 only cedes the
        // BIT across the round trip, never content). Clear the bits in the
        // capture index so those paths are re-examined like every other.
        let flagged = Command::new("git")
            .current_dir(workspace_path)
            .env("GIT_INDEX_FILE", &temp_index)
            .env("LC_ALL", "C")
            .args(["ls-files", "-v", "-z"])
            .output()
            .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git ls-files -v failed to run: {error}")))?;
        let skip_worktree_paths: Vec<String> = flagged
            .stdout
            .split(|byte| *byte == 0)
            .filter_map(|entry| {
                let entry = String::from_utf8_lossy(entry);
                let (tag, path) = entry.split_once(' ')?;
                (tag == "S" || tag == "s").then(|| path.to_string())
            })
            .collect();
        if !skip_worktree_paths.is_empty() {
            let mut unset = Command::new("git");
            unset
                .current_dir(workspace_path)
                .env("GIT_INDEX_FILE", &temp_index)
                .args(["update-index", "--no-skip-worktree", "--"])
                .args(&skip_worktree_paths);
            let unset = unset
                .output()
                .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git update-index --no-skip-worktree failed to run: {error}")))?;
            if !unset.status.success() {
                return Err(SnapshotError::Internal(anyhow::anyhow!(
                    "git update-index --no-skip-worktree failed: {}",
                    String::from_utf8_lossy(&unset.stderr).trim()
                )));
            }
        }
    } else {
        let seed = Command::new("git")
            .current_dir(workspace_path)
            .env("GIT_INDEX_FILE", &temp_index)
            .args(["read-tree", index_tree])
            .output()
            .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git read-tree failed to run: {error}")))?;
        if !seed.status.success() {
            return Err(SnapshotError::Internal(anyhow::anyhow!(
                "git read-tree failed: {}",
                String::from_utf8_lossy(&seed.stderr).trim()
            )));
        }
    }

    let add = Command::new("git")
        .current_dir(workspace_path)
        .env("GIT_INDEX_FILE", &temp_index)
        .env("LC_ALL", "C")
        .args(["add", "-A", "--ignore-errors"])
        .output()
        .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git add failed to run: {error}")))?;
    // `--ignore-errors` degrades hard failures to exit 1 with paths skipped;
    // any other nonzero exit is unexpected.
    if !add.status.success() && add.status.code() != Some(1) {
        return Err(SnapshotError::Internal(anyhow::anyhow!(
            "git add -A --ignore-errors failed: {}",
            String::from_utf8_lossy(&add.stderr).trim()
        )));
    }

    let work_tree = git_write_tree(workspace_path, Some(&temp_index))?;
    let notices = classify_partial_capture(
        workspace_path,
        index_tree,
        &String::from_utf8_lossy(&add.stderr),
    );
    Ok((work_tree, notices, temp_index))
}

/// Parse the two `add -A --ignore-errors` stderr shapes: an unreadable file
/// (`error: open("<path>"): Permission denied` plus a companion
/// `unable to index file '<path>'` line, deduped to one skip) and an unborn
/// embedded repo (`error: '<path>' does not have a commit checked out`,
/// trailing slash stripped).
fn parse_partial_capture_skips(stderr: &str) -> BTreeSet<String> {
    let mut skips = BTreeSet::new();
    for line in stderr.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("error: open(\"") {
            if let Some(end) = rest.find("\")") {
                skips.insert(rest[..end].to_string());
                continue;
            }
        }
        if let Some(rest) = line.strip_prefix("error: unable to index file '") {
            if let Some(end) = rest.find('\'') {
                skips.insert(rest[..end].to_string());
                continue;
            }
        }
        if let Some(rest) = line.strip_prefix("error: '") {
            if let Some(end) = rest.find("' does not have a commit checked out") {
                skips.insert(rest[..end].trim_end_matches('/').to_string());
            }
        }
    }
    skips
}

fn classify_partial_capture(
    workspace_path: &Path,
    index_tree: &str,
    stderr: &str,
) -> Vec<SnapshotNotice> {
    let skips = parse_partial_capture_skips(stderr);
    if skips.is_empty() {
        return Vec::new();
    }
    let mut tracked = Vec::new();
    let mut untracked = Vec::new();
    for path in skips {
        if path_tracked_in_tree(workspace_path, index_tree, &path) {
            tracked.push(path);
        } else {
            untracked.push(path);
        }
    }
    let mut notices = Vec::new();
    if !tracked.is_empty() {
        notices.push(SnapshotNotice::PartialCaptureTracked { paths: tracked });
    }
    if !untracked.is_empty() {
        notices.push(SnapshotNotice::PartialCaptureUntracked { paths: untracked });
    }
    notices
}

fn path_tracked_in_tree(workspace_path: &Path, tree: &str, path: &str) -> bool {
    Command::new("git")
        .current_dir(workspace_path)
        .args(["ls-tree", "-r", "--name-only", tree, "--", path])
        .output()
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false)
}

/// Diff the working tree's gitlink (mode `160000`) entries against the
/// staged tree's: one present only in the working tree is an embedded repo
/// (never registered); one present in both at a different SHA is a dirty or
/// ahead submodule.
fn detect_gitlink_notices(
    workspace_path: &Path,
    work_tree: &str,
    index_tree: &str,
) -> Vec<SnapshotNotice> {
    let work_links = gitlink_entries(workspace_path, work_tree);
    let index_links = gitlink_entries(workspace_path, index_tree);
    let mut embedded = Vec::new();
    let mut dirty = Vec::new();
    for (path, work_sha) in &work_links {
        match index_links.get(path) {
            None => embedded.push(path.clone()),
            Some(recorded) if recorded != work_sha => dirty.push(path.clone()),
            _ => {}
        }
    }
    let mut notices = Vec::new();
    if !embedded.is_empty() {
        notices.push(SnapshotNotice::EmbeddedRepo { paths: embedded });
    }
    if !dirty.is_empty() {
        notices.push(SnapshotNotice::DirtySubmodule { paths: dirty });
    }
    notices
}

fn gitlink_entries(workspace_path: &Path, tree_ish: &str) -> BTreeMap<String, String> {
    let mut entries = BTreeMap::new();
    let Ok(output) = Command::new("git")
        .current_dir(workspace_path)
        .args(["ls-tree", "-r", tree_ish])
        .output()
    else {
        return entries;
    };
    if !output.status.success() {
        return entries;
    }
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((meta, path)) = line.split_once('\t') else {
            continue;
        };
        let mut fields = meta.split_whitespace();
        let (Some(mode), Some(_kind), Some(sha)) = (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if mode == "160000" {
            entries.insert(path.to_string(), sha.to_string());
        }
    }
    entries
}

/// Detection resolves per §5.5 of the delivery spec: the primary
/// `ls-files ':(attr:filter=lfs)'` pathspec magic against the capture's own
/// temp index, falling back to a pointer-blob content sniff on older git.
/// Failure of both is treated as pointers-present.
fn detect_lfs_pointers(workspace_path: &Path, temp_index: &Path, work_tree: &str) -> bool {
    if let Some(has_lfs) = ls_files_lfs_attr(workspace_path, temp_index) {
        return has_lfs;
    }
    sniff_lfs_pointer_blobs(workspace_path, work_tree).unwrap_or(true)
}

fn ls_files_lfs_attr(workspace_path: &Path, temp_index: &Path) -> Option<bool> {
    let output = Command::new("git")
        .current_dir(workspace_path)
        .env("GIT_INDEX_FILE", temp_index)
        .args(["ls-files", "-z", ":(attr:filter=lfs)"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(!output.stdout.is_empty())
}

fn sniff_lfs_pointer_blobs(workspace_path: &Path, tree: &str) -> Option<bool> {
    const LFS_POINTER_PREFIX: &str = "version https://git-lfs.github.com/spec/v1";
    const MAX_POINTER_SIZE: u64 = 1024;

    let output = Command::new("git")
        .current_dir(workspace_path)
        .args(["ls-tree", "-r", "-l", tree])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((meta, _path)) = line.split_once('\t') else {
            continue;
        };
        let mut fields = meta.split_whitespace();
        let (Some(_mode), Some(kind), Some(sha), Some(size)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if kind != "blob" {
            continue;
        }
        let Ok(size) = size.parse::<u64>() else { continue };
        if size > MAX_POINTER_SIZE {
            continue;
        }
        let content = Command::new("git")
            .current_dir(workspace_path)
            .args(["cat-file", "blob", sha])
            .output()
            .ok()?;
        if content.status.success()
            && String::from_utf8_lossy(&content.stdout).starts_with(LFS_POINTER_PREFIX)
        {
            return Some(true);
        }
    }
    Some(false)
}

fn create_anchor_commit(
    workspace_path: &Path,
    tree_oid: &str,
    label: &str,
) -> Result<String, SnapshotError> {
    let output = Command::new("git")
        .current_dir(workspace_path)
        .env("GIT_AUTHOR_NAME", ANCHOR_IDENTITY_NAME)
        .env("GIT_AUTHOR_EMAIL", ANCHOR_IDENTITY_EMAIL)
        .env("GIT_COMMITTER_NAME", ANCHOR_IDENTITY_NAME)
        .env("GIT_COMMITTER_EMAIL", ANCHOR_IDENTITY_EMAIL)
        .args([
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            tree_oid,
            "-m",
            &format!("archive snapshot {label}"),
        ])
        .output()
        .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git commit-tree failed to run: {error}")))?;
    if !output.status.success() {
        return Err(SnapshotError::Internal(anyhow::anyhow!(
            "git commit-tree failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(super) fn resolve_branch(workspace_path: &Path) -> Option<String> {
    let output = Command::new("git")
        .current_dir(workspace_path)
        .args(["symbolic-ref", "-q", "--short", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

fn git_rev_parse(workspace_path: &Path, rev: &str) -> Result<String, SnapshotError> {
    let output = Command::new("git")
        .current_dir(workspace_path)
        .args(["rev-parse", rev])
        .output()
        .map_err(|error| SnapshotError::Internal(anyhow::anyhow!("git rev-parse failed: {error}")))?;
    if !output.status.success() {
        return Err(SnapshotError::Internal(anyhow::anyhow!(
            "git rev-parse {rev} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Called by the archive flow between quiesce and capture. With every
/// runtime-owned process provably dead, this reaps the debris its own
/// SIGKILLs created so the capture that follows is not permanently blocked.
pub fn repair_kill_debris(
    workspace_path: &Path,
    quiesce: &QuiesceReport,
) -> Result<Vec<SnapshotNotice>, SnapshotError> {
    let mut notices = Vec::new();
    if let Some(notice) = repair_conflict_sentinel(workspace_path, quiesce)? {
        notices.push(notice);
    }
    reap_lock_files(workspace_path, quiesce);
    Ok(notices)
}
