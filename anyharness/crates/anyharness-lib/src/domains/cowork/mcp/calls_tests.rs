use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::calls::{call_artifact_tool, ensure_tool_available};
use super::calls_helpers::default_launch_selection;
use super::context::CoworkMcpContext;
use crate::domains::agents::launch_options::{
    HarnessLaunchControl, HarnessLaunchControlValue, HarnessLaunchDefaults, HarnessLaunchModel,
    HarnessLaunchModelControls, HarnessLaunchOptions,
};
use crate::domains::cowork::artifacts::CoworkArtifactRuntime;
use crate::domains::workspaces::model::{
    WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord, WorkspaceSurface,
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
        archived_head_sha: None,
        archived_branch: None,
        archived_at: None,
        partial_capture_json: None,
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

#[test]
fn cowork_defaults_use_the_exact_default_model_scope() {
    let control = |id: &str, value: &str| HarnessLaunchControl {
        id: id.to_string(),
        observed_label: None,
        observed_description: None,
        values: vec![HarnessLaunchControlValue {
            value: value.to_string(),
            observed_label: None,
            observed_description: None,
        }],
    };
    let options = HarnessLaunchOptions {
        models: vec![HarnessLaunchModel {
            id: "fable".to_string(),
            observed_name: None,
            observed_description: None,
        }],
        controls: vec![control("mode", "default"), control("fast", "off")],
        defaults: HarnessLaunchDefaults {
            model_id: Some("fable".to_string()),
            control_values: [
                ("mode".to_string(), "default".to_string()),
                ("fast".to_string(), "off".to_string()),
            ]
            .into_iter()
            .collect(),
        },
        model_controls: vec![HarnessLaunchModelControls {
            model_id: "fable".to_string(),
            controls: vec![control("mode", "default")],
            default_control_values: [("mode".to_string(), "default".to_string())]
                .into_iter()
                .collect(),
        }],
    };

    let (model_id, control_values) = default_launch_selection(&options);

    assert_eq!(model_id.as_deref(), Some("fable"));
    assert_eq!(
        control_values,
        [("mode".to_string(), "default".to_string())]
            .into_iter()
            .collect()
    );
}
