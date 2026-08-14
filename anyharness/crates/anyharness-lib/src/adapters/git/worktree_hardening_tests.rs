//! Spec §7.6: the hardened worktree verbs — `remove_worktree_force`'s
//! `AlreadyGone`/fallback mapping and no-repo-global-prune invariant, and
//! `restore_worktree`'s `no_checkout`/detached restore and
//! `prune_target_registration` gate.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use super::operations::worktree_restore::WorktreeRestoreOptions;
use super::types::{GitWorktreeRestoreError, GitWorktreeRestoreOutcome, WorktreeRemoveOutcome};
use super::GitService;

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

fn init_repo(path: &Path) -> String {
    run(path, &["init", "-b", "main"]);
    run(path, &["config", "user.email", "test@example.com"]);
    run(path, &["config", "user.name", "Test"]);
    run(path, &["config", "commit.gpgsign", "false"]);
    fs::write(path.join("README.md"), "seed\n").expect("write seed");
    run(path, &["add", "README.md"]);
    run(path, &["commit", "-m", "initial"]);
    stdout(path, &["rev-parse", "HEAD"])
}

/// Deletes a linked worktree's admin registration directly, leaving its
/// on-disk directory (with its own private `.git` link file) untouched.
/// `git worktree remove` on the resulting state fails with exit 128
/// ("is not a working tree") even though a real directory survives — the
/// exact ambiguity `remove_worktree_force`'s post-stat mapping exists for.
fn delete_admin_registration_only(source: &Path, worktree: &Path) {
    let common_dir = stdout(
        source,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    );
    let admin_root = Path::new(&common_dir).join("worktrees");
    for entry in fs::read_dir(&admin_root).expect("read worktrees admin dir") {
        let entry = entry.expect("read admin entry");
        let gitdir_file = entry.path().join("gitdir");
        let Ok(recorded) = fs::read_to_string(&gitdir_file) else {
            continue;
        };
        let recorded_path = PathBuf::from(recorded.trim());
        let recorded_parent = recorded_path.parent().and_then(|p| fs::canonicalize(p).ok());
        let target_canonical = fs::canonicalize(worktree).ok();
        if recorded_parent.is_some() && recorded_parent == target_canonical {
            fs::remove_dir_all(entry.path()).expect("remove admin registration");
            return;
        }
    }
    panic!("no admin registration found for {}", worktree.display());
}

#[test]
fn remove_worktree_force_maps_missing_registration_and_directory_to_already_gone() {
    let source = TempDirGuard::new("wt-remove-already-gone-source");
    let workspace = TempDirGuard::new("wt-remove-already-gone-workspace");
    let _ = fs::remove_dir_all(workspace.path());
    init_repo(source.path());
    run(source.path(), &["branch", "archived"]);
    run(
        source.path(),
        &["worktree", "add", &workspace.path().display().to_string(), "archived"],
    );

    // Genuinely remove it first, so a second call finds nothing at all —
    // no registration, no directory.
    run(
        source.path(),
        &[
            "worktree",
            "remove",
            "--force",
            "--force",
            &workspace.path().display().to_string(),
        ],
    );
    assert!(!workspace.path().exists());

    let outcome = GitService::remove_worktree_force(
        &source.path().display().to_string(),
        &workspace.path().display().to_string(),
    )
    .expect("remove_worktree_force on an already-gone worktree must not error");
    assert_eq!(outcome, WorktreeRemoveOutcome::AlreadyGone);
}

#[test]
fn remove_worktree_force_falls_back_to_rm_rf_when_exit_128_leaves_a_directory_behind() {
    let source = TempDirGuard::new("wt-remove-fallback-source");
    let workspace = TempDirGuard::new("wt-remove-fallback-workspace");
    let _ = fs::remove_dir_all(workspace.path());
    init_repo(source.path());
    run(source.path(), &["branch", "archived"]);
    run(
        source.path(),
        &["worktree", "add", &workspace.path().display().to_string(), "archived"],
    );

    // Corrupt just the admin registration; the directory (and its content)
    // survives on disk, which is exactly the case exit 128 alone cannot
    // distinguish from "nothing left at all".
    delete_admin_registration_only(source.path(), workspace.path());
    assert!(workspace.path().join("README.md").exists());

    let outcome = GitService::remove_worktree_force(
        &source.path().display().to_string(),
        &workspace.path().display().to_string(),
    )
    .expect("the rm-rf fallback must recover and succeed");
    assert_eq!(outcome, WorktreeRemoveOutcome::Removed);
    assert!(
        !workspace.path().exists(),
        "the fallback must actually remove the directory"
    );

    // The fallback clears the registration too: `worktree list --porcelain`
    // no longer reports the path.
    let listing = stdout(source.path(), &["worktree", "list", "--porcelain"]);
    assert!(
        !listing.contains(&workspace.path().display().to_string()),
        "the registration must be cleared after the fallback, got: {listing}"
    );
}

#[test]
fn remove_worktree_force_never_runs_a_repo_global_prune() {
    let source = TempDirGuard::new("wt-remove-no-global-prune-source");
    let workspace_a = TempDirGuard::new("wt-remove-no-global-prune-a");
    let workspace_c = TempDirGuard::new("wt-remove-no-global-prune-c");
    let _ = fs::remove_dir_all(workspace_a.path());
    let _ = fs::remove_dir_all(workspace_c.path());
    init_repo(source.path());
    run(source.path(), &["branch", "branch-a"]);
    run(source.path(), &["branch", "branch-c"]);
    run(
        source.path(),
        &["worktree", "add", &workspace_a.path().display().to_string(), "branch-a"],
    );
    run(
        source.path(),
        &["worktree", "add", &workspace_c.path().display().to_string(), "branch-c"],
    );

    // Make C's registration stale/prunable WITHOUT going through
    // `remove_worktree_force` — a real `git worktree prune` run from
    // anywhere would clear it immediately.
    fs::remove_dir_all(workspace_c.path()).expect("remove C's directory directly");
    let before = stdout(source.path(), &["worktree", "list", "--porcelain"]);
    assert!(before.contains(&workspace_c.path().display().to_string()));

    let outcome = GitService::remove_worktree_force(
        &source.path().display().to_string(),
        &workspace_a.path().display().to_string(),
    )
    .expect("remove A");
    assert_eq!(outcome, WorktreeRemoveOutcome::Removed);

    // C's stale registration must still be there: removing A did not run a
    // repo-global `worktree prune` that would have swept it up too.
    let after = stdout(source.path(), &["worktree", "list", "--porcelain"]);
    assert!(
        after.contains(&workspace_c.path().display().to_string()),
        "a sibling's stale registration must survive; got: {after}"
    );
}

#[test]
fn restore_worktree_no_checkout_and_no_branch_restores_detached_with_an_empty_index() {
    let source = TempDirGuard::new("wt-restore-no-checkout-source");
    let target = TempDirGuard::new("wt-restore-no-checkout-target");
    let _ = fs::remove_dir_all(target.path());
    let head_sha = init_repo(source.path());

    let outcome = GitService::restore_worktree(
        source.path(),
        target.path(),
        WorktreeRestoreOptions {
            branch: None,
            no_checkout: true,
            prune_target_registration: false,
        },
    )
    .expect("restore_worktree with no_checkout and no branch");
    assert_eq!(outcome, GitWorktreeRestoreOutcome::Restored);

    // Detached at the source repository's HEAD (the caller's job is to
    // park source HEAD at the desired SHA before calling).
    assert_eq!(stdout(target.path(), &["rev-parse", "HEAD"]), head_sha);
    assert!(
        !try_run(target.path(), &["symbolic-ref", "-q", "HEAD"]),
        "HEAD must be detached, not on a branch"
    );

    // Empty index and a bare directory: `restore_snapshot`/`restore_trees`
    // are what write both whole in the next step.
    let index_entries = stdout(target.path(), &["ls-files"]);
    assert!(index_entries.is_empty(), "index must be empty, got: {index_entries}");
    assert!(
        !target.path().join("README.md").exists(),
        "the working directory must stay bare with --no-checkout"
    );
}

/// `prune_target_registration` is target-path-only: a SIBLING path's
/// prunable registration is a refusal in BOTH modes, because deleting it
/// would eat another workspace's registration — the one destructive
/// cross-workspace interaction this design forbids.
#[test]
fn restore_worktree_never_prunes_a_sibling_registration_in_either_mode() {
    let source = TempDirGuard::new("wt-restore-prune-gate-source");
    let stale_path = TempDirGuard::new("wt-restore-prune-gate-stale");
    let target = TempDirGuard::new("wt-restore-prune-gate-target");
    let _ = fs::remove_dir_all(stale_path.path());
    let _ = fs::remove_dir_all(target.path());
    init_repo(source.path());
    run(source.path(), &["branch", "shared-feature"]);
    run(
        source.path(),
        &[
            "worktree",
            "add",
            &stale_path.path().display().to_string(),
            "shared-feature",
        ],
    );
    // Leave a stale, prunable registration for `shared-feature` at
    // `stale_path`, distinct from `target`.
    fs::remove_dir_all(stale_path.path()).expect("remove stale directory directly");

    for prune_target_registration in [false, true] {
        let refused = GitService::restore_worktree(
            source.path(),
            target.path(),
            WorktreeRestoreOptions {
                branch: Some("shared-feature"),
                no_checkout: false,
                prune_target_registration,
            },
        );
        assert!(
            matches!(refused, Err(GitWorktreeRestoreError::RegistrationConflict { .. })),
            "a prunable SIBLING registration must refuse with prune_target_registration={prune_target_registration}; got: {refused:?}"
        );
        assert!(!target.path().exists());

        let listing = stdout(source.path(), &["worktree", "list", "--porcelain"]);
        assert!(
            listing.contains(&stale_path.path().display().to_string()),
            "the sibling's registration must survive with prune_target_registration={prune_target_registration}, got: {listing}"
        );
    }
}

/// The R4 case: a detached restore into a path that still carries its own
/// stale registration. `branch: None` runs the same validate-and-prune block
/// a branch-ful restore runs, so `prune_target_registration: true` prunes the
/// target's own registration and the restore proceeds.
#[test]
fn restore_worktree_detached_with_prune_target_registration_prunes_the_targets_own_registration() {
    let source = TempDirGuard::new("wt-restore-detached-prune-source");
    let target = TempDirGuard::new("wt-restore-detached-prune-target");
    let _ = fs::remove_dir_all(target.path());
    let head_sha = init_repo(source.path());
    run(source.path(), &["branch", "archived"]);
    run(
        source.path(),
        &["worktree", "add", &target.path().display().to_string(), "archived"],
    );
    // The directory is gone but its registration survives, on a branch, at
    // the exact path the detached restore is aimed at.
    fs::remove_dir_all(target.path()).expect("remove the target directory directly");
    let before = stdout(source.path(), &["worktree", "list", "--porcelain"]);
    assert!(before.contains(&target.path().display().to_string()));

    let refused = GitService::restore_worktree(
        source.path(),
        target.path(),
        WorktreeRestoreOptions {
            branch: None,
            no_checkout: true,
            prune_target_registration: false,
        },
    );
    assert!(
        matches!(refused, Err(GitWorktreeRestoreError::RegistrationConflict { .. })),
        "with the flag off, the target's own branch registration must still refuse; got: {refused:?}"
    );

    let restored = GitService::restore_worktree(
        source.path(),
        target.path(),
        WorktreeRestoreOptions {
            branch: None,
            no_checkout: true,
            prune_target_registration: true,
        },
    )
    .expect("with the flag on, the target's own stale registration must be pruned");
    assert_eq!(restored, GitWorktreeRestoreOutcome::Restored);

    assert_eq!(stdout(target.path(), &["rev-parse", "HEAD"]), head_sha);
    assert!(
        !try_run(target.path(), &["symbolic-ref", "-q", "HEAD"]),
        "the restored worktree must be detached"
    );
    let listing = stdout(source.path(), &["worktree", "list", "--porcelain"]);
    let target_display = target.path().display().to_string();
    assert_eq!(
        listing
            .lines()
            .filter(|line| line.starts_with("worktree ") && line.contains(&target_display))
            .count(),
        1,
        "exactly one registration must remain for the target path, got: {listing}"
    );
    assert!(
        !listing.contains("prunable"),
        "the stale registration must be gone, got: {listing}"
    );
}
