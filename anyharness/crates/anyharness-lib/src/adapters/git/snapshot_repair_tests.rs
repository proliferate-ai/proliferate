//! Kill-debris repair (spec §7.3), against synthetic `QuiesceReport`s.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use super::operations::snapshot::{repair_kill_debris, snapshot_workspace};
use crate::adapters::git::types::{QuiesceReport, SnapshotError, SnapshotNotice};
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

fn init_repo(path: &Path) -> String {
    run(path, &["init", "-b", "main"]);
    run(path, &["config", "user.email", "test@example.com"]);
    run(path, &["config", "user.name", "Test"]);
    run(path, &["config", "commit.gpgsign", "false"]);
    fs::write(path.join("file.txt"), "line one\n").expect("write seed");
    run(path, &["add", "file.txt"]);
    run(path, &["commit", "-m", "initial"]);
    stdout(path, &["rev-parse", "HEAD"])
}

fn diverge(path: &Path) {
    run(path, &["branch", "topic"]);
    fs::write(path.join("file.txt"), "main change\n").unwrap();
    run(path, &["commit", "-am", "main change"]);
    run(path, &["switch", "topic"]);
    fs::write(path.join("file.txt"), "topic change\n").unwrap();
    run(path, &["commit", "-am", "topic change"]);
}

fn quiesce(killed: usize, killed_git: usize, completed_at: SystemTime) -> QuiesceReport {
    QuiesceReport {
        killed,
        killed_git,
        completed_at,
    }
}

/// Sets a path's mtime using `touch -t`, since no `filetime`-style crate is
/// a dependency of this crate.
fn set_mtime_seconds_ago(path: &Path, seconds_ago: u64) {
    let target = SystemTime::now() - Duration::from_secs(seconds_ago);
    let datetime: chrono::DateTime<chrono::Local> = target.into();
    let formatted = datetime.format("%Y%m%d%H%M.%S").to_string();
    let status = Command::new("touch")
        .args(["-t", &formatted, &path.display().to_string()])
        .status()
        .expect("spawn touch");
    assert!(status.success(), "touch -t {formatted} {path:?} failed");
}

fn git_path(path: &Path, name: &str) -> PathBuf {
    PathBuf::from(stdout(
        path,
        &["rev-parse", "--path-format=absolute", "--git-path", name],
    ))
}

#[test]
fn stranded_rebase_sentinel_with_kill_evidence_is_aborted_and_capture_then_succeeds() {
    let repo = TempDirGuard::new("repair-rebase-abort");
    init_repo(repo.path());
    diverge(repo.path());
    assert!(!try_run(repo.path(), &["rebase", "--apply", "main"]));
    assert!(repo.path().join(".git/rebase-apply").exists());

    // Negative control: without repair, the sentinel survives and every
    // retry refuses forever.
    let refused_once = snapshot_workspace(repo.path()).expect_err("must refuse before repair");
    assert!(matches!(refused_once, SnapshotError::GitOperationInProgress { .. }));
    let refused_again = snapshot_workspace(repo.path()).expect_err("still refuses without repair");
    assert!(matches!(refused_again, SnapshotError::GitOperationInProgress { .. }));

    let report = quiesce(1, 1, SystemTime::now() + Duration::from_secs(2));
    let notices = repair_kill_debris(repo.path(), &report).expect("repair_kill_debris");
    assert!(notices.iter().any(|notice| matches!(
        notice,
        SnapshotNotice::AbortedGitOperation { operation } if operation == "rebase"
    )));
    assert!(!repo.path().join(".git/rebase-apply").exists());

    snapshot_workspace(repo.path()).expect("capture must succeed after repair");
}

#[test]
fn half_written_rebase_sentinel_falls_back_to_quit_and_settles() {
    let repo = TempDirGuard::new("repair-rebase-quit-fallback");
    init_repo(repo.path());
    diverge(repo.path());
    let pre_rebase_branch = "topic";
    assert!(!try_run(repo.path(), &["rebase", "--apply", "main"]));
    let rebase_apply = repo.path().join(".git/rebase-apply");
    assert!(rebase_apply.exists());
    // Corrupt the state dir so `--abort` itself fails, forcing the
    // `--quit` + `read-tree --reset HEAD` + re-attach fallback:
    // `--abort` on the apply backend needs `original-commit`/`onto` to
    // reset HEAD; removing them makes it exit nonzero.
    let _ = fs::remove_file(rebase_apply.join("onto"));
    let _ = fs::remove_file(rebase_apply.join("orig-head"));
    assert!(!try_run(repo.path(), &["rebase", "--abort"]));
    // Re-create the half-written state for the repair to actually act on
    // (the failed --abort above may have already cleared some of it; what
    // matters is the repair path, not this probe).
    assert!(!try_run(repo.path(), &["rebase", "--apply", "main"]));
    let _ = fs::remove_file(rebase_apply.join("onto"));
    let _ = fs::remove_file(rebase_apply.join("orig-head"));

    let report = quiesce(1, 1, SystemTime::now() + Duration::from_secs(2));
    repair_kill_debris(repo.path(), &report).expect("repair_kill_debris");

    // End-state assertions: no unmerged stages left, HEAD re-attached, and
    // a capture succeeds afterward.
    assert!(stdout(repo.path(), &["ls-files", "-u"]).is_empty());
    let current_branch = stdout(repo.path(), &["symbolic-ref", "--short", "HEAD"]);
    assert_eq!(current_branch, pre_rebase_branch);
    snapshot_workspace(repo.path()).expect("capture must succeed after the quit fallback settles");
}

/// The notice is a claim about the end state. `merge --abort` can exit zero
/// while leaving `MERGE_HEAD` behind, and there is no `merge --quit` for the
/// fallback to use, so a surviving sentinel must fail into the generic
/// retryable error instead of telling the user the operation was cleaned up.
#[test]
fn a_sentinel_that_survives_the_abort_path_fails_instead_of_claiming_an_abort() {
    let repo = TempDirGuard::new("repair-abort-ineffective");
    init_repo(repo.path());
    // A `MERGE_HEAD` that `merge --abort` reports success on and yet cannot
    // remove, which is the exact shape the unconditional notice hid.
    let merge_head = git_path(repo.path(), "MERGE_HEAD");
    fs::create_dir(&merge_head).expect("create an unremovable MERGE_HEAD");

    let report = quiesce(1, 1, SystemTime::now() + Duration::from_secs(2));
    let error = repair_kill_debris(repo.path(), &report)
        .expect_err("a surviving sentinel must not be reported as an abort");
    assert!(
        matches!(error, SnapshotError::Internal(_)),
        "expected the generic retryable error, got {error:?}"
    );
    assert!(merge_head.exists());

    let refusal = snapshot_workspace(repo.path()).expect_err("the capture must still refuse");
    assert!(
        matches!(refusal, SnapshotError::GitOperationInProgress { operation } if operation == "merge")
    );

    let _ = fs::remove_dir_all(&merge_head);
}

#[test]
fn sentinel_with_zero_killed_git_is_not_aborted_even_with_a_nonzero_total_kill_count() {
    let repo = TempDirGuard::new("repair-no-git-kill-evidence");
    init_repo(repo.path());
    diverge(repo.path());
    assert!(!try_run(repo.path(), &["merge", "main"]));

    // An idle PTY shell died (killed=1) but no GIT process did (killed_git=0):
    // this must NOT license an abort.
    let report = quiesce(1, 0, SystemTime::now() + Duration::from_secs(2));
    let notices = repair_kill_debris(repo.path(), &report).expect("repair_kill_debris");
    assert!(notices.is_empty());
    assert!(repo.path().join(".git/MERGE_HEAD").exists());

    let error = snapshot_workspace(repo.path()).expect_err("must still refuse");
    assert!(matches!(error, SnapshotError::GitOperationInProgress { .. }));
}

#[test]
fn bisect_sentinel_is_never_auto_aborted_even_with_kill_evidence() {
    let repo = TempDirGuard::new("repair-bisect-never");
    init_repo(repo.path());
    fs::write(repo.path().join("file.txt"), "second\n").unwrap();
    run(repo.path(), &["commit", "-am", "second"]);
    let good = stdout(repo.path(), &["rev-parse", "HEAD~1"]);
    fs::write(repo.path().join("file.txt"), "third\n").unwrap();
    run(repo.path(), &["commit", "-am", "third"]);
    run(repo.path(), &["bisect", "start"]);
    run(repo.path(), &["bisect", "bad", "HEAD"]);
    run(repo.path(), &["bisect", "good", &good]);
    assert!(repo.path().join(".git/BISECT_LOG").exists());

    // Maximal evidence: many git kills, sentinel far in the past.
    set_mtime_seconds_ago(&repo.path().join(".git/BISECT_LOG"), 300);
    let report = quiesce(5, 5, SystemTime::now());
    let notices = repair_kill_debris(repo.path(), &report).expect("repair_kill_debris");
    assert!(notices.is_empty());
    assert!(repo.path().join(".git/BISECT_LOG").exists());

    let error = snapshot_workspace(repo.path()).expect_err("bisect must always refuse");
    assert!(matches!(error, SnapshotError::GitOperationInProgress { operation } if operation == "bisect"));

    run(repo.path(), &["bisect", "reset"]);
}

#[test]
fn young_index_lock_with_kill_evidence_is_reaped_and_capture_proceeds() {
    let repo = TempDirGuard::new("repair-lock-young-evidence");
    init_repo(repo.path());
    let lock = git_path(repo.path(), "index.lock");
    fs::write(&lock, b"").unwrap();

    let report = quiesce(1, 1, SystemTime::now() + Duration::from_secs(2));
    repair_kill_debris(repo.path(), &report).expect("repair_kill_debris");

    assert!(!lock.exists());
    snapshot_workspace(repo.path()).expect("capture proceeds once the lock is reaped");
}

#[test]
fn minutes_old_lock_is_reaped_unconditionally_with_no_evidence() {
    let repo = TempDirGuard::new("repair-lock-abandoned");
    init_repo(repo.path());
    let lock = git_path(repo.path(), "index.lock");
    fs::write(&lock, b"").unwrap();
    set_mtime_seconds_ago(&lock, 300);

    // No evidence at all: killed_git == 0, completed_at way in the past too.
    let report = quiesce(0, 0, SystemTime::now() - Duration::from_secs(600));
    repair_kill_debris(repo.path(), &report).expect("repair_kill_debris");

    assert!(!lock.exists());
}

#[test]
fn young_lock_with_no_evidence_is_left_alone_and_surfaces_as_git_locked() {
    let repo = TempDirGuard::new("repair-lock-young-no-evidence");
    init_repo(repo.path());
    let lock = git_path(repo.path(), "index.lock");
    fs::write(&lock, b"").unwrap();

    // No kill evidence: killed_git == 0.
    let report = quiesce(0, 0, SystemTime::now());
    let notices = repair_kill_debris(repo.path(), &report).expect("repair_kill_debris");
    assert!(notices.is_empty());
    assert!(lock.exists(), "young lock without evidence must survive");

    let error = snapshot_workspace(repo.path()).expect_err("write-tree must fail 128 on the lock");
    match error {
        SnapshotError::GitLocked { file } => assert!(file.ends_with("index.lock")),
        other => panic!("expected GitLocked, got {other:?}"),
    }

    let _ = fs::remove_file(&lock);
}

#[test]
fn common_dir_lock_is_never_touched_regardless_of_age_or_evidence() {
    let source = TempDirGuard::new("repair-common-lock-source");
    let linked = TempDirGuard::new("repair-common-lock-linked");
    let _ = fs::remove_dir_all(linked.path());
    init_repo(source.path());
    run(source.path(), &["branch", "topic"]);
    run(
        source.path(),
        &["worktree", "add", &linked.path().display().to_string(), "topic"],
    );

    let common_dir = PathBuf::from(stdout(
        linked.path(),
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    ));
    let common_lock = common_dir.join("packed-refs.lock");
    fs::write(&common_lock, b"").unwrap();
    set_mtime_seconds_ago(&common_lock, 300);

    let report = quiesce(5, 5, SystemTime::now());
    repair_kill_debris(linked.path(), &report).expect("repair_kill_debris");

    assert!(
        common_lock.exists(),
        "a common-dir lock must never be touched by per-worktree repair"
    );
    let _ = fs::remove_file(&common_lock);
}
