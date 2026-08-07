//! Wire↔domain mappers for the retire family. Dep-less of fetches and clocks;
//! every field is carried straight through from what the use case returned.
//!
//! `workspace_to_contract` needs `&state` because a `Workspace` embeds a live
//! execution summary — the same dependency `workspaces_contract.rs` already
//! carries for every other workspace response.

use anyharness_contract::v1::{
    WorkspaceRetireOutcome, WorkspaceRetirePreflightResponse, WorkspaceRetireResponse,
};

use super::error::ApiError;
use super::workspaces_contract::workspace_to_contract;
use crate::app::AppState;
use crate::domains::workspaces::retire::{RetirePreflightView, WorkspaceRetireResult};
use crate::domains::workspaces::retire_policy::RetireOutcome;

pub(super) fn retire_preflight_to_contract(
    view: RetirePreflightView,
) -> WorkspaceRetirePreflightResponse {
    let RetirePreflightView {
        result, can_retire, ..
    } = view;
    WorkspaceRetirePreflightResponse {
        workspace_id: result.workspace.id,
        workspace_kind: result.workspace_kind,
        lifecycle_state: result.lifecycle_state,
        cleanup_state: result.cleanup_state,
        cleanup_operation: result.cleanup_operation,
        can_retire,
        materialized: result.materialized,
        merged_into_base: result.merged_into_base,
        base_ref: result.base_ref,
        base_oid: result.base_oid,
        head_oid: result.head_oid,
        head_matches_base: result.head_matches_base,
        readiness_fingerprint: result.readiness_fingerprint,
        blockers: result.blockers,
    }
}

pub(super) async fn retire_result_to_contract(
    state: &AppState,
    result: WorkspaceRetireResult,
) -> Result<WorkspaceRetireResponse, ApiError> {
    Ok(WorkspaceRetireResponse {
        workspace: workspace_to_contract(state, result.workspace).await?,
        outcome: retire_outcome_to_contract(result.outcome),
        preflight: retire_preflight_to_contract(result.preflight),
        cleanup_attempted: result.cleanup_attempted,
        cleanup_succeeded: result.cleanup_succeeded,
        cleanup_message: result.cleanup_message,
    })
}

fn retire_outcome_to_contract(outcome: RetireOutcome) -> WorkspaceRetireOutcome {
    match outcome {
        RetireOutcome::Retired => WorkspaceRetireOutcome::Retired,
        RetireOutcome::AlreadyRetired => WorkspaceRetireOutcome::AlreadyRetired,
        RetireOutcome::Blocked => WorkspaceRetireOutcome::Blocked,
        RetireOutcome::CleanupFailed => WorkspaceRetireOutcome::CleanupFailed,
    }
}
