use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::test_support::{
    git_stdout, init_repo, make_runtime, run_git, session_record, TempDirGuard,
};
use super::{RestoreWorktreeError, WorkspaceRuntime};
use crate::adapters::git::types::{GitWorktreeRestoreError, GitWorktreeRestoreOutcome};
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::restore_runtime::RestoreWorktreeRuntime;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

struct RestoreFixture {
    source: TempDirGuard,
    _target_root: TempDirGuard,
    target_path: PathBuf,
    runtime: Arc<WorkspaceRuntime>,
    db: Db,
    workspace: WorkspaceRecord,
}

impl RestoreFixture {
    fn new() -> Self {
        let source = TempDirGuard::new("restore-worktree-source");
        let target_root = TempDirGuard::new("restore-worktree-target");
        let target_path = target_root.path().join("checkout");
        let runtime_home = TempDirGuard::new("restore-worktree-runtime-home");
        init_repo(source.path());

        let db = Db::open_in_memory().expect("open db");
        let runtime = Arc::new(make_runtime(&db, runtime_home.path()));
        let source_workspace = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("register source repository");
        let workspace = runtime
            .create_worktree(
                &source_workspace.repo_root.id,
                &target_path.display().to_string(),
                "feature/restore-me",
                Some("main"),
                None,
            )
            .expect("create worktree")
            .workspace;

        Self {
            source,
            _target_root: target_root,
            target_path,
            runtime,
            db,
            workspace,
        }
    }

    fn remove_checkout(&self) {
        fs::remove_dir_all(&self.target_path).expect("remove worktree checkout");
    }
}

#[test]
fn restore_recreates_committed_branch_at_recorded_path_and_preserves_identity() {
    let fixture = RestoreFixture::new();
    SessionStore::new(fixture.db.clone())
        .insert(&session_record("session-preserved", &fixture.workspace.id))
        .expect("insert existing session");
    fixture.remove_checkout();

    let result = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect("restore worktree");

    assert_eq!(result.outcome, GitWorktreeRestoreOutcome::Restored);
    assert_eq!(result.workspace.id, fixture.workspace.id);
    assert_eq!(result.workspace.path, fixture.workspace.path);
    assert_eq!(
        git_stdout(&fixture.target_path, ["rev-parse", "--abbrev-ref", "HEAD"]),
        "feature/restore-me"
    );
    assert_eq!(
        fs::read_to_string(fixture.target_path.join("README.md")).expect("read committed file"),
        "seed\n"
    );
    let sessions = SessionStore::new(fixture.db.clone())
        .list_visible_by_workspace(&fixture.workspace.id)
        .expect("list preserved sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "session-preserved");
}

#[test]
fn repeated_restore_returns_the_same_successful_workspace() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();

    let first = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect("first restore");
    let second = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect("idempotent restore");

    assert_eq!(first.outcome, GitWorktreeRestoreOutcome::Restored);
    assert_eq!(second.outcome, GitWorktreeRestoreOutcome::AlreadyPresent);
    assert_eq!(first.workspace.id, second.workspace.id);
    assert_eq!(first.workspace.id, fixture.workspace.id);
}

#[test]
fn restore_uses_the_recorded_current_branch_after_a_branch_rename() {
    let fixture = RestoreFixture::new();
    run_git(
        &fixture.target_path,
        ["branch", "-m", "feature/restored-name"],
    );
    let refresh = fixture
        .runtime
        .refresh_workspace_branches_for_test()
        .expect("refresh renamed branch");
    assert_eq!(refresh.updated_count, 1);
    let recorded = WorkspaceStore::new(fixture.db.clone())
        .find_by_id(&fixture.workspace.id)
        .expect("load renamed workspace")
        .expect("workspace exists");
    assert_eq!(
        recorded.original_branch.as_deref(),
        Some("feature/restore-me")
    );
    assert_eq!(
        recorded.current_branch.as_deref(),
        Some("feature/restored-name")
    );
    fixture.remove_checkout();

    fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect("restore renamed branch");

    assert_eq!(
        git_stdout(&fixture.target_path, ["rev-parse", "--abbrev-ref", "HEAD"]),
        "feature/restored-name"
    );
}

#[test]
fn restore_rejects_a_detached_worktree_even_when_original_branch_is_recorded() {
    let fixture = RestoreFixture::new();
    run_git(&fixture.target_path, ["checkout", "--detach"]);
    let refresh = fixture
        .runtime
        .refresh_workspace_branches_for_test()
        .expect("refresh detached branch");
    assert_eq!(refresh.updated_count, 1);
    let recorded = WorkspaceStore::new(fixture.db.clone())
        .find_by_id(&fixture.workspace.id)
        .expect("load detached workspace")
        .expect("workspace exists");
    assert_eq!(
        recorded.original_branch.as_deref(),
        Some("feature/restore-me")
    );
    assert_eq!(recorded.current_branch, None);
    fixture.remove_checkout();

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("detached worktree must remain ineligible");

    assert!(matches!(
        error,
        RestoreWorktreeError::RecordedBranchMissing { .. }
    ));
    assert!(!fixture.target_path.exists());
}

#[test]
fn restore_rejects_a_legacy_head_branch_sentinel() {
    let fixture = RestoreFixture::new();
    WorkspaceStore::new(fixture.db.clone())
        .update_current_branch(
            &fixture.workspace.id,
            Some("HEAD"),
            &chrono::Utc::now().to_rfc3339(),
        )
        .expect("record legacy detached sentinel");
    fixture.remove_checkout();

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("HEAD sentinel must remain ineligible");

    assert!(matches!(
        error,
        RestoreWorktreeError::RecordedBranchMissing { .. }
    ));
    assert!(!fixture.target_path.exists());
}

#[tokio::test]
async fn concurrent_restore_requests_coalesce_under_the_workspace_gate() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    let runtime = RestoreWorktreeRuntime::new(
        fixture.runtime.clone(),
        Arc::new(WorkspaceOperationGate::new()),
    );
    let workspace_id = fixture.workspace.id.clone();

    let (left, right) = tokio::join!(
        runtime.restore_worktree(&workspace_id),
        runtime.restore_worktree(&workspace_id),
    );
    let left = left.expect("left restore");
    let right = right.expect("right restore");

    assert_eq!(left.workspace.id, workspace_id);
    assert_eq!(right.workspace.id, workspace_id);
    let outcomes = [left.outcome, right.outcome];
    assert!(outcomes.contains(&GitWorktreeRestoreOutcome::Restored));
    assert!(outcomes.contains(&GitWorktreeRestoreOutcome::AlreadyPresent));
}

#[test]
fn restore_refuses_an_occupied_path_without_removing_user_files() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    fs::create_dir_all(&fixture.target_path).expect("occupy destination");
    fs::write(fixture.target_path.join("KEEP.txt"), "do not remove\n").expect("write sentinel");

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("occupied destination must fail");

    assert!(
        matches!(
            error,
            RestoreWorktreeError::Git(GitWorktreeRestoreError::DestinationOccupied { .. })
        ),
        "unexpected restore error: {error:?}"
    );
    assert_eq!(
        fs::read_to_string(fixture.target_path.join("KEEP.txt")).expect("read sentinel"),
        "do not remove\n"
    );
}

#[test]
fn restore_refuses_a_path_that_appears_during_staged_checkout() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    let target_path = fixture.target_path.clone();
    let target_parent = target_path.parent().expect("target parent").to_path_buf();
    let occupier = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let stage_exists = fs::read_dir(&target_parent)
                .expect("read target parent")
                .filter_map(Result::ok)
                .any(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".proliferate-worktree-restore-")
                });
            if stage_exists {
                fs::create_dir(&target_path).expect("occupy destination during restore");
                fs::write(target_path.join("KEEP.txt"), "do not remove\n")
                    .expect("write concurrent sentinel");
                return;
            }
            assert!(
                Instant::now() < deadline,
                "restore did not create its staging directory"
            );
            thread::yield_now();
        }
    });

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("concurrently occupied destination must fail");
    occupier.join().expect("join path occupier");

    assert!(
        matches!(
            error,
            RestoreWorktreeError::Git(GitWorktreeRestoreError::DestinationOccupied { .. })
        ),
        "unexpected restore error: {error:?}"
    );
    assert_eq!(
        fs::read_to_string(fixture.target_path.join("KEEP.txt")).expect("read sentinel"),
        "do not remove\n"
    );
    assert!(
        fs::read_dir(fixture.target_path.parent().expect("target parent"))
            .expect("read target parent")
            .filter_map(Result::ok)
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".proliferate-worktree-restore-")),
        "private staging directory must be cleaned after a refused move"
    );
}

#[test]
fn restore_rejects_a_missing_source_repository() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    fs::remove_dir_all(fixture.source.path()).expect("remove source repository");

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("missing source repository must fail");

    assert!(matches!(
        error,
        RestoreWorktreeError::Git(GitWorktreeRestoreError::RepositoryMissing { .. })
    ));
    assert!(!fixture.target_path.exists());
}

#[test]
fn restore_rejects_an_existing_non_repository_source_path() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    fs::remove_dir_all(fixture.source.path()).expect("remove source repository");
    fs::create_dir(fixture.source.path()).expect("replace repository with plain directory");

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("plain source directory must fail as an invalid repository");

    assert!(matches!(
        error,
        RestoreWorktreeError::Git(GitWorktreeRestoreError::RepositoryInvalid { .. })
    ));
    assert!(!fixture.target_path.exists());
}

#[test]
fn restore_rejects_a_missing_recorded_branch() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    run_git(
        fixture.source.path(),
        ["worktree", "prune", "--expire", "now"],
    );
    run_git(
        fixture.source.path(),
        ["branch", "-D", "feature/restore-me"],
    );

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("missing branch must fail");

    assert!(matches!(
        error,
        RestoreWorktreeError::Git(GitWorktreeRestoreError::BranchMissing { .. })
    ));
    assert!(!fixture.target_path.exists());
}

#[test]
fn restore_rejects_a_branch_checked_out_elsewhere() {
    let fixture = RestoreFixture::new();
    let elsewhere = TempDirGuard::new("restore-worktree-elsewhere");
    fixture.remove_checkout();
    fs::remove_dir_all(elsewhere.path()).expect("remove elsewhere placeholder");
    run_git(
        fixture.source.path(),
        ["worktree", "prune", "--expire", "now"],
    );
    run_git(
        fixture.source.path(),
        [
            "worktree",
            "add",
            &elsewhere.path().display().to_string(),
            "feature/restore-me",
        ],
    );

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("branch checked out elsewhere must fail");

    assert!(matches!(
        error,
        RestoreWorktreeError::Git(GitWorktreeRestoreError::BranchCheckedOutElsewhere { .. })
    ));
    assert!(!fixture.target_path.exists());
}

#[test]
fn restore_rejects_conflicting_git_registration_for_recorded_path() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    run_git(
        fixture.source.path(),
        ["worktree", "prune", "--expire", "now"],
    );
    run_git(fixture.source.path(), ["branch", "feature/other"]);
    run_git(
        fixture.source.path(),
        [
            "worktree",
            "add",
            &fixture.target_path.display().to_string(),
            "feature/other",
        ],
    );
    fixture.remove_checkout();

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("conflicting registration must fail");

    assert!(matches!(
        error,
        RestoreWorktreeError::Git(GitWorktreeRestoreError::RegistrationConflict { .. })
    ));
    assert!(!fixture.target_path.exists());
}

#[test]
fn restore_rejects_locked_missing_git_state_as_ambiguous() {
    let fixture = RestoreFixture::new();
    run_git(
        fixture.source.path(),
        [
            "worktree",
            "lock",
            &fixture.target_path.display().to_string(),
        ],
    );
    fixture.remove_checkout();

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("locked missing registration must fail");

    assert!(matches!(
        error,
        RestoreWorktreeError::Git(GitWorktreeRestoreError::AmbiguousState { .. })
    ));
    assert!(!fixture.target_path.exists());
}

#[test]
fn restore_rejects_a_conflicting_runtime_workspace_registration() {
    let fixture = RestoreFixture::new();
    fixture.remove_checkout();
    let mut conflict = fixture.workspace.clone();
    conflict.id = "conflicting-workspace".to_string();
    conflict.kind = WorkspaceKind::Local;
    WorkspaceStore::new(fixture.db.clone())
        .insert(&conflict)
        .expect("insert conflicting workspace registration");

    let error = fixture
        .runtime
        .restore_worktree(&fixture.workspace.id)
        .expect_err("conflicting runtime registration must fail");

    assert!(matches!(
        error,
        RestoreWorktreeError::WorkspaceRegistrationConflict {
            conflicting_workspace_id,
            ..
        } if conflicting_workspace_id == "conflicting-workspace"
    ));
    assert!(!fixture.target_path.exists());
}
