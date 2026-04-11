use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Context;

use crate::agents::portability::{
    collect_agent_artifacts, delete_session_agent_artifacts, install_session_agent_artifacts,
    validate_session_agent_artifacts,
};
use crate::git::executor::run_git_ok;
use crate::git::mobility_delta::{collect_workspace_delta, current_branch_name};
use crate::mobility::model::{
    ImportedWorkspaceArchiveSummary, MobilityBlocker, MobilityFileData, MobilitySessionCandidate,
    WorkspaceMobilityArchiveData, WorkspaceMobilityPreflightResult,
    WorkspaceMobilitySessionBundleData, MAX_MOBILITY_ARCHIVE_BODY_BYTES, MAX_MOBILITY_FILE_BYTES,
};
use crate::sessions::runtime::SessionRuntime;
use crate::sessions::service::SessionService;
use crate::terminals::model::{TerminalRecord, TerminalStatus};
use crate::terminals::service::TerminalService;
use crate::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::workspaces::access_model::WorkspaceAccessMode;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::service::WorkspaceService;
use crate::workspaces::setup_execution::SetupExecutionService;
use crate::{files::safety::resolve_safe_path, git::GitService};

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
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct MobilityService {
    workspace_service: Arc<WorkspaceService>,
    session_service: Arc<SessionService>,
    session_runtime: Arc<SessionRuntime>,
    access_gate: Arc<WorkspaceAccessGate>,
    setup_execution_service: Arc<SetupExecutionService>,
    terminal_service: Arc<TerminalService>,
}

impl MobilityService {
    pub fn new(
        workspace_service: Arc<WorkspaceService>,
        session_service: Arc<SessionService>,
        session_runtime: Arc<SessionRuntime>,
        access_gate: Arc<WorkspaceAccessGate>,
        setup_execution_service: Arc<SetupExecutionService>,
        terminal_service: Arc<TerminalService>,
    ) -> Self {
        Self {
            workspace_service,
            session_service,
            session_runtime,
            access_gate,
            setup_execution_service,
            terminal_service,
        }
    }

    pub async fn preflight_workspace(
        &self,
        workspace_id: &str,
        exclude_paths: &[String],
    ) -> Result<WorkspaceMobilityPreflightResult, MobilityError> {
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

        if self.setup_execution_service.is_running(workspace_id).await {
            blockers.push(MobilityBlocker {
                code: "setup_running".to_string(),
                message: "Workspace setup is still running".to_string(),
                session_id: None,
            });
        }

        for terminal in self.active_terminals_async(workspace_id).await {
            blockers.push(MobilityBlocker {
                code: "terminal_running".to_string(),
                message: format!("Terminal {} is still active", terminal.id),
                session_id: None,
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
            if execution_summary.pending_approval.is_some() {
                blockers.push(MobilityBlocker {
                    code: "session_awaiting_permission".to_string(),
                    message: format!("Session {} is awaiting approval", candidate.session.id),
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
                warnings.push(format!(
                    "Session {} ({}) will be skipped because {}",
                    candidate.session.id,
                    candidate.session.agent_kind,
                    candidate
                        .reason
                        .clone()
                        .unwrap_or_else(|| "it is unsupported".to_string())
                ));
            }
        }

        let archive_estimated_bytes = if blockers.is_empty() {
            let archive = self.export_workspace_archive(workspace_id, exclude_paths)?;
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
            Some(size)
        } else {
            None
        };

        let can_move = blockers.is_empty();

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
        exclude_paths: &[String],
    ) -> Result<WorkspaceMobilityArchiveData, MobilityError> {
        let workspace = self.load_workspace(workspace_id)?;
        let workspace_path = PathBuf::from(&workspace.path);
        let repo_root = GitService::resolve_repo_root(&workspace_path)
            .map_err(|_| MobilityError::NotGitWorkspace(workspace.path.clone()))?;
        let repo_root_string = repo_root.display().to_string();
        let base_commit_sha = run_git_ok(&repo_root, &["rev-parse", "HEAD"])?
            .trim()
            .to_string();
        let branch_name = current_branch_name(&repo_root)?;
        let delta = collect_workspace_delta(&repo_root, exclude_paths)?;
        let sessions = self.collect_workspace_sessions(&workspace)?;

        let archive = WorkspaceMobilityArchiveData {
            source_workspace_path: workspace.path,
            repo_root_path: repo_root_string,
            branch_name,
            base_commit_sha,
            files: delta.files,
            deleted_paths: delta.deleted_paths,
            sessions,
        };
        validate_archive_size(&archive)?;
        Ok(archive)
    }

    pub fn install_workspace_archive(
        &self,
        workspace_id: &str,
        archive: &WorkspaceMobilityArchiveData,
    ) -> Result<ImportedWorkspaceArchiveSummary, MobilityError> {
        validate_archive_size(archive)?;
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

        self.validate_install_preconditions(&workspace, &repo_root, archive)?;

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
        for bundle in &archive.sessions {
            let mut session = bundle.session.clone();
            session.workspace_id = workspace.id.clone();
            // MCP bindings are workspace-local encrypted state; sessions rebind after handoff.
            session.mcp_bindings_ciphertext = None;
            self.session_service.import_session_bundle(
                &workspace.id,
                &session,
                bundle.live_config_snapshot.as_ref(),
                &bundle.pending_config_changes,
                &bundle.pending_prompts,
                &bundle.events,
                &bundle.raw_notifications,
            )?;
            install_session_agent_artifacts(&session, &workspace_path, &bundle.agent_artifacts)?;
            imported_agent_artifact_count += bundle.agent_artifacts.len();
            imported_session_ids.push(session.id);
        }

        Ok(ImportedWorkspaceArchiveSummary {
            workspace_id: workspace.id,
            source_workspace_path: archive.source_workspace_path.clone(),
            base_commit_sha: archive.base_commit_sha.clone(),
            imported_session_ids,
            applied_file_count: archive.files.len(),
            deleted_file_count: archive.deleted_paths.len(),
            imported_agent_artifact_count,
        })
    }

    pub fn cleanup_workspace_sessions(
        &self,
        workspace_id: &str,
        session_ids: &[String],
    ) -> Result<Vec<String>, MobilityError> {
        let workspace = self.load_workspace(workspace_id)?;
        let workspace_path = PathBuf::from(&workspace.path);
        let sessions = if session_ids.is_empty() {
            self.session_service
                .list_sessions(Some(workspace_id), true)?
                .into_iter()
                .filter(|session| is_supported_agent_kind(&session.agent_kind))
                .collect::<Vec<_>>()
        } else {
            session_ids
                .iter()
                .filter_map(|session_id| {
                    self.session_service
                        .get_session(session_id)
                        .ok()
                        .flatten()
                        .filter(|session| session.workspace_id == workspace_id)
                })
                .collect::<Vec<_>>()
        };

        let mut deleted_session_ids = Vec::new();
        for session in sessions {
            delete_session_agent_artifacts(&session, &workspace_path)?;
            self.session_service.delete_session(&session.id)?;
            deleted_session_ids.push(session.id);
        }

        Ok(deleted_session_ids)
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
            let events = self.session_service.store().list_events(&session.id)?;
            let raw_notifications = self
                .session_service
                .store()
                .list_raw_notifications(&session.id)?;
            let agent_artifacts = collect_agent_artifacts(&session, &workspace_path)?;

            bundles.push(WorkspaceMobilitySessionBundleData {
                session,
                live_config_snapshot,
                pending_config_changes,
                pending_prompts,
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
    ) -> Result<(), MobilityError> {
        self.access_gate
            .assert_can_mutate_for_workspace(&workspace.id)
            .map_err(map_access_error)?;
        if self
            .setup_execution_service
            .is_running_blocking(&workspace.id)
        {
            return Err(MobilityError::Invalid(
                "destination workspace setup is still running".to_string(),
            ));
        }
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
        for bundle in &archive.sessions {
            if self
                .session_service
                .get_session(&bundle.session.id)?
                .is_some()
            {
                return Err(MobilityError::SessionAlreadyExists(
                    bundle.session.id.clone(),
                ));
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

fn is_active_terminal(terminal: &TerminalRecord) -> bool {
    matches!(
        terminal.status,
        TerminalStatus::Starting | TerminalStatus::Running
    )
}

fn map_access_error(error: WorkspaceAccessError) -> MobilityError {
    match error {
        WorkspaceAccessError::WorkspaceNotFound(id) => MobilityError::WorkspaceNotFound(id),
        WorkspaceAccessError::SessionNotFound(id) => MobilityError::Invalid(id),
        WorkspaceAccessError::TerminalNotFound(id) => MobilityError::Invalid(id),
        WorkspaceAccessError::MutationBlocked { workspace_id, mode } => {
            MobilityError::Invalid(format!(
                "workspace {workspace_id} is not writable while mode={}",
                mode.as_str()
            ))
        }
        WorkspaceAccessError::LiveSessionStartBlocked { workspace_id, mode } => {
            MobilityError::Invalid(format!(
                "workspace {workspace_id} cannot start live sessions while mode={}",
                mode.as_str()
            ))
        }
    }
}

fn validate_archive_size(archive: &WorkspaceMobilityArchiveData) -> Result<(), MobilityError> {
    let total = archive_estimated_size_bytes(archive);
    if total > MAX_MOBILITY_ARCHIVE_BODY_BYTES as u64 {
        return Err(MobilityError::SizeLimitExceeded(format!(
            "archive exceeded the {} byte limit",
            MAX_MOBILITY_ARCHIVE_BODY_BYTES
        )));
    }

    for file in archive.files.iter().chain(
        archive
            .sessions
            .iter()
            .flat_map(|bundle| bundle.agent_artifacts.iter()),
    ) {
        if file.content.len() > MAX_MOBILITY_FILE_BYTES {
            return Err(MobilityError::SizeLimitExceeded(format!(
                "file {} exceeded the {} byte limit",
                file.relative_path, MAX_MOBILITY_FILE_BYTES
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
                        + string_size(&record.queued_at)
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
                .map(encoded_file_size_bytes)
                .sum::<u64>(),
        )
}

fn encoded_session_size_bytes(session: &crate::sessions::model::SessionRecord) -> u64 {
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
    record: &crate::sessions::model::SessionLiveConfigSnapshotRecord,
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

fn base64_size(byte_len: usize) -> u64 {
    byte_len.div_ceil(3) as u64 * 4
}

fn string_size(value: &String) -> u64 {
    value.len() as u64
}

fn option_string_size(value: &Option<String>) -> u64 {
    value.as_ref().map(|value| value.len() as u64).unwrap_or(0)
}
