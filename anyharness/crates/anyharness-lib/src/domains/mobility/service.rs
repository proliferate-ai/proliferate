use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Context;

use crate::adapters::git::executor::run_git_ok;
use crate::domains::agents::portability::{
    collect_agent_artifacts, delete_session_agent_artifacts, install_session_agent_artifacts,
    validate_session_agent_artifacts, AgentArtifactFileData,
};
use crate::domains::mobility::model::{
    DestroyedWorkspaceSourceSummary, ImportedWorkspaceArchiveSummary, MobilityBlocker,
    MobilityFileData, MobilityInstallMode, MobilitySessionCandidate, WorkspaceMobilityArchiveData,
    WorkspaceMobilityExportOptions, WorkspaceMobilityPreflightResult,
    WorkspaceMobilitySessionBundleData, MAX_MOBILITY_ARCHIVE_BODY_BYTES, MAX_MOBILITY_FILE_BYTES,
};
use crate::domains::mobility::store::MobilityStore;
use crate::domains::mobility::workspace_delta::{collect_workspace_delta, current_branch_name};
use crate::domains::reviews::store::ReviewStore;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::terminals::model::{TerminalRecord, TerminalStatus};
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::access_model::{WorkspaceAccessMode, WorkspaceAccessRecord};
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::service::WorkspaceService;
use crate::domains::workspaces::types::PreparedWorkspaceMobilityDestination;
use crate::live::terminals::TerminalService;
use crate::{
    adapters::files::safety::resolve_safe_path,
    adapters::git::{types::GitOperation, GitService},
};

const INCLUDE_RAW_NOTIFICATIONS_ENV: &str = "ANYHARNESS_MOBILITY_INCLUDE_RAW_NOTIFICATIONS";

#[derive(Debug, thiserror::Error)]
pub enum MobilityError {
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("workspace is not backed by a git repository: {0}")]
    NotGitWorkspace(String),
    #[error("destination base commit {destination} did not match archive base {archive}")]
    BaseCommitMismatch {
        destination: String,
        archive: String,
    },
    #[error("session already exists in destination workspace: {0}")]
    SessionAlreadyExists(String),
    #[error("mobility archive exceeds size limits: {0}")]
    SizeLimitExceeded(String),
    #[error("mobility destination conflict: {0}")]
    DestinationConflict(String),
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// How `validate_install_preconditions` wants each archived session id with
/// a pre-existing local row handled during apply. A session id absent from
/// both sets is a plain fresh import.
#[derive(Debug, Default)]
struct ExistingArchiveSessionPlan {
    /// Same-runtime move: the existing row lives on a different (frozen or
    /// remote_owned) workspace that matches the archive's own source —
    /// update it in place instead of inserting a new row.
    relocate: HashSet<String>,
    /// Round-trip coming home: the existing row already lives on the
    /// destination workspace itself (a prior-home leftover) — delete it and
    /// import the archive's copy fresh.
    readopt: HashSet<String>,
}

#[derive(Clone)]
pub struct MobilityService {
    workspace_service: Arc<WorkspaceService>,
    workspace_runtime: Arc<WorkspaceRuntime>,
    mobility_store: MobilityStore,
    session_service: Arc<SessionService>,
    session_runtime: Arc<SessionRuntime>,
    subagent_service: Arc<SubagentService>,
    review_store: ReviewStore,
    access_gate: Arc<WorkspaceAccessGate>,
    terminal_service: Arc<TerminalService>,
}

impl MobilityService {
    pub fn new(
        workspace_service: Arc<WorkspaceService>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        mobility_store: MobilityStore,
        session_service: Arc<SessionService>,
        session_runtime: Arc<SessionRuntime>,
        subagent_service: Arc<SubagentService>,
        review_store: ReviewStore,
        access_gate: Arc<WorkspaceAccessGate>,
        terminal_service: Arc<TerminalService>,
    ) -> Self {
        Self {
            workspace_service,
            workspace_runtime,
            mobility_store,
            session_service,
            session_runtime,
            subagent_service,
            review_store,
            access_gate,
            terminal_service,
        }
    }

    pub async fn prepare_repo_root_destination(
        &self,
        repo_root_id: &str,
        requested_branch: &str,
        requested_base_sha: &str,
        destination_id: Option<&str>,
        preferred_workspace_name: Option<&str>,
    ) -> Result<PreparedWorkspaceMobilityDestination, MobilityError> {
        let repo_root_id = repo_root_id.trim().to_string();
        let requested_branch = requested_branch.trim().to_string();
        let requested_base_sha = requested_base_sha.trim().to_string();
        let preferred_workspace_name = preferred_workspace_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let destination_id = destination_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if requested_branch.is_empty() {
            return Err(MobilityError::Invalid(
                "requested branch is required".to_string(),
            ));
        }
        if requested_base_sha.is_empty() {
            return Err(MobilityError::Invalid(
                "requested base sha is required".to_string(),
            ));
        }

        let workspace_runtime = self.workspace_runtime.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            workspace_runtime.create_mobility_destination(
                &repo_root_id,
                &requested_branch,
                &requested_base_sha,
                destination_id.as_deref(),
                preferred_workspace_name.as_deref(),
            )
        })
        .await
        .map_err(|error| MobilityError::Internal(anyhow::anyhow!(error.to_string())))?
        .map_err(|error| {
            let message = error.to_string();
            if message.contains("mobility destination conflict") {
                MobilityError::DestinationConflict(message)
            } else {
                MobilityError::Internal(error)
            }
        })?;

        self.validate_prepared_destination_is_empty(&prepared.workspace)
            .await?;

        Ok(prepared)
    }

    pub async fn preflight_workspace(
        &self,
        workspace_id: &str,
        exclude_paths: &[String],
    ) -> Result<WorkspaceMobilityPreflightResult, MobilityError> {
        let started = Instant::now();
        let workspace = self.load_workspace(workspace_id)?;
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
            let archive = self.export_workspace_archive(
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

    pub fn export_workspace_archive(
        &self,
        workspace_id: &str,
        options: &WorkspaceMobilityExportOptions,
    ) -> Result<WorkspaceMobilityArchiveData, MobilityError> {
        let workspace = self.load_workspace(workspace_id)?;
        self.validate_expected_export_runtime_state(workspace_id, options)?;
        let workspace_path = PathBuf::from(&workspace.path);
        let repo_root = GitService::resolve_repo_root(&workspace_path)
            .map_err(|_| MobilityError::NotGitWorkspace(workspace.path.clone()))?;
        let repo_root_string = repo_root.display().to_string();
        let base_commit_sha = run_git_ok(&repo_root, &["rev-parse", "HEAD"])?
            .trim()
            .to_string();
        let branch_name = current_branch_name(&repo_root)?;
        if options.require_clean_git_state {
            validate_expected_export_git_state(
                workspace_id,
                &workspace_path,
                &base_commit_sha,
                branch_name.as_deref(),
                options,
            )?;
        }
        let delta = collect_workspace_delta(&repo_root, &options.exclude_paths)?;
        if options.require_clean_git_state {
            if !delta.files.is_empty() || !delta.deleted_paths.is_empty() {
                return Err(MobilityError::Invalid(
                    "Source workspace changed while preparing the mobility archive".to_string(),
                ));
            }
            validate_clean_repo_for_mobility(
                workspace_id,
                &workspace_path,
                "Source workspace must stay clean while exporting a mobility archive",
            )?;
        }
        let sessions = self.collect_workspace_sessions(&workspace)?;
        let session_ids = sessions
            .iter()
            .map(|bundle| bundle.session.id.clone())
            .collect::<HashSet<_>>();
        let (session_links, session_link_completions, session_link_wake_schedules, partial_graph) =
            self.subagent_service
                .mobility_graph_for_sessions(&session_ids)
                .map_err(MobilityError::Internal)?;
        if let Some(missing_id) = partial_graph.first() {
            return Err(MobilityError::Invalid(format!(
                "cannot export partial subagent graph; linked session {missing_id} is outside the archive"
            )));
        }
        self.validate_expected_export_runtime_state(workspace_id, options)?;

        let archive = WorkspaceMobilityArchiveData {
            source_workspace_id: Some(workspace.id),
            source_workspace_path: workspace.path,
            repo_root_path: repo_root_string,
            branch_name,
            base_commit_sha,
            files: delta.files,
            deleted_paths: delta.deleted_paths,
            sessions,
            session_links,
            session_link_completions,
            session_link_wake_schedules,
        };
        validate_archive_size(&archive)?;
        Ok(archive)
    }

    pub fn install_workspace_archive(
        &self,
        workspace_id: &str,
        archive: &WorkspaceMobilityArchiveData,
        operation_id: Option<&str>,
        install_mode: MobilityInstallMode,
    ) -> Result<ImportedWorkspaceArchiveSummary, MobilityError> {
        validate_archive_size(archive)?;
        let operation_id = operation_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(operation_id) = operation_id.as_deref() {
            if let Some(summary) = self
                .mobility_store
                .find_completed_install(workspace_id, operation_id)
                .map_err(MobilityError::Internal)?
            {
                return Ok(summary);
            }
        }
        let workspace = self.load_workspace(workspace_id)?;
        let workspace_path = PathBuf::from(&workspace.path);
        let repo_root = GitService::resolve_repo_root(&workspace_path)
            .map_err(|_| MobilityError::NotGitWorkspace(workspace.path.clone()))?;
        let destination_commit = run_git_ok(&repo_root, &["rev-parse", "HEAD"])?
            .trim()
            .to_string();
        if destination_commit != archive.base_commit_sha {
            return Err(MobilityError::BaseCommitMismatch {
                destination: destination_commit,
                archive: archive.base_commit_sha.clone(),
            });
        }
        validate_clean_repo_for_mobility(
            workspace_id,
            &workspace_path,
            "Destination workspace must be clean before installing a mobility archive",
        )?;

        let install_plan = self.validate_install_preconditions(&workspace, &repo_root, archive)?;

        for deleted_path in &archive.deleted_paths {
            let resolved = resolve_safe_path(&repo_root, deleted_path)
                .map_err(|error| MobilityError::Invalid(error.to_string()))?;
            if resolved.is_dir() {
                std::fs::remove_dir_all(&resolved)
                    .with_context(|| format!("removing destination path {}", resolved.display()))?;
            } else if resolved.exists() {
                std::fs::remove_file(&resolved)
                    .with_context(|| format!("removing destination path {}", resolved.display()))?;
            }
        }

        for file in &archive.files {
            write_workspace_file(&repo_root, file)?;
        }

        let mut imported_session_ids = Vec::new();
        let mut imported_agent_artifact_count = 0usize;
        let mut relocated_session_count = 0usize;
        for bundle in &archive.sessions {
            let mut session = bundle.session.clone();
            session.workspace_id = workspace.id.clone();
            // Native agent session state is tied to the source workspace path,
            // but for supported agent kinds the destination's re-slugged/
            // id-keyed artifact layout resumes it fine (E1c/E1d). Preserve the
            // id only under that install mode + kind pairing; otherwise keep
            // durable history but let the destination start a fresh native
            // session, matching v1 behavior byte-for-byte.
            let preserve_native =
                matches!(install_mode, MobilityInstallMode::PreserveNativeSessions)
                    && is_supported_agent_kind(&session.agent_kind);
            if !preserve_native {
                session.native_session_id = None;
            }
            // MCP bindings are workspace-local encrypted state; sessions rebind after handoff.
            session.mcp_bindings_ciphertext = None;
            session.mcp_binding_summaries_json = None;
            session.mcp_binding_policy =
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace;
            install_session_agent_artifacts(
                &session,
                &workspace_path,
                &bundle.agent_artifacts,
                Some(self.session_runtime.runtime_home()),
            )
            .map_err(|error| MobilityError::Invalid(error.to_string()))?;
            imported_agent_artifact_count += bundle.agent_artifacts.len();
            if install_plan.relocate.contains(&session.id) {
                self.session_runtime
                    .forget_live_session_for_mobility_blocking(&session.id);
                self.session_service
                    .relocate_session_for_mobility(&session, preserve_native)?;
                relocated_session_count += 1;
            } else {
                if install_plan.readopt.contains(&session.id) {
                    // Re-adopt (round-trip coming home): the archive is
                    // authoritative over this runtime's stale leftover copy
                    // of the same session id. Forget any live handle and
                    // delete the stale graph (events, raw notifications,
                    // pending prompts, attachment rows+files) before
                    // importing the archive's version fresh.
                    self.session_runtime
                        .forget_live_session_for_mobility_blocking(&session.id);
                    self.session_service.delete_session(&session.id)?;
                }
                self.session_service.import_session_bundle(
                    &workspace.id,
                    &session,
                    bundle.live_config_snapshot.as_ref(),
                    &bundle.pending_config_changes,
                    &bundle.pending_prompts,
                    &bundle.session_prompt_attachments(),
                    &bundle.events,
                    &bundle.raw_notifications,
                )?;
            }
            imported_session_ids.push(session.id);
        }
        if relocated_session_count == 0 {
            for link in &archive.session_links {
                self.subagent_service
                    .import_link(link)
                    .map_err(MobilityError::Internal)?;
            }
            for completion in &archive.session_link_completions {
                self.subagent_service
                    .import_completion(completion)
                    .map_err(MobilityError::Internal)?;
            }
            for schedule in &archive.session_link_wake_schedules {
                self.subagent_service
                    .import_wake_schedule(schedule)
                    .map_err(MobilityError::Internal)?;
            }
        } else if relocated_session_count != archive.sessions.len() {
            return Err(MobilityError::Invalid(
                "cannot install a mobility archive with mixed relocated and imported sessions"
                    .to_string(),
            ));
        }

        let summary = ImportedWorkspaceArchiveSummary {
            workspace_id: workspace.id,
            source_workspace_path: archive.source_workspace_path.clone(),
            base_commit_sha: archive.base_commit_sha.clone(),
            imported_session_ids,
            applied_file_count: archive.files.len(),
            deleted_file_count: archive.deleted_paths.len(),
            imported_agent_artifact_count,
        };
        if let Some(operation_id) = operation_id.as_deref() {
            self.mobility_store
                .record_completed_install(workspace_id, operation_id, &summary)
                .map_err(MobilityError::Internal)?;
        }
        Ok(summary)
    }

    pub fn destroy_source_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<DestroyedWorkspaceSourceSummary, MobilityError> {
        let workspace = self.load_workspace(workspace_id)?;
        let workspace_path = PathBuf::from(&workspace.path);
        let default_branch = if workspace.kind == WorkspaceKind::Local {
            let repo_root_id = workspace.repo_root_id.clone();
            Some(
                self.workspace_runtime
                    .resolve_repo_root_default_branch(&repo_root_id)
                    .map_err(MobilityError::Internal)?,
            )
        } else {
            None
        };

        let active_terminals = self.active_terminals_blocking(workspace_id);
        let mut closed_terminal_ids = Vec::new();
        for terminal in active_terminals {
            self.terminal_service
                .close_terminal_blocking(&terminal.id)
                .map_err(MobilityError::Internal)?;
            closed_terminal_ids.push(terminal.id);
        }
        let sessions = self
            .session_service
            .store()
            .list_by_workspace(workspace_id)?;
        let mut deleted_session_ids = Vec::new();
        let runtime_home = Some(self.session_runtime.runtime_home());
        for session in sessions {
            delete_session_agent_artifacts(&session, &workspace_path, runtime_home)?;
            self.session_service.delete_session(&session.id)?;
            deleted_session_ids.push(session.id);
        }

        self.workspace_runtime
            .destroy_source_workspace_materialization(&workspace, default_branch.as_deref())
            .map_err(MobilityError::Internal)?;

        Ok(DestroyedWorkspaceSourceSummary {
            workspace_id: workspace.id,
            deleted_session_ids,
            closed_terminal_ids,
            source_destroyed: true,
        })
    }

    fn collect_workspace_sessions(
        &self,
        workspace: &WorkspaceRecord,
    ) -> Result<Vec<WorkspaceMobilitySessionBundleData>, MobilityError> {
        let workspace_path = PathBuf::from(&workspace.path);
        let sessions = self
            .session_service
            .store()
            .list_by_workspace(&workspace.id)?;
        let mut bundles = Vec::new();
        let runtime_home = Some(self.session_runtime.runtime_home());
        for mut session in sessions {
            if !is_supported_agent_kind(&session.agent_kind) {
                continue;
            }
            // MCP bindings are workspace-local encrypted state; sessions rebind after handoff.
            session.mcp_bindings_ciphertext = None;
            let live_config_snapshot = self
                .session_service
                .store()
                .find_live_config_snapshot(&session.id)?;
            let pending_config_changes = self
                .session_service
                .store()
                .list_pending_config_changes(&session.id)?;
            let pending_prompts = self
                .session_service
                .store()
                .list_pending_prompts(&session.id)?;
            let prompt_attachments = self
                .session_service
                .store()
                .list_prompt_attachments(&session.id)?
                .into_iter()
                .map(|record| {
                    let content = self
                        .session_service
                        .read_prompt_attachment_content(&record)?;
                    Ok(
                        crate::domains::mobility::model::MobilityPromptAttachmentData {
                            record,
                            content,
                        },
                    )
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            let events = self.session_service.store().list_events(&session.id)?;
            let raw_notifications = if include_raw_notifications_in_mobility_archive() {
                self.session_service
                    .store()
                    .list_raw_notifications(&session.id)?
            } else {
                Vec::new()
            };
            let agent_artifacts = collect_agent_artifacts(&session, &workspace_path, runtime_home)?;

            bundles.push(WorkspaceMobilitySessionBundleData {
                session,
                live_config_snapshot,
                pending_config_changes,
                pending_prompts,
                prompt_attachments,
                events,
                raw_notifications,
                agent_artifacts,
            });
        }
        Ok(bundles)
    }

    fn load_workspace(&self, workspace_id: &str) -> Result<WorkspaceRecord, MobilityError> {
        self.workspace_service
            .get_workspace(workspace_id)?
            .ok_or_else(|| MobilityError::WorkspaceNotFound(workspace_id.to_string()))
    }

    fn validate_install_preconditions(
        &self,
        workspace: &WorkspaceRecord,
        repo_root: &Path,
        archive: &WorkspaceMobilityArchiveData,
    ) -> Result<ExistingArchiveSessionPlan, MobilityError> {
        self.access_gate
            .assert_can_install_mobility_archive(&workspace.id)
            .map_err(map_access_error)?;
        if self
            .terminal_service
            .is_setup_running_blocking(&workspace.id)
        {
            return Err(MobilityError::Invalid(
                "destination workspace setup is still running".to_string(),
            ));
        }
        // A prior-home destination (this workspace's own remote_owned/retired
        // row, coming home on a round trip) is expected to still carry its
        // own stale sessions; the per-archive-session loop below resolves
        // those via re-adopt instead of refusing outright.
        let is_prior_home = self.is_prior_home_workspace(workspace)?;
        if !is_prior_home {
            let existing_sessions = self
                .session_service
                .store()
                .list_by_workspace(&workspace.id)?;
            if let Some(existing_session) = existing_sessions.first() {
                return Err(MobilityError::Invalid(format!(
                    "destination workspace already contains session {}",
                    existing_session.id
                )));
            }
        }
        if let Some(terminal) = self.active_terminals_blocking(&workspace.id).first() {
            return Err(MobilityError::Invalid(format!(
                "destination workspace still has active terminal {}",
                terminal.id
            )));
        }
        for deleted_path in &archive.deleted_paths {
            resolve_safe_path(repo_root, deleted_path)
                .map_err(|error| MobilityError::Invalid(error.to_string()))?;
        }
        for file in &archive.files {
            resolve_safe_path(repo_root, &file.relative_path)
                .map_err(|error| MobilityError::Invalid(error.to_string()))?;
        }
        validate_delegated_archive_graph(archive)?;
        let mut plan = ExistingArchiveSessionPlan::default();
        for bundle in &archive.sessions {
            if let Some(existing_session) = self.session_service.get_session(&bundle.session.id)? {
                if existing_session.workspace_id == workspace.id {
                    // Same-row collision: this is the destination's own
                    // leftover copy of the archived session. Only a
                    // prior-home destination may re-adopt it; a normal
                    // workspace with a live session of this id is a genuine
                    // conflict.
                    if is_prior_home {
                        plan.readopt.insert(bundle.session.id.clone());
                    } else {
                        return Err(MobilityError::SessionAlreadyExists(
                            bundle.session.id.clone(),
                        ));
                    }
                } else if self.can_relocate_existing_archive_session(
                    workspace,
                    archive,
                    &existing_session,
                )? {
                    plan.relocate.insert(bundle.session.id.clone());
                } else {
                    return Err(MobilityError::SessionAlreadyExists(
                        bundle.session.id.clone(),
                    ));
                }
            }
            let mut remapped_session = bundle.session.clone();
            remapped_session.workspace_id = workspace.id.clone();
            // MCP bindings are workspace-local encrypted state; sessions rebind after handoff.
            remapped_session.mcp_bindings_ciphertext = None;
            validate_session_agent_artifacts(
                &remapped_session,
                Path::new(&workspace.path),
                &bundle.agent_artifacts,
            )?;
        }
        Ok(plan)
    }

    fn can_relocate_existing_archive_session(
        &self,
        destination_workspace: &WorkspaceRecord,
        archive: &WorkspaceMobilityArchiveData,
        existing_session: &crate::domains::sessions::model::SessionRecord,
    ) -> Result<bool, MobilityError> {
        if existing_session.workspace_id == destination_workspace.id {
            return Ok(false);
        }

        let source_workspace = self.load_workspace(&existing_session.workspace_id)?;
        let state = self
            .access_gate
            .runtime_state(&source_workspace.id)
            .map_err(map_access_error)?;

        let should_relocate = classify_existing_archive_session_for_relocation(
            &destination_workspace.id,
            archive.source_workspace_id.as_deref(),
            &archive.source_workspace_path,
            &existing_session.workspace_id,
            &source_workspace.path,
            state.mode,
        )?;
        if !should_relocate {
            return Ok(false);
        }

        Ok(true)
    }

    /// Whether `workspace` is this runtime's prior home for a workspace that
    /// moved away: `remote_owned` (destroy-source cleanup not yet run) or a
    /// retired lifecycle row with pending cleanup. Mobility install re-adopts
    /// (round-trip coming home) a duplicate archive session id instead of
    /// refusing it only when this holds.
    fn is_prior_home_workspace(&self, workspace: &WorkspaceRecord) -> Result<bool, MobilityError> {
        if workspace.lifecycle_state == WorkspaceLifecycleState::Retired {
            return Ok(true);
        }
        let state = self
            .access_gate
            .runtime_state(&workspace.id)
            .map_err(map_access_error)?;
        Ok(state.mode == WorkspaceAccessMode::RemoteOwned)
    }

    async fn validate_prepared_destination_is_empty(
        &self,
        workspace: &WorkspaceRecord,
    ) -> Result<(), MobilityError> {
        let sessions = self
            .session_service
            .store()
            .list_by_workspace(&workspace.id)?;
        if let Some(session) = sessions.first() {
            return Err(MobilityError::DestinationConflict(format!(
                "mobility destination conflict: destination workspace already contains session {}",
                session.id
            )));
        }
        let active_terminals = self.active_terminals_async(&workspace.id).await;
        if let Some(terminal) = active_terminals.first() {
            return Err(MobilityError::DestinationConflict(format!(
                "mobility destination conflict: destination workspace still has active terminal {}",
                terminal.id
            )));
        }
        Ok(())
    }

    async fn active_terminals_async(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        self.terminal_service
            .list_terminals(workspace_id)
            .await
            .into_iter()
            .filter(is_active_terminal)
            .collect()
    }

    fn active_terminals_blocking(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        self.terminal_service
            .list_terminals_blocking(workspace_id)
            .into_iter()
            .filter(is_active_terminal)
            .collect()
    }

    fn validate_expected_export_runtime_state(
        &self,
        workspace_id: &str,
        options: &WorkspaceMobilityExportOptions,
    ) -> Result<(), MobilityError> {
        let runtime_state = self
            .access_gate
            .runtime_state(workspace_id)
            .map_err(map_access_error)?;
        validate_expected_handoff_runtime_state(workspace_id, &runtime_state, options)
    }
}

fn classify_existing_archive_session_for_relocation(
    destination_workspace_id: &str,
    archive_source_workspace_id: Option<&str>,
    archive_source_workspace_path: &str,
    existing_session_workspace_id: &str,
    existing_workspace_path: &str,
    existing_workspace_mode: WorkspaceAccessMode,
) -> Result<bool, MobilityError> {
    if existing_session_workspace_id == destination_workspace_id {
        return Ok(false);
    }

    let matches_archive_source_id =
        archive_source_workspace_id == Some(existing_session_workspace_id);
    let matches_archive_source_path = existing_workspace_path == archive_source_workspace_path;

    if !matches_archive_source_id && !matches_archive_source_path {
        return Ok(false);
    }

    if !matches!(
        existing_workspace_mode,
        WorkspaceAccessMode::FrozenForHandoff | WorkspaceAccessMode::RemoteOwned
    ) {
        return Err(MobilityError::Invalid(format!(
            "source workspace {existing_session_workspace_id} must be frozen before same-runtime mobility install"
        )));
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relocation_ignores_unrelated_remote_owned_duplicate() {
        let should_relocate = classify_existing_archive_session_for_relocation(
            "new-cloud-workspace",
            Some("local-source-workspace"),
            "/local/source",
            "old-cloud-workspace",
            "/cloud/old-source",
            WorkspaceAccessMode::RemoteOwned,
        )
        .expect("unrelated remote-owned leftovers should not error");

        assert!(!should_relocate);
    }

    #[test]
    fn relocation_rejects_unrelated_normal_workspace_duplicate() {
        let should_relocate = classify_existing_archive_session_for_relocation(
            "new-cloud-workspace",
            Some("local-source-workspace"),
            "/local/source",
            "other-workspace",
            "/other/source",
            WorkspaceAccessMode::Normal,
        )
        .expect("unrelated normal workspace should not error");

        assert!(!should_relocate);
    }

    #[test]
    fn relocation_requires_matching_source_to_be_frozen() {
        let error = classify_existing_archive_session_for_relocation(
            "destination-workspace",
            Some("source-workspace"),
            "/source",
            "source-workspace",
            "/source",
            WorkspaceAccessMode::Normal,
        )
        .expect_err("matching source must be frozen");

        assert!(matches!(error, MobilityError::Invalid(_)));
    }

    #[test]
    fn export_runtime_state_requires_matching_frozen_handoff() {
        let options = WorkspaceMobilityExportOptions {
            require_clean_git_state: true,
            expected_handoff_op_id: Some("handoff-1".to_string()),
            ..Default::default()
        };
        let runtime_state = WorkspaceAccessRecord {
            workspace_id: "workspace-1".to_string(),
            mode: WorkspaceAccessMode::FrozenForHandoff,
            handoff_op_id: Some("handoff-1".to_string()),
            updated_at: "2026-03-25T00:00:01Z".to_string(),
        };

        validate_expected_handoff_runtime_state("workspace-1", &runtime_state, &options)
            .expect("matching handoff should be exportable");
    }

    #[test]
    fn export_runtime_state_rejects_stale_handoff() {
        let options = WorkspaceMobilityExportOptions {
            require_clean_git_state: true,
            expected_handoff_op_id: Some("handoff-1".to_string()),
            ..Default::default()
        };
        let runtime_state = WorkspaceAccessRecord {
            workspace_id: "workspace-1".to_string(),
            mode: WorkspaceAccessMode::FrozenForHandoff,
            handoff_op_id: Some("other-handoff".to_string()),
            updated_at: "2026-03-25T00:00:01Z".to_string(),
        };

        let error =
            validate_expected_handoff_runtime_state("workspace-1", &runtime_state, &options)
                .expect_err("stale handoff should be rejected");

        assert!(matches!(error, MobilityError::Invalid(_)));
    }

    #[test]
    fn export_runtime_state_rejects_normal_workspace() {
        let options = WorkspaceMobilityExportOptions {
            require_clean_git_state: true,
            expected_handoff_op_id: Some("handoff-1".to_string()),
            ..Default::default()
        };
        let runtime_state = WorkspaceAccessRecord {
            workspace_id: "workspace-1".to_string(),
            mode: WorkspaceAccessMode::Normal,
            handoff_op_id: None,
            updated_at: "2026-03-25T00:00:01Z".to_string(),
        };

        let error =
            validate_expected_handoff_runtime_state("workspace-1", &runtime_state, &options)
                .expect_err("normal runtime state should be rejected");

        assert!(matches!(error, MobilityError::Invalid(_)));
    }

    // --- install_workspace_archive: install-mode + re-adopt behavior -----
    //
    // These exercise the real `MobilityService` (wired through `AppState`,
    // same as production) rather than re-deriving its plumbing by hand, per
    // `AppState::new`'s existing test-safety (`app/tests.rs`): no background
    // work runs except the review-hook listener, which idles harmlessly.

    use crate::app::AppState;
    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::persistence::Db;
    use std::process::Command;

    struct MobilityServiceTestDir {
        path: PathBuf,
    }

    impl MobilityServiceTestDir {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-mobility-service-{prefix}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for MobilityServiceTestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn install_test_run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn install_test_git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn install_test_init_repo(path: &Path) {
        install_test_run_git(path, ["init", "-b", "main"]);
        install_test_run_git(
            path,
            ["config", "user.email", "mobility-install-test@example.com"],
        );
        install_test_run_git(path, ["config", "user.name", "Mobility Install Test"]);
        std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
        install_test_run_git(path, ["add", "README.md"]);
        install_test_run_git(path, ["commit", "-m", "Initial commit"]);
    }

    /// Builds a real, fully-wired `AppState` against a fresh in-memory DB —
    /// the same construction path production uses — so `install_workspace_archive`
    /// runs with its actual collaborators instead of a hand-rolled double.
    fn build_install_test_state(runtime_home: &Path) -> AppState {
        let _lock = crate::app::test_support::ENV_MUTEX
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _bearer_guard = crate::app::test_support::set_bearer_token_env(None);
        let _data_key_guard = crate::app::test_support::set_data_key_env(None);
        AppState::new(
            runtime_home.to_path_buf(),
            "http://127.0.0.1:0".to_string(),
            Db::open_in_memory().expect("open in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("build mobility install test app state")
    }

    /// Fresh destination workspace (real git repo, clean HEAD) plus the app
    /// state wired against it. Guards must outlive the test.
    fn build_install_destination(
        prefix: &str,
    ) -> (
        MobilityServiceTestDir,
        MobilityServiceTestDir,
        AppState,
        WorkspaceRecord,
        String,
    ) {
        let repo_dir = MobilityServiceTestDir::new(&format!("{prefix}-repo"));
        let runtime_home = MobilityServiceTestDir::new(&format!("{prefix}-home"));
        install_test_init_repo(repo_dir.path());
        let state = build_install_test_state(runtime_home.path());
        let workspace = state
            .workspace_runtime
            .create_workspace(&repo_dir.path().display().to_string())
            .expect("create destination workspace")
            .workspace;
        let base_commit_sha = install_test_git_stdout(repo_dir.path(), ["rev-parse", "HEAD"]);
        (repo_dir, runtime_home, state, workspace, base_commit_sha)
    }

    fn install_test_session(
        id: &str,
        workspace_id: &str,
        agent_kind: &str,
        native_session_id: Option<&str>,
        title: &str,
    ) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: agent_kind.to_string(),
            native_session_id: native_session_id.map(str::to_string),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some(title.to_string()),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-07-02T00:00:00Z".to_string(),
            updated_at: "2026-07-02T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: None,
        }
    }

    /// `install_workspace_archive` calls the terminal manager's `_blocking`
    /// accessors, which panic if invoked directly on a Tokio task thread
    /// (`tokio::sync::RwLock::blocking_read` refuses to run inside an async
    /// context). Production always reaches this through `spawn_blocking`
    /// (`api/http/mobility.rs`); mirror that here instead of calling the
    /// service straight from the `#[tokio::test]` body.
    async fn install_archive_blocking(
        state: &AppState,
        workspace_id: &str,
        archive: &WorkspaceMobilityArchiveData,
        install_mode: MobilityInstallMode,
    ) -> Result<ImportedWorkspaceArchiveSummary, MobilityError> {
        let mobility_service = state.mobility_service.clone();
        let workspace_id = workspace_id.to_string();
        let archive = archive.clone();
        tokio::task::spawn_blocking(move || {
            mobility_service.install_workspace_archive(&workspace_id, &archive, None, install_mode)
        })
        .await
        .expect("install_workspace_archive task join")
    }

    fn install_test_archive(
        workspace: &WorkspaceRecord,
        base_commit_sha: &str,
        sessions: Vec<SessionRecord>,
    ) -> WorkspaceMobilityArchiveData {
        WorkspaceMobilityArchiveData {
            source_workspace_id: None,
            source_workspace_path: "/dummy/mobility-source".to_string(),
            repo_root_path: workspace.path.clone(),
            branch_name: Some("main".to_string()),
            base_commit_sha: base_commit_sha.to_string(),
            files: Vec::new(),
            deleted_paths: Vec::new(),
            sessions: sessions
                .into_iter()
                .map(|session| WorkspaceMobilitySessionBundleData {
                    session,
                    live_config_snapshot: None,
                    pending_config_changes: Vec::new(),
                    pending_prompts: Vec::new(),
                    prompt_attachments: Vec::new(),
                    events: Vec::new(),
                    raw_notifications: Vec::new(),
                    agent_artifacts: Vec::new(),
                })
                .collect(),
            session_links: Vec::new(),
            session_link_completions: Vec::new(),
            session_link_wake_schedules: Vec::new(),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn install_workspace_archive_preserve_mode_keeps_native_id_for_supported_kinds_only() {
        let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
            build_install_destination("preserve-mode");

        let claude_session = install_test_session(
            "session-claude-1",
            &workspace.id,
            "claude",
            Some("native-claude-1"),
            "Claude session",
        );
        let codex_session = install_test_session(
            "session-codex-1",
            &workspace.id,
            "codex",
            Some("native-codex-1"),
            "Codex session",
        );
        let gemini_session = install_test_session(
            "session-gemini-1",
            &workspace.id,
            "gemini",
            Some("native-gemini-1"),
            "Gemini session",
        );
        let archive = install_test_archive(
            &workspace,
            &base_commit_sha,
            vec![claude_session, codex_session, gemini_session],
        );

        let summary = install_archive_blocking(
            &state,
            &workspace.id,
            &archive,
            MobilityInstallMode::PreserveNativeSessions,
        )
        .await
        .expect("install preserve-mode archive");
        assert_eq!(summary.imported_session_ids.len(), 3);

        let claude_installed = state
            .session_service
            .get_session("session-claude-1")
            .expect("query claude session")
            .expect("claude session exists");
        assert_eq!(
            claude_installed.native_session_id.as_deref(),
            Some("native-claude-1"),
            "claude is a supported kind: preserve mode must keep its native id"
        );

        let codex_installed = state
            .session_service
            .get_session("session-codex-1")
            .expect("query codex session")
            .expect("codex session exists");
        assert_eq!(
            codex_installed.native_session_id.as_deref(),
            Some("native-codex-1"),
            "codex is a supported kind: preserve mode must keep its native id"
        );

        let gemini_installed = state
            .session_service
            .get_session("session-gemini-1")
            .expect("query gemini session")
            .expect("gemini session exists");
        assert_eq!(
            gemini_installed.native_session_id, None,
            "unsupported kinds always start fresh, even under preserve mode"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn install_workspace_archive_fresh_native_default_nulls_supported_kind_ids() {
        let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
            build_install_destination("fresh-native");

        let claude_session = install_test_session(
            "session-claude-2",
            &workspace.id,
            "claude",
            Some("native-claude-2"),
            "Claude session",
        );
        let codex_session = install_test_session(
            "session-codex-2",
            &workspace.id,
            "codex",
            Some("native-codex-2"),
            "Codex session",
        );
        let archive = install_test_archive(
            &workspace,
            &base_commit_sha,
            vec![claude_session, codex_session],
        );

        install_archive_blocking(
            &state,
            &workspace.id,
            &archive,
            MobilityInstallMode::default(),
        )
        .await
        .expect("install fresh-native (default) archive");

        let claude_installed = state
            .session_service
            .get_session("session-claude-2")
            .expect("query claude session")
            .expect("claude session exists");
        assert_eq!(
            claude_installed.native_session_id, None,
            "fresh_native is the default and byte-for-byte matches v1 behavior: always null"
        );

        let codex_installed = state
            .session_service
            .get_session("session-codex-2")
            .expect("query codex session")
            .expect("codex session exists");
        assert_eq!(codex_installed.native_session_id, None);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn install_workspace_archive_readopts_stale_remote_owned_session_copy() {
        let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
            build_install_destination("readopt");

        // This destination is the workspace's own prior home: it moved away
        // (remote_owned) and is now coming back on a round trip.
        state
            .workspace_access_gate
            .set_runtime_state(&workspace.id, WorkspaceAccessMode::RemoteOwned, None)
            .expect("mark destination as remote_owned prior home");

        let stale_session = install_test_session(
            "session-return",
            &workspace.id,
            "claude",
            Some("native-stale"),
            "STALE",
        );
        state
            .session_service
            .store()
            .insert(&stale_session)
            .expect("seed stale leftover session copy");

        let archived_session = install_test_session(
            "session-return",
            &workspace.id,
            "claude",
            Some("native-fresh"),
            "FRESH",
        );
        let archive = install_test_archive(&workspace, &base_commit_sha, vec![archived_session]);

        let summary = install_archive_blocking(
            &state,
            &workspace.id,
            &archive,
            MobilityInstallMode::PreserveNativeSessions,
        )
        .await
        .expect("re-adopt archive over the stale remote_owned copy");
        assert_eq!(
            summary.imported_session_ids,
            vec!["session-return".to_string()]
        );

        let installed = state
            .session_service
            .get_session("session-return")
            .expect("query readopted session")
            .expect("session exists after readopt");
        assert_eq!(
            installed.title.as_deref(),
            Some("FRESH"),
            "the archive is authoritative over the stale local copy"
        );
        assert_eq!(installed.native_session_id.as_deref(), Some("native-fresh"));

        let rows = state
            .session_service
            .store()
            .list_by_workspace(&workspace.id)
            .expect("list destination sessions");
        assert_eq!(
            rows.len(),
            1,
            "readopt must replace, not duplicate, the stale row"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn install_workspace_archive_rejects_duplicate_session_on_normal_destination() {
        let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
            build_install_destination("normal-duplicate");

        // Normal (not remote_owned/retired) destination: it is not this
        // workspace's prior home, so an existing session blocks the install
        // outright instead of being treated as a round trip.
        let existing_session = install_test_session(
            "session-dup",
            &workspace.id,
            "claude",
            Some("native-existing"),
            "EXISTING",
        );
        state
            .session_service
            .store()
            .insert(&existing_session)
            .expect("seed existing session on normal destination");

        let incoming_session = install_test_session(
            "session-dup",
            &workspace.id,
            "claude",
            Some("native-incoming"),
            "INCOMING",
        );
        let archive = install_test_archive(&workspace, &base_commit_sha, vec![incoming_session]);

        let error = install_archive_blocking(
            &state,
            &workspace.id,
            &archive,
            MobilityInstallMode::PreserveNativeSessions,
        )
        .await
        .expect_err("a normal-state duplicate must be rejected");
        assert!(
            matches!(error, MobilityError::Invalid(_)),
            "unexpected error: {error:?}"
        );

        let unchanged = state
            .session_service
            .get_session("session-dup")
            .expect("query existing session")
            .expect("existing session still present");
        assert_eq!(unchanged.title.as_deref(), Some("EXISTING"));
    }
}

fn write_workspace_file(repo_root: &Path, file: &MobilityFileData) -> Result<(), MobilityError> {
    let resolved = resolve_safe_path(repo_root, &file.relative_path)
        .map_err(|error| MobilityError::Invalid(error.to_string()))?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating parent directory {}", parent.display()))?;
    }
    std::fs::write(&resolved, &file.content)
        .with_context(|| format!("writing workspace file {}", resolved.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&resolved, std::fs::Permissions::from_mode(file.mode))
            .with_context(|| format!("setting mode on {}", resolved.display()))?;
    }

    Ok(())
}

fn is_supported_agent_kind(agent_kind: &str) -> bool {
    matches!(agent_kind, "claude" | "codex")
}

fn include_raw_notifications_in_mobility_archive() -> bool {
    env_flag_enabled(INCLUDE_RAW_NOTIFICATIONS_ENV)
}

fn env_flag_enabled(key: &str) -> bool {
    let Some(value) = std::env::var_os(key) else {
        return false;
    };
    let value = value.to_string_lossy();
    let normalized = value.trim().to_ascii_lowercase();
    !normalized.is_empty() && !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
}

fn is_active_terminal(terminal: &TerminalRecord) -> bool {
    matches!(
        terminal.status,
        TerminalStatus::Starting | TerminalStatus::Running
    )
}

fn validate_expected_export_git_state(
    workspace_id: &str,
    workspace_path: &Path,
    base_commit_sha: &str,
    branch_name: Option<&str>,
    options: &WorkspaceMobilityExportOptions,
) -> Result<(), MobilityError> {
    if let Some(expected_base) = options
        .expected_base_commit_sha
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if base_commit_sha != expected_base {
            return Err(MobilityError::Invalid(format!(
                "workspace HEAD changed before export (expected {expected_base}, found {base_commit_sha})"
            )));
        }
    } else {
        return Err(MobilityError::Invalid(
            "expected base commit sha is required for clean mobility export".to_string(),
        ));
    }

    if let Some(expected_branch) = options
        .expected_branch_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if branch_name != Some(expected_branch) {
            return Err(MobilityError::Invalid(format!(
                "workspace branch changed before export (expected {expected_branch}, found {})",
                branch_name.unwrap_or("detached HEAD")
            )));
        }
    } else {
        return Err(MobilityError::Invalid(
            "expected branch name is required for clean mobility export".to_string(),
        ));
    }

    validate_clean_repo_for_mobility(
        workspace_id,
        workspace_path,
        "Source workspace must be clean before exporting a mobility archive",
    )
}

fn validate_expected_handoff_runtime_state(
    workspace_id: &str,
    runtime_state: &WorkspaceAccessRecord,
    options: &WorkspaceMobilityExportOptions,
) -> Result<(), MobilityError> {
    if !options.require_clean_git_state {
        return Ok(());
    }
    let Some(expected_handoff_op_id) = options
        .expected_handoff_op_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(MobilityError::Invalid(
            "expected handoff op id is required for clean mobility export".to_string(),
        ));
    };

    if runtime_state.mode != WorkspaceAccessMode::FrozenForHandoff {
        return Err(MobilityError::Invalid(format!(
            "workspace {workspace_id} must be frozen for handoff {expected_handoff_op_id} before exporting a mobility archive"
        )));
    }
    if runtime_state.handoff_op_id.as_deref() != Some(expected_handoff_op_id) {
        return Err(MobilityError::Invalid(format!(
            "workspace {workspace_id} must be frozen for handoff {expected_handoff_op_id} before exporting a mobility archive"
        )));
    }

    Ok(())
}

fn validate_clean_repo_for_mobility(
    workspace_id: &str,
    workspace_path: &Path,
    message: &str,
) -> Result<(), MobilityError> {
    let status = GitService::status(workspace_id, workspace_path)
        .map_err(|error| MobilityError::Invalid(format!("{message}: {error}")))?;
    if status.detached {
        return Err(MobilityError::Invalid(format!(
            "{message}: workspace is detached"
        )));
    }
    if status.operation != GitOperation::None {
        return Err(MobilityError::Invalid(format!(
            "{message}: git operation in progress"
        )));
    }
    if status.conflicted {
        return Err(MobilityError::Invalid(format!(
            "{message}: conflicts must be resolved"
        )));
    }
    if !status.clean {
        return Err(MobilityError::Invalid(message.to_string()));
    }
    Ok(())
}

fn map_access_error(error: WorkspaceAccessError) -> MobilityError {
    use MobilityError::Invalid;

    match error {
        WorkspaceAccessError::WorkspaceNotFound(id) => MobilityError::WorkspaceNotFound(id),
        WorkspaceAccessError::SessionNotFound(id) | WorkspaceAccessError::TerminalNotFound(id) => {
            Invalid(id)
        }
        WorkspaceAccessError::MutationBlocked { workspace_id, mode } => Invalid(format!(
            "workspace {workspace_id} is not writable while mode={}",
            mode.as_str()
        )),
        WorkspaceAccessError::LiveSessionStartBlocked { workspace_id, mode } => Invalid(format!(
            "workspace {workspace_id} cannot start live sessions while mode={}",
            mode.as_str()
        )),
        WorkspaceAccessError::WorkspaceRetired(id) => Invalid(format!("workspace {id} is retired")),
        WorkspaceAccessError::Unexpected(error) => MobilityError::Internal(error),
    }
}

fn validate_delegated_archive_graph(
    archive: &WorkspaceMobilityArchiveData,
) -> Result<(), MobilityError> {
    let session_ids = archive
        .sessions
        .iter()
        .map(|bundle| bundle.session.id.as_str())
        .collect::<HashSet<_>>();
    let mut link_ids = HashSet::new();

    for link in &archive.session_links {
        if !session_ids.contains(link.parent_session_id.as_str()) {
            return Err(MobilityError::Invalid(format!(
                "archive session link {} references missing parent session {}",
                link.id, link.parent_session_id
            )));
        }
        if !session_ids.contains(link.child_session_id.as_str()) {
            return Err(MobilityError::Invalid(format!(
                "archive session link {} references missing child session {}",
                link.id, link.child_session_id
            )));
        }
        if !link_ids.insert(link.id.as_str()) {
            return Err(MobilityError::Invalid(format!(
                "archive contains duplicate session link {}",
                link.id
            )));
        }
    }

    for completion in &archive.session_link_completions {
        if !link_ids.contains(completion.session_link_id.as_str()) {
            return Err(MobilityError::Invalid(format!(
                "archive completion {} references missing session link {}",
                completion.completion_id, completion.session_link_id
            )));
        }
    }

    for schedule in &archive.session_link_wake_schedules {
        if !link_ids.contains(schedule.session_link_id.as_str()) {
            return Err(MobilityError::Invalid(format!(
                "archive wake schedule references missing session link {}",
                schedule.session_link_id
            )));
        }
    }

    Ok(())
}

fn validate_archive_size(archive: &WorkspaceMobilityArchiveData) -> Result<(), MobilityError> {
    let total = archive_estimated_size_bytes(archive);
    if total > MAX_MOBILITY_ARCHIVE_BODY_BYTES as u64 {
        return Err(MobilityError::SizeLimitExceeded(format!(
            "archive exceeded the {} byte limit",
            MAX_MOBILITY_ARCHIVE_BODY_BYTES
        )));
    }

    for file in &archive.files {
        if file.content.len() > MAX_MOBILITY_FILE_BYTES {
            return Err(MobilityError::SizeLimitExceeded(format!(
                "file {} exceeded the {} byte limit",
                file.relative_path, MAX_MOBILITY_FILE_BYTES
            )));
        }
    }

    for file in archive
        .sessions
        .iter()
        .flat_map(|bundle| bundle.agent_artifacts.iter())
    {
        if file.content.len() > MAX_MOBILITY_FILE_BYTES {
            return Err(MobilityError::SizeLimitExceeded(format!(
                "agent artifact {} exceeded the {} byte limit",
                file.relative_path, MAX_MOBILITY_FILE_BYTES
            )));
        }
    }

    for attachment in archive
        .sessions
        .iter()
        .flat_map(|bundle| bundle.prompt_attachments.iter())
    {
        if attachment.content.len() > MAX_MOBILITY_FILE_BYTES {
            return Err(MobilityError::SizeLimitExceeded(format!(
                "prompt attachment {} exceeded the {} byte limit",
                attachment.record.attachment_id, MAX_MOBILITY_FILE_BYTES
            )));
        }
    }

    Ok(())
}

fn archive_estimated_size_bytes(archive: &WorkspaceMobilityArchiveData) -> u64 {
    let file_bytes = archive
        .files
        .iter()
        .map(encoded_file_size_bytes)
        .sum::<u64>();
    let session_bytes = archive
        .sessions
        .iter()
        .map(session_bundle_size_bytes)
        .sum::<u64>();
    file_bytes
        .saturating_add(session_bytes)
        .saturating_add(string_size(&archive.source_workspace_path))
        .saturating_add(string_size(&archive.repo_root_path))
        .saturating_add(option_string_size(&archive.branch_name))
        .saturating_add(string_size(&archive.base_commit_sha))
        .saturating_add(archive.deleted_paths.iter().map(string_size).sum::<u64>())
}

fn session_bundle_size_bytes(bundle: &WorkspaceMobilitySessionBundleData) -> u64 {
    encoded_session_size_bytes(&bundle.session)
        .saturating_add(
            bundle
                .live_config_snapshot
                .as_ref()
                .map(encoded_live_config_size_bytes)
                .unwrap_or(0),
        )
        .saturating_add(
            bundle
                .pending_config_changes
                .iter()
                .map(|record| {
                    string_size(&record.session_id)
                        + string_size(&record.config_id)
                        + string_size(&record.value)
                        + string_size(&record.queued_at)
                })
                .sum::<u64>(),
        )
        .saturating_add(
            bundle
                .pending_prompts
                .iter()
                .map(|record| {
                    string_size(&record.session_id)
                        + record.seq as u64
                        + option_string_size(&record.prompt_id)
                        + string_size(&record.text)
                        + option_string_size(&record.blocks_json)
                        + string_size(&record.queued_at)
                })
                .sum::<u64>(),
        )
        .saturating_add(
            bundle
                .prompt_attachments
                .iter()
                .map(|attachment| {
                    let record = &attachment.record;
                    string_size(&record.attachment_id)
                        + string_size(&record.session_id)
                        + str_size(record.state.as_str())
                        + str_size(record.kind.as_str())
                        + str_size(record.source.as_str())
                        + option_string_size(&record.mime_type)
                        + option_string_size(&record.display_name)
                        + option_string_size(&record.source_uri)
                        + base64_size(attachment.content.len())
                        + string_size(&record.sha256)
                        + string_size(&record.created_at)
                        + string_size(&record.updated_at)
                })
                .sum::<u64>(),
        )
        .saturating_add(
            bundle
                .events
                .iter()
                .map(|record| {
                    string_size(&record.session_id)
                        + record.seq as u64
                        + string_size(&record.timestamp)
                        + string_size(&record.event_type)
                        + option_string_size(&record.turn_id)
                        + option_string_size(&record.item_id)
                        + string_size(&record.payload_json)
                })
                .sum::<u64>(),
        )
        .saturating_add(
            bundle
                .raw_notifications
                .iter()
                .map(|record| {
                    string_size(&record.session_id)
                        + record.seq as u64
                        + string_size(&record.timestamp)
                        + string_size(&record.notification_kind)
                        + string_size(&record.payload_json)
                })
                .sum::<u64>(),
        )
        .saturating_add(
            bundle
                .agent_artifacts
                .iter()
                .map(encoded_agent_artifact_size_bytes)
                .sum::<u64>(),
        )
}

fn encoded_session_size_bytes(session: &crate::domains::sessions::model::SessionRecord) -> u64 {
    string_size(&session.id)
        + string_size(&session.workspace_id)
        + string_size(&session.agent_kind)
        + option_string_size(&session.native_session_id)
        + option_string_size(&session.requested_model_id)
        + option_string_size(&session.current_model_id)
        + option_string_size(&session.requested_mode_id)
        + option_string_size(&session.current_mode_id)
        + option_string_size(&session.title)
        + option_string_size(&session.thinking_level_id)
        + session.thinking_budget_tokens.unwrap_or_default() as u64
        + string_size(&session.status)
        + string_size(&session.created_at)
        + string_size(&session.updated_at)
        + option_string_size(&session.last_prompt_at)
        + option_string_size(&session.closed_at)
        + option_string_size(&session.dismissed_at)
        + option_string_size(&session.system_prompt_append)
}

fn encoded_live_config_size_bytes(
    record: &crate::domains::sessions::model::SessionLiveConfigSnapshotRecord,
) -> u64 {
    string_size(&record.session_id)
        + record.source_seq as u64
        + string_size(&record.raw_config_options_json)
        + string_size(&record.normalized_controls_json)
        + string_size(&record.updated_at)
}

fn encoded_file_size_bytes(file: &MobilityFileData) -> u64 {
    string_size(&file.relative_path) + file.mode as u64 + base64_size(file.content.len())
}

fn encoded_agent_artifact_size_bytes(file: &AgentArtifactFileData) -> u64 {
    string_size(&file.relative_path) + file.mode as u64 + base64_size(file.content.len())
}

fn base64_size(byte_len: usize) -> u64 {
    byte_len.div_ceil(3) as u64 * 4
}

fn string_size(value: &String) -> u64 {
    value.len() as u64
}

fn str_size(value: &str) -> u64 {
    value.len() as u64
}

fn option_string_size(value: &Option<String>) -> u64 {
    value.as_ref().map(|value| value.len() as u64).unwrap_or(0)
}
