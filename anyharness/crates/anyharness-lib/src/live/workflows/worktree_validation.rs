//! Persisted workflow-worktree metadata validation used before broker inspect.

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::WorkspaceKind;

use super::executor::failed_msg;

pub(super) fn validate_recovered_worktree_metadata(
    kind: WorkspaceKind,
    record_path: &str,
    current_branch: Option<&str>,
    creator_context: Option<&WorkspaceCreatorContext>,
    expected_path: &str,
    expected_branch: &str,
    expected_creator: &WorkspaceCreatorContext,
) -> Result<std::path::PathBuf, StepOutcome> {
    let canonical_expected = std::fs::canonicalize(expected_path)
        .map_err(|error| failed_msg("worktree_resume_lookup_failed", error.to_string()))?;
    let canonical_record = std::fs::canonicalize(record_path)
        .map_err(|error| failed_msg("worktree_resume_lookup_failed", error.to_string()))?;
    if kind != WorkspaceKind::Worktree
        || canonical_record != canonical_expected
        || current_branch != Some(expected_branch)
        || creator_context != Some(expected_creator)
    {
        return Err(failed_msg(
            "worktree_resume_lookup_failed",
            "workflow worktree ownership/path/branch metadata mismatch",
        ));
    }
    Ok(canonical_record)
}
