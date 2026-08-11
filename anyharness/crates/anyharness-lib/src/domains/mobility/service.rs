use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Context;

use crate::adapters::git::executor::run_git_ok;
use crate::domains::agents::portability::collect_agent_artifacts;
use crate::domains::mobility::model::{
    MobilityFileData, WorkspaceMobilityArchiveData, WorkspaceMobilityExportOptions,
    WorkspaceMobilitySessionBundleData, MAX_MOBILITY_ARCHIVE_BODY_BYTES, MAX_MOBILITY_FILE_BYTES,
};
use crate::domains::mobility::workspace_delta::{collect_workspace_delta, current_branch_name};
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::access_model::{WorkspaceAccessMode, WorkspaceAccessRecord};
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::{
    adapters::files::safety::resolve_safe_path,
    adapters::git::{types::GitOperation, GitService},
};

const INCLUDE_RAW_NOTIFICATIONS_ENV: &str = "ANYHARNESS_MOBILITY_INCLUDE_RAW_NOTIFICATIONS";

mod archive;
pub(super) use archive::archive_estimated_size_bytes;
use archive::validate_completion_deliveries;

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

#[derive(Clone)]
pub struct MobilityService {
    workspace_runtime: Arc<WorkspaceRuntime>,
    session_service: Arc<SessionService>,
    subagent_service: Arc<SubagentService>,
    access_gate: Arc<WorkspaceAccessGate>,
    /// The runtime home directory, for locating per-session agent artifacts.
    /// A path fact, handed in by `app/` — the same value `SessionRuntime` gets.
    runtime_home: PathBuf,
}

impl MobilityService {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        session_service: Arc<SessionService>,
        subagent_service: Arc<SubagentService>,
        access_gate: Arc<WorkspaceAccessGate>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            workspace_runtime,
            session_service,
            subagent_service,
            access_gate,
            runtime_home,
        }
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
        let mut parent_session_ids = session_ids.iter().cloned().collect::<Vec<_>>();
        parent_session_ids.sort();
        let session_link_completion_deliveries = self
            .subagent_service
            .completion_deliveries_for_parent_sessions(&parent_session_ids)
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
            session_link_completion_deliveries,
            session_link_wake_schedules,
        };
        validate_archive_size(&archive)?;
        Ok(archive)
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
        let runtime_home = Some(self.runtime_home.as_path());
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

    pub(super) fn load_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceRecord, MobilityError> {
        self.workspace_runtime
            .get_workspace(workspace_id)?
            .ok_or_else(|| MobilityError::WorkspaceNotFound(workspace_id.to_string()))
    }

    pub(super) fn can_relocate_existing_archive_session(
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
}

pub(super) fn write_workspace_file(
    repo_root: &Path,
    file: &MobilityFileData,
) -> Result<(), MobilityError> {
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

pub(super) fn is_supported_agent_kind(agent_kind: &str) -> bool {
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

pub(super) fn validate_clean_repo_for_mobility(
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

pub(super) fn map_access_error(error: WorkspaceAccessError) -> MobilityError {
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

pub(super) fn validate_delegated_archive_graph(
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

    validate_completion_deliveries(archive, &session_ids)
}

pub(super) fn validate_archive_size(
    archive: &WorkspaceMobilityArchiveData,
) -> Result<(), MobilityError> {
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
