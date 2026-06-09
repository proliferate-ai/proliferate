use std::path::PathBuf;

use super::*;
use crate::domains::terminals::model::{CreateTerminalOptions, TerminalPurpose};
use crate::domains::workspaces::model::{
    WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

fn insert_test_workspace(db: &Db, id: &str, path: &str) {
    let repo_root_id = format!("repo-root-{id}");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO repo_roots (
                id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                remote_repo_name, remote_url, created_at, updated_at
             ) VALUES (?1, 'external', ?2, NULL, 'main', NULL, NULL, NULL, NULL, ?3, ?3)",
            [&repo_root_id, path, "2026-01-01T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed repo root");
    WorkspaceStore::new(db.clone())
        .insert(&WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Worktree,
            repo_root_id,
            path: path.to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
        .expect("insert workspace");
}

fn test_runtime_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "anyharness-terminal-service-test-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&path).expect("create runtime dir");
    path
}

#[tokio::test]
async fn run_terminal_command_rejects_overlap_without_interrupt() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("overlap-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-1", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let terminal = service
        .create_terminal(
            "workspace-1",
            &workspace_path_string,
            CreateTerminalOptions {
                cwd: None,
                shell: Some(super::super::driver::detect_posix_shell()),
                title: Some("Run command".to_string()),
                purpose: TerminalPurpose::Run,
                env: Vec::new(),
                startup_command: None,
                startup_command_env: Vec::new(),
                startup_command_timeout_ms: None,
                cols: 80,
                rows: 24,
            },
        )
        .await
        .expect("create terminal");

    service
        .run_terminal_command(
            &terminal.id,
            RunTerminalCommandOptions {
                command: "sleep 2".to_string(),
                env: Vec::new(),
                interrupt: false,
                timeout_ms: None,
            },
        )
        .await
        .expect("start first command");

    let error = service
        .run_terminal_command(
            &terminal.id,
            RunTerminalCommandOptions {
                command: "echo second".to_string(),
                env: Vec::new(),
                interrupt: false,
                timeout_ms: None,
            },
        )
        .await
        .expect_err("overlapping command rejected");

    assert!(error
        .to_string()
        .contains("terminal command already running"));
    let _ = service.close_terminal(&terminal.id).await;
}
