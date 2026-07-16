use crate::api::http::workspaces_purge::admit_all_workspace_sessions;
use crate::domains::sessions::admission::SessionMutationKind;
use anyharness_contract::v1::{
    Workspace, WorkspaceRetireBlocker, WorkspaceRetireBlockerCode, WorkspaceRetireBlockerSeverity,
    WorkspaceRetireOutcome, WorkspaceRetirePreflightResponse, WorkspaceRetireResponse,
};
use axum::{
    extract::{Path, State},
    Json,
};

use super::blocking::run_blocking;
use super::error::ApiError;
use super::workspaces_contract::workspace_to_contract;
use crate::app::AppState;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceRecord,
};
use crate::domains::workspaces::retire_preflight::RetirePreflightMode;

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/retire/preflight",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Retire preflight", body = WorkspaceRetirePreflightResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retire_workspace_preflight(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetirePreflightResponse>, ApiError> {
    Ok(Json(build_retire_preflight(&state, &workspace_id).await?))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/retire",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 409, description = "Session execution is controlled by an active workflow run", body = anyharness_contract::v1::ProblemDetails),
        (status = 200, description = "Retire workspace result", body = WorkspaceRetireResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retire_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetireResponse>, ApiError> {
    // Spec 2b RETIRE-01 ruling (option B): retirement can dematerialize the
    // workspace a controlled session is running in, so it fails closed like
    // purge — sorted permits for every workspace session are held across the
    // whole retirement.
    let admission =
        admit_all_workspace_sessions(&state, &workspace_id, SessionMutationKind::WorkspaceRetire)
            .await?;
    // PR1227-WORKSPACE-FENCE-02: carry the admitted id set into the under-lease
    // re-check; the permits are held until this handler returns.
    let admitted_session_ids = admission.session_ids.clone();
    let _admission_permits = admission.permits;
    let current = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if current.lifecycle_state == WorkspaceLifecycleState::Retired {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        if current.cleanup_operation == Some(WorkspaceCleanupOperation::Purge) {
            return Ok(Json(WorkspaceRetireResponse {
                workspace: workspace_to_contract(&state, current).await?,
                outcome: WorkspaceRetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(
                    "workspace is in purge cleanup state; use purge retry instead".to_string(),
                ),
            }));
        }
        let cleanup_succeeded = current.cleanup_state == WorkspaceCleanupState::Complete;
        let cleanup_message = retired_cleanup_message(&current);
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, current).await?,
            outcome: WorkspaceRetireOutcome::AlreadyRetired,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded,
            cleanup_message,
        }));
    }

    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.can_retire {
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }

    // PR1227-WORKSPACE-FENCE-01 proof seam (test-only, no-op in production):
    // park between the advisory preflight and the exclusive lease so a proof
    // can bind a workflow-controlled session in exactly the gap the fence
    // guards. Keyed by workspace id; absent keys change nothing.
    #[cfg(test)]
    retire_barriers::at_pre_exclusive(&workspace_id).await;

    let _exclusive = state
        .workspace_operation_gate
        .acquire_exclusive(&workspace_id)
        .await;
    // PR1227-WORKSPACE-FENCE-01/02: the up-front admit_all_workspace_sessions
    // snapshot cannot see a session the workflow executor creates+binds inside
    // the window before this exclusive lease is held (it only holds the shared
    // SessionStart lease then). Now that the exclusive lease excludes further
    // workflow session creation, re-enumerate and fail closed if (01) a workflow
    // controls a session, OR (02) any enumerated id is absent from the admitted
    // set (bound after the snapshot, possibly already terminalized). Read-only
    // controller lookup + pure in-memory set comparison: no permit, no lease —
    // no ABBA edge.
    reject_retire_if_workflow_controlled(&state, &workspace_id, &admitted_session_ids).await?;
    let workspace = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if workspace.lifecycle_state == WorkspaceLifecycleState::Retired {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        if workspace.cleanup_operation == Some(WorkspaceCleanupOperation::Purge) {
            return Ok(Json(WorkspaceRetireResponse {
                workspace: workspace_to_contract(&state, workspace).await?,
                outcome: WorkspaceRetireOutcome::Blocked,
                preflight,
                cleanup_attempted: false,
                cleanup_succeeded: false,
                cleanup_message: Some(
                    "workspace is in purge cleanup state; use purge retry instead".to_string(),
                ),
            }));
        }
        let cleanup_succeeded = workspace.cleanup_state == WorkspaceCleanupState::Complete;
        let cleanup_message = retired_cleanup_message(&workspace);
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::AlreadyRetired,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded,
            cleanup_message,
        }));
    }
    if state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(&workspace_id)
        .is_err()
    {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }

    let mut preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.can_retire {
        let workspace = workspace_contract_by_id(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: None,
        }));
    }
    if let Some(active) = state
        .workspace_runtime
        .find_active_worktree_by_path_excluding_id(&workspace.path, &workspace.id)
        .map_err(|e| ApiError::internal(e.to_string()))?
    {
        preflight.can_retire = false;
        preflight
            .blockers
            .push(active_path_owner_retire_blocker(&active));
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(format!(
                "cleanup blocked because active workspace {} also owns path {}",
                active.id, active.path
            )),
        }));
    }

    let attempted_at = chrono::Utc::now().to_rfc3339();
    let pending = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Pending,
            Some(WorkspaceCleanupOperation::Retire),
            None,
            None,
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;

    let cleanup_result = {
        let runtime = state.workspace_runtime.clone();
        let workspace = pending.clone();
        run_blocking("retire worktree cleanup", move || {
            runtime.retire_worktree_materialization(&workspace)
        })
        .await?
    };

    let (outcome, cleanup_succeeded, cleanup_message, cleanup_state, error_at) =
        match cleanup_result {
            Ok(()) => (
                WorkspaceRetireOutcome::Retired,
                true,
                None,
                WorkspaceCleanupState::Complete,
                None,
            ),
            Err(error) => {
                let message = error.to_string();
                (
                    WorkspaceRetireOutcome::CleanupFailed,
                    false,
                    Some(message),
                    WorkspaceCleanupState::Failed,
                    Some(chrono::Utc::now().to_rfc3339()),
                )
            }
        };
    let final_record = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            WorkspaceLifecycleState::Retired,
            cleanup_state,
            Some(WorkspaceCleanupOperation::Retire),
            cleanup_message.as_deref(),
            error_at.as_deref(),
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;

    Ok(Json(WorkspaceRetireResponse {
        workspace: workspace_to_contract(&state, final_record).await?,
        outcome,
        preflight,
        cleanup_attempted: true,
        cleanup_succeeded,
        cleanup_message,
    }))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/retire/cleanup-retry",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Cleanup retry result", body = WorkspaceRetireResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn retry_retire_cleanup(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRetireResponse>, ApiError> {
    let workspace = state
        .workspace_runtime
        .get_workspace(&workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    if workspace.lifecycle_state != WorkspaceLifecycleState::Retired
        || !matches!(
            workspace.cleanup_state,
            WorkspaceCleanupState::Failed | WorkspaceCleanupState::Pending
        )
        || workspace.cleanup_operation == Some(WorkspaceCleanupOperation::Purge)
    {
        let preflight = build_retire_preflight(&state, &workspace_id).await?;
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some("cleanup retry is only available for retired workspaces with pending or failed cleanup".to_string()),
        }));
    }

    let _exclusive = state
        .workspace_operation_gate
        .acquire_exclusive(&workspace_id)
        .await;
    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    if !preflight.blockers.is_empty() {
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(
                "cleanup retry blocked because workspace safety preflight failed".to_string(),
            ),
        }));
    }
    if let Some(active) = state
        .workspace_runtime
        .find_active_worktree_by_path_excluding_id(&workspace.path, &workspace.id)
        .map_err(|e| ApiError::internal(e.to_string()))?
    {
        let mut preflight = build_retire_preflight(&state, &workspace_id).await?;
        preflight
            .blockers
            .push(active_path_owner_retire_blocker(&active));
        return Ok(Json(WorkspaceRetireResponse {
            workspace: workspace_to_contract(&state, workspace).await?,
            outcome: WorkspaceRetireOutcome::Blocked,
            preflight,
            cleanup_attempted: false,
            cleanup_succeeded: false,
            cleanup_message: Some(format!(
                "cleanup retry blocked because active workspace {} now owns path {}",
                active.id, active.path
            )),
        }));
    }
    let attempted_at = chrono::Utc::now().to_rfc3339();
    let _ = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Pending,
            Some(WorkspaceCleanupOperation::Retire),
            None,
            None,
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let cleanup_result = {
        let runtime = state.workspace_runtime.clone();
        let workspace = workspace.clone();
        run_blocking("retire cleanup retry", move || {
            runtime.retire_worktree_materialization(&workspace)
        })
        .await?
    };
    let (outcome, cleanup_succeeded, cleanup_message, cleanup_state, error_at) =
        match cleanup_result {
            Ok(()) => (
                WorkspaceRetireOutcome::Retired,
                true,
                None,
                WorkspaceCleanupState::Complete,
                None,
            ),
            Err(error) => {
                let message = error.to_string();
                (
                    WorkspaceRetireOutcome::CleanupFailed,
                    false,
                    Some(message),
                    WorkspaceCleanupState::Failed,
                    Some(chrono::Utc::now().to_rfc3339()),
                )
            }
        };
    let final_record = state
        .workspace_runtime
        .set_lifecycle_cleanup_state(
            &workspace_id,
            WorkspaceLifecycleState::Retired,
            cleanup_state,
            Some(WorkspaceCleanupOperation::Retire),
            cleanup_message.as_deref(),
            error_at.as_deref(),
            Some(&attempted_at),
        )
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let preflight = build_retire_preflight(&state, &workspace_id).await?;
    Ok(Json(WorkspaceRetireResponse {
        workspace: workspace_to_contract(&state, final_record).await?,
        outcome,
        preflight,
        cleanup_attempted: true,
        cleanup_succeeded,
        cleanup_message,
    }))
}

/// PR1227-WORKSPACE-FENCE-01/02: called under the already-held exclusive
/// workspace lease. Re-enumerate the workspace session set and return the stable
/// 409 if either (02) an enumerated session id is absent from `admitted_session_ids`
/// — the ids the up-front admission snapshotted and holds permits for — even if
/// its controlling workflow already terminalized (the bind->terminalize race), OR
/// (01) a NONTERMINAL workflow controls a session the up-front admission could not
/// have seen (created+bound inside the admission -> exclusive-lease window).
/// FENCE-02 is checked first: it is a pure in-memory set comparison over ids
/// enumerated under the held lease (no permit, no lease). FENCE-01 remains to
/// catch control acquired post-snapshot on an EXISTING admitted session. Neither
/// introduces an ABBA edge.
async fn reject_retire_if_workflow_controlled(
    state: &AppState,
    workspace_id: &str,
    admitted_session_ids: &std::collections::BTreeSet<String>,
) -> Result<(), ApiError> {
    let session_ids = state
        .session_service
        .store()
        .list_with_dismissed_by_workspace(workspace_id)
        .map_err(|error| {
            tracing::error!(workspace_id = %workspace_id, error = %error, "retire re-check session list failed");
            ApiError::internal("session list failed")
        })?
        .into_iter()
        .map(|session| session.id)
        .collect::<Vec<_>>();
    // PR1227-WORKSPACE-FENCE-02: any id enumerated under the exclusive lease that
    // was NOT in the up-front admitted set was bound after the snapshot and never
    // admitted; fail closed regardless of its controller's terminality.
    if let Some(unadmitted) = session_ids
        .iter()
        .find(|id| !admitted_session_ids.contains(*id))
    {
        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %unadmitted,
            "workspace retire rejected under exclusive lease: a session appeared after the destruction admission snapshot"
        );
        return Err(ApiError::conflict(
            format!("session {unadmitted} appeared after destruction admission"),
            "SESSION_CONTROLLED_BY_WORKFLOW",
        ));
    }
    match state
        .session_admission
        .find_workflow_controlled_session(session_ids)
        .await
    {
        Ok(None) => Ok(()),
        Ok(Some((session_id, run_id))) => {
            tracing::info!(
                workspace_id = %workspace_id,
                session_id = %session_id,
                controlling_run_id = %run_id,
                "workspace retire rejected under exclusive lease: a workflow controls a session created after admission"
            );
            Err(ApiError::conflict(
                "session execution is controlled by an active workflow run",
                "SESSION_CONTROLLED_BY_WORKFLOW",
            ))
        }
        Err(error) => {
            tracing::error!(workspace_id = %workspace_id, error = %error, "retire controlled-session re-check failed");
            Err(ApiError::internal("session admission unavailable"))
        }
    }
}

async fn build_retire_preflight(
    state: &AppState,
    workspace_id: &str,
) -> Result<WorkspaceRetirePreflightResponse, ApiError> {
    let current = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    let mode = if current.lifecycle_state == WorkspaceLifecycleState::Retired
        && matches!(
            current.cleanup_state,
            WorkspaceCleanupState::Pending | WorkspaceCleanupState::Failed
        )
        && current.cleanup_operation != Some(WorkspaceCleanupOperation::Purge)
    {
        RetirePreflightMode::RetiredCleanupRetry
    } else {
        RetirePreflightMode::ActiveRetire
    };
    let result = state
        .retire_preflight_checker
        .check_workspace(current, mode)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(WorkspaceRetirePreflightResponse {
        workspace_id: result.workspace.id,
        workspace_kind: result.workspace_kind,
        lifecycle_state: result.lifecycle_state,
        cleanup_state: result.cleanup_state,
        cleanup_operation: result.cleanup_operation,
        can_retire: result.can_retire && mode == RetirePreflightMode::ActiveRetire,
        materialized: result.materialized,
        merged_into_base: result.merged_into_base,
        base_ref: result.base_ref,
        base_oid: result.base_oid,
        head_oid: result.head_oid,
        head_matches_base: result.head_matches_base,
        readiness_fingerprint: result.readiness_fingerprint,
        blockers: result.blockers,
    })
}

async fn workspace_contract_by_id(
    state: &AppState,
    workspace_id: &str,
) -> Result<Workspace, ApiError> {
    let record = state
        .workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        })?;
    workspace_to_contract(state, record).await
}

fn active_path_owner_retire_blocker(active: &WorkspaceRecord) -> WorkspaceRetireBlocker {
    WorkspaceRetireBlocker {
        code: WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
        message: format!(
            "Another active workspace ({}) owns checkout path {}.",
            active.id, active.path
        ),
        severity: WorkspaceRetireBlockerSeverity::Blocking,
        retryable: true,
        session_id: None,
        terminal_id: None,
        command_run_id: None,
        path: Some(active.path.clone()),
        paths: None,
        operation: None,
    }
}

fn retired_cleanup_message(workspace: &WorkspaceRecord) -> Option<String> {
    match workspace.cleanup_state {
        WorkspaceCleanupState::Complete => None,
        WorkspaceCleanupState::Failed => workspace
            .cleanup_error_message
            .clone()
            .or_else(|| Some("retired workspace cleanup failed".to_string())),
        WorkspaceCleanupState::Pending => {
            Some("retired workspace cleanup is still pending".to_string())
        }
        WorkspaceCleanupState::None => Some(format!(
            "retired workspace cleanup is not complete: {}",
            workspace.cleanup_state
        )),
    }
}

/// PR1227-WORKSPACE-FENCE-01 proof seam. A keyed, test-only barrier that parks
/// `retire_workspace` between the advisory preflight and the exclusive
/// workspace lease, so a deterministic proof can bind a workflow-controlled
/// session in exactly the window the under-lease fence exists to catch. Absent
/// keys cost one mutex lookup and change nothing. Test-only by construction.
#[cfg(test)]
pub(crate) mod retire_barriers {
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    use tokio::sync::oneshot;

    #[derive(Default)]
    pub(crate) struct RetireBarrier {
        /// Fired when `retire_workspace` reaches the pre-exclusive-lease point.
        pub(crate) reached_tx: Option<oneshot::Sender<()>>,
        /// Awaited before acquiring the exclusive lease when present.
        pub(crate) resume_rx: Option<oneshot::Receiver<()>>,
    }

    static BARRIERS: StdMutex<Option<HashMap<String, RetireBarrier>>> = StdMutex::new(None);

    pub(crate) fn install(workspace_id: &str, barrier: RetireBarrier) {
        BARRIERS
            .lock()
            .expect("retire barrier lock")
            .get_or_insert_with(HashMap::new)
            .insert(workspace_id.to_string(), barrier);
    }

    pub(crate) fn clear(workspace_id: &str) {
        if let Some(map) = BARRIERS.lock().expect("retire barrier lock").as_mut() {
            map.remove(workspace_id);
        }
    }

    pub(super) async fn at_pre_exclusive(workspace_id: &str) {
        let barrier = BARRIERS
            .lock()
            .expect("retire barrier lock")
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
