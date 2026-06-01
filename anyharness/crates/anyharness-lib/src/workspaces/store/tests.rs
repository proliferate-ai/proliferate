use super::WorkspaceStore;
use crate::origin::OriginContext;
use crate::persistence::Db;
use crate::workspaces::creator_context::WorkspaceCreatorContext;
use crate::workspaces::model::WorkspaceRecord;

fn workspace_record(id: &str, kind: &str, path: &str) -> WorkspaceRecord {
    WorkspaceRecord {
        id: id.to_string(),
        kind: kind.to_string(),
        repo_root_id: None,
        path: path.to_string(),
        surface: "standard".to_string(),
        source_repo_root_path: path.to_string(),
        source_workspace_id: None,
        git_provider: None,
        git_owner: None,
        git_repo_name: None,
        original_branch: Some("main".to_string()),
        current_branch: Some("main".to_string()),
        display_name: None,
        origin: None,
        creator_context: None,
        lifecycle_state: "active".to_string(),
        cleanup_state: "none".to_string(),
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
    }
}

#[test]
fn stores_and_loads_workspace_origin() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let mut workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
    workspace.origin = Some(OriginContext::human_desktop());

    store.insert(&workspace).expect("insert workspace");
    let stored = store
        .find_by_id(&workspace.id)
        .expect("find workspace")
        .expect("workspace record");

    assert_eq!(stored.origin, Some(OriginContext::human_desktop()));
}

#[test]
fn malformed_workspace_origin_is_omitted() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db.clone());

    let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
    store.insert(&workspace).expect("insert workspace");

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE workspaces SET origin_json = ?1 WHERE id = ?2",
            [
                "{\"kind\":\"automation\",\"entrypoint\":\"cloud\"}",
                &workspace.id,
            ],
        )?;
        Ok(())
    })
    .expect("corrupt origin JSON");

    let stored = store
        .find_by_id(&workspace.id)
        .expect("find workspace")
        .expect("workspace record");

    assert_eq!(stored.origin, None);
}

#[test]
fn stores_and_loads_workspace_creator_context() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let mut workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
    workspace.creator_context = Some(WorkspaceCreatorContext::Agent {
        source_session_id: "session-1".to_string(),
        source_session_workspace_id: Some("workspace-parent".to_string()),
        session_link_id: None,
        source_workspace_id: Some("workspace-source".to_string()),
        label: Some("Cowork thread".to_string()),
    });

    store.insert(&workspace).expect("insert workspace");
    let stored = store
        .find_by_id(&workspace.id)
        .expect("find workspace")
        .expect("workspace record");

    assert_eq!(stored.creator_context, workspace.creator_context);
}

#[test]
fn malformed_workspace_creator_context_is_omitted() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db.clone());

    let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
    store.insert(&workspace).expect("insert workspace");

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE workspaces SET creator_context_json = ?1 WHERE id = ?2",
            ["{\"kind\":\"agent\",\"sourceSessionId\":42}", &workspace.id],
        )?;
        Ok(())
    })
    .expect("corrupt creator context JSON");

    let stored = store
        .find_by_id(&workspace.id)
        .expect("find workspace")
        .expect("workspace record");

    assert_eq!(stored.creator_context, None);
}

#[test]
fn active_path_lookup_ignores_retired_rows() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let mut retired = workspace_record("workspace-retired", "worktree", "/tmp/workspace");
    retired.created_at = "2024-01-01T00:00:00Z".to_string();
    retired.lifecycle_state = "retired".to_string();
    retired.cleanup_state = "complete".to_string();
    let active = workspace_record("workspace-active", "worktree", "/tmp/workspace");

    store.insert(&retired).expect("insert retired workspace");
    store.insert(&active).expect("insert active workspace");

    assert_eq!(
        store
            .find_by_path("/tmp/workspace")
            .expect("find any path")
            .expect("historical workspace")
            .id,
        "workspace-retired"
    );
    assert_eq!(
        store
            .find_active_by_path("/tmp/workspace")
            .expect("find active path")
            .expect("active workspace")
            .id,
        "workspace-active"
    );
    assert!(store
        .find_active_by_path_and_kind("/tmp/workspace", "local")
        .expect("find active local path")
        .is_none());
}

#[test]
fn active_path_lookup_can_exclude_current_workspace() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let current = workspace_record("workspace-current", "worktree", "/tmp/workspace");
    let sibling = workspace_record("workspace-sibling", "local", "/tmp/workspace");
    let mut retired = workspace_record("workspace-retired", "worktree", "/tmp/workspace");
    retired.lifecycle_state = "retired".to_string();
    retired.cleanup_state = "complete".to_string();

    store.insert(&current).expect("insert current workspace");
    store.insert(&sibling).expect("insert sibling workspace");
    store.insert(&retired).expect("insert retired workspace");

    assert_eq!(
        store
            .find_active_by_path_excluding_id("/tmp/workspace", "workspace-current")
            .expect("find active path excluding current")
            .expect("sibling active workspace")
            .id,
        "workspace-sibling"
    );
    assert!(store
        .find_active_by_path_excluding_id("/tmp/workspace", "workspace-sibling")
        .expect("find active path excluding sibling")
        .is_some());
    assert!(store
        .find_active_by_path_excluding_id("/tmp/other", "workspace-current")
        .expect("find active path for missing path")
        .is_none());
}

#[test]
fn active_path_and_kind_lookup_excludes_current_workspace() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let current = workspace_record("workspace-current", "worktree", "/tmp/workspace");
    let local_sibling = workspace_record("workspace-local", "local", "/tmp/workspace");
    store.insert(&current).expect("insert current workspace");
    store
        .insert(&local_sibling)
        .expect("insert local sibling workspace");

    assert!(store
        .find_active_by_path_and_kind_excluding_id(
            "/tmp/workspace",
            "worktree",
            "workspace-current",
        )
        .expect("find worktree active path excluding current")
        .is_none());

    let worktree_sibling =
        workspace_record("workspace-worktree-sibling", "worktree", "/tmp/workspace");
    store
        .insert(&worktree_sibling)
        .expect("insert worktree sibling workspace");

    assert_eq!(
        store
            .find_active_by_path_and_kind_excluding_id(
                "/tmp/workspace",
                "worktree",
                "workspace-current",
            )
            .expect("find worktree active path excluding current")
            .expect("worktree sibling")
            .id,
        "workspace-worktree-sibling"
    );
}

#[test]
fn retired_incomplete_cleanup_lookup_tracks_path_ownership() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let mut complete = workspace_record("workspace-complete", "worktree", "/tmp/complete");
    complete.lifecycle_state = "retired".to_string();
    complete.cleanup_state = "complete".to_string();
    let mut failed = workspace_record("workspace-failed", "worktree", "/tmp/failed");
    failed.lifecycle_state = "retired".to_string();
    failed.cleanup_state = "failed".to_string();

    store.insert(&complete).expect("insert complete workspace");
    store.insert(&failed).expect("insert failed workspace");

    assert!(store
        .find_retired_incomplete_cleanup_by_path_and_kind("/tmp/complete", "worktree")
        .expect("lookup complete path")
        .is_none());
    assert_eq!(
        store
            .find_retired_incomplete_cleanup_by_path_and_kind("/tmp/failed", "worktree")
            .expect("lookup failed path")
            .expect("failed retired workspace")
            .id,
        "workspace-failed"
    );
}

#[test]
fn active_repo_root_listing_ignores_retired_rows() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let mut retired = workspace_record("workspace-retired", "worktree", "/tmp/retired");
    retired.repo_root_id = Some("repo-root-1".to_string());
    retired.lifecycle_state = "retired".to_string();
    retired.cleanup_state = "complete".to_string();
    let mut active = workspace_record("workspace-active", "worktree", "/tmp/active");
    active.repo_root_id = Some("repo-root-1".to_string());

    store.insert(&retired).expect("insert retired workspace");
    store.insert(&active).expect("insert active workspace");

    let workspaces = store
        .list_active_by_repo_root_id("repo-root-1")
        .expect("list active repo-root workspaces");
    assert_eq!(
        workspaces
            .iter()
            .map(|workspace| workspace.id.as_str())
            .collect::<Vec<_>>(),
        vec!["workspace-active"]
    );
}

#[test]
fn lifecycle_cleanup_update_preserves_workspace_and_persists_failure_detail() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
    store.insert(&workspace).expect("insert workspace");
    store
        .update_lifecycle_cleanup_state(
            &workspace.id,
            "retired",
            "failed",
            Some("retire"),
            Some("permission denied"),
            Some("2026-04-29T12:00:00Z"),
            Some("2026-04-29T11:59:00Z"),
            "2026-04-29T12:00:01Z",
        )
        .expect("update lifecycle cleanup");

    let stored = store
        .find_by_id(&workspace.id)
        .expect("find workspace")
        .expect("workspace should still exist");
    assert_eq!(stored.lifecycle_state, "retired");
    assert_eq!(stored.cleanup_state, "failed");
    assert_eq!(stored.cleanup_operation.as_deref(), Some("retire"));
    assert_eq!(
        stored.cleanup_error_message.as_deref(),
        Some("permission denied")
    );
    assert_eq!(
        stored.cleanup_failed_at.as_deref(),
        Some("2026-04-29T12:00:00Z")
    );
    assert_eq!(
        stored.cleanup_attempted_at.as_deref(),
        Some("2026-04-29T11:59:00Z")
    );
    assert_eq!(stored.updated_at, "2026-04-29T12:00:01Z");
}

#[test]
fn delete_workspace_removes_workspace_row() {
    let db = Db::open_in_memory().expect("open db");
    let store = WorkspaceStore::new(db);

    let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
    store.insert(&workspace).expect("insert workspace");

    store.delete_by_id(&workspace.id).expect("delete workspace");

    assert!(store
        .find_by_id(&workspace.id)
        .expect("find deleted workspace")
        .is_none());
}
