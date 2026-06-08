use super::{order_worktrees_by_activity, should_spawn_startup_pass};
use crate::domains::workspaces::model::{
    WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};

#[test]
fn startup_deferral_is_startup_only_gate() {
    assert!(should_spawn_startup_pass(true, false));
    assert!(!should_spawn_startup_pass(true, true));
    assert!(!should_spawn_startup_pass(false, false));
    assert!(!should_spawn_startup_pass(false, true));
}

#[test]
fn active_worktree_activity_order_uses_true_row_max() {
    let mut workspaces = vec![
        workspace_record("workspace-session-newer"),
        workspace_record("workspace-terminal-newer"),
        workspace_record("workspace-older"),
    ];

    order_worktrees_by_activity(
        &mut workspaces,
        vec![
            (
                "workspace-session-newer".to_string(),
                "2025-01-11T00:00:00Z".to_string(),
            ),
            (
                "workspace-older".to_string(),
                "2025-01-09T00:00:00Z".to_string(),
            ),
        ],
        vec![(
            "workspace-terminal-newer".to_string(),
            "2025-01-10T00:00:00Z".to_string(),
        )],
    );

    let ids = workspaces
        .into_iter()
        .map(|workspace| workspace.id)
        .collect::<Vec<_>>();

    assert_eq!(
        ids,
        vec![
            "workspace-session-newer".to_string(),
            "workspace-terminal-newer".to_string(),
            "workspace-older".to_string(),
        ]
    );
}

fn workspace_record(id: &str) -> WorkspaceRecord {
    WorkspaceRecord {
        id: id.to_string(),
        kind: WorkspaceKind::Worktree,
        repo_root_id: "repo-root-1".to_string(),
        path: format!("/tmp/{id}"),
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
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
    }
}
