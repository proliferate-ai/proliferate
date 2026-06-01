use std::time::Instant;

use super::access::{assert_workspace_mutable, assert_workspace_not_retired};
use super::error::ApiError;
use crate::app::AppState;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

fn resolve_workspace_path(
    workspace_runtime: &crate::domains::workspaces::runtime::WorkspaceRuntime,
    workspace_id: &str,
) -> Result<std::path::PathBuf, ApiError> {
    let workspace = workspace_runtime
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("Workspace not found", "WORKSPACE_NOT_FOUND"))?;

    Ok(std::path::PathBuf::from(workspace.path))
}

#[derive(Clone, Copy, Debug)]
pub(super) enum GitTaskAccess {
    Read,
    Write,
}

pub(super) async fn run_git_task<T, F>(
    state: &AppState,
    workspace_id: String,
    access: GitTaskAccess,
    task_label: &'static str,
    task: F,
) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(String, std::path::PathBuf) -> Result<T, ApiError> + Send + 'static,
{
    let started = Instant::now();
    // Acquire exactly one operation lease per request. Nested read leases can
    // deadlock behind a queued exclusive retire lease.
    let operation_kind = match access {
        GitTaskAccess::Read => WorkspaceOperationKind::MaterializationRead,
        GitTaskAccess::Write => WorkspaceOperationKind::GitWrite,
    };
    let lease_started = Instant::now();
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, operation_kind)
        .await;
    tracing::info!(
        workspace_id = %workspace_id,
        task_label = task_label,
        access = ?access,
        elapsed_ms = lease_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.http.task.lease_acquired"
    );
    let access_started = Instant::now();
    match access {
        GitTaskAccess::Read => assert_workspace_not_retired(state, &workspace_id)?,
        GitTaskAccess::Write => assert_workspace_mutable(state, &workspace_id)?,
    }
    tracing::info!(
        workspace_id = %workspace_id,
        task_label = task_label,
        access = ?access,
        elapsed_ms = access_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.http.task.access_checked"
    );
    let workspace_runtime = state.workspace_runtime.clone();
    tokio::task::spawn_blocking(move || {
        let blocking_started = Instant::now();
        let resolve_started = Instant::now();
        let workspace_path = resolve_workspace_path(&workspace_runtime, &workspace_id)?;
        tracing::info!(
            workspace_id = %workspace_id,
            task_label = task_label,
            elapsed_ms = resolve_started.elapsed().as_millis(),
            blocking_elapsed_ms = blocking_started.elapsed().as_millis(),
            "[anyharness-latency] git.http.task.workspace_path_resolved"
        );
        let task_started = Instant::now();
        let result = task(workspace_id.clone(), workspace_path);
        tracing::info!(
            workspace_id = %workspace_id,
            task_label = task_label,
            success = result.is_ok(),
            elapsed_ms = task_started.elapsed().as_millis(),
            blocking_elapsed_ms = blocking_started.elapsed().as_millis(),
            "[anyharness-latency] git.http.task.completed"
        );
        result
    })
    .await
    .map_err(|e| ApiError::internal(format!("{task_label} task failed: {e}")))?
}
