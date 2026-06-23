use anyharness_contract::v1::{
    WorkspacePurgeOutcome, WorkspacePurgePreflightResponse, WorkspacePurgeResponse,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::error::ApiError;
use super::workspaces_contract::{
    workspace_cleanup_operation_to_contract, workspace_cleanup_to_contract,
    workspace_kind_to_contract, workspace_lifecycle_to_contract, workspace_to_contract,
};
use crate::app::AppState;
use crate::domains::workspaces::purge::WorkspacePurgeServiceOutcome;
use crate::domains::workspaces::retire_preflight::RetirePreflightMode;

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/purge/preflight",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Purge preflight", body = WorkspacePurgePreflightResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn purge_workspace_preflight(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspacePurgePreflightResponse>, ApiError> {
    Ok(Json(build_purge_preflight(&state, &workspace_id).await?))
}

#[utoipa::path(
    delete,
    path = "/v1/workspaces/{workspace_id}",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Purge workspace result", body = WorkspacePurgeResponse),
    ),
    tag = "workspaces"
)]
pub async fn purge_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspacePurgeResponse>, ApiError> {
    purge_response_from_service_outcome(
        &state,
        None,
        state
            .workspace_purge_service
            .purge(&workspace_id, false)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
    )
    .await
    .map(Json)
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/purge/retry",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Purge retry result", body = WorkspacePurgeResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retry_purge_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspacePurgeResponse>, ApiError> {
    let _ = build_purge_preflight(&state, &workspace_id).await?;
    purge_response_from_service_outcome(
        &state,
        None,
        state
            .workspace_purge_service
            .purge(&workspace_id, true)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?,
    )
    .await
    .map(Json)
}

async fn build_purge_preflight(
    state: &AppState,
    workspace_id: &str,
) -> Result<WorkspacePurgePreflightResponse, ApiError> {
    let workspace = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let preflight = state
        .retire_preflight_checker
        .check_workspace(workspace.clone(), RetirePreflightMode::Purge)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(WorkspacePurgePreflightResponse {
        workspace_id: workspace.id,
        workspace_kind: workspace_kind_to_contract(workspace.kind),
        lifecycle_state: workspace_lifecycle_to_contract(workspace.lifecycle_state),
        cleanup_state: workspace_cleanup_to_contract(workspace.cleanup_state),
        cleanup_operation: workspace
            .cleanup_operation
            .map(workspace_cleanup_operation_to_contract),
        can_purge: preflight.can_purge,
        materialized: preflight.materialized,
        blockers: preflight.blockers,
    })
}

async fn purge_response_from_service_outcome(
    state: &AppState,
    preflight: Option<WorkspacePurgePreflightResponse>,
    outcome: WorkspacePurgeServiceOutcome,
) -> Result<WorkspacePurgeResponse, ApiError> {
    match outcome {
        WorkspacePurgeServiceOutcome::Deleted {
            already_deleted,
            cleanup_attempted,
        } => Ok(WorkspacePurgeResponse {
            outcome: WorkspacePurgeOutcome::Deleted,
            workspace: None,
            preflight,
            already_deleted,
            cleanup_attempted,
            cleanup_succeeded: true,
            cleanup_message: None,
        }),
        WorkspacePurgeServiceOutcome::Blocked { workspace, message } => {
            Ok(WorkspacePurgeResponse {
                outcome: WorkspacePurgeOutcome::Blocked,
                workspace: Some(workspace_to_contract(state, workspace).await?),
                preflight,
                already_deleted: false,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(message),
            })
        }
        WorkspacePurgeServiceOutcome::CleanupFailed { workspace, message } => {
            Ok(WorkspacePurgeResponse {
                outcome: WorkspacePurgeOutcome::CleanupFailed,
                workspace: Some(workspace_to_contract(state, workspace).await?),
                preflight,
                already_deleted: false,
                cleanup_attempted: true,
                cleanup_succeeded: false,
                cleanup_message: Some(message),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;
    use crate::app::test_support;
    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
        WorkspaceRecord, WorkspaceSurface,
    };
    use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
    use crate::domains::workspaces::store::WorkspaceStore;
    use crate::persistence::Db;
    use anyharness_contract::v1::WorkspaceRetireBlockerCode;

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_allows_retired_complete_workspace() {
        let state = test_state("purge-retired-complete");
        let workspace = workspace_record(
            "workspace-retired-complete",
            "retired",
            "complete",
            Some("retire"),
        );
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(preflight.can_purge);
        assert!(preflight.blockers.is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_allows_retired_purge_retry_workspace() {
        let state = test_state("purge-retired-retry");
        let workspace =
            workspace_record("workspace-purge-retry", "retired", "failed", Some("purge"));
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(preflight.can_purge);
        assert!(preflight.blockers.is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_allows_dirty_active_workspace() {
        let checkout = TempDirGuard::new("purge-dirty-active");
        run_git(checkout.path(), ["init"]);
        std::fs::write(checkout.path().join("dirty.txt"), "delete me").expect("write dirty file");

        let state = test_state("purge-dirty-active");
        let workspace = workspace_record_with_path(
            "workspace-dirty-active",
            "active",
            "none",
            None,
            checkout.path().to_string_lossy().as_ref(),
        );
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(preflight.can_purge);
        assert!(preflight.blockers.iter().all(|blocker| {
            blocker.code != WorkspaceRetireBlockerCode::DirtyWorkingTree
                && blocker.code != WorkspaceRetireBlockerCode::ConflictedFiles
                && blocker.code != WorkspaceRetireBlockerCode::ActiveGitOperation
        }));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_reports_single_unsupported_workspace_blocker() {
        let state = test_state("purge-unsupported");
        let workspace = workspace_record_with_kind_surface(
            "workspace-local",
            "local",
            "standard",
            "active",
            "none",
            None,
            "/tmp/anyharness-local-workspace",
        );
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(!preflight.can_purge);
        assert_eq!(preflight.blockers.len(), 1);
        assert_eq!(
            preflight.blockers[0].message,
            "Purge is only available for standard worktree workspaces."
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_preflight_still_blocks_active_workspace_operations() {
        let state = test_state("purge-active-operation");
        let workspace = workspace_record("workspace-active-operation", "active", "none", None);
        WorkspaceStore::new(state.db.clone())
            .insert(&workspace)
            .expect("insert workspace");
        let _lease = state
            .workspace_operation_gate
            .acquire_shared(&workspace.id, WorkspaceOperationKind::ProcessRun)
            .await;

        let preflight = match build_purge_preflight(&state, &workspace.id).await {
            Ok(preflight) => preflight,
            Err(_) => panic!("purge preflight failed"),
        };

        assert!(!preflight.can_purge);
        assert!(preflight
            .blockers
            .iter()
            .any(|blocker| blocker.code == WorkspaceRetireBlockerCode::RunningCommand));
    }

    fn test_state(name: &str) -> AppState {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _bearer_guard = test_support::set_bearer_token_env(None);
        let _data_key_guard = test_support::set_data_key_env(None);
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO repo_roots (
                    id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                    remote_repo_name, remote_url, created_at, updated_at
                 ) VALUES (
                    'repo-root-1', 'external', '/tmp/repo-root-1', NULL, 'main', NULL, NULL,
                    NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
                 )",
                [],
            )?;
            Ok(())
        })
        .expect("seed repo root");
        AppState::new(
            PathBuf::from(format!("/tmp/anyharness-{name}-runtime")),
            "http://127.0.0.1:8457".to_string(),
            db,
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state")
    }

    fn workspace_record(
        id: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
    ) -> WorkspaceRecord {
        workspace_record_with_path(
            id,
            lifecycle_state,
            cleanup_state,
            cleanup_operation,
            &format!("/tmp/anyharness-nonexistent-{id}"),
        )
    }

    fn workspace_record_with_path(
        id: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
        path: &str,
    ) -> WorkspaceRecord {
        workspace_record_with_kind_surface(
            id,
            "worktree",
            "standard",
            lifecycle_state,
            cleanup_state,
            cleanup_operation,
            path,
        )
    }

    fn workspace_record_with_kind_surface(
        id: &str,
        kind: &str,
        surface: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
        path: &str,
    ) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::try_from(kind).expect("test workspace kind"),
            repo_root_id: "repo-root-1".to_string(),
            path: path.to_string(),
            surface: WorkspaceSurface::try_from(surface).expect("test workspace surface"),
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::try_from(lifecycle_state)
                .expect("test lifecycle state"),
            cleanup_state: WorkspaceCleanupState::try_from(cleanup_state)
                .expect("test cleanup state"),
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

    fn run_git<const N: usize>(cwd: &std::path::Path, args: [&str; N]) {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-{name}-{}-{}",
                std::process::id(),
                chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            std::fs::create_dir_all(&path).expect("temp dir");
            Self { path }
        }

        fn path(&self) -> &std::path::Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}
