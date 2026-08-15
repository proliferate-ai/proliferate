//! Mobility preflight: can this workspace move right now?
//!
//! Live because it asks live terminals whether setup is running and which
//! terminals are open, and reaches live session execution state through
//! `SessionRuntime`. Delegates the archive size estimate down to the durable
//! service.
//!
//! Pipeline: one resolve pass gathers every fact (store rows, git inspection,
//! live probes) → `mobility_policy::assess_mobility_preflight` decides the
//! blocker/warning matrix → the only remaining effect is the archive-size
//! estimate, which is gated on that verdict and re-decided by
//! `mobility_policy::archive_size_blocker`. Preflight has no compensations: it
//! is a read-only assessment, the archive export writes nothing.
//!
//! The size estimate is deliberately still last. It is the one expensive fetch
//! (it exports a whole archive), it is skipped entirely when anything else
//! already blocks the move, and it is a fetch whose own result feeds a further
//! decision — the doctrine's "effects that change facts force a re-resolve"
//! rule, minus the effect.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Instant;

use super::mobility_policy::{
    archive_size_blocker, assess_mobility_preflight, classify_session_support, movable_session_ids,
    workspace_can_move, DefaultBranchFact, PreflightFacts, PreflightGitStatus, PreflightReviewRun,
    PreflightSessionFacts,
};
use super::MobilityRuntime;
use crate::adapters::git::executor::run_git_ok;
use crate::adapters::git::types::GitOperation;
use crate::adapters::git::GitService;
use crate::domains::mobility::model::{
    MobilitySessionCandidate, WorkspaceMobilityExportOptions, WorkspaceMobilityPreflightResult,
};
use crate::domains::mobility::service::{
    archive_estimated_size_bytes, map_access_error, MobilityError,
};
use crate::domains::mobility::workspace_delta::current_branch_name;
use crate::domains::workspaces::model::WorkspaceKind;

impl MobilityRuntime {
    pub async fn preflight_workspace(
        &self,
        workspace_id: &str,
        exclude_paths: &[String],
    ) -> Result<WorkspaceMobilityPreflightResult, MobilityError> {
        let started = Instant::now();

        // --- resolve -------------------------------------------------------
        let workspace = self.mobility_service.load_workspace(workspace_id)?;
        let runtime_state = self
            .access_gate
            .runtime_state(workspace_id)
            .map_err(map_access_error)?;

        let workspace_path = PathBuf::from(&workspace.path);
        let repo_root = GitService::resolve_repo_root(&workspace_path)
            .map_err(|_| MobilityError::NotGitWorkspace(workspace.path.clone()))?;
        let base_commit_sha = run_git_ok(&repo_root, &["rev-parse", "HEAD"])?
            .trim()
            .to_string();
        let branch_name = current_branch_name(&repo_root)?;
        tracing::info!(
            workspace_id = %workspace_id,
            workspace_kind = %workspace.kind,
            runtime_mode = %runtime_state.mode.as_str(),
            branch_name = branch_name.as_deref().unwrap_or(""),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "[workspace-latency] mobility.preflight.repo_ready"
        );

        let sessions = self
            .session_service
            .list_sessions(Some(workspace_id), true)?
            .into_iter()
            .map(|session| {
                let support = classify_session_support(&session.agent_kind);
                MobilitySessionCandidate {
                    supported: support.supported,
                    reason: support.reason,
                    session,
                }
            })
            .collect::<Vec<_>>();

        let default_branch = if workspace.kind == WorkspaceKind::Local {
            let repo_root_id = workspace.repo_root_id.clone();
            match self
                .workspace_runtime
                .resolve_repo_root_default_branch(&repo_root_id)
            {
                Ok(branch) => DefaultBranchFact::Resolved(branch),
                Err(_) => DefaultBranchFact::Unresolved,
            }
        } else {
            DefaultBranchFact::NotRequired
        };

        let setup_running = self.terminal_service.is_setup_running(workspace_id).await;

        let git_status = match GitService::status(workspace_id, &workspace_path) {
            Ok(status) => PreflightGitStatus::Inspected {
                detached: status.detached,
                operation_in_progress: status.operation != GitOperation::None,
                conflicted: status.conflicted,
                clean: status.clean,
            },
            Err(error) => PreflightGitStatus::Unavailable {
                error: error.to_string(),
            },
        };

        let active_terminal_ids = self
            .active_terminals_async(workspace_id)
            .await
            .into_iter()
            .map(|terminal| terminal.id)
            .collect::<Vec<_>>();

        let active_review_runs = self
            .review_store
            .list_active_runs_for_workspace(workspace_id)?
            .into_iter()
            .map(|run| PreflightReviewRun {
                run_id: run.id,
                parent_session_id: run.parent_session_id,
            })
            .collect::<Vec<_>>();

        let mut session_facts = Vec::with_capacity(sessions.len());
        for candidate in &sessions {
            let execution_summary = self
                .session_runtime
                .session_execution_summary(&candidate.session)
                .await;
            let has_pending_prompts = !self
                .session_service
                .store()
                .list_pending_prompts(&candidate.session.id)?
                .is_empty();
            session_facts.push(PreflightSessionFacts {
                session_id: candidate.session.id.clone(),
                status: candidate.session.status.clone(),
                agent_kind: candidate.session.agent_kind.clone(),
                supported: candidate.supported,
                unsupported_reason: candidate.reason.clone(),
                awaiting_interaction: !execution_summary.pending_interactions.is_empty(),
                has_pending_prompts,
            });
        }

        let movable_ids = movable_session_ids(&session_facts)
            .into_iter()
            .collect::<HashSet<_>>();
        let partial_graph = self
            .partial_session_link_graph(&movable_ids)
            .map_err(MobilityError::Internal)?;

        // --- decide --------------------------------------------------------
        let assessment = assess_mobility_preflight(&PreflightFacts {
            workspace_kind: workspace.kind,
            runtime_mode: runtime_state.mode,
            branch_name: branch_name.clone(),
            default_branch,
            setup_running,
            git_status,
            active_terminal_ids,
            active_review_runs,
            sessions: session_facts,
            partial_subagent_graph_session_ids: partial_graph,
        });
        let mut blockers = assessment.blockers;
        let warnings = assessment.warnings;
        tracing::info!(
            workspace_id = %workspace_id,
            session_count = sessions.len(),
            blocker_count = blockers.len(),
            warning_count = warnings.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "[workspace-latency] mobility.preflight.validation_complete"
        );

        // --- resolve the size estimate, then decide over it -----------------
        let archive_estimated_bytes = if workspace_can_move(&blockers) {
            let archive_started = Instant::now();
            tracing::info!(
                workspace_id = %workspace_id,
                exclude_path_count = exclude_paths.len(),
                "[workspace-latency] mobility.preflight.archive_estimate.start"
            );
            let archive = self.mobility_service.export_workspace_archive(
                workspace_id,
                &WorkspaceMobilityExportOptions {
                    exclude_paths: exclude_paths.to_vec(),
                    ..WorkspaceMobilityExportOptions::default()
                },
            )?;
            let size = archive_estimated_size_bytes(&archive);
            blockers.extend(archive_size_blocker(size));
            tracing::info!(
                workspace_id = %workspace_id,
                archive_estimated_bytes = size,
                elapsed_ms = archive_started.elapsed().as_millis() as u64,
                "[workspace-latency] mobility.preflight.archive_estimate.completed"
            );
            Some(size)
        } else {
            None
        };

        let can_move = workspace_can_move(&blockers);
        tracing::info!(
            workspace_id = %workspace_id,
            can_move = can_move,
            blocker_count = blockers.len(),
            warning_count = warnings.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "[workspace-latency] mobility.preflight.completed"
        );

        Ok(WorkspaceMobilityPreflightResult {
            workspace_id: workspace.id,
            runtime_state,
            can_move,
            branch_name,
            base_commit_sha: Some(base_commit_sha),
            archive_estimated_bytes,
            blockers,
            sessions,
            warnings,
        })
    }

    fn partial_session_link_graph(
        &self,
        session_ids: &HashSet<String>,
    ) -> anyhow::Result<Vec<String>> {
        let mut blockers = Vec::new();
        for session_id in session_ids {
            for link in self
                .session_link_service
                .list_by_parent_including_closed(session_id)?
            {
                if !session_ids.contains(&link.child_session_id) && link.closed_at.is_none() {
                    blockers.push(link.child_session_id);
                }
            }
            for link in self
                .session_link_service
                .list_by_child_including_closed(session_id)?
            {
                if !session_ids.contains(&link.parent_session_id) && link.closed_at.is_none() {
                    blockers.push(link.parent_session_id);
                }
            }
        }
        blockers.sort();
        blockers.dedup();
        Ok(blockers)
    }
}
