//! Lane merge-back (M2b): at a clean parallel-group join, merge each finished
//! lane's worktree branch back into the run-level worktree. Split out of
//! [`super::parallel`] for line budget (same worktree-orchestration cluster).
//! Moved verbatim out of `executor.rs` (WS0B-R).

use std::path::Path;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::Isolation;

use super::executor::{failed_msg, WorkflowStepExecutorImpl};
use super::parallel::worktree_branch_for_scope;
use crate::live::workflows::isolation::{
    run_workflow_command, WorkflowCommandRequest, WorkflowProcessIdentity,
    WORKFLOW_COMMAND_COMBINED_LIMIT, WORKFLOW_COMMAND_MEMORY_LIMIT, WORKFLOW_COMMAND_PROCESS_LIMIT,
    WORKFLOW_COMMAND_STDERR_LIMIT, WORKFLOW_COMMAND_STDOUT_LIMIT,
};
use crate::process_env::complete_workflow_operation_env;

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
        self.merge_lanes_into_run_worktree_brokered(&run_level_id, &lane_targets)
            .await
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
impl WorkflowStepExecutorImpl {
    async fn merge_lanes_into_run_worktree_brokered(
        &self,
        run_level_id: &str,
        lane_targets: &[(String, String)],
    ) -> Result<(), StepOutcome> {
        let run_level = self
            .deps
            .workspace_runtime
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
            let lane_branch = worktree_branch_for_scope(&self.run_id, lane_name);
            let identity = WorkflowProcessIdentity::try_lane_merge(
                self.isolation_capability.identity().clone(),
                lane_name,
                run_level_path,
            )
            .map_err(|error| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    format!("invalid lane merge identity: {error}"),
                )
            })?;
            // Idempotency guard (crash-resume): the lane branch already merged (its
            // tip is an ancestor of the run-level HEAD) → skip, never double-merge.
            let already_merged = run_workflow_command(
                self.deps.workflow_isolation_broker.as_ref(),
                &self.isolation_capability,
                WorkflowCommandRequest {
                    identity: identity.clone(),
                    program: "/usr/bin/git".into(),
                    args: vec![
                        "merge-base".to_string(),
                        "--is-ancestor".to_string(),
                        lane_branch.clone(),
                        "HEAD".to_string(),
                    ],
                    cwd: run_level_path.to_path_buf(),
                    env: complete_workflow_operation_env(Vec::new()),
                    timeout: std::time::Duration::from_secs(60),
                    max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
                    max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
                    max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
                    max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
                    max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
                },
            )
            .await
            .map(|output| output.exit_code == Some(0))
            .unwrap_or(false);
            if decide_lane_merge(already_merged) == LaneMergeAction::Skip {
                tracing::info!(
                    run_id = %self.run_id,
                    lane = %lane_name,
                    branch = %lane_branch,
                    "lane already merged into run worktree — skipping (idempotent)"
                );
                continue;
            }
            // Default merge (no squash), non-interactive. A conflict returns non-zero;
            // abort to leave the run-level worktree clean for inspection, then fail.
            let output = run_workflow_command(
                self.deps.workflow_isolation_broker.as_ref(),
                &self.isolation_capability,
                WorkflowCommandRequest {
                    identity: identity.clone(),
                    program: "/usr/bin/git".into(),
                    args: vec![
                        "merge".to_string(),
                        "--no-ff".to_string(),
                        "--no-edit".to_string(),
                        lane_branch.clone(),
                    ],
                    cwd: run_level_path.to_path_buf(),
                    env: complete_workflow_operation_env(Vec::new()),
                    timeout: std::time::Duration::from_secs(180),
                    max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
                    max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
                    max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
                    max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
                    max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
                },
            )
            .await
            .map_err(|error| {
                failed_msg(
                    "lane_merge_failed",
                    format!("git merge for lane '{lane_name}' failed to spawn: {error}"),
                )
            })?;
            if output.exit_code != Some(0) {
                let _ = run_workflow_command(
                    self.deps.workflow_isolation_broker.as_ref(),
                    &self.isolation_capability,
                    WorkflowCommandRequest {
                        identity,
                        program: "/usr/bin/git".into(),
                        args: vec!["merge".to_string(), "--abort".to_string()],
                        cwd: run_level_path.to_path_buf(),
                        env: complete_workflow_operation_env(Vec::new()),
                        timeout: std::time::Duration::from_secs(60),
                        max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
                        max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
                        max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
                        max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
                        max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
                    },
                )
                .await;
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
                run_id = %self.run_id,
                lane = %lane_name,
                branch = %lane_branch,
                "merged lane into run worktree"
            );
        }
        Ok(())
    }
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
