use std::collections::BTreeSet;

use crate::api::http::access::admit_session_mutation;
use crate::domains::sessions::admission::{SessionMutationKind, SessionMutationPermit};
use anyharness_contract::v1::{WorkspacePurgeOutcome, WorkspacePurgeResponse};
use axum::{
    extract::{Path, State},
    Json,
};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::workspaces::deletion::purge::{
    WorkspacePurgeError, WorkspacePurgeOutcome as ServiceWorkspacePurgeOutcome,
};

/// The result of the up-front workspace-destruction admission snapshot: the
/// held permits (dropped at end of the destructive operation) PLUS the SET of
/// session ids that snapshot covered (PR1227-WORKSPACE-FENCE-02). The
/// destructive owner carries the id set into its under-lease re-check so a
/// session bound AFTER the snapshot — whose controlling workflow may already
/// have terminalized — fails closed even though no permit is held for it.
pub(super) struct AdmittedWorkspaceSessions {
    /// Held for the lifetime of the destructive operation; never inspected.
    pub(super) permits: Vec<SessionMutationPermit>,
    /// The exact session ids admitted (and permit-held) up front.
    pub(super) session_ids: BTreeSet<String>,
}

/// Spec 2b fail-closed rule: purge (and mobility removal) never overrides an
/// active workflow controller. Every session of the workspace is admitted —
/// in sorted id order so concurrent multi-session holders cannot deadlock —
/// and ALL permits are held across the destructive operation. The admitted id
/// set is returned alongside the permits for the FENCE-02 under-lease
/// set-membership re-check.
pub(super) async fn admit_all_workspace_sessions(
    state: &AppState,
    workspace_id: &str,
    kind: SessionMutationKind,
) -> Result<AdmittedWorkspaceSessions, ApiError> {
    let mut sessions = state
        .session_service
        .list_sessions(Some(workspace_id), true)
        .map_err(|error| {
            tracing::error!(workspace_id = %workspace_id, error = %error, "session list failed");
            ApiError::internal("session list failed")
        })?;
    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    let mut permits = Vec::with_capacity(sessions.len());
    let mut session_ids = BTreeSet::new();
    for session in &sessions {
        permits.push(admit_session_mutation(state, &session.id, kind).await?);
        session_ids.insert(session.id.clone());
    }
    Ok(AdmittedWorkspaceSessions {
        permits,
        session_ids,
    })
}

#[utoipa::path(
    delete,
    path = "/v1/workspaces/{workspace_id}",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 409, description = "Session execution is controlled by an active workflow run", body = anyharness_contract::v1::ProblemDetails),
        (status = 200, description = "Purge workspace result", body = WorkspacePurgeResponse),
    ),
    tag = "workspaces"
)]
pub async fn purge_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspacePurgeResponse>, ApiError> {
    let admission =
        admit_all_workspace_sessions(&state, &workspace_id, SessionMutationKind::WorkspacePurge)
            .await?;
    // PR1227-WORKSPACE-FENCE-02: carry the admitted id set into the destructive
    // owner so a session bound after this snapshot fails the under-lease
    // set-membership re-check even if its workflow already terminalized. The
    // permits are held until this scope ends.
    let admitted_session_ids = admission.session_ids.clone();
    let _admission_permits = admission.permits;

    // PR1227-WORKSPACE-FENCE-01 proof seam (test-only, no-op in production):
    // park between the up-front admission snapshot (now fully complete) and the
    // exclusive workspace lease taken inside `.purge(...)`, so a proof can bind a
    // workflow-controlled session in exactly the gap the under-lease fence
    // guards. Keyed by workspace id; absent keys change nothing.
    #[cfg(test)]
    purge_barriers::at_pre_exclusive(&workspace_id).await;

    let outcome = state
        .workspace_purge_service
        .purge_with_admitted_session_ids(&workspace_id, Some(admitted_session_ids))
        .await
        .map_err(map_purge_error)?;

    Ok(Json(purge_response_from_service_outcome(outcome)))
}

/// PR1227-WORKSPACE-FENCE-01 proof seam. A keyed, test-only barrier that parks
/// `purge_workspace` between the up-front `admit_all_workspace_sessions`
/// snapshot and the exclusive workspace lease taken inside the purge service,
/// so a deterministic proof can bind a workflow-controlled session in exactly
/// the window the under-lease fence exists to catch. Absent keys cost one mutex
/// lookup and change nothing. Test-only by construction.
#[cfg(test)]
pub(crate) mod purge_barriers {
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    use tokio::sync::oneshot;

    #[derive(Default)]
    pub(crate) struct PurgeBarrier {
        /// Fired when `purge_workspace` reaches the pre-exclusive-lease point.
        pub(crate) reached_tx: Option<oneshot::Sender<()>>,
        /// Awaited before proceeding to the exclusive lease when present.
        pub(crate) resume_rx: Option<oneshot::Receiver<()>>,
    }

    static BARRIERS: StdMutex<Option<HashMap<String, PurgeBarrier>>> = StdMutex::new(None);

    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    pub(crate) fn install(workspace_id: &str, barrier: PurgeBarrier) {
        BARRIERS
            .lock()
            .expect("purge barrier lock")
            .get_or_insert_with(HashMap::new)
            .insert(workspace_id.to_string(), barrier);
    }

    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    pub(crate) fn clear(workspace_id: &str) {
        if let Some(map) = BARRIERS.lock().expect("purge barrier lock").as_mut() {
            map.remove(workspace_id);
        }
    }

    pub(super) async fn at_pre_exclusive(workspace_id: &str) {
        let barrier = BARRIERS
            .lock()
            .expect("purge barrier lock")
            .as_mut()
            .and_then(|map| map.remove(workspace_id));
        let Some(mut barrier) = barrier else {
            return;
        };
        if let Some(tx) = barrier.reached_tx.take() {
            let _ = tx.send(());
        }
        if let Some(rx) = barrier.resume_rx.take() {
            let _ = rx.await;
        }
    }
}

fn purge_response_from_service_outcome(
    outcome: ServiceWorkspacePurgeOutcome,
) -> WorkspacePurgeResponse {
    match outcome {
        ServiceWorkspacePurgeOutcome::Deleted { already_deleted } => WorkspacePurgeResponse {
            outcome: WorkspacePurgeOutcome::Deleted,
            already_deleted,
        },
    }
}

/// Maps every [`WorkspacePurgeError`] variant to the same stable HTTP shape
/// the pre-split purge answered with: the two fence rejections both surface
/// as the same `SESSION_CONTROLLED_BY_WORKFLOW` 409 they always have (no
/// client-visible behavior change from the internal type split), a timed-out
/// bounded acquire is the same "in flight, retry" conflict archive/unarchive
/// already answer with, and every other failure — mechanical, and never past
/// a destructive point by construction — is a plain 500.
fn map_purge_error(error: WorkspacePurgeError) -> ApiError {
    match error {
        // PR1227-WORKSPACE-FENCE-01: the under-lease re-check observed a
        // workflow-controlled session created after up-front admission. Fail
        // closed with the same stable 409 as the up-front fence.
        WorkspacePurgeError::ControlledByWorkflow { .. } => ApiError::conflict(
            "session execution is controlled by an active workflow run",
            "SESSION_CONTROLLED_BY_WORKFLOW",
        ),
        // PR1227-WORKSPACE-FENCE-02: the under-lease re-enumeration observed a
        // session id absent from the up-front admitted set (bound after the
        // snapshot, possibly already terminalized). Fail closed with the same
        // stable 409 code; the detail names the unadmitted session id only —
        // no raw internal state, nothing persisted.
        WorkspacePurgeError::SessionAppearedAfterAdmission { session_id } => ApiError::conflict(
            format!("session {session_id} appeared after destruction admission"),
            "SESSION_CONTROLLED_BY_WORKFLOW",
        ),
        WorkspacePurgeError::OperationInFlight => ApiError::conflict(
            "a workspace operation is already in flight",
            "WORKSPACE_OPERATION_IN_FLIGHT",
        ),
        WorkspacePurgeError::CheckpointCleanupFailed => ApiError::internal_with_safe_log_and_code(
            "Could not remove workspace checkpoint artifacts.",
            "workspace checkpoint cleanup failed",
            Some("WORKSPACE_CHECKPOINT_CLEANUP_FAILED"),
        ),
        WorkspacePurgeError::Failed(message) => ApiError::internal(message),
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
        WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord, WorkspaceSurface,
    };
    use crate::domains::workspaces::store::WorkspaceStore;
    use crate::persistence::Db;

    /// Real repo, real managed worktree, real `AppState` — the managed
    /// worktrees root is `runtime_home.parent()/worktrees`, so purge's
    /// containment guard is meaningfully exercised here rather than vacuously
    /// true. Mirrors `deletion/tests/purge_tests.rs`'s
    /// `Harness::worktree_workspace`. Returns `(runtime_home, repo_root,
    /// workspace_path)`.
    fn seed_managed_worktree(
        base: &TempDirGuard,
        workspace_id: &str,
    ) -> (PathBuf, PathBuf, PathBuf) {
        let runtime_home = base.path().join("runtime");
        let worktrees_root = base.path().join("worktrees");
        let repo_root = base.path().join("repo");
        std::fs::create_dir_all(&runtime_home).expect("create runtime home");
        std::fs::create_dir_all(&worktrees_root).expect("create managed worktrees root");
        std::fs::create_dir_all(&repo_root).expect("create repo root");
        run_git(&repo_root, ["init", "-b", "main"]);
        run_git(&repo_root, ["config", "user.email", "test@example.com"]);
        run_git(&repo_root, ["config", "user.name", "Test"]);
        run_git(&repo_root, ["config", "commit.gpgsign", "false"]);
        run_git(&repo_root, ["commit", "--allow-empty", "-m", "init"]);
        let workspace_path = worktrees_root.join(workspace_id);
        let workspace_path_string = workspace_path.to_string_lossy().into_owned();
        run_git(
            &repo_root,
            [
                "worktree",
                "add",
                "-b",
                workspace_id,
                &workspace_path_string,
                "HEAD",
            ],
        );
        (runtime_home, repo_root, workspace_path)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_workspace_deletes_an_active_worktree_row_and_its_checkout() {
        let base = TempDirGuard::new("purge-http-active");
        let (runtime_home, repo_root, workspace_path) =
            seed_managed_worktree(&base, "workspace-http-active");

        let workspace_path_string = workspace_path.to_string_lossy().into_owned();
        let state = test_state(runtime_home, &repo_root);
        let workspace = workspace_record("workspace-http-active", "active", &workspace_path_string);
        let store = WorkspaceStore::new(state.db.clone());
        store.insert(&workspace).expect("insert workspace");

        let response = purge_workspace(State(state.clone()), Path(workspace.id.clone()))
            .await
            .expect("purge workspace");

        assert_eq!(response.outcome, WorkspacePurgeOutcome::Deleted);
        assert!(!response.already_deleted);
        assert!(store
            .find_by_id(&workspace.id)
            .expect("find workspace")
            .is_none());
        assert!(
            !workspace_path.exists(),
            "the worktree checkout must be removed"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_workspace_deletes_an_archived_row_whose_checkout_is_already_gone() {
        // The ADR's headline flow over the real HTTP handler: an ARCHIVED row
        // has no checkout by construction (archive's phase 2 removed it), so
        // this is the shape every `DELETE` of an archived workspace arrives
        // in. Before the containment guard grew its missing-directory
        // early-out this answered 500 "refusing to remove a worktree outside
        // the managed worktrees root" and left the row behind forever.
        let base = TempDirGuard::new("purge-http-archived");
        let (runtime_home, repo_root, workspace_path) =
            seed_managed_worktree(&base, "workspace-http-archived");
        let workspace_path_string = workspace_path.to_string_lossy().into_owned();
        run_git(
            &repo_root,
            ["worktree", "remove", "--force", &workspace_path_string],
        );
        assert!(
            !workspace_path.exists(),
            "an archived row's checkout is gone before DELETE is ever called"
        );

        let state = test_state(runtime_home, &repo_root);
        let workspace = workspace_record(
            "workspace-http-archived",
            "archived",
            &workspace_path_string,
        );
        let store = WorkspaceStore::new(state.db.clone());
        store.insert(&workspace).expect("insert workspace");

        let response = purge_workspace(State(state.clone()), Path(workspace.id.clone()))
            .await
            .expect("an archived workspace must be deletable");

        assert_eq!(response.outcome, WorkspacePurgeOutcome::Deleted);
        assert!(!response.already_deleted);
        assert!(store
            .find_by_id(&workspace.id)
            .expect("find workspace")
            .is_none());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn purge_workspace_is_idempotent_on_a_repeat_call() {
        let base = TempDirGuard::new("purge-http-idempotent");
        let state = test_state(base.path().join("runtime"), &base.path().join("repo"));
        let response = purge_workspace(State(state), Path("workspace-does-not-exist".to_string()))
            .await
            .expect("purge missing workspace");

        assert_eq!(response.outcome, WorkspacePurgeOutcome::Deleted);
        assert!(response.already_deleted);
    }

    fn test_state(runtime_home: PathBuf, repo_root_path: &std::path::Path) -> AppState {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _bearer_guard = test_support::set_bearer_token_env(None);
        let _data_key_guard = test_support::set_data_key_env(None);
        let db = Db::open_in_memory().expect("open db");
        let repo_root_path = repo_root_path.to_string_lossy().to_string();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO repo_roots (
                    id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                    remote_repo_name, remote_url, created_at, updated_at
                 ) VALUES (
                    'repo-root-1', 'external', ?1, NULL, 'main', NULL, NULL,
                    NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
                 )",
                [&repo_root_path],
            )?;
            Ok(())
        })
        .expect("seed repo root");
        AppState::new(
            runtime_home,
            "http://127.0.0.1:8457".to_string(),
            db,
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state")
    }

    fn workspace_record(id: &str, lifecycle_state: &str, path: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Worktree,
            repo_root_id: "repo-root-1".to_string(),
            path: path.to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::try_from(lifecycle_state)
                .expect("test lifecycle state"),
            archived_head_sha: None,
            archived_branch: None,
            archived_at: None,
            partial_capture_json: None,
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
        /// A scratch base directory. Callers that need a managed worktree
        /// (purge's containment guard is real, not vacuous) create
        /// `<base>/runtime`, `<base>/worktrees`, and `<base>/repo`
        /// underneath it themselves, matching
        /// `deletion/tests/purge_tests.rs`'s `Harness`.
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
