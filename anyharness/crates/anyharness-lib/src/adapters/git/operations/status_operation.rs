use std::path::{Path, PathBuf};
use std::process::Command;

use super::super::types::GitOperation;

/// One shared sentinel table, read once per call, that both projections in
/// this file are built from: `detect_operation`'s byte-identical five-variant
/// answer for the three live wire-facing callers, and the richer
/// business-rule projection the archive probe reads (`conflict_sentinel`).
/// Every path resolves per-worktree via git's own git-path resolution: these
/// files live under `.git/worktrees/<name>/`, not the common dir, so a
/// common-dir check would both miss this worktree's conflicts and
/// false-positive on a sibling's. None of MERGE_HEAD, CHERRY_PICK_HEAD,
/// REVERT_HEAD, rebase-merge/apply, sequencer, or BISECT_LOG are on git's
/// "common" file list, so resolving the worktree's own git-dir once and
/// joining each sentinel name is equivalent to `rev-parse --git-path <name>`
/// per name, without spawning a process per sentinel.
struct SentinelTable {
    merge_head: bool,
    rebase: bool,
    cherry_pick: bool,
    revert: bool,
    sequencer: bool,
    bisect_log: bool,
    unmerged_entries: bool,
}

fn read_sentinel_table(worktree: &Path) -> SentinelTable {
    let git_dir = resolve_worktree_git_dir(worktree);
    let exists = |name: &str| {
        git_dir
            .as_ref()
            .map(|dir| dir.join(name).exists())
            .unwrap_or(false)
    };
    SentinelTable {
        merge_head: exists("MERGE_HEAD"),
        rebase: exists("rebase-merge") || exists("rebase-apply"),
        cherry_pick: exists("CHERRY_PICK_HEAD"),
        revert: exists("REVERT_HEAD"),
        sequencer: exists("sequencer"),
        bisect_log: exists("BISECT_LOG"),
        unmerged_entries: has_unmerged_entries(worktree),
    }
}

/// The absolute per-worktree git admin directory (`.git/worktrees/<name>` for
/// a linked worktree, `.git` for the primary checkout) — the resolution root
/// `rev-parse --git-path <name>` maps every per-worktree sentinel onto.
fn resolve_worktree_git_dir(worktree: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .args([
            "-C",
            &worktree.display().to_string(),
            "rev-parse",
            "--path-format=absolute",
            "--absolute-git-dir",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(raw))
    }
}

/// Resolve one sentinel path via git's own git-path resolution, for callers
/// outside this module that need the resolved path itself rather than a
/// bare existence check (kill-debris repair reaps lock files by path).
pub(super) fn resolve_worktree_git_path(worktree: &Path, name: &str) -> Option<PathBuf> {
    resolve_worktree_git_dir(worktree).map(|dir| dir.join(name))
}

/// Belt-and-braces check: unmerged index stages cannot exist inside a tree
/// object, so this can never disagree with the sentinel files above, but it
/// catches the rare case where a conflict's sentinel file was already cleaned
/// up (e.g. a `--quit`) while unmerged stages remain.
fn has_unmerged_entries(worktree: &Path) -> bool {
    Command::new("git")
        .args(["-C", &worktree.display().to_string(), "ls-files", "-u"])
        .output()
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false)
}

/// `detect_operation` keeps its exact current signature, visibility, and
/// five-variant projection, so its three live callers (`status.rs`,
/// `status_summary.rs`, `revert_patches.rs`) see byte-identical behavior. The
/// new `sequencer`/`BISECT_LOG`/unmerged-entries evidence never changes this
/// answer; it only feeds the richer projection below.
pub(super) fn detect_operation(repo_root: &Path) -> GitOperation {
    let table = read_sentinel_table(repo_root);
    if table.merge_head {
        GitOperation::Merge
    } else if table.rebase {
        GitOperation::Rebase
    } else if table.cherry_pick {
        GitOperation::CherryPick
    } else if table.revert {
        GitOperation::Revert
    } else {
        GitOperation::None
    }
}

/// The richer, archive-facing answer: a second projection over the same
/// sentinel table `detect_operation` reads, extended with `sequencer/`,
/// `BISECT_LOG`, and the `ls-files -u` belt-and-braces check. This is what
/// `snapshot.rs`'s probe and in-capture refusal both key off; it must never
/// disagree with `detect_operation` for the cases they share.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ConflictSentinel {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Sequencer,
    Bisect,
    UnmergedEntries,
}

impl ConflictSentinel {
    /// The label used in `SnapshotError::GitOperationInProgress { operation }`.
    pub(super) fn label(self) -> &'static str {
        match self {
            ConflictSentinel::Merge => "merge",
            ConflictSentinel::Rebase => "rebase",
            ConflictSentinel::CherryPick => "cherry-pick",
            ConflictSentinel::Revert => "revert",
            ConflictSentinel::Sequencer => "sequencer",
            ConflictSentinel::Bisect => "bisect",
            ConflictSentinel::UnmergedEntries => "unmerged entries",
        }
    }

    /// Whether kill-debris repair may ever auto-abort this sentinel, even
    /// with kill evidence. Bisect is excluded: `bisect reset` is a
    /// destructive checkout, not a metadata clear.
    pub(super) fn is_auto_repairable(self) -> bool {
        !matches!(
            self,
            ConflictSentinel::Bisect | ConflictSentinel::UnmergedEntries
        )
    }
}

pub(super) fn conflict_sentinel(worktree: &Path) -> Option<ConflictSentinel> {
    let table = read_sentinel_table(worktree);
    if table.merge_head {
        Some(ConflictSentinel::Merge)
    } else if table.rebase {
        Some(ConflictSentinel::Rebase)
    } else if table.cherry_pick {
        Some(ConflictSentinel::CherryPick)
    } else if table.revert {
        Some(ConflictSentinel::Revert)
    } else if table.sequencer {
        Some(ConflictSentinel::Sequencer)
    } else if table.bisect_log {
        Some(ConflictSentinel::Bisect)
    } else if table.unmerged_entries {
        Some(ConflictSentinel::UnmergedEntries)
    } else {
        None
    }
}
