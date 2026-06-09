use std::path::Path;

use uuid::Uuid;

use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{
    WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};
use crate::domains::workspaces::resolver;
use crate::origin::OriginContext;

pub(super) fn build_workspace_record(
    repo_root: &RepoRootRecord,
    path: &str,
    kind: WorkspaceKind,
    surface: WorkspaceSurface,
    current_branch: Option<String>,
    original_branch: Option<String>,
    origin: OriginContext,
    creator_context: Option<WorkspaceCreatorContext>,
) -> WorkspaceRecord {
    let now = chrono::Utc::now().to_rfc3339();
    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind,
        repo_root_id: repo_root.id.clone(),
        path: path.to_string(),
        surface,
        original_branch,
        current_branch,
        display_name: None,
        origin: Some(origin),
        creator_context,
        lifecycle_state: WorkspaceLifecycleState::Active,
        cleanup_state: WorkspaceCleanupState::None,
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub(super) fn reconcile_current_branch(
    mut record: WorkspaceRecord,
) -> anyhow::Result<WorkspaceRecord> {
    if let Ok(ctx) = resolver::resolve_git_context(&record.path) {
        record.current_branch = ctx.current_branch;
    } else if record.current_branch.as_deref() == Some("HEAD") {
        record.current_branch = None;
    }
    Ok(record)
}
pub(super) fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo")
        .to_string()
}
