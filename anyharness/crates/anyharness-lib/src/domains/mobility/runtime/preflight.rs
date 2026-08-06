//! Mobility preflight: can this workspace move right now?
//!
//! Live because it asks live terminals whether setup is running and which
//! terminals are open, and reaches live session execution state through
//! `SessionRuntime`. Delegates the archive size estimate down to the durable
//! service.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Instant;

use super::MobilityRuntime;
use crate::adapters::git::executor::run_git_ok;
use crate::adapters::git::types::GitOperation;
use crate::adapters::git::GitService;
use crate::domains::mobility::model::{
    MobilityBlocker, MobilitySessionCandidate, WorkspaceMobilityExportOptions,
    WorkspaceMobilityPreflightResult, MAX_MOBILITY_ARCHIVE_BODY_BYTES,
};
use crate::domains::mobility::service::{
    archive_estimated_size_bytes, is_supported_agent_kind, map_access_error, MobilityError,
};
use crate::domains::mobility::workspace_delta::current_branch_name;
use crate::domains::workspaces::access_model::WorkspaceAccessMode;
use crate::domains::workspaces::model::WorkspaceKind;

impl MobilityRuntime {
    pub async fn preflight_workspace(
        &self,
        workspace_id: &str,
        exclude_paths: &[String],
    ) -> Result<WorkspaceMobilityPreflightResult, MobilityError> {
        let started = Instant::now();
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
            .map(|session| MobilitySessionCandidate {
                supported: is_supported_agent_kind(&session.agent_kind),
                reason: if is_supported_agent_kind(&session.agent_kind) {
                    None
                } else {
                    Some("Unsupported agent kind for workspace mobility v1".to_string())
                },
                session,
            })
            .collect::<Vec<_>>();

        let mut blockers = Vec::new();
        let mut warnings = Vec::new();

        if runtime_state.mode != WorkspaceAccessMode::Normal {
            blockers.push(MobilityBlocker {
                code: "workspace_not_mutable".to_string(),
                message: format!(
                    "Workspace is currently in {} mode",
                    runtime_state.mode.as_str()
                ),
                session_id: None,
            });
        }

        let default_branch = if workspace.kind == WorkspaceKind::Local {
            let repo_root_id = workspace.repo_root_id.clone();
            match self
                .workspace_runtime
                .resolve_repo_root_default_branch(&repo_root_id)
            {
                Ok(branch) => Some(branch),
                Err(_) => {
                    blockers.push(MobilityBlocker {
                        code: "default_branch_unknown".to_string(),
                        message: ("Main local workspaces require a resolved repo default branch "
                            .to_string()),
                        session_id: None,
                    });
                    None
                }
            }
        } else {
            None
        };

        if self.terminal_service.is_setup_running(workspace_id).await {
            blockers.push(MobilityBlocker {
                code: "setup_running".to_string(),
                message: "Workspace setup is still running".to_string(),
                session_id: None,
            });
        }

        match GitService::status(workspace_id, &workspace_path) {
            Ok(status) => {
                if status.detached {
                    blockers.push(MobilityBlocker {
                        code: "workspace_detached".to_string(),
                        message: "Workspace must be on a branch before moving".to_string(),
                        session_id: None,
                    });
                }
                if status.operation != GitOperation::None {
                    blockers.push(MobilityBlocker {
                        code: "git_operation_in_progress".to_string(),
                        message: "Finish the current Git operation before moving".to_string(),
                        session_id: None,
                    });
                }
                if status.conflicted {
                    blockers.push(MobilityBlocker {
                        code: "workspace_conflicted".to_string(),
                        message: "Resolve Git conflicts before moving".to_string(),
                        session_id: None,
                    });
                }
                if !status.clean {
                    blockers.push(MobilityBlocker {
                        code: "workspace_dirty".to_string(),
                        message: "Workspace must be committed and clean before moving".to_string(),
                        session_id: None,
                    });
                }
            }
            Err(error) => blockers.push(MobilityBlocker {
                code: "workspace_status_unknown".to_string(),
                message: format!("Unable to inspect workspace status: {error}"),
                session_id: None,
            }),
        }

        if workspace.kind == WorkspaceKind::Local {
            if let (Some(current_branch), Some(default_branch)) =
                (branch_name.as_deref(), default_branch.as_deref())
            {
                if current_branch == default_branch {
                    blockers.push(MobilityBlocker {
                        code: "local_default_branch_in_use".to_string(),
                        message: format!(
                            "Main local workspaces on '{default_branch}' must move from a worktree instead"
                        ),
                        session_id: None,
                    });
                }
            }
        }

        for terminal in self.active_terminals_async(workspace_id).await {
            warnings.push(format!(
                "Terminal {} will be force-closed after the move commits",
                terminal.id
            ));
        }

        for run in self
            .review_store
            .list_active_runs_for_workspace(workspace_id)?
        {
            blockers.push(MobilityBlocker {
                code: "review_active".to_string(),
                message: format!("Review run {} is still active", run.id),
                session_id: Some(run.parent_session_id),
            });
        }

        for candidate in &sessions {
            if matches!(candidate.session.status.as_str(), "starting" | "running") {
                blockers.push(MobilityBlocker {
                    code: "session_running".to_string(),
                    message: format!("Session {} is still active", candidate.session.id),
                    session_id: Some(candidate.session.id.clone()),
                });
            }

            let execution_summary = self
                .session_runtime
                .session_execution_summary(&candidate.session)
                .await;
            if !execution_summary.pending_interactions.is_empty() {
                blockers.push(MobilityBlocker {
                    code: "session_awaiting_interaction".to_string(),
                    message: format!("Session {} is awaiting interaction", candidate.session.id),
                    session_id: Some(candidate.session.id.clone()),
                });
            }

            if !self
                .session_service
                .store()
                .list_pending_prompts(&candidate.session.id)?
                .is_empty()
            {
                blockers.push(MobilityBlocker {
                    code: "pending_prompt".to_string(),
                    message: format!("Session {} has pending prompts", candidate.session.id),
                    session_id: Some(candidate.session.id.clone()),
                });
            }

            if !candidate.supported {
                blockers.push(MobilityBlocker {
                    code: "unsupported_session".to_string(),
                    message: format!(
                        "Session {} ({}) cannot move because {}",
                        candidate.session.id,
                        candidate.session.agent_kind,
                        candidate
                            .reason
                            .clone()
                            .unwrap_or_else(|| "it is unsupported".to_string())
                    ),
                    session_id: Some(candidate.session.id.clone()),
                });
            }
        }
        let session_ids = sessions
            .iter()
            .filter(|candidate| candidate.supported)
            .map(|candidate| candidate.session.id.clone())
            .collect::<HashSet<_>>();
        let (_links, _completions, _wake_schedules, partial_graph) = self
            .subagent_service
            .mobility_graph_for_sessions(&session_ids)
            .map_err(MobilityError::Internal)?;
        for missing_id in partial_graph {
            blockers.push(MobilityBlocker {
                code: "partial_subagent_graph".to_string(),
                message: format!(
                    "Session graph includes linked subagent session {missing_id} outside this archive"
                ),
                session_id: Some(missing_id),
            });
        }
        tracing::info!(
            workspace_id = %workspace_id,
            session_count = sessions.len(),
            blocker_count = blockers.len(),
            warning_count = warnings.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "[workspace-latency] mobility.preflight.validation_complete"
        );

        let archive_estimated_bytes = if blockers.is_empty() {
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
            if size > MAX_MOBILITY_ARCHIVE_BODY_BYTES as u64 {
                blockers.push(MobilityBlocker {
                    code: "archive_too_large".to_string(),
                    message: format!(
                        "Archive exceeds the {} byte limit",
                        MAX_MOBILITY_ARCHIVE_BODY_BYTES
                    ),
                    session_id: None,
                });
            }
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

        let can_move = blockers.is_empty();
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
}
