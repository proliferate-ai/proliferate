//! Round-trip matrix (spec §7.1): one state per test. Each test puts a temp
//! repo into a state, records `git status` and HEAD, captures, wipes the
//! worktree (simulating deletion), restores, and asserts `git status` and
//! HEAD read exactly the same.

use std::env;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

use super::operations::snapshot::snapshot_workspace;
use super::operations::snapshot_restore::restore_snapshot;
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
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Sets a local git identity on `path` so commits succeed in CI, where no
/// global `user.name`/`user.email` is configured (unlike a dev machine).
fn configure_identity(path: &Path) {
    run(path, &["config", "user.email", "test@example.com"]);
    run(path, &["config", "user.name", "Test"]);
    run(path, &["config", "commit.gpgsign", "false"]);
}

fn init_repo(path: &Path) -> String {
    run(path, &["init", "-b", "main"]);
    configure_identity(path);
    fs::write(path.join("README.md"), "seed\n").expect("write seed");
    run(path, &["add", "README.md"]);
    run(path, &["commit", "-m", "initial"]);
    stdout(path, &["rev-parse", "HEAD"])
}

fn status_porcelain(path: &Path) -> String {
    stdout(path, &["status", "--porcelain=v1", "-uall"])
}

fn head_sha(path: &Path) -> String {
    stdout(path, &["rev-parse", "HEAD"])
}

/// Simulates "the worktree is deleted, then a fresh one takes its place":
/// clears every entry except `.git`, AND drops the current index so no
/// index-only metadata (skip-worktree, assume-unchanged) leaks across from
/// the "old" worktree into the "fresh" one restore populates.
fn wipe_worktree(path: &Path) {
    for entry in fs::read_dir(path).expect("read worktree dir") {
        let entry = entry.expect("dir entry");
        if entry.file_name() == ".git" {
            continue;
        }
        let entry_path = entry.path();
        if entry_path.is_dir() {
            fs::remove_dir_all(&entry_path).expect("remove dir");
        } else {
            fs::remove_file(&entry_path).expect("remove file");
        }
    }
    let index_path = stdout(
        path,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    );
    let _ = fs::remove_file(index_path);
}

/// Captures, wipes, restores, and asserts `git status` and HEAD are
/// byte-identical to before capture.
fn assert_round_trips(path: &Path) {
    let before_status = status_porcelain(path);
    let before_head = head_sha(path);

    let snap = snapshot_workspace(path).expect("snapshot_workspace");

    wipe_worktree(path);
    restore_snapshot(path, &snap).expect("restore_snapshot");

    assert_eq!(status_porcelain(path), before_status, "git status diverged");
    assert_eq!(head_sha(path), before_head, "HEAD diverged");
}

#[test]
fn staged_only_file_round_trips() {
    let repo = TempDirGuard::new("rt-staged-only");
    init_repo(repo.path());
    fs::write(repo.path().join("staged.txt"), "staged content\n").unwrap();
    run(repo.path(), &["add", "staged.txt"]);
    assert_round_trips(repo.path());
}

#[test]
fn unstaged_only_file_round_trips() {
    let repo = TempDirGuard::new("rt-unstaged-only");
    init_repo(repo.path());
    fs::write(repo.path().join("README.md"), "changed\n").unwrap();
    assert_round_trips(repo.path());
}

#[test]
fn untracked_file_round_trips() {
    let repo = TempDirGuard::new("rt-untracked");
    init_repo(repo.path());
    fs::write(repo.path().join("new.txt"), "untracked content\n").unwrap();
    assert_round_trips(repo.path());
}

#[test]
fn half_staged_file_round_trips() {
    let repo = TempDirGuard::new("rt-half-staged");
    init_repo(repo.path());
    fs::write(repo.path().join("README.md"), "staged version\n").unwrap();
    run(repo.path(), &["add", "README.md"]);
    fs::write(repo.path().join("README.md"), "unstaged version on top\n").unwrap();
    assert_round_trips(repo.path());
}

#[test]
fn staged_deletion_round_trips() {
    let repo = TempDirGuard::new("rt-staged-deletion");
    init_repo(repo.path());
    run(repo.path(), &["rm", "README.md"]);
    assert_round_trips(repo.path());
}

#[test]
fn rename_round_trips() {
    let repo = TempDirGuard::new("rt-rename");
    init_repo(repo.path());
    run(repo.path(), &["mv", "README.md", "RENAMED.md"]);
    assert_round_trips(repo.path());
}

#[test]
fn binary_file_round_trips() {
    let repo = TempDirGuard::new("rt-binary");
    init_repo(repo.path());
    fs::write(repo.path().join("blob.bin"), [0u8, 159, 146, 150, 0, 1, 2]).unwrap();
    run(repo.path(), &["add", "blob.bin"]);
    assert_round_trips(repo.path());
}

#[test]
fn symlink_round_trips() {
    let repo = TempDirGuard::new("rt-symlink");
    init_repo(repo.path());
    symlink("README.md", repo.path().join("link.md")).unwrap();
    run(repo.path(), &["add", "link.md"]);
    assert_round_trips(repo.path());
}

#[test]
fn tracked_but_gitignored_file_round_trips() {
    let repo = TempDirGuard::new("rt-tracked-ignored");
    init_repo(repo.path());
    fs::write(repo.path().join("config.local"), "tracked before ignore\n").unwrap();
    run(repo.path(), &["add", "config.local"]);
    run(repo.path(), &["commit", "-m", "add tracked file"]);
    fs::write(repo.path().join(".gitignore"), "config.local\n").unwrap();
    run(repo.path(), &["add", ".gitignore"]);
    run(repo.path(), &["commit", "-m", "ignore it"]);
    // Still tracked (already in the index/HEAD); dirty it unstaged.
    fs::write(repo.path().join("config.local"), "dirty but tracked\n").unwrap();
    assert_round_trips(repo.path());
}

#[test]
fn ignored_untracked_file_does_not_come_back() {
    let repo = TempDirGuard::new("rt-ignored-untracked");
    init_repo(repo.path());
    fs::write(repo.path().join(".gitignore"), "ignored.txt\n").unwrap();
    run(repo.path(), &["add", ".gitignore"]);
    run(repo.path(), &["commit", "-m", "add gitignore"]);
    fs::write(repo.path().join("ignored.txt"), "never tracked\n").unwrap();

    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    wipe_worktree(repo.path());
    restore_snapshot(repo.path(), &snap).expect("restore_snapshot");

    assert!(!repo.path().join("ignored.txt").exists());
}

#[test]
fn detached_head_round_trips() {
    let repo = TempDirGuard::new("rt-detached");
    let sha = init_repo(repo.path());
    run(repo.path(), &["checkout", "--detach", &sha]);
    fs::write(repo.path().join("README.md"), "detached edit\n").unwrap();
    assert_round_trips(repo.path());

    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    assert_eq!(snap.branch, None);
}

#[test]
fn stash_is_untouched_by_round_trip() {
    let repo = TempDirGuard::new("rt-stash");
    init_repo(repo.path());
    fs::write(repo.path().join("README.md"), "stash me\n").unwrap();
    run(repo.path(), &["stash", "push", "-m", "keepme"]);
    let stash_list_before = stdout(repo.path(), &["stash", "list"]);

    fs::write(repo.path().join("current.txt"), "current dirty state\n").unwrap();
    assert_round_trips(repo.path());

    assert_eq!(stdout(repo.path(), &["stash", "list"]), stash_list_before);
    assert!(stash_list_before.contains("keepme"));
}

#[test]
fn clean_submodule_round_trips() {
    let repo = TempDirGuard::new("rt-submodule-parent");
    let submodule_source = TempDirGuard::new("rt-submodule-source");
    init_repo(submodule_source.path());
    init_repo(repo.path());
    run(
        repo.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &submodule_source.path().display().to_string(),
            "sub",
        ],
    );
    run(repo.path(), &["commit", "-m", "add clean submodule"]);
    assert_round_trips(repo.path());
}

#[test]
fn switched_branch_is_captured_by_name() {
    let repo = TempDirGuard::new("rt-switched-branch");
    init_repo(repo.path());
    run(repo.path(), &["switch", "-c", "feature/new-branch"]);

    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    assert_eq!(snap.branch, Some("feature/new-branch".to_string()));
}

#[test]
fn dirty_submodule_raises_notice_and_loses_inner_state_as_a_bound() {
    let repo = TempDirGuard::new("rt-submodule-dirty-parent");
    let submodule_source = TempDirGuard::new("rt-submodule-dirty-source");
    init_repo(submodule_source.path());
    init_repo(repo.path());
    run(
        repo.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &submodule_source.path().display().to_string(),
            "sub",
        ],
    );
    run(repo.path(), &["commit", "-m", "add submodule"]);
    // Dirty the submodule's own working tree (ahead of its recorded gitlink).
    // The submodule checkout at `sub` is a fresh clone with no identity of
    // its own (it never went through `init_repo`), so give it one before
    // committing — otherwise this only passes where a global git identity
    // happens to be configured (e.g. locally), not in CI.
    configure_identity(&repo.path().join("sub"));
    fs::write(repo.path().join("sub/extra.txt"), "dirty inside submodule\n").unwrap();
    run(&repo.path().join("sub"), &["add", "extra.txt"]);
    run(&repo.path().join("sub"), &["commit", "-m", "dirty commit"]);

    use crate::adapters::git::types::SnapshotNotice;
    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    assert!(snap
        .notices
        .iter()
        .any(|notice| matches!(notice, SnapshotNotice::DirtySubmodule { paths } if paths.iter().any(|p| p == "sub"))));

    // Bound: the inner submodule commit is not itself captured/restored.
    wipe_worktree(repo.path());
    restore_snapshot(repo.path(), &snap).expect("restore_snapshot");
    assert!(repo.path().join("sub").exists());
}

#[test]
fn embedded_repo_raises_notice_and_is_lost_as_a_bound() {
    let repo = TempDirGuard::new("rt-embedded-parent");
    init_repo(repo.path());
    let embedded = repo.path().join("embedded");
    fs::create_dir_all(&embedded).unwrap();
    init_repo(&embedded);

    use crate::adapters::git::types::SnapshotNotice;
    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    assert!(snap.notices.iter().any(
        |notice| matches!(notice, SnapshotNotice::EmbeddedRepo { paths } if paths.iter().any(|p| p == "embedded"))
    ));

    // Bound: the embedded repo's own object store dies with the worktree.
    wipe_worktree(repo.path());
    restore_snapshot(repo.path(), &snap).expect("restore_snapshot");
    assert!(!repo.path().join("embedded/.git").exists());
}

#[test]
fn skip_worktree_bit_survives_content_but_not_the_bit_as_a_bound() {
    // A documented fidelity bound (spec §6.8), asserted as a bound rather
    // than through `assert_round_trips`: the skip-worktree bit suppresses
    // `git status` for the unstaged edit, so `git status` before and after
    // is legitimately NOT expected to match here.
    let repo = TempDirGuard::new("rt-skip-worktree");
    init_repo(repo.path());
    run(repo.path(), &["update-index", "--skip-worktree", "README.md"]);
    fs::write(repo.path().join("README.md"), "content still on disk\n").unwrap();

    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    wipe_worktree(repo.path());
    restore_snapshot(repo.path(), &snap).expect("restore_snapshot");

    // Content survives: the disk content Twork captured comes back.
    assert_eq!(
        fs::read_to_string(repo.path().join("README.md")).unwrap(),
        "content still on disk\n"
    );
    // Bound: the skip-worktree bit itself does not survive the round trip.
    let flags = stdout(repo.path(), &["ls-files", "-v"]);
    assert!(!flags.starts_with('S'), "skip-worktree bit unexpectedly survived: {flags}");
}

#[test]
fn intent_to_add_entry_returns_untracked() {
    let repo = TempDirGuard::new("rt-intent-to-add");
    init_repo(repo.path());
    fs::write(repo.path().join("planned.txt"), "not really staged\n").unwrap();
    run(repo.path(), &["add", "-N", "planned.txt"]);

    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    wipe_worktree(repo.path());
    restore_snapshot(repo.path(), &snap).expect("restore_snapshot");

    let status = status_porcelain(repo.path());
    assert!(status.contains("?? planned.txt"), "expected untracked, got: {status}");
}

#[test]
fn unborn_embedded_repo_captures_cleanly_with_partial_capture_notice() {
    let repo = TempDirGuard::new("rt-unborn-embedded-parent");
    init_repo(repo.path());
    let unborn = repo.path().join("unborn");
    fs::create_dir_all(&unborn).unwrap();
    run(&unborn, &["init"]);

    let snap = snapshot_workspace(repo.path()).expect("capture must succeed despite unborn embedded repo");
    use crate::adapters::git::types::SnapshotNotice;
    assert!(snap.notices.iter().any(|notice| matches!(
        notice,
        SnapshotNotice::PartialCaptureUntracked { paths } if paths.iter().any(|p| p == "unborn")
    )));
    assert!(snap.partial_capture_json().is_some());
}

#[test]
fn unreadable_tracked_file_captures_cleanly_and_restores_staged_content_as_a_bound() {
    let repo = TempDirGuard::new("rt-unreadable-tracked");
    init_repo(repo.path());
    let secret = repo.path().join("secret.txt");
    fs::write(&secret, "staged secret content\n").unwrap();
    run(repo.path(), &["add", "secret.txt"]);
    run(repo.path(), &["commit", "-m", "add secret"]);
    fs::write(&secret, "unstaged change nobody can read\n").unwrap();
    fs::set_permissions(&secret, fs::Permissions::from_mode(0o000)).unwrap();

    let result = snapshot_workspace(repo.path());
    // Restore permissions before any assertion can panic and leak a
    // mode-000 file into the temp-dir cleanup.
    fs::set_permissions(&secret, fs::Permissions::from_mode(0o644)).unwrap();
    let snap = result.expect("capture must succeed despite an unreadable tracked file");

    use crate::adapters::git::types::SnapshotNotice;
    assert!(snap.notices.iter().any(|notice| matches!(
        notice,
        SnapshotNotice::PartialCaptureTracked { paths } if paths.iter().any(|p| p == "secret.txt")
    )));

    wipe_worktree(repo.path());
    restore_snapshot(repo.path(), &snap).expect("restore_snapshot");
    // Bound: restores at the last-staged content, not the unreadable edit.
    assert_eq!(
        fs::read_to_string(repo.path().join("secret.txt")).unwrap(),
        "staged secret content\n"
    );
    assert_eq!(status_porcelain(repo.path()), "");
}

#[test]
fn non_invertible_clean_filter_rewrites_content_as_a_documented_bound() {
    let repo = TempDirGuard::new("rt-clean-filter");
    init_repo(repo.path());
    fs::write(repo.path().join(".gitattributes"), "*.ipynb filter=stripout\n").unwrap();
    run(repo.path(), &["add", ".gitattributes"]);
    run(
        repo.path(),
        &[
            "config",
            "filter.stripout.clean",
            "sed 's/OUTPUT/STRIPPED/'",
        ],
    );
    run(repo.path(), &["config", "filter.stripout.smudge", "cat"]);
    fs::write(repo.path().join("notebook.ipynb"), "cell with OUTPUT data\n").unwrap();

    let snap = snapshot_workspace(repo.path()).expect("snapshot_workspace");
    wipe_worktree(repo.path());
    restore_snapshot(repo.path(), &snap).expect("restore_snapshot");

    // Bound: the clean filter rewrote the content on capture; the round
    // trip reproduces the REWRITTEN content, not the original.
    let restored = fs::read_to_string(repo.path().join("notebook.ipynb")).unwrap();
    assert!(restored.contains("STRIPPED"), "expected filter rewrite, got: {restored}");
}

#[test]
fn lfs_tracked_file_pointer_round_trips() {
    if !try_run(Path::new("."), &["lfs", "version"]) {
        eprintln!("skipping: git-lfs not available");
        return;
    }
    let repo = TempDirGuard::new("rt-lfs");
    init_repo(repo.path());
    run(repo.path(), &["lfs", "install", "--local"]);
    run(repo.path(), &["lfs", "track", "*.bin"]);
    run(repo.path(), &["add", ".gitattributes"]);
    run(repo.path(), &["commit", "-m", "track lfs"]);
    fs::write(repo.path().join("asset.bin"), "large binary payload\n").unwrap();
    run(repo.path(), &["add", "asset.bin"]);

    assert_round_trips(repo.path());

    // The pointer (index/tree object) and the real content (smudged onto
    // disk on checkout, exactly as an ordinary `git checkout` would) both
    // round-trip: `assert_round_trips` above proves `git status` reads
    // clean, and this proves the actual payload survived.
    let restored = fs::read_to_string(repo.path().join("asset.bin")).unwrap();
    assert_eq!(restored, "large binary payload\n");
}
