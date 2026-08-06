//! Destroy the source workspace after a committed move.
//!
//! Live because it force-closes live terminals and because destroying the
//! materialization goes through `WorkspaceRuntime`.
//!
//! Pipeline: resolve every fact (workspace record, repo default branch, live
//! terminals, session rows) → decide the whole effect sequence in
//! `mobility_policy::plan_source_destruction` → execute the plan in order. The
//! resolve pass replaces the old fetch/act interleaving, so the `Local`
//! default-branch precondition is now proved before the first irreversible
//! effect instead of being discovered by the materialization call after the
//! terminals are closed and the sessions deleted.
//!
//! There is no compensation slot here on purpose: force-closing a terminal,
//! deleting a session row, and removing a worktree are all irreversible, so a
//! mid-sequence failure cannot be rolled back. The plan is therefore ordered
//! cheapest-to-recover first (terminals, which the user can reopen) and the
//! partial progress is logged before the error propagates. The caller holds the
//! exclusive workspace lease for the whole call, so no concurrent writer can
//! invalidate the resolved facts between decide and execute.

use std::collections::HashMap;
use std::path::PathBuf;

use super::mobility_policy::{
    plan_source_destruction, DefaultBranchFact, SourceDestructionFacts, SourceDestructionRejection,
    TerminalFact,
};
use super::MobilityRuntime;
use crate::domains::agents::portability::delete_session_agent_artifacts;
use crate::domains::mobility::model::DestroyedWorkspaceSourceSummary;
use crate::domains::mobility::service::MobilityError;
use crate::domains::workspaces::model::WorkspaceKind;

impl MobilityRuntime {
    pub fn destroy_source_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<DestroyedWorkspaceSourceSummary, MobilityError> {
        // --- resolve -------------------------------------------------------
        let workspace = self.mobility_service.load_workspace(workspace_id)?;
        let workspace_path = PathBuf::from(&workspace.path);
        let default_branch = if workspace.kind == WorkspaceKind::Local {
            let repo_root_id = workspace.repo_root_id.clone();
            DefaultBranchFact::Resolved(
                self.workspace_runtime
                    .resolve_repo_root_default_branch(&repo_root_id)
                    .map_err(MobilityError::Internal)?,
            )
        } else {
            DefaultBranchFact::NotRequired
        };
        let terminals = self
            .terminal_service
            .list_terminals_blocking(workspace_id)
            .into_iter()
            .map(|terminal| TerminalFact {
                terminal_id: terminal.id,
                status: terminal.status,
            })
            .collect::<Vec<_>>();
        let sessions = self
            .session_service
            .store()
            .list_by_workspace(workspace_id)?;

        // --- decide --------------------------------------------------------
        let plan = plan_source_destruction(&SourceDestructionFacts {
            workspace_kind: workspace.kind,
            default_branch,
            terminals,
            session_ids: sessions.iter().map(|session| session.id.clone()).collect(),
        })
        .map_err(|rejection| match rejection {
            // Same message and surface the materialization call used to raise
            // once the effects had already run.
            SourceDestructionRejection::MissingLocalDefaultBranch => MobilityError::Internal(
                anyhow::anyhow!("default branch is required to park a local workspace"),
            ),
        })?;

        // --- execute -------------------------------------------------------
        let mut closed_terminal_ids = Vec::new();
        for terminal_id in &plan.close_terminal_ids {
            if let Err(error) = self.terminal_service.close_terminal_blocking(terminal_id) {
                tracing::error!(
                    workspace_id = %workspace_id,
                    terminal_id = %terminal_id,
                    closed_terminal_count = closed_terminal_ids.len(),
                    error = %error,
                    "mobility destroy-source aborted while closing terminals; no session was deleted"
                );
                return Err(MobilityError::Internal(error));
            }
            closed_terminal_ids.push(terminal_id.clone());
        }

        // The plan names ids; the records travel beside it. Resolve the plan's
        // ids back to their rows BEFORE the first deletion so a mismatch fails
        // with nothing half-deleted.
        let sessions_by_id = sessions
            .iter()
            .map(|session| (session.id.as_str(), session))
            .collect::<HashMap<_, _>>();
        let planned_sessions = plan
            .delete_session_ids
            .iter()
            .map(|session_id| {
                sessions_by_id
                    .get(session_id.as_str())
                    .copied()
                    .ok_or_else(|| {
                        MobilityError::Internal(anyhow::anyhow!(
                            "destroy-source plan named unknown session {session_id}"
                        ))
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let mut deleted_session_ids = Vec::new();
        let runtime_home = Some(self.session_runtime.runtime_home());
        for session in planned_sessions {
            if let Err(error) =
                delete_session_agent_artifacts(session, &workspace_path, runtime_home)
                    .and_then(|()| self.session_service.delete_session(&session.id))
            {
                tracing::error!(
                    workspace_id = %workspace_id,
                    session_id = %session.id,
                    closed_terminal_count = closed_terminal_ids.len(),
                    deleted_session_count = deleted_session_ids.len(),
                    error = %error,
                    "mobility destroy-source aborted while deleting sessions; the materialization was left in place"
                );
                return Err(MobilityError::Internal(error));
            }
            deleted_session_ids.push(session.id.clone());
        }

        if let Err(error) = self
            .workspace_runtime
            .destroy_source_workspace_materialization(
                &workspace,
                plan.materialization.default_branch(),
            )
        {
            tracing::error!(
                workspace_id = %workspace_id,
                closed_terminal_count = closed_terminal_ids.len(),
                deleted_session_count = deleted_session_ids.len(),
                error = %error,
                "mobility destroy-source aborted while destroying the materialization"
            );
            return Err(MobilityError::Internal(error));
        }

        Ok(DestroyedWorkspaceSourceSummary {
            workspace_id: workspace.id,
            deleted_session_ids,
            closed_terminal_ids,
            source_destroyed: true,
        })
    }
}
