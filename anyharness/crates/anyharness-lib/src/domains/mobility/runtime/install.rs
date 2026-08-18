//! Install a mobility archive into a destination workspace.
//!
//! Live because its preconditions ask live terminals (setup state, open
//! terminals) and because relocating a session first forgets the live session
//! through `SessionRuntime`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Context;

use super::MobilityRuntime;
use crate::adapters::files::safety::resolve_safe_path;
use crate::adapters::git::executor::run_git_ok;
use crate::adapters::git::GitService;
use crate::domains::agents::portability::{
    install_session_agent_artifacts, validate_session_agent_artifacts,
};
use crate::domains::mobility::model::{
    ImportedWorkspaceArchiveSummary, WorkspaceMobilityArchiveData,
};
use crate::domains::mobility::service::{
    map_access_error, session_pending_prompt_cursor_lower_bound, validate_archive_size,
    validate_clean_repo_for_mobility, validate_delegated_archive_graph, write_workspace_file,
    MobilityError,
};
use crate::domains::workspaces::model::WorkspaceRecord;

impl MobilityRuntime {
    pub fn install_workspace_archive(
        &self,
        workspace_id: &str,
        archive: &WorkspaceMobilityArchiveData,
        operation_id: Option<&str>,
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
        let workspace = self.mobility_service.load_workspace(workspace_id)?;
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

        let relocated_session_ids =
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
        let mut relocated_session_count = 0usize;
        for bundle in &archive.sessions {
            let mut session = bundle.session.clone();
            session.workspace_id = workspace.id.clone();
            // Native agent session state is tied to the source workspace path.
            // Keep durable history, but let the destination start a fresh native session.
            session.native_session_id = None;
            // MCP bindings are workspace-local encrypted state; sessions rebind after handoff.
            session.mcp_bindings_ciphertext = None;
            session.mcp_binding_summaries_json = None;
            session.mcp_binding_policy =
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace;
            install_session_agent_artifacts(&session, &workspace_path, &bundle.agent_artifacts)
                .map_err(|error| MobilityError::Invalid(error.to_string()))?;
            imported_agent_artifact_count += bundle.agent_artifacts.len();
            if relocated_session_ids.contains(&session.id) {
                self.session_runtime
                    .forget_live_session_for_mobility_blocking(&session.id);
                self.session_service
                    .relocate_session_for_mobility(&session)?;
                relocated_session_count += 1;
            } else {
                let pending_prompt_seq_cursor =
                    session_pending_prompt_cursor_lower_bound(archive, bundle)?;
                self.session_service.import_session_bundle(
                    &workspace.id,
                    &session,
                    pending_prompt_seq_cursor,
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
                self.session_link_service
                    .import_link(link)
                    .map_err(MobilityError::Internal)?;
            }
            for completion in &archive.session_link_completions {
                self.link_completion_store
                    .import_completion(completion)
                    .map_err(MobilityError::Internal)?;
            }
            for delivery in &archive.session_link_completion_deliveries {
                self.completion_delivery_store
                    .import(delivery)
                    .map_err(MobilityError::Internal)?;
            }
            for schedule in &archive.session_link_wake_schedules {
                self.link_completion_store
                    .import_wake_schedule(&schedule.session_link_id)
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

    fn validate_install_preconditions(
        &self,
        workspace: &WorkspaceRecord,
        repo_root: &Path,
        archive: &WorkspaceMobilityArchiveData,
    ) -> Result<HashSet<String>, MobilityError> {
        self.access_gate
            .assert_can_mutate_for_workspace(&workspace.id)
            .map_err(map_access_error)?;
        if self
            .terminal_service
            .is_setup_running_blocking(&workspace.id)
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
        validate_delegated_archive_graph(archive)?;
        let mut relocated_session_ids = HashSet::new();
        for bundle in &archive.sessions {
            if let Some(existing_session) = self.session_service.get_session(&bundle.session.id)? {
                if self
                    .mobility_service
                    .can_relocate_existing_archive_session(workspace, archive, &existing_session)?
                {
                    relocated_session_ids.insert(bundle.session.id.clone());
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
        Ok(relocated_session_ids)
    }
}
