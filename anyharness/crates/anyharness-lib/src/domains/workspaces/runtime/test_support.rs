use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use super::WorkspaceRuntime;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::origin::OriginContext;
use crate::persistence::Db;

pub(super) struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    pub(super) fn new(prefix: &str) -> Self {
        let path = env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub(super) fn init_repo(path: &Path) {
    run_git(path, ["init", "-b", "main"]);
    run_git(path, ["config", "user.email", "codex@example.com"]);
    run_git(path, ["config", "user.name", "Codex"]);
    fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    run_git(path, ["add", "README.md"]);
    run_git(path, ["commit", "-m", "Initial commit"]);
}

pub(super) fn make_runtime(db: &Db, runtime_home: &Path) -> WorkspaceRuntime {
    let repo_root_service = RepoRootService::new(RepoRootStore::new(db.clone()));
    WorkspaceRuntime::new(
        WorkspaceStore::new(db.clone()),
        WorkspaceDeleteWorkflow::new(
            db.clone(),
            crate::domains::sessions::deletion::SessionDeleteWorkflow::new(db.clone()),
        ),
        repo_root_service,
        runtime_home.to_path_buf(),
    )
}

pub(super) fn session_record(id: &str, workspace_id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_scope: None,
        required_agent_auth_revision: None,
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: false,
        action_capabilities_json: None,
        origin: Some(OriginContext::api_local_runtime()),
    }
}

pub(super) fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
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

pub(super) fn assert_git_command_fails<const N: usize>(cwd: &Path, args: [&str; N]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        !output.status.success(),
        "git {:?} unexpectedly succeeded with stdout: {}",
        args,
        String::from_utf8_lossy(&output.stdout)
    );
}

pub(super) fn git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
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
