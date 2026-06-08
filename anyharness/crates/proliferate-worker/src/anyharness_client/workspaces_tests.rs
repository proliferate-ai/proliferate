use serde_json::json;

use super::{AnyHarnessWorkspace, MaterializeWorkspaceRequest};

#[test]
fn materialized_result_extracts_existing_path_fields() {
    let request = MaterializeWorkspaceRequest::ExistingPath {
        path: "/workspace/proliferate".to_string(),
        display_name: Some("Proliferate".to_string()),
        origin: None,
        creator_context: None,
    };
    let result = request
        .materialized_result(&json!({
            "repoRoot": { "id": "repo-root-1" },
            "workspace": {
                "id": "workspace-1",
                "repoRootId": "repo-root-1",
                "path": "/workspace/proliferate",
                "kind": "local",
                "currentBranch": "main",
                "displayName": "Proliferate"
            }
        }))
        .expect("result");
    assert_eq!(result.mode, "existing_path");
    assert_eq!(result.anyharness_workspace_id, "workspace-1");
    assert_eq!(result.repo_root_id, "repo-root-1");
    assert_eq!(result.display_name.as_deref(), Some("Proliferate"));
}

#[test]
fn existing_path_body_does_not_pass_display_name_to_anyharness_create_body() {
    let request = MaterializeWorkspaceRequest::ExistingPath {
        path: "/workspace/proliferate".to_string(),
        display_name: Some("Proliferate".to_string()),
        origin: Some(json!({ "kind": "api", "entrypoint": "cloud" })),
        creator_context: Some(json!({ "kind": "human" })),
    };
    assert_eq!(
        request.anyharness_body(),
        json!({
            "path": "/workspace/proliferate",
            "origin": { "kind": "api", "entrypoint": "cloud" },
            "creatorContext": { "kind": "human" }
        })
    );
}

#[test]
fn materialize_workspace_bodies_expand_home_paths_for_anyharness() {
    let home = dirs::home_dir()
        .expect("home dir")
        .join("proliferate-workspaces")
        .to_string_lossy()
        .into_owned();
    let request = MaterializeWorkspaceRequest::ExistingPath {
        path: "~/proliferate-workspaces".to_string(),
        display_name: None,
        origin: None,
        creator_context: None,
    };

    assert_eq!(request.anyharness_body(), json!({ "path": home }));
}

#[test]
fn materialized_result_uses_worktree_repo_root_hint() {
    let request = MaterializeWorkspaceRequest::Worktree {
        repo_root_id: "repo-root-1".to_string(),
        target_path: "/workspace/feature".to_string(),
        new_branch_name: "feature".to_string(),
        base_branch: Some("main".to_string()),
        checkout_mode: None,
        setup_script: None,
        name_conflict_policy: None,
        origin: None,
        creator_context: None,
    };
    let result = request
        .materialized_result(&json!({
            "workspace": {
                "id": "workspace-2",
                "path": "/workspace/feature",
                "kind": "worktree",
                "currentBranch": "feature",
                "originalBranch": "main"
            }
        }))
        .expect("result");
    assert_eq!(result.mode, "worktree");
    assert_eq!(result.repo_root_id, "repo-root-1");
}

#[test]
fn worktree_body_uses_anyharness_camel_case_fields() {
    let request = MaterializeWorkspaceRequest::Worktree {
        repo_root_id: "repo-root-1".to_string(),
        target_path: "/workspace/feature".to_string(),
        new_branch_name: "feature".to_string(),
        base_branch: Some("main".to_string()),
        checkout_mode: Some("detached_ref".to_string()),
        setup_script: Some("pnpm install".to_string()),
        name_conflict_policy: Some("suffix_path".to_string()),
        origin: None,
        creator_context: None,
    };
    assert_eq!(
        request.anyharness_body(),
        json!({
            "repoRootId": "repo-root-1",
            "targetPath": "/workspace/feature",
            "newBranchName": "feature",
            "baseBranch": "main",
            "checkoutMode": "detached_ref",
            "setupScript": "pnpm install",
            "nameConflictPolicy": "suffix_path"
        })
    );
}

#[test]
fn worktree_recovery_requires_expected_workspace_shape() {
    let request = MaterializeWorkspaceRequest::Worktree {
        repo_root_id: "repo-root-1".to_string(),
        target_path: "/workspace/feature".to_string(),
        new_branch_name: "feature".to_string(),
        base_branch: Some("main".to_string()),
        checkout_mode: None,
        setup_script: None,
        name_conflict_policy: None,
        origin: None,
        creator_context: None,
    };
    assert!(request.recovered_worktree_is_expected(&json!({
        "workspace": {
            "id": "workspace-2",
            "repoRootId": "repo-root-1",
            "path": "/workspace/feature",
            "kind": "worktree",
            "currentBranch": "feature"
        }
    })));
    assert!(!request.recovered_worktree_is_expected(&json!({
        "workspace": {
            "id": "workspace-2",
            "repoRootId": "repo-root-1",
            "path": "/workspace/feature",
            "kind": "worktree",
            "currentBranch": "other"
        }
    })));
    assert!(!request.recovered_worktree_is_expected(&json!({
        "workspace": {
            "id": "workspace-2",
            "repoRootId": "other-root",
            "path": "/workspace/feature",
            "kind": "worktree",
            "currentBranch": "feature"
        }
    })));
}

#[test]
fn worktree_recovery_accepts_suffixed_path_with_expected_branch() {
    let request = MaterializeWorkspaceRequest::Worktree {
        repo_root_id: "repo-root-1".to_string(),
        target_path: "/workspace/feature".to_string(),
        new_branch_name: "feature".to_string(),
        base_branch: Some("main".to_string()),
        checkout_mode: None,
        setup_script: None,
        name_conflict_policy: Some("suffix_path".to_string()),
        origin: None,
        creator_context: None,
    };
    assert!(
        request.recovered_worktree_workspace_is_expected(&AnyHarnessWorkspace {
            id: "workspace-2".to_string(),
            kind: "worktree".to_string(),
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace/feature-2".to_string(),
            original_branch: Some("main".to_string()),
            current_branch: Some("feature".to_string()),
            display_name: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
    );
    assert!(
        !request.recovered_worktree_workspace_is_expected(&AnyHarnessWorkspace {
            id: "workspace-3".to_string(),
            kind: "worktree".to_string(),
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace/feature-3".to_string(),
            original_branch: Some("main".to_string()),
            current_branch: Some("other".to_string()),
            display_name: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
    );
    assert!(
        !request.recovered_worktree_workspace_is_expected(&AnyHarnessWorkspace {
            id: "workspace-4".to_string(),
            kind: "worktree".to_string(),
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace/other".to_string(),
            original_branch: Some("main".to_string()),
            current_branch: Some("feature".to_string()),
            display_name: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
    );
}

#[test]
fn strict_worktree_recovery_rejects_suffixed_path() {
    let request = MaterializeWorkspaceRequest::Worktree {
        repo_root_id: "repo-root-1".to_string(),
        target_path: "/workspace/feature".to_string(),
        new_branch_name: "feature".to_string(),
        base_branch: Some("main".to_string()),
        checkout_mode: None,
        setup_script: None,
        name_conflict_policy: None,
        origin: None,
        creator_context: None,
    };
    assert!(
        request.recovered_worktree_workspace_is_expected(&AnyHarnessWorkspace {
            id: "workspace-2".to_string(),
            kind: "worktree".to_string(),
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace/feature".to_string(),
            original_branch: Some("main".to_string()),
            current_branch: Some("feature".to_string()),
            display_name: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
    );
    assert!(
        !request.recovered_worktree_workspace_is_expected(&AnyHarnessWorkspace {
            id: "workspace-3".to_string(),
            kind: "worktree".to_string(),
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace/feature-2".to_string(),
            original_branch: Some("main".to_string()),
            current_branch: Some("feature".to_string()),
            display_name: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
    );
}

#[test]
fn detached_worktree_recovery_accepts_head_with_expected_original_branch() {
    let request = MaterializeWorkspaceRequest::Worktree {
        repo_root_id: "repo-root-1".to_string(),
        target_path: "/workspace/feature".to_string(),
        new_branch_name: "generated/otter".to_string(),
        base_branch: Some("feature/base".to_string()),
        checkout_mode: Some("detached_ref".to_string()),
        setup_script: None,
        name_conflict_policy: Some("suffix_path".to_string()),
        origin: None,
        creator_context: None,
    };
    assert!(request.recovered_worktree_is_expected(&json!({
        "workspace": {
            "id": "workspace-2",
            "repoRootId": "repo-root-1",
            "path": "/workspace/feature",
            "kind": "worktree",
            "currentBranch": "HEAD",
            "originalBranch": "feature/base"
        }
    })));
    assert!(!request.recovered_worktree_is_expected(&json!({
        "workspace": {
            "id": "workspace-2",
            "repoRootId": "repo-root-1",
            "path": "/workspace/feature",
            "kind": "worktree",
            "currentBranch": "feature/base",
            "originalBranch": "feature/base"
        }
    })));
    assert!(!request.recovered_worktree_is_expected(&json!({
        "workspace": {
            "id": "workspace-2",
            "repoRootId": "repo-root-1",
            "path": "/workspace/feature",
            "kind": "worktree",
            "currentBranch": "HEAD"
        }
    })));
    assert!(
        !request.recovered_worktree_workspace_is_expected(&AnyHarnessWorkspace {
            id: "workspace-3".to_string(),
            kind: "worktree".to_string(),
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace/other".to_string(),
            original_branch: Some("feature/base".to_string()),
            current_branch: Some("HEAD".to_string()),
            display_name: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
    );
}
