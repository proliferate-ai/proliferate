use super::workspace_can_purge;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorkspaceRecord, WorkspaceSurface,
};

#[test]
fn workspace_can_purge_accepts_active_standard_worktree() {
    assert!(workspace_can_purge(&workspace_record(
        "worktree", "standard", "active", "none", None,
    )));
}

#[test]
fn workspace_can_purge_accepts_retired_complete_or_purge_tombstone() {
    assert!(workspace_can_purge(&workspace_record(
        "worktree",
        "standard",
        "retired",
        "complete",
        Some("retire"),
    )));
    assert!(workspace_can_purge(&workspace_record(
        "worktree",
        "standard",
        "retired",
        "failed",
        Some("purge"),
    )));
}

#[test]
fn workspace_can_purge_rejects_nonstandard_or_nonworktree_rows() {
    assert!(!workspace_can_purge(&workspace_record(
        "local", "standard", "active", "none", None,
    )));
    assert!(!workspace_can_purge(&workspace_record(
        "worktree", "cowork", "active", "none", None,
    )));
    assert!(!workspace_can_purge(&workspace_record(
        "worktree",
        "standard",
        "retired",
        "failed",
        Some("retire"),
    )));
}

fn workspace_record(
    kind: &str,
    surface: &str,
    lifecycle_state: &str,
    cleanup_state: &str,
    cleanup_operation: Option<&str>,
) -> WorkspaceRecord {
    WorkspaceRecord {
        id: "workspace-1".to_string(),
        kind: WorkspaceKind::try_from(kind).expect("test workspace kind"),
        repo_root_id: "repo-root-1".to_string(),
        path: "/tmp/workspace-1".to_string(),
        surface: WorkspaceSurface::try_from(surface).expect("test workspace surface"),
        original_branch: Some("main".to_string()),
        current_branch: Some("main".to_string()),
        display_name: None,
        origin: None,
        creator_context: None,
        lifecycle_state: WorkspaceLifecycleState::try_from(lifecycle_state)
            .expect("test lifecycle state"),
        cleanup_state: WorkspaceCleanupState::try_from(cleanup_state).expect("test cleanup state"),
        cleanup_operation: cleanup_operation.map(|operation| {
            WorkspaceCleanupOperation::try_from(operation).expect("test cleanup operation")
        }),
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
    }
}
