//! Durable destination planning for exact-ref workspace materialization.

use super::model::MaterializationError;
use super::service::{hash_request, internal, Result};
use super::store::MaterializationOperationStore;
use crate::domains::workspaces::runtime::WorkspaceRuntime;

/// Choose and persist the exact workspace destination before Git mutates it.
pub(crate) fn prepare_workspace_destination(
    workspace_runtime: &WorkspaceRuntime,
    store: &MaterializationOperationStore,
    operation_id: &str,
    repo_root_id: &str,
    requested_destination_id: Option<&str>,
    preferred_name: &str,
    head_sha: &str,
) -> Result<String> {
    let effective_destination_id =
        requested_destination_id
            .map(str::to_string)
            .unwrap_or_else(|| {
                generated_workspace_destination_id(operation_id, preferred_name, head_sha)
            });
    let planned_destination = workspace_runtime
        .standard_worktree_destination_path(repo_root_id, &effective_destination_id)
        .map_err(|error| MaterializationError::DestinationConflict(error.to_string()))?
        .to_string_lossy()
        .to_string();

    if let Some(recorded_destination) = store
        .find(operation_id)
        .map_err(internal)?
        .and_then(|record| record.destination_path)
    {
        if recorded_destination != planned_destination {
            return Err(MaterializationError::DestinationConflict(
                "recorded workspace destination does not match the retry request".into(),
            ));
        }
    }
    store
        .set_destination_path(operation_id, &planned_destination)
        .map_err(internal)?;
    Ok(effective_destination_id)
}

/// A filesystem-safe, retry-stable destination id for a request that omitted
/// one. Human context remains visible while the operation hash prevents two
/// independent requests from racing for an accidental shared path.
pub(crate) fn generated_workspace_destination_id(
    operation_id: &str,
    preferred_name: &str,
    head_sha: &str,
) -> String {
    let mut slug = preferred_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    slug = slug
        .trim_matches(|character| character == '.' || character == '-')
        .to_string();
    if slug.is_empty() {
        slug = "workspace".to_string();
    }
    slug.truncate(56);
    let short_sha = head_sha.chars().take(8).collect::<String>();
    let operation_hash = hash_request(&["workspace_destination", operation_id]);
    format!("{slug}-{short_sha}-{}", &operation_hash[..12])
}

/// Map an exact-ref creation error to its stable materialization error.
pub(crate) fn map_exact_ref_error(error: anyhow::Error) -> MaterializationError {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    if lower.contains("not requested branch") || lower.contains("not on requested branch") {
        MaterializationError::WorkspaceBranchMismatch(message)
    } else if lower.contains("uncommitted changes") {
        MaterializationError::WorkspaceDirty(message)
    } else if lower.contains("not requested commit")
        || lower.contains("not requested")
        || lower.contains("is at ")
    {
        MaterializationError::WorkspaceHeadMismatch(message)
    } else if lower.contains("does not exist")
        || lower.contains("not found")
        || lower.contains("rev-parse")
        || lower.contains("unknown revision")
        || lower.contains("bad revision")
    {
        MaterializationError::RequestedRefNotFound(message)
    } else if lower.contains("pending cleanup") || lower.contains("already exists") {
        MaterializationError::DestinationConflict(message)
    } else {
        MaterializationError::Failed(message)
    }
}
