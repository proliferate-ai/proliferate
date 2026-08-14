use super::WorkspaceStore;
use crate::domains::repo_roots::test_support::seed_repo_root_1;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorkspaceRecord, WorkspaceSurface,
};
use crate::origin::OriginContext;
use crate::persistence::Db;

fn workspace_record(id: &str, kind: WorkspaceKind, path: &str) -> WorkspaceRecord {
    WorkspaceRecord {
        id: id.to_string(),
        kind,
        repo_root_id: "repo-root-1".to_string(),
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
        archived_head_sha: None,
        archived_branch: None,
        archived_at: None,
        partial_capture_json: None,
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
    }
}

fn store_with_repo_root() -> (Db, WorkspaceStore) {
    let db = Db::open_in_memory().expect("open db");
    seed_repo_root_1(&db);
    let store = WorkspaceStore::new(db.clone());
    (db, store)
}

#[test]
fn stores_and_loads_workspace_origin() {
    let (_db, store) = store_with_repo_root();

    let mut workspace =
        workspace_record("workspace-1", WorkspaceKind::Worktree, "/tmp/workspace-1");
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
    let (db, store) = store_with_repo_root();

    let workspace = workspace_record("workspace-1", WorkspaceKind::Worktree, "/tmp/workspace-1");
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
    let (_db, store) = store_with_repo_root();

    let mut workspace =
        workspace_record("workspace-1", WorkspaceKind::Worktree, "/tmp/workspace-1");
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
    let (db, store) = store_with_repo_root();

    let workspace = workspace_record("workspace-1", WorkspaceKind::Worktree, "/tmp/workspace-1");
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
fn active_path_lookup_ignores_archived_rows() {
    let (_db, store) = store_with_repo_root();

    let mut archived = workspace_record(
        "workspace-archived",
        WorkspaceKind::Worktree,
        "/tmp/workspace",
    );
    archived.created_at = "2024-01-01T00:00:00Z".to_string();
    archived.lifecycle_state = WorkspaceLifecycleState::Archived;
    archived.cleanup_state = WorkspaceCleanupState::Complete;
    let active = workspace_record(
        "workspace-active",
        WorkspaceKind::Worktree,
        "/tmp/workspace",
    );

    store.insert(&archived).expect("insert archived workspace");
    store.insert(&active).expect("insert active workspace");

    assert_eq!(
        store
            .find_by_path("/tmp/workspace")
            .expect("find any path")
            .expect("historical workspace")
            .id,
        "workspace-archived"
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
        .find_active_by_path_and_kind("/tmp/workspace", WorkspaceKind::Local)
        .expect("find active local path")
        .is_none());
}

#[test]
fn active_path_lookup_can_exclude_current_workspace() {
    let (_db, store) = store_with_repo_root();

    let current = workspace_record(
        "workspace-current",
        WorkspaceKind::Worktree,
        "/tmp/workspace",
    );
    let sibling = workspace_record("workspace-sibling", WorkspaceKind::Local, "/tmp/workspace");
    let mut archived = workspace_record(
        "workspace-archived",
        WorkspaceKind::Worktree,
        "/tmp/workspace",
    );
    archived.lifecycle_state = WorkspaceLifecycleState::Archived;
    archived.cleanup_state = WorkspaceCleanupState::Complete;

    store.insert(&current).expect("insert current workspace");
    store.insert(&sibling).expect("insert sibling workspace");
    store.insert(&archived).expect("insert archived workspace");

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
    let (_db, store) = store_with_repo_root();

    let current = workspace_record(
        "workspace-current",
        WorkspaceKind::Worktree,
        "/tmp/workspace",
    );
    let local_sibling = workspace_record("workspace-local", WorkspaceKind::Local, "/tmp/workspace");
    store.insert(&current).expect("insert current workspace");
    store
        .insert(&local_sibling)
        .expect("insert local sibling workspace");

    assert!(store
        .find_active_by_path_and_kind_excluding_id(
            "/tmp/workspace",
            WorkspaceKind::Worktree,
            "workspace-current",
        )
        .expect("find worktree active path excluding current")
        .is_none());

    let worktree_sibling = workspace_record(
        "workspace-worktree-sibling",
        WorkspaceKind::Worktree,
        "/tmp/workspace",
    );
    store
        .insert(&worktree_sibling)
        .expect("insert worktree sibling workspace");

    assert_eq!(
        store
            .find_active_by_path_and_kind_excluding_id(
                "/tmp/workspace",
                WorkspaceKind::Worktree,
                "workspace-current",
            )
            .expect("find worktree active path excluding current")
            .expect("worktree sibling")
            .id,
        "workspace-worktree-sibling"
    );
}

#[test]
fn archived_lookup_reserves_the_path_of_every_archived_row() {
    let (_db, store) = store_with_repo_root();

    // An archived row reserves its path for its lifetime, whatever its
    // cleanup bookkeeping says: unarchive restores in place and never
    // relocates, so a completed-cleanup row claims its path exactly like a
    // failed-cleanup one.
    let mut complete = workspace_record(
        "workspace-complete",
        WorkspaceKind::Worktree,
        "/tmp/complete",
    );
    complete.lifecycle_state = WorkspaceLifecycleState::Archived;
    complete.cleanup_state = WorkspaceCleanupState::Complete;
    let mut failed = workspace_record("workspace-failed", WorkspaceKind::Worktree, "/tmp/failed");
    failed.lifecycle_state = WorkspaceLifecycleState::Archived;
    failed.cleanup_state = WorkspaceCleanupState::Failed;
    let active = workspace_record("workspace-active", WorkspaceKind::Worktree, "/tmp/active");

    store.insert(&complete).expect("insert complete workspace");
    store.insert(&failed).expect("insert failed workspace");
    store.insert(&active).expect("insert active workspace");

    assert_eq!(
        store
            .find_archived_by_path_and_kind("/tmp/complete", WorkspaceKind::Worktree)
            .expect("lookup complete path")
            .expect("archived workspace claims its path")
            .id,
        "workspace-complete"
    );
    assert_eq!(
        store
            .find_archived_by_path_and_kind("/tmp/failed", WorkspaceKind::Worktree)
            .expect("lookup failed path")
            .expect("archived workspace claims its path")
            .id,
        "workspace-failed"
    );
    // An active row's path is not reserved by this predicate, and kind is
    // part of the claim.
    assert!(store
        .find_archived_by_path_and_kind("/tmp/active", WorkspaceKind::Worktree)
        .expect("lookup active path")
        .is_none());
    assert!(store
        .find_archived_by_path_and_kind("/tmp/failed", WorkspaceKind::Local)
        .expect("lookup failed path as local")
        .is_none());
}

#[test]
fn active_repo_root_listing_ignores_archived_rows() {
    let (_db, store) = store_with_repo_root();

    let mut archived =
        workspace_record("workspace-archived", WorkspaceKind::Worktree, "/tmp/archived");
    archived.lifecycle_state = WorkspaceLifecycleState::Archived;
    archived.cleanup_state = WorkspaceCleanupState::Complete;
    let active = workspace_record("workspace-active", WorkspaceKind::Worktree, "/tmp/active");

    store.insert(&archived).expect("insert archived workspace");
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
    let (_db, store) = store_with_repo_root();

    let workspace = workspace_record("workspace-1", WorkspaceKind::Worktree, "/tmp/workspace-1");
    store.insert(&workspace).expect("insert workspace");
    store
        .update_lifecycle_cleanup_state(
            &workspace.id,
            WorkspaceLifecycleState::Archived,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Retire),
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
    assert_eq!(stored.lifecycle_state, WorkspaceLifecycleState::Archived);
    assert_eq!(stored.cleanup_state, WorkspaceCleanupState::Failed);
    assert_eq!(
        stored.cleanup_operation,
        Some(WorkspaceCleanupOperation::Retire)
    );
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
fn unknown_lifecycle_value_does_not_brick_listings() {
    let (db, store) = store_with_repo_root();

    let corrupted = workspace_record(
        "workspace-corrupted",
        WorkspaceKind::Worktree,
        "/tmp/corrupted",
    );
    let active = workspace_record("workspace-active", WorkspaceKind::Worktree, "/tmp/active");
    store.insert(&corrupted).expect("insert corrupted workspace");
    store.insert(&active).expect("insert active workspace");

    db.with_conn(|conn| {
        conn.execute("PRAGMA ignore_check_constraints = ON", [])?;
        conn.execute(
            "UPDATE workspaces SET lifecycle_state = 'future_state' WHERE id = ?1",
            [corrupted.id.as_str()],
        )?;
        Ok(())
    })
    .expect("corrupt lifecycle_state to a value neither binary knows");

    let surfaces = store
        .list_execution_surfaces()
        .expect("an unknown lifecycle_state must not brick the whole listing");
    assert_eq!(surfaces.len(), 2);

    let corrupted_row = surfaces
        .iter()
        .find(|workspace| workspace.id == corrupted.id)
        .expect("corrupted workspace is still returned by the listing");
    assert_eq!(
        corrupted_row.lifecycle_state,
        WorkspaceLifecycleState::Archived
    );

    let active_row = surfaces
        .iter()
        .find(|workspace| workspace.id == active.id)
        .expect("untouched workspace is still returned by the listing");
    assert_eq!(active_row.lifecycle_state, WorkspaceLifecycleState::Active);

    let active_only = store
        .list_active_by_repo_root_id("repo-root-1")
        .expect("list active repo-root workspaces");
    assert_eq!(
        active_only
            .iter()
            .map(|workspace| workspace.id.as_str())
            .collect::<Vec<_>>(),
        vec![active.id.as_str()]
    );
}

#[test]
fn unknown_lifecycle_value_survives_unrelated_mutation() {
    let (db, store) = store_with_repo_root();

    let corrupted = workspace_record(
        "workspace-corrupted",
        WorkspaceKind::Worktree,
        "/tmp/corrupted",
    );
    store.insert(&corrupted).expect("insert corrupted workspace");

    db.with_conn(|conn| {
        conn.execute("PRAGMA ignore_check_constraints = ON", [])?;
        conn.execute(
            "UPDATE workspaces SET lifecycle_state = 'future_state' WHERE id = ?1",
            [corrupted.id.as_str()],
        )?;
        Ok(())
    })
    .expect("corrupt lifecycle_state to a value neither binary knows");

    store
        .update_display_name(&corrupted.id, Some("renamed"), "2026-04-29T12:00:01Z")
        .expect("update display name");

    let raw_lifecycle_state: String = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT lifecycle_state FROM workspaces WHERE id = ?1",
                [corrupted.id.as_str()],
                |row| row.get(0),
            )
        })
        .expect("read raw lifecycle_state");

    // Read-tolerant, write-never: the unrelated mutation must not have
    // normalized the unknown value to the literal string "archived".
    assert_eq!(raw_lifecycle_state, "future_state");
}

#[test]
fn archive_columns_round_trip_through_insert_and_read() {
    let (_db, store) = store_with_repo_root();

    let mut workspace =
        workspace_record("workspace-archived", WorkspaceKind::Worktree, "/tmp/archived");
    workspace.lifecycle_state = WorkspaceLifecycleState::Archived;
    workspace.archived_head_sha = Some("a".repeat(40));
    workspace.archived_branch = Some("feature/archive-me".to_string());
    workspace.archived_at = Some("2026-08-13T00:00:00Z".to_string());
    workspace.partial_capture_json =
        Some(r#"{"tracked":["src/big.bin"],"untracked":[]}"#.to_string());

    store.insert(&workspace).expect("insert workspace");
    let stored = store
        .find_by_id(&workspace.id)
        .expect("find workspace")
        .expect("workspace record");

    assert_eq!(stored.archived_head_sha, workspace.archived_head_sha);
    assert_eq!(stored.archived_branch, workspace.archived_branch);
    assert_eq!(stored.archived_at, workspace.archived_at);
    assert_eq!(stored.partial_capture_json, workspace.partial_capture_json);

    let never_archived =
        workspace_record("workspace-active", WorkspaceKind::Worktree, "/tmp/active");
    store.insert(&never_archived).expect("insert workspace");
    let stored = store
        .find_by_id(&never_archived.id)
        .expect("find workspace")
        .expect("workspace record");
    assert_eq!(stored.archived_head_sha, None);
    assert_eq!(stored.archived_branch, None);
    assert_eq!(stored.archived_at, None);
    assert_eq!(stored.partial_capture_json, None);
}

#[test]
fn delete_workspace_removes_workspace_row() {
    let (_db, store) = store_with_repo_root();

    let workspace = workspace_record("workspace-1", WorkspaceKind::Worktree, "/tmp/workspace-1");
    store.insert(&workspace).expect("insert workspace");

    store.delete_by_id(&workspace.id).expect("delete workspace");

    assert!(store
        .find_by_id(&workspace.id)
        .expect("find deleted workspace")
        .is_none());
}
