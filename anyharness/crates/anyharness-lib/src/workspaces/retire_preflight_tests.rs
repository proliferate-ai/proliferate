use super::workspace_can_purge;
use crate::workspaces::model::WorkspaceRecord;

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
        "worktree", "mobility", "active", "none", None,
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
        kind: kind.to_string(),
        repo_root_id: None,
        path: "/tmp/workspace-1".to_string(),
        surface: surface.to_string(),
        source_repo_root_path: "/tmp/source".to_string(),
        source_workspace_id: None,
        git_provider: None,
        git_owner: None,
        git_repo_name: None,
        original_branch: Some("main".to_string()),
        current_branch: Some("main".to_string()),
        display_name: None,
        origin: None,
        creator_context: None,
        lifecycle_state: lifecycle_state.to_string(),
        cleanup_state: cleanup_state.to_string(),
        cleanup_operation: cleanup_operation.map(str::to_string),
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
    }
}
