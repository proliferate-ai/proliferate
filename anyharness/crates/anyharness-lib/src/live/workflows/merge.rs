//! Lane merge-back (M2b): at a clean parallel-group join, merge each finished
//! lane's worktree branch back into the run-level worktree. Split out of
//! [`super::parallel`] for line budget (same worktree-orchestration cluster).
//! Moved verbatim out of `executor.rs` (WS0B-R).

use std::path::Path;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::Isolation;

use super::executor::{failed_msg, WorkflowStepExecutorImpl};
use super::parallel::worktree_branch_for_scope;

impl WorkflowStepExecutorImpl {
    /// M2(b): at a clean parallel-group join, merge each lane's branch back into
    /// the run-level worktree, in lane order (deterministic). Under `Workspace`
    /// isolation everything already shared the pinned checkout (nothing to merge);
    /// a lane that never minted a worktree (no workspace-using step ran) has
    /// nothing to merge either. A conflict fails the run honestly
    /// (`lane_merge_conflict`); an already-merged lane (crash-resume mid-merge) is
    /// skipped by the blocking helper's merge-base guard.
    pub(super) async fn merge_lanes_into_run_worktree_impl(
        &self,
        lanes: &[String],
    ) -> Result<(), StepOutcome> {
        if self.isolation == Isolation::Workspace {
            return Ok(());
        }
        // Only lanes that actually minted a worktree have anything to merge.
        let lane_targets: Vec<(String, String)> = {
            let guard = self.lane_workspaces.lock().await;
            lanes
                .iter()
                .filter_map(|lane| guard.get(lane).map(|id| (lane.clone(), id.clone())))
                .collect()
        };
        if lane_targets.is_empty() {
            return Ok(());
        }
        // The merge target — the run-level worktree the lanes were based off (so
        // it exists; resolving is a memo hit). Mint defensively if somehow absent.
        let run_level_id = self.run_level_workspace_id().await?;
        let workspace_runtime = self.deps.workspace_runtime.clone();
        let run_id = self.run_id.clone();
        tokio::task::spawn_blocking(move || {
            merge_lanes_into_run_worktree_blocking(&workspace_runtime, &run_id, &run_level_id, &lane_targets)
        })
        .await
        .map_err(|error| {
            failed_msg(
                "lane_merge_failed",
                format!("lane merge-back task failed: {error}"),
            )
        })?
    }
}

/// The per-lane merge-back decision (M2b), pure so the idempotency contract is
/// unit-testable without a live repo: a lane whose branch is already an ancestor
/// of the run-level worktree HEAD is SKIPPED (already merged — crash-resume mid
/// merge-back must never double-merge), otherwise it is MERGED.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LaneMergeAction {
    Skip,
    Merge,
}

pub(super) fn decide_lane_merge(lane_branch_is_ancestor_of_run_head: bool) -> LaneMergeAction {
    if lane_branch_is_ancestor_of_run_head {
        LaneMergeAction::Skip
    } else {
        LaneMergeAction::Merge
    }
}

/// Merge every finished lane's branch into the run-level worktree, sequentially
/// in the given lane order (M2b). Runs blocking git in `spawn_blocking`. Each
/// merge is idempotent (skipped when already an ancestor of the run HEAD — see
/// [`decide_lane_merge`]) and a conflict aborts + fails the run
/// (`lane_merge_conflict`), never silently dropping conflicting work.
fn merge_lanes_into_run_worktree_blocking(
    workspace_runtime: &crate::domains::workspaces::runtime::WorkspaceRuntime,
    run_id: &str,
    run_level_id: &str,
    lane_targets: &[(String, String)],
) -> Result<(), StepOutcome> {
    let run_level = workspace_runtime
        .get_workspace(run_level_id)
        .map_err(|error| {
            failed_msg(
                "lane_merge_failed",
                format!("could not load run-level worktree: {error}"),
            )
        })?
        .ok_or_else(|| {
            failed_msg(
                "lane_merge_failed",
                format!("run-level worktree {run_level_id} not found"),
            )
        })?;
    let run_level_path = Path::new(&run_level.path);
    for (lane_name, _lane_workspace_id) in lane_targets {
        let lane_branch = worktree_branch_for_scope(run_id, lane_name);
        // Idempotency guard (crash-resume): the lane branch already merged (its
        // tip is an ancestor of the run-level HEAD) → skip, never double-merge.
        let already_merged = std::process::Command::new("git")
            .current_dir(run_level_path)
            .args(["merge-base", "--is-ancestor", &lane_branch, "HEAD"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if decide_lane_merge(already_merged) == LaneMergeAction::Skip {
            tracing::info!(
                run_id = %run_id,
                lane = %lane_name,
                branch = %lane_branch,
                "lane already merged into run worktree — skipping (idempotent)"
            );
            continue;
        }
        // Default merge (no squash), non-interactive. A conflict returns non-zero;
        // abort to leave the run-level worktree clean for inspection, then fail.
        let output = std::process::Command::new("git")
            .current_dir(run_level_path)
            .args(["merge", "--no-edit", &lane_branch])
            .output()
            .map_err(|error| {
                failed_msg(
                    "lane_merge_failed",
                    format!("git merge for lane '{lane_name}' failed to spawn: {error}"),
                )
            })?;
        if !output.status.success() {
            let _ = std::process::Command::new("git")
                .current_dir(run_level_path)
                .args(["merge", "--abort"])
                .output();
            return Err(failed_msg(
                "lane_merge_conflict",
                format!(
                    "lane '{lane_name}' could not be merged into the run worktree \
                     (conflicting parallel work): {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            ));
        }
        tracing::info!(
            run_id = %run_id,
            lane = %lane_name,
            branch = %lane_branch,
            "merged lane into run worktree"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decide_lane_merge_skips_when_already_ancestor() {
        // M2(b) idempotency: a lane whose branch is already an ancestor of the
        // run-level HEAD (crash-resume mid merge-back) is skipped, never re-merged;
        // otherwise it is merged.
        assert_eq!(decide_lane_merge(true), LaneMergeAction::Skip);
        assert_eq!(decide_lane_merge(false), LaneMergeAction::Merge);
    }
}
