use std::collections::HashSet;
use std::path::PathBuf;

use crate::adapters::git::executor::run_git_ok;
use crate::adapters::git::GitService;
use crate::domains::agents::portability::collect_agent_artifacts;
use crate::domains::mobility::model::{
    MobilityPromptAttachmentData, WorkspaceMobilityArchiveData, WorkspaceMobilityExportOptions,
    WorkspaceMobilitySessionBundleData,
};
use crate::domains::mobility::workspace_delta::{collect_workspace_delta, current_branch_name};
use crate::domains::sessions::store::mobility::WorkspaceMobilitySnapshot;
use crate::domains::sessions::store::SessionStore;

use super::{
    is_supported_agent_kind, relation_owns_mobility_wake_schedule, validate_archive_size,
    validate_clean_repo_for_mobility, validate_expected_export_git_state, MobilityError,
    MobilityService,
};

const INCLUDE_RAW_NOTIFICATIONS_ENV: &str = "ANYHARNESS_MOBILITY_INCLUDE_RAW_NOTIFICATIONS";

impl MobilityService {
    pub fn export_workspace_archive(
        &self,
        workspace_id: &str,
        options: &WorkspaceMobilityExportOptions,
    ) -> Result<WorkspaceMobilityArchiveData, MobilityError> {
        self.export_workspace_archive_inner(
            workspace_id,
            options,
            || {},
            |store, workspace_id, include_raw_notifications| {
                store.snapshot_workspace_for_mobility(workspace_id, include_raw_notifications)
            },
        )
    }

    #[cfg(test)]
    pub(crate) fn export_workspace_archive_with_snapshot_hooks(
        &self,
        workspace_id: &str,
        options: &WorkspaceMobilityExportOptions,
        before_snapshot: impl FnOnce(),
        after_session_rows: impl FnOnce(),
    ) -> Result<WorkspaceMobilityArchiveData, MobilityError> {
        self.export_workspace_archive_inner(
            workspace_id,
            options,
            before_snapshot,
            move |store, workspace_id, include_raw_notifications| {
                store.snapshot_workspace_for_mobility_with_hook(
                    workspace_id,
                    include_raw_notifications,
                    after_session_rows,
                )
            },
        )
    }

    fn export_workspace_archive_inner(
        &self,
        workspace_id: &str,
        options: &WorkspaceMobilityExportOptions,
        before_snapshot: impl FnOnce(),
        snapshotter: impl FnOnce(&SessionStore, &str, bool) -> anyhow::Result<WorkspaceMobilitySnapshot>,
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

        before_snapshot();
        let snapshot = snapshotter(
            self.session_service.store(),
            &workspace.id,
            include_raw_notifications_in_mobility_archive(),
        )?;
        let archive_rows = self.assemble_snapshot(snapshot, &workspace_path)?;
        if let Some(missing_id) = archive_rows.partial_graph.first() {
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
            sessions: archive_rows.sessions,
            session_links: archive_rows.session_links,
            session_link_completions: archive_rows.session_link_completions,
            session_link_completion_deliveries: archive_rows.session_link_completion_deliveries,
            session_link_wake_schedules: archive_rows.session_link_wake_schedules,
        };
        validate_archive_size(&archive)?;
        Ok(archive)
    }

    fn assemble_snapshot(
        &self,
        snapshot: WorkspaceMobilitySnapshot,
        workspace_path: &std::path::Path,
    ) -> Result<AssembledSnapshot, MobilityError> {
        let included_session_ids = snapshot
            .sessions
            .iter()
            .filter(|bundle| is_supported_agent_kind(&bundle.session.agent_kind))
            .map(|bundle| bundle.session.id.clone())
            .collect::<HashSet<_>>();
        let runtime_home = Some(self.runtime_home.as_path());
        let mut sessions = Vec::with_capacity(included_session_ids.len());
        for bundle in snapshot.sessions {
            let mut session = bundle.session;
            if !included_session_ids.contains(&session.id) {
                continue;
            }
            session.mcp_bindings_ciphertext = None;
            let prompt_attachments = bundle
                .prompt_attachments
                .into_iter()
                .map(|record| {
                    let content = self
                        .session_service
                        .read_prompt_attachment_content(&record)?;
                    Ok(MobilityPromptAttachmentData { record, content })
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            let agent_artifacts = collect_agent_artifacts(&session, workspace_path, runtime_home)?;
            sessions.push(WorkspaceMobilitySessionBundleData {
                session,
                pending_prompt_seq_cursor: Some(bundle.pending_prompt_seq_cursor),
                live_config_snapshot: bundle.live_config_snapshot,
                pending_config_changes: bundle.pending_config_changes,
                pending_prompts: bundle.pending_prompts,
                prompt_attachments,
                events: bundle.events,
                raw_notifications: bundle.raw_notifications,
                agent_artifacts,
            });
        }

        let mut partial_graph = Vec::new();
        let mut session_links = Vec::new();
        for link in snapshot.session_links {
            let parent_included = included_session_ids.contains(&link.parent_session_id);
            let child_included = included_session_ids.contains(&link.child_session_id);
            if parent_included && child_included {
                session_links.push(link);
            } else if link.closed_at.is_none() {
                if parent_included {
                    partial_graph.push(link.child_session_id);
                }
                if child_included {
                    partial_graph.push(link.parent_session_id);
                }
            }
        }
        partial_graph.sort();
        partial_graph.dedup();
        let included_link_ids = session_links
            .iter()
            .map(|link| link.id.as_str())
            .collect::<HashSet<_>>();
        let cowork_wake_link_ids = session_links
            .iter()
            .filter(|link| relation_owns_mobility_wake_schedule(link.relation))
            .map(|link| link.id.as_str())
            .collect::<HashSet<_>>();
        let session_link_completions = snapshot
            .session_link_completions
            .into_iter()
            .filter(|completion| included_link_ids.contains(completion.session_link_id.as_str()))
            .collect();
        let session_link_wake_schedules = snapshot
            .session_link_wake_schedules
            .into_iter()
            .filter(|schedule| cowork_wake_link_ids.contains(schedule.session_link_id.as_str()))
            .collect();
        let session_link_completion_deliveries = snapshot
            .session_link_completion_deliveries
            .into_iter()
            .filter(|delivery| included_session_ids.contains(&delivery.parent_session_id))
            .collect();

        Ok(AssembledSnapshot {
            sessions,
            session_links,
            session_link_completions,
            session_link_completion_deliveries,
            session_link_wake_schedules,
            partial_graph,
        })
    }
}

struct AssembledSnapshot {
    sessions: Vec<WorkspaceMobilitySessionBundleData>,
    session_links: Vec<crate::domains::sessions::links::model::SessionLinkRecord>,
    session_link_completions:
        Vec<crate::domains::sessions::subagents::model::SubagentCompletionRecord>,
    session_link_completion_deliveries:
        Vec<crate::domains::sessions::subagents::delivery::CompletionDeliveryRecord>,
    session_link_wake_schedules:
        Vec<crate::domains::sessions::links::completions::LinkWakeScheduleRecord>,
    partial_graph: Vec<String>,
}

fn include_raw_notifications_in_mobility_archive() -> bool {
    let Some(value) = std::env::var_os(INCLUDE_RAW_NOTIFICATIONS_ENV) else {
        return false;
    };
    let normalized = value.to_string_lossy().trim().to_ascii_lowercase();
    !normalized.is_empty() && !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
}
