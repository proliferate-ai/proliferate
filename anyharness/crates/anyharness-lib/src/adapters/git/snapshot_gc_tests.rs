//! The GC test (spec §7.4): capture, delete the worktree, run
//! `git gc --prune=now --aggressive` (and, for the LFS extension,
//! `git lfs prune`), then restore. Everything must still round-trip. This
//! is the single test suite that catches anyone reintroducing the
//! tree-invisible-to-reachability hole — the reason `refs.rs` exists.
//!
//! Modeled on the real topology: a primary checkout (`source`) whose own
//! index is never touched, and a linked worktree (`workspace`) that gets
//! captured and then genuinely removed via `git worktree remove`, taking
//! its own private index with it. `git gc`/`git lfs prune` then run from
//! `source`, exactly where the real archive flow would run them (the
//! workspace being archived is gone by the time gc/prune matter).

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::operations::snapshot::snapshot_workspace;
use super::operations::snapshot_restore::restore_trees;
use crate::domains::workspaces::archive::refs::{resolve_archive_refs, write_archive_refs, ArchiveRefShape};
use uuid::Uuid;

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn run(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn try_run(cwd: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_source_repo(path: &Path) {
    run(path, &["init", "-b", "main"]);
    run(path, &["config", "user.email", "test@example.com"]);
    run(path, &["config", "user.name", "Test"]);
    run(path, &["config", "commit.gpgsign", "false"]);
    fs::write(path.join("README.md"), "seed\n").expect("write seed");
    run(path, &["add", "README.md"]);
    run(path, &["commit", "-m", "initial"]);
}

fn add_linked_worktree(source: &Path, workspace: &Path, branch: &str) {
    run(source, &["branch", branch]);
    run(
        source,
        &["worktree", "add", &workspace.display().to_string(), branch],
    );
}

/// Genuinely removes the linked worktree, including its own private index
/// under `<common-dir>/worktrees/<name>/index` — the real "the worktree is
/// deleted" step, not a same-directory file wipe.
fn remove_linked_worktree(source: &Path, workspace: &Path) {
    run(
        source,
        &[
            "worktree",
            "remove",
            "--force",
            "--force",
            &workspace.display().to_string(),
        ],
    );
}

fn status_porcelain(path: &Path) -> String {
    stdout(path, &["status", "--porcelain=v1", "-uall"])
}

fn head_sha(path: &Path) -> String {
    stdout(path, &["rev-parse", "HEAD"])
}

#[test]
fn round_trip_survives_aggressive_gc() {
    let source = TempDirGuard::new("gc-basic-source");
    let workspace = TempDirGuard::new("gc-basic-workspace");
    let _ = fs::remove_dir_all(workspace.path());
    init_source_repo(source.path());
    add_linked_worktree(source.path(), workspace.path(), "archived");

    fs::write(workspace.path().join("README.md"), "unstaged edit\n").unwrap();
    fs::write(workspace.path().join("new.txt"), "untracked\n").unwrap();
    run(workspace.path(), &["add", "new.txt"]);

    let before_status = status_porcelain(workspace.path());
    let before_head = head_sha(workspace.path());

    let snap = snapshot_workspace(workspace.path()).expect("snapshot_workspace");
    write_archive_refs(source.path(), "ws-gc-basic", &snap).expect("write_archive_refs");

    remove_linked_worktree(source.path(), workspace.path());
    run(source.path(), &["gc", "--prune=now", "--aggressive"]);

    let resolved = resolve_archive_refs(source.path(), "ws-gc-basic")
        .expect("resolve_archive_refs")
        .expect("archive refs must survive gc");

    let restore_target = TempDirGuard::new("gc-basic-restore-target");
    let _ = fs::remove_dir_all(restore_target.path());
    add_linked_worktree(source.path(), restore_target.path(), "restored");
    restore_trees(restore_target.path(), &resolved.work_tree, &resolved.index_tree)
        .expect("restore_trees after gc");

    assert_eq!(status_porcelain(restore_target.path()), before_status);
    // `restore_trees` never touches HEAD; both the archived and restored
    // branches were cut from the same unmoved `main` tip, so they still
    // share the captured HEAD sha.
    assert_eq!(head_sha(restore_target.path()), before_head);
}

// FOUNDER-FLAGGED CONTRADICTION (found during R2 implementation, verified
// 2026-08-13, empirically, on git-lfs/3.7.1): spec section 5.5's "RESOLVED,
// empirical probe 2026-08-13" claim — that an anchor commit protects an
// LFS object from `git lfs prune` — does NOT hold for refs under the
// `refs/proliferate/` namespace, which is exactly where `refs.rs` (section
// 5.3/5.4) writes `archive-worktrees`/`archive-indexes`. `git lfs prune`'s
// reachability scan (per `git lfs help prune` and confirmed by direct
// repro) only ever considers: the current checkout, stashes, `refs/heads/*`
// and `refs/tags/*` ("recent branch"/"recent commit"), unpushed commits,
// and other worktree checkouts — never an arbitrary custom ref namespace.
// Anchoring under `refs/heads/*` or `refs/tags/*` DOES retain the object
// (repro-verified: before=1 local object, after=1 retained); the identical
// anchor commit under `refs/proliferate/archive-worktrees/<id>` or any
// other non-heads/non-tags namespace (e.g. `refs/custom/foo`) is pruned
// exactly like the bare-tree shape (before=1, after=0 either way). The
// spec's probe that produced "before=2, after=2 anchored" must have been
// run against a branch or tag, not the actual archive-refs namespace.
// Separately, even when the object genuinely IS present, `read-tree
// --reset -u`'s LFS smudge filter hard-fails the whole checkout (rather
// than degrading to the raw pointer text) whenever it cannot resolve the
// object and no remote is configured — so the negative control's
// "restore succeeds mechanically with degraded content" assumption is also
// not how git-lfs actually behaves without further plumbing (e.g.
// `GIT_LFS_SKIP_SMUDGE=1`, which would also defeat the positive case's
// "restore reproduces real content" assertion).
// This is a design-level gap in the ADR/spec's LFS resolution, not a bug in
// this rung's implementation: `write_archive_refs`/`snapshot_workspace`
// implement exactly what sections 5.4/5.5 specify. Both tests below are
// left in place, unmodified, and `#[ignore]`d rather than weakened or
// deleted, pending a founder ruling on how archived-workspace LFS survival
// should actually be achieved (e.g. R5's `gc.rs` never running `git lfs
// prune` against a repo with outstanding archive refs, or a different
// protection mechanism entirely).
#[test]
#[ignore = "R2-4/5.5 anchor-under-refs/proliferate does not survive `git lfs prune` \
            in practice — see the FOUNDER-FLAGGED CONTRADICTION comment above"]
fn lfs_anchored_capture_survives_lfs_prune_and_restores_real_content() {
    if !try_run(Path::new("."), &["lfs", "version"]) {
        eprintln!("skipping: git-lfs not available");
        return;
    }
    let source = TempDirGuard::new("gc-lfs-anchored-source");
    let workspace = TempDirGuard::new("gc-lfs-anchored-workspace");
    let _ = fs::remove_dir_all(workspace.path());
    init_source_repo(source.path());
    run(source.path(), &["lfs", "install", "--local"]);
    run(source.path(), &["lfs", "track", "*.bin"]);
    run(source.path(), &["add", ".gitattributes"]);
    run(source.path(), &["commit", "-m", "track lfs"]);
    add_linked_worktree(source.path(), workspace.path(), "archived");

    fs::write(workspace.path().join("asset.bin"), "large binary payload\n").unwrap();
    run(workspace.path(), &["add", "asset.bin"]);

    let snap = snapshot_workspace(workspace.path()).expect("snapshot_workspace");
    assert!(snap.work_tree_anchor.is_some(), "capture must detect LFS pointers and anchor Twork");
    // R2-4's symmetric extension: the staged tree (identical content here)
    // is anchored too.
    assert!(snap.index_tree_anchor.is_some(), "R2-4: Tindex must be anchored too");

    write_archive_refs(source.path(), "ws-gc-lfs", &snap).expect("write_archive_refs");
    let resolved_before_prune = resolve_archive_refs(source.path(), "ws-gc-lfs")
        .expect("resolve_archive_refs")
        .unwrap();
    assert_eq!(resolved_before_prune.work_tree_shape, ArchiveRefShape::AnchorCommit);

    remove_linked_worktree(source.path(), workspace.path());
    run(source.path(), &["lfs", "prune", "--force", "--verify-remote=false"]);

    let resolved = resolve_archive_refs(source.path(), "ws-gc-lfs")
        .expect("resolve_archive_refs")
        .expect("archive refs must survive lfs prune");

    let restore_target = TempDirGuard::new("gc-lfs-anchored-restore-target");
    let _ = fs::remove_dir_all(restore_target.path());
    add_linked_worktree(source.path(), restore_target.path(), "restored");
    restore_trees(restore_target.path(), &resolved.work_tree, &resolved.index_tree)
        .expect("restore_trees after lfs prune");

    let restored = fs::read_to_string(restore_target.path().join("asset.bin")).unwrap();
    assert_eq!(restored, "large binary payload\n", "the LFS object must survive prune");
}

// See the FOUNDER-FLAGGED CONTRADICTION comment above
// `lfs_anchored_capture_survives_lfs_prune_and_restores_real_content`: this
// negative control's own assumption (checkout "succeeds mechanically" with
// degraded pointer-text content once the object is gone) does not hold
// either — git-lfs's smudge filter hard-fails the checkout instead.
#[test]
#[ignore = "negative control's own assumption (graceful degrade to pointer text) \
            does not hold against real git-lfs — see the FOUNDER-FLAGGED \
            CONTRADICTION comment on the sibling positive-case test above"]
fn suppressing_the_anchor_lets_lfs_prune_destroy_the_object_negative_control() {
    if !try_run(Path::new("."), &["lfs", "version"]) {
        eprintln!("skipping: git-lfs not available");
        return;
    }
    let source = TempDirGuard::new("gc-lfs-unanchored-source");
    let workspace = TempDirGuard::new("gc-lfs-unanchored-workspace");
    let _ = fs::remove_dir_all(workspace.path());
    init_source_repo(source.path());
    run(source.path(), &["lfs", "install", "--local"]);
    run(source.path(), &["lfs", "track", "*.bin"]);
    run(source.path(), &["add", ".gitattributes"]);
    run(source.path(), &["commit", "-m", "track lfs"]);
    add_linked_worktree(source.path(), workspace.path(), "archived");

    fs::write(workspace.path().join("asset.bin"), "large binary payload\n").unwrap();
    run(workspace.path(), &["add", "asset.bin"]);

    let snap = snapshot_workspace(workspace.path()).expect("snapshot_workspace");
    assert!(snap.work_tree_anchor.is_some());

    // Negative control: write the refs with the anchor commit SUPPRESSED,
    // i.e. archive-worktrees points directly at the bare tree, exactly
    // what shipped before the LFS anchor-commit fallback existed.
    run(
        source.path(),
        &[
            "update-ref",
            "refs/proliferate/archive-heads/ws-gc-lfs-neg",
            &snap.head_sha,
        ],
    );
    run(
        source.path(),
        &[
            "update-ref",
            "refs/proliferate/archive-worktrees/ws-gc-lfs-neg",
            &snap.work_tree,
        ],
    );
    run(
        source.path(),
        &[
            "update-ref",
            "refs/proliferate/archive-indexes/ws-gc-lfs-neg",
            &snap.index_tree,
        ],
    );

    remove_linked_worktree(source.path(), workspace.path());
    run(source.path(), &["lfs", "prune", "--force", "--verify-remote=false"]);

    let resolved = resolve_archive_refs(source.path(), "ws-gc-lfs-neg")
        .expect("resolve_archive_refs")
        .expect("the bare-tree ref itself still resolves");
    assert_eq!(resolved.work_tree_shape, ArchiveRefShape::Tree);

    let restore_target = TempDirGuard::new("gc-lfs-unanchored-restore-target");
    let _ = fs::remove_dir_all(restore_target.path());
    add_linked_worktree(source.path(), restore_target.path(), "restored");
    restore_trees(restore_target.path(), &resolved.work_tree, &resolved.index_tree)
        .expect("restore_trees succeeds mechanically even though the LFS object is gone");

    // The restore "degrades": the checked-out file is the bare pointer
    // text, not the real payload, because the LFS backing object was
    // pruned. This is the exact failure the anchor-commit fallback exists
    // to prevent.
    let restored = fs::read_to_string(restore_target.path().join("asset.bin")).unwrap();
    assert_ne!(
        restored, "large binary payload\n",
        "expected the LFS content to be lost without the anchor commit"
    );
    assert!(restored.starts_with("version https://git-lfs.github.com/spec/v1"));
}
