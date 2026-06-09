use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::calls::{call_artifact_tool, ensure_tool_available};
use super::context::CoworkMcpContext;
use crate::domains::cowork::artifacts::CoworkArtifactRuntime;
use crate::domains::workspaces::model::{
    WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};
use crate::origin::OriginContext;

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-cowork-mcp-calls-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn workspace(path: &Path) -> WorkspaceRecord {
    WorkspaceRecord {
        id: "workspace-1".to_string(),
        kind: WorkspaceKind::Local,
        repo_root_id: "repo-root-1".to_string(),
        path: path.display().to_string(),
        surface: WorkspaceSurface::Cowork,
        original_branch: Some("main".to_string()),
        current_branch: Some("main".to_string()),
        display_name: None,
        origin: Some(OriginContext::cowork()),
        creator_context: None,
        lifecycle_state: WorkspaceLifecycleState::Active,
        cleanup_state: WorkspaceCleanupState::None,
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

#[test]
fn delegation_disabled_call_is_rejected_before_runtime_work() {
    let temp = TempDirGuard::new("delegation-disabled");
    let ctx = CoworkMcpContext {
        session_id: "session-1".to_string(),
        workspace: workspace(&temp.path),
        workspace_delegation_enabled: false,
    };
    let error = ensure_tool_available("create_coding_workspace", &ctx)
        .expect_err("delegation tool should be rejected when disabled");
    assert_eq!(
        error.to_string(),
        "cowork workspace delegation is disabled for this thread"
    );
}

#[tokio::test]
async fn create_artifact_tool_delegates_to_artifact_runtime() {
    let temp = TempDirGuard::new("create-artifact");
    let artifact_runtime = CoworkArtifactRuntime::new();
    let workspace = workspace(&temp.path);

    let result = call_artifact_tool(
        &artifact_runtime,
        &workspace,
        "create_artifact",
        Some(json!({
            "path": "notes/brief.md",
            "content": "# Brief",
            "title": "Brief",
        })),
    )
    .await
    .expect("call artifact tool")
    .expect("artifact tool handled");

    assert_eq!(result["path"], "notes/brief.md");
    assert_eq!(result["title"], "Brief");
    assert!(temp.path.join("notes/brief.md").exists());
}
