//! Behavioral exact-ref materialization tests using real local Git checkouts.

use std::path::Path;
use std::process::Command;

use super::model::MaterializationKind;
use super::service::hash_request;
use super::store::MaterializationOperationStore;
use super::workspace_plan::generated_workspace_destination_id;
use crate::app::AppState;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::persistence::Db;

struct Guard {
    path: std::path::PathBuf,
}

impl Guard {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-workspace-mat-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("utf8 git output")
        .trim()
        .to_string()
}

fn make_source_repo(prefix: &str) -> Guard {
    let source = Guard::new(prefix);
    git(source.path(), &["init", "-b", "main"]);
    git(source.path(), &["config", "user.email", "test@example.com"]);
    git(source.path(), &["config", "user.name", "Test"]);
    std::fs::write(source.path().join("README.md"), "seed\n").expect("write source");
    git(source.path(), &["add", "README.md"]);
    git(source.path(), &["commit", "-m", "initial"]);
    source
}

fn make_app_state(prefix: &str) -> (Guard, AppState) {
    let home = Guard::new(prefix);
    let runtime_home = home.path().join("anyharness");
    std::fs::create_dir_all(&runtime_home).expect("create runtime home");
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".into(),
        Db::open_in_memory().expect("db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    (home, state)
}

fn registered_source(state: &AppState, prefix: &str) -> (Guard, String, String) {
    let source = make_source_repo(prefix);
    let workspace = state
        .workspace_runtime
        .create_workspace(&source.path().display().to_string())
        .expect("register source");
    let head_sha = git(source.path(), &["rev-parse", "HEAD"]);
    (source, workspace.repo_root.id, head_sha)
}

#[tokio::test]
async fn omitted_destination_crash_retry_adopts_the_recorded_checkout() {
    let (_home, state) = make_app_state("crash-home");
    let (_source, repo_root_id, head_sha) = registered_source(&state, "crash-source");
    let operation_id = "workspace-crash-op";
    let branch = "feature/crash-recovery";
    let preferred = "Crash recovery";
    let destination_id = generated_workspace_destination_id(operation_id, preferred, &head_sha);

    // Simulate process death after Git/workspace creation but before the
    // operation records completion: keep the checkout and remove its row.
    let created = state
        .workspace_runtime
        .create_or_reuse_standard_worktree_at_ref(
            &repo_root_id,
            branch,
            &head_sha,
            Some(&destination_id),
            Some(preferred),
        )
        .expect("create crash checkout");
    crate::domains::workspaces::store::WorkspaceStore::new(state.db.clone())
        .delete_by_id(&created.workspace.id)
        .expect("remove incomplete registration");

    let request_hash = hash_request(&[
        "workspace",
        operation_id,
        &repo_root_id,
        branch,
        &head_sha,
        "",
        preferred,
    ]);
    let store = MaterializationOperationStore::new(state.db.clone());
    store
        .insert_running(operation_id, MaterializationKind::Workspace, &request_hash)
        .expect("seed crashed operation");
    store
        .set_destination_path(operation_id, &created.workspace.path)
        .expect("record chosen destination");

    let recovered = state
        .materialization_service
        .materialize_workspace_at_ref(
            &repo_root_id,
            operation_id,
            branch,
            &head_sha,
            None,
            Some(preferred),
        )
        .await
        .expect("adopt crashed checkout");
    assert_eq!(recovered.workspace.path, created.workspace.path);
    assert_eq!(recovered.observed_head_sha, head_sha);
}

#[tokio::test]
async fn explicit_busy_destination_returns_workspace_busy() {
    let (_home, state) = make_app_state("busy-home");
    let (_source, repo_root_id, head_sha) = registered_source(&state, "busy-source");
    let branch = "feature/busy";
    let first = state
        .materialization_service
        .materialize_workspace_at_ref(
            &repo_root_id,
            "workspace-busy-first",
            branch,
            &head_sha,
            Some("busy-destination"),
            None,
        )
        .await
        .expect("first materialization");

    state
        .db
        .with_conn(|connection| {
            connection.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at
                 ) VALUES (?1, ?2, 'codex', 'starting', 'now', 'now')",
                rusqlite::params!["busy-session", first.workspace.id],
            )?;
            Ok(())
        })
        .expect("seed active session");

    let error = state
        .materialization_service
        .materialize_workspace_at_ref(
            &repo_root_id,
            "workspace-busy-second",
            branch,
            &head_sha,
            Some("busy-destination"),
            None,
        )
        .await
        .expect_err("busy destination must fail");
    assert_eq!(error.code(), "WORKSPACE_BUSY");
}

#[tokio::test]
async fn completed_replay_rejects_malformed_observed_head_sha() {
    let (_home, state) = make_app_state("replay-home");
    let (_source, repo_root_id, head_sha) = registered_source(&state, "replay-source");
    let operation_id = "workspace-replay-sha";
    let branch = "feature/replay-sha";
    state
        .materialization_service
        .materialize_workspace_at_ref(
            &repo_root_id,
            operation_id,
            branch,
            &head_sha,
            Some("replay-sha-destination"),
            None,
        )
        .await
        .expect("initial materialization");

    state
        .db
        .with_conn(|connection| {
            connection.execute(
                "UPDATE local_materialization_operation
                 SET observed_head_sha = 'main'
                 WHERE operation_id = ?1",
                [operation_id],
            )?;
            Ok(())
        })
        .expect("corrupt replay sha");

    let error = state
        .materialization_service
        .materialize_workspace_at_ref(
            &repo_root_id,
            operation_id,
            branch,
            &head_sha,
            Some("replay-sha-destination"),
            None,
        )
        .await
        .expect_err("malformed replay sha must fail closed");
    assert_eq!(error.code(), "MATERIALIZATION_FAILED");
}
