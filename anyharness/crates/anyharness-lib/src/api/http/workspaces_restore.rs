use anyharness_contract::v1::{RestoreWorktreeWorkspaceOutcome, RestoreWorktreeWorkspaceResponse};
use axum::extract::{Path, State};
use axum::Json;

use super::access::map_access_error;
use super::error::ApiError;
use super::workspaces_contract::workspace_to_contract;
use crate::adapters::git::types::GitWorktreeRestoreOutcome;
use crate::app::AppState;

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/worktree/restore",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Restored the recorded worktree", body = RestoreWorktreeWorkspaceResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Worktree cannot be restored safely", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "workspaces"
)]
pub async fn restore_worktree(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<RestoreWorktreeWorkspaceResponse>, ApiError> {
    state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(&workspace_id)
        .map_err(map_access_error)?;
    let result = state
        .restore_worktree_runtime
        .restore_worktree(&workspace_id)
        .await?;
    Ok(Json(RestoreWorktreeWorkspaceResponse {
        workspace: workspace_to_contract(&state, result.workspace).await?,
        outcome: match result.outcome {
            GitWorktreeRestoreOutcome::Restored => RestoreWorktreeWorkspaceOutcome::Restored,
            GitWorktreeRestoreOutcome::AlreadyPresent => {
                RestoreWorktreeWorkspaceOutcome::AlreadyPresent
            }
        },
    }))
}
