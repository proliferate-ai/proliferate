use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::workspaces::access_model::WorkspaceAccessMode;
use crate::domains::workspaces::checkpoints::refs;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::persistence::Db;

const WORKSPACE_ID: &str = "mobility-checkpoint-source";

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-mobility-checkpoints-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create mobility test root");
        Self { path }
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn destroy_source_deletes_checkpoint_row_and_refs_before_workspace_row() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let base = TempDirGuard::new();
    let runtime_home = base.path.join("runtime");
    let repo_root = base.path.join("repo");
    let worktrees_root = base.path.join("worktrees");
    let worktree = worktrees_root.join(WORKSPACE_ID);
    std::fs::create_dir_all(&runtime_home).expect("create runtime home");
    std::fs::create_dir_all(&worktrees_root).expect("create managed worktrees root");
    init_repo(&repo_root);
    git(
        &repo_root,
        &[
            "worktree",
            "add",
            "-b",
            WORKSPACE_ID,
            &worktree.display().to_string(),
            "HEAD",
        ],
    );

    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("open in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("create app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WORKSPACE_ID,
        "worktree",
        &worktree.display().to_string(),
    );
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE repo_roots SET path = ?2 WHERE id = ?1",
                rusqlite::params![
                    format!("repo-root-{WORKSPACE_ID}"),
                    repo_root.display().to_string()
                ],
            )?;
            Ok(())
        })
        .expect("point workspace at common repo root");

    let capture_lease = state
        .workspace_operation_gate
        .acquire_shared(WORKSPACE_ID, WorkspaceOperationKind::SessionPrompt)
        .await;
    let checkpoint = state
        .workspace_checkpoint_service
        .capture_turn_start_under_workspace_lease(WORKSPACE_ID, None, None)
        .await
        .expect("capture source checkpoint");
    drop(capture_lease);
    assert!(state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find captured checkpoint")
        .is_some());
    assert_eq!(
        refs::list_for_workspace(&repo_root, WORKSPACE_ID)
            .expect("list source checkpoint refs")
            .len(),
        3
    );

    state
        .workspace_access_gate
        .set_runtime_state(WORKSPACE_ID, WorkspaceAccessMode::RemoteOwned, None)
        .expect("mark workspace remote-owned");
    let exclusive_lease = state
        .workspace_operation_gate
        .acquire_exclusive(WORKSPACE_ID)
        .await;
    let mobility_runtime = state.mobility_runtime.clone();
    let summary = tokio::task::spawn_blocking(move || {
        mobility_runtime.destroy_source_workspace(WORKSPACE_ID)
    })
    .await
    .expect("join destroy-source task")
    .expect("destroy source workspace");
    drop(exclusive_lease);

    assert!(summary.source_destroyed);
    assert!(summary.deleted_session_ids.is_empty());
    assert!(summary.closed_terminal_ids.is_empty());
    assert!(!worktree.exists(), "source worktree must be removed");
    assert!(state
        .workspace_runtime
        .get_workspace(WORKSPACE_ID)
        .expect("find workspace after destroy-source")
        .is_none());
    assert!(state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find checkpoint after destroy-source")
        .is_none());
    assert!(
        refs::list_for_workspace(&repo_root, WORKSPACE_ID)
            .expect("list checkpoint refs after destroy-source")
            .is_empty(),
        "destroy-source must remove checkpoint refs before deleting the workspace row"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn destroy_source_checkpoint_cleanup_failure_preserves_source_for_retry() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let base = TempDirGuard::new();
    let runtime_home = base.path.join("runtime");
    let repo_root = base.path.join("repo");
    let worktrees_root = base.path.join("worktrees");
    let worktree = worktrees_root.join(WORKSPACE_ID);
    std::fs::create_dir_all(&runtime_home).expect("create runtime home");
    std::fs::create_dir_all(&worktrees_root).expect("create managed worktrees root");
    init_repo(&repo_root);
    git(
        &repo_root,
        &[
            "worktree",
            "add",
            "-b",
            WORKSPACE_ID,
            &worktree.display().to_string(),
            "HEAD",
        ],
    );

    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("open in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("create app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WORKSPACE_ID,
        "worktree",
        &worktree.display().to_string(),
    );
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE repo_roots SET path = ?2 WHERE id = ?1",
                rusqlite::params![
                    format!("repo-root-{WORKSPACE_ID}"),
                    repo_root.display().to_string()
                ],
            )?;
            Ok(())
        })
        .expect("point workspace at common repo root");

    let capture_lease = state
        .workspace_operation_gate
        .acquire_shared(WORKSPACE_ID, WorkspaceOperationKind::SessionPrompt)
        .await;
    let checkpoint = state
        .workspace_checkpoint_service
        .capture_turn_start_under_workspace_lease(WORKSPACE_ID, None, None)
        .await
        .expect("capture source checkpoint");
    drop(capture_lease);
    state
        .workspace_access_gate
        .set_runtime_state(WORKSPACE_ID, WorkspaceAccessMode::RemoteOwned, None)
        .expect("mark workspace remote-owned");

    let disabled_git_dir = repo_root.join("git-metadata-disabled");
    std::fs::rename(repo_root.join(".git"), &disabled_git_dir)
        .expect("make the existing common repository inoperable");
    let exclusive_lease = state
        .workspace_operation_gate
        .acquire_exclusive(WORKSPACE_ID)
        .await;
    let mobility_runtime = state.mobility_runtime.clone();
    let error = tokio::task::spawn_blocking(move || {
        mobility_runtime.destroy_source_workspace(WORKSPACE_ID)
    })
    .await
    .expect("join failed destroy-source task")
    .expect_err("checkpoint cleanup must fail against an inoperable repository");
    drop(exclusive_lease);

    assert_eq!(
        error.to_string(),
        "checkpoint cleanup failed before source destruction"
    );
    assert!(
        worktree.exists(),
        "checkpoint cleanup failure must abort before materialization destruction"
    );
    assert!(
        state
            .workspace_runtime
            .get_workspace(WORKSPACE_ID)
            .expect("find workspace after failed destroy-source")
            .is_some(),
        "checkpoint cleanup failure must preserve the workspace row for retry"
    );
    let expired = state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find checkpoint after failed destroy-source")
        .expect("failed ref cleanup must retain checkpoint metadata");
    assert!(
        expired.expired_at.is_some(),
        "failed cleanup must leave expired metadata discoverable"
    );

    std::fs::rename(&disabled_git_dir, repo_root.join(".git"))
        .expect("repair the common repository for retry");
    assert_eq!(
        refs::list_for_workspace(&repo_root, WORKSPACE_ID)
            .expect("list checkpoint refs after repository repair")
            .len(),
        3,
        "the failed cleanup must leave checkpoint refs for the retry"
    );

    let exclusive_lease = state
        .workspace_operation_gate
        .acquire_exclusive(WORKSPACE_ID)
        .await;
    let mobility_runtime = state.mobility_runtime.clone();
    let summary = tokio::task::spawn_blocking(move || {
        mobility_runtime.destroy_source_workspace(WORKSPACE_ID)
    })
    .await
    .expect("join retried destroy-source task")
    .expect("retry destroy-source after repository repair");
    drop(exclusive_lease);

    assert!(summary.source_destroyed);
    assert!(!worktree.exists(), "retry must remove the source worktree");
    assert!(state
        .workspace_runtime
        .get_workspace(WORKSPACE_ID)
        .expect("find workspace after destroy-source retry")
        .is_none());
    assert!(state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find checkpoint after destroy-source retry")
        .is_none());
    assert!(
        refs::list_for_workspace(&repo_root, WORKSPACE_ID)
            .expect("list checkpoint refs after destroy-source retry")
            .is_empty(),
        "retry must finish checkpoint ref cleanup"
    );
}

fn init_repo(path: &Path) {
    std::fs::create_dir_all(path).expect("create repo root");
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.email", "test@example.com"]);
    git(path, &["config", "user.name", "Test"]);
    git(path, &["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    git(path, &["add", "README.md"]);
    git(path, &["commit", "-m", "initial"]);
}

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} in {} failed: {}",
        args,
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}
