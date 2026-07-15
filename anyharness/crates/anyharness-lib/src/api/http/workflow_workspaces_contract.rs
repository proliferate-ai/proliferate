//! Wire/domain mapping for the workflow-run-workspace routes. Contract types
//! stop here: the domain service and store speak only domain models. Strict
//! decode (deny-unknown-fields at every level, exact schema version, kind/field
//! pairing) happens at this boundary.

use anyharness_contract::v1;
use serde_json::Value;

use crate::domains::workflows::workspace_materialization::model::{
    MaterializationRecord, MaterializationStatus, MATERIALIZATION_SCHEMA_VERSION,
};
use crate::domains::workspaces::workflow_placement::WorkflowPlacementRequest;

/// The single strict-decode failure; details never reach the wire.
#[derive(Debug)]
pub struct WorkflowWorkspaceDecodeError;

/// Strictly decode the PUT body into the domain placement request.
///
/// The generated SDK/OpenAPI custody comes from the strict discriminated-union
/// contract type ([`v1::WorkflowWorkspacePlacementRequest`]). Serde's
/// internally-tagged enums do NOT honor `deny_unknown_fields` on variant content
/// (a known serde limitation), so this boundary ALSO validates the raw
/// `placement` object's keys against the exact per-`kind` allowlist. Together
/// they reject a nested unknown field, `scratch` carrying repository fields, and
/// `repositoryWorktree` missing either required field — the CONTRACT-01 matrix.
pub fn decode_put_workflow_run_workspace(
    run_id: &str,
    body: Value,
) -> Result<WorkflowPlacementRequest, WorkflowWorkspaceDecodeError> {
    // Top-level strictness (schema version + no unknown top-level keys) is
    // enforced by the struct's `deny_unknown_fields`.
    let decoded: v1::PutWorkflowRunWorkspaceRequest =
        serde_json::from_value(body.clone()).map_err(|_| WorkflowWorkspaceDecodeError)?;
    if decoded.schema_version != MATERIALIZATION_SCHEMA_VERSION {
        return Err(WorkflowWorkspaceDecodeError);
    }

    // Nested strictness: reprove the raw `placement` object carries exactly the
    // keys its `kind` permits (`kind` alone for scratch; `kind` + both repo
    // fields for repositoryWorktree).
    let placement_obj = body
        .get("placement")
        .and_then(Value::as_object)
        .ok_or(WorkflowWorkspaceDecodeError)?;
    match decoded.placement {
        v1::WorkflowWorkspacePlacementRequest::Scratch => {
            assert_exact_keys(placement_obj, &["kind"])?;
            Ok(WorkflowPlacementRequest::Scratch {
                run_id: run_id.to_string(),
            })
        }
        v1::WorkflowWorkspacePlacementRequest::RepositoryWorktree {
            repo_root_id,
            base_ref,
        } => {
            assert_exact_keys(placement_obj, &["kind", "repoRootId", "baseRef"])?;
            let repo_root_id = non_blank(&repo_root_id).ok_or(WorkflowWorkspaceDecodeError)?;
            let base_ref = non_blank(&base_ref).ok_or(WorkflowWorkspaceDecodeError)?;
            Ok(WorkflowPlacementRequest::RepositoryWorktree {
                run_id: run_id.to_string(),
                repo_root_id,
                base_ref,
            })
        }
    }
}

/// Reject a placement object whose key set is not exactly `allowed`.
fn assert_exact_keys(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
) -> Result<(), WorkflowWorkspaceDecodeError> {
    if object.len() != allowed.len() || !allowed.iter().all(|key| object.contains_key(*key)) {
        return Err(WorkflowWorkspaceDecodeError);
    }
    Ok(())
}

fn non_blank(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Map a durable materialization record into the wire response. The stored
/// canonical `request_json` supplies the requested placement echo; the resolved
/// placement supplies the non-secret base OID once resolved.
pub fn record_to_response(
    record: &MaterializationRecord,
) -> anyhow::Result<v1::WorkflowRunWorkspaceResponse> {
    let placement = record
        .placement_request()
        .ok_or_else(|| anyhow::anyhow!("stored request_json is not a valid placement"))?;
    let base_oid = record
        .resolved_placement()
        .and_then(|resolved| resolved.base_oid().map(str::to_string));
    let placement = match placement {
        WorkflowPlacementRequest::Scratch { .. } => v1::WorkflowWorkspaceResolvedPlacement::Scratch,
        WorkflowPlacementRequest::RepositoryWorktree {
            repo_root_id,
            base_ref,
            ..
        } => v1::WorkflowWorkspaceResolvedPlacement::RepositoryWorktree {
            repo_root_id,
            base_ref,
            base_oid,
        },
    };
    Ok(v1::WorkflowRunWorkspaceResponse {
        run_id: record.run_id.clone(),
        schema_version: record.schema_version,
        status: status_to_contract(record.status),
        placement,
        workspace_id: record.workspace_id.clone(),
        failure_code: record.failure_code.map(|code| code.as_str().to_string()),
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        finished_at: record.finished_at.clone(),
    })
}

fn status_to_contract(status: MaterializationStatus) -> v1::WorkflowWorkspaceStatus {
    match status {
        MaterializationStatus::Accepted => v1::WorkflowWorkspaceStatus::Accepted,
        MaterializationStatus::Materializing => v1::WorkflowWorkspaceStatus::Materializing,
        MaterializationStatus::Ready => v1::WorkflowWorkspaceStatus::Ready,
        MaterializationStatus::Failed => v1::WorkflowWorkspaceStatus::Failed,
    }
}
