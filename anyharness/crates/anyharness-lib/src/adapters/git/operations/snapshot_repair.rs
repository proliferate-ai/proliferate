use std::path::Path;
use std::process::Command;
use std::time::SystemTime;

use super::status_operation::{conflict_sentinel, resolve_worktree_git_path, ConflictSentinel};
use crate::adapters::git::types::{QuiesceReport, SnapshotNotice};

/// A minutes-old lock provably has no living owner (git holds locks for
/// milliseconds), so it is reaped unconditionally.
const ABANDONED_LOCK_AGE: std::time::Duration = std::time::Duration::from_secs(120);

/// Per-worktree lock files `repair_kill_debris` may ever reap. Resolved via
/// the worktree's own admin directory, never the common dir.
const RESCUE_LOCK_NAMES: [&str; 3] = ["index.lock", "HEAD.lock", "MERGE_MSG.lock"];

/// The internals of [`super::snapshot::repair_kill_debris`], split into their
/// own file to keep `snapshot.rs` under `scripts/check_max_lines.py`'s
/// 600-line cap without an allowlist entry.
pub(super) fn repair_conflict_sentinel(
    workspace_path: &Path,
    quiesce: &QuiesceReport,
) -> anyhow::Result<Option<SnapshotNotice>> {
    let Some(sentinel) = conflict_sentinel(workspace_path) else {
        return Ok(None);
    };
    // Bisect is never auto-repaired even with kill evidence: `bisect reset`
    // is a destructive checkout, not a metadata clear. Unmerged index stages
    // alone (no sentinel file) carry no operation to abort.
    if !sentinel.is_auto_repairable() {
        return Ok(None);
    }
    // killed_git > 0 is the ownership proof: zero means no writer of ours
    // could have created this sentinel.
    if quiesce.killed_git == 0 {
        return Ok(None);
    }
    let Some(sentinel_mtime) = conflict_sentinel_mtime(workspace_path, sentinel) else {
        return Ok(None);
    };
    if sentinel_mtime >= quiesce.completed_at {
        return Ok(None);
    }

    if !run_git_ok(workspace_path, abort_args(sentinel)) {
        quit_and_settle(workspace_path, sentinel);
    }
    // The notice is a claim about the END STATE, not about a command's exit
    // status: `merge --abort` can report success while leaving MERGE_HEAD in
    // place, and `quit_and_settle` deliberately discards every step's status
    // (there is no `merge --quit` at all). Re-read the sentinel and only
    // claim the abort if it is actually gone; a surviving sentinel is the
    // generic retryable failure spec §5.1 assigns to a failed abort path,
    // never a notice telling the user it was cleaned up.
    if let Some(surviving) = conflict_sentinel(workspace_path) {
        return Err(anyhow::anyhow!(
            "the stranded {} could not be aborted: the {} sentinel is still present",
            sentinel.label(),
            surviving.label()
        ));
    }
    Ok(Some(SnapshotNotice::AbortedGitOperation {
        operation: sentinel.label().to_string(),
    }))
}

fn abort_args(sentinel: ConflictSentinel) -> &'static [&'static str] {
    match sentinel {
        ConflictSentinel::Merge => &["merge", "--abort"],
        ConflictSentinel::Rebase => &["rebase", "--abort"],
        ConflictSentinel::CherryPick | ConflictSentinel::Sequencer => &["cherry-pick", "--abort"],
        ConflictSentinel::Revert => &["revert", "--abort"],
        ConflictSentinel::Bisect | ConflictSentinel::UnmergedEntries => &[],
    }
}

/// `--abort` failing (a SIGKILL mid-operation leaves half-written state)
/// falls back to `--quit`, then `read-tree --reset HEAD` (settles unmerged
/// stages), then re-attaching HEAD to the pre-operation branch when `--quit`
/// left it detached. Only a rebase (either backend) ever detaches HEAD in
/// the first place — cherry-pick and revert stay on the current branch even
/// mid-conflict — so the pre-operation branch is read from the rebase state
/// dir's own `head-name` bookkeeping BEFORE `--quit` deletes that dir. The
/// reflog is unreliable for this: its most recent "checkout: moving from
/// ... to ..." entry can belong to an unrelated checkout that happened
/// before the rebase even started (repro-verified — a rebase's own start
/// entry reads "rebase (start): checkout <upstream>", not that shape), so
/// scanning it can re-attach HEAD to the WRONG branch.
fn quit_and_settle(workspace_path: &Path, sentinel: ConflictSentinel) {
    let pre_quit_branch = match sentinel {
        ConflictSentinel::Rebase => recover_pre_rebase_branch(workspace_path),
        ConflictSentinel::CherryPick
        | ConflictSentinel::Sequencer
        | ConflictSentinel::Revert
        | ConflictSentinel::Merge
        | ConflictSentinel::Bisect
        | ConflictSentinel::UnmergedEntries => None,
    };
    let quit_args: &[&str] = match sentinel {
        ConflictSentinel::Rebase => &["rebase", "--quit"],
        ConflictSentinel::CherryPick | ConflictSentinel::Sequencer => &["cherry-pick", "--quit"],
        ConflictSentinel::Revert => &["revert", "--quit"],
        ConflictSentinel::Merge | ConflictSentinel::Bisect | ConflictSentinel::UnmergedEntries => &[],
    };
    if !quit_args.is_empty() {
        let _ = run_git_ok(workspace_path, quit_args);
    }
    let _ = run_git_ok(workspace_path, &["read-tree", "--reset", "HEAD"]);
    if super::snapshot::resolve_branch(workspace_path).is_none() {
        if let Some(branch) = pre_quit_branch {
            let _ = run_git_ok(
                workspace_path,
                &["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")],
            );
        }
    }
}

/// Reads `head-name` from whichever rebase state dir is active
/// (`rebase-apply/` or `rebase-merge/`, both backends write it), the exact
/// branch ref git itself recorded before detaching HEAD to start the
/// rebase. Must run BEFORE `--quit`, which deletes the state dir.
fn recover_pre_rebase_branch(workspace_path: &Path) -> Option<String> {
    for state_dir in ["rebase-apply", "rebase-merge"] {
        let Some(head_name_path) = resolve_worktree_git_path(workspace_path, state_dir)
            .map(|dir| dir.join("head-name"))
        else {
            continue;
        };
        let Ok(contents) = std::fs::read_to_string(&head_name_path) else {
            continue;
        };
        let head_name = contents.trim();
        if let Some(branch) = head_name.strip_prefix("refs/heads/") {
            if !branch.is_empty() {
                return Some(branch.to_string());
            }
        }
    }
    None
}

fn conflict_sentinel_mtime(workspace_path: &Path, sentinel: ConflictSentinel) -> Option<SystemTime> {
    let name = match sentinel {
        ConflictSentinel::Merge => "MERGE_HEAD",
        ConflictSentinel::Rebase => {
            return ["rebase-merge", "rebase-apply"]
                .into_iter()
                .find_map(|name| sentinel_path_mtime(workspace_path, name))
        }
        ConflictSentinel::CherryPick => "CHERRY_PICK_HEAD",
        ConflictSentinel::Revert => "REVERT_HEAD",
        ConflictSentinel::Sequencer => "sequencer",
        ConflictSentinel::Bisect => "BISECT_LOG",
        ConflictSentinel::UnmergedEntries => return None,
    };
    sentinel_path_mtime(workspace_path, name)
}

fn sentinel_path_mtime(workspace_path: &Path, name: &str) -> Option<SystemTime> {
    resolve_worktree_git_path(workspace_path, name)
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok())
}

/// Reap lock files per the risk-ordered policy: an old lock (mtime older
/// than [`ABANDONED_LOCK_AGE`]) has no living owner and is unlinked
/// unconditionally; a young lock is unlinked only on kill evidence. Scope
/// guard either way: only per-worktree lock paths are ever touched — a
/// common-dir lock can belong to a sibling worktree's live operation.
pub(super) fn reap_lock_files(workspace_path: &Path, quiesce: &QuiesceReport) {
    for name in RESCUE_LOCK_NAMES {
        let Some(path) = resolve_worktree_git_path(workspace_path, name) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let age = SystemTime::now()
            .duration_since(modified)
            .unwrap_or_default();
        let should_reap =
            age >= ABANDONED_LOCK_AGE || (quiesce.killed_git > 0 && modified < quiesce.completed_at);
        if should_reap {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn run_git_ok(workspace_path: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .current_dir(workspace_path)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}
