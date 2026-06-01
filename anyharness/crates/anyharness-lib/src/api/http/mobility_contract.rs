use anyharness_contract::v1::{
    InstallWorkspaceMobilityArchiveResponse, MobilityPendingConfigChangeRecord,
    MobilityPendingPromptRecord, MobilityPromptAttachmentRecord, MobilitySessionEventRecord,
    MobilitySessionLinkCompletionRecord, MobilitySessionLinkRecord,
    MobilitySessionLinkWakeScheduleRecord, MobilitySessionLiveConfigSnapshotRecord,
    MobilitySessionRawNotificationRecord, MobilitySessionRecord, WorkspaceMobilityArchive,
    WorkspaceMobilityBlocker, WorkspaceMobilityFileEntry, WorkspaceMobilityPreflightResponse,
    WorkspaceMobilitySessionBundle, WorkspaceMobilitySessionCandidate,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::domains::agents::portability::AgentArtifactFileData;
use crate::domains::mobility::model::{
    ImportedWorkspaceArchiveSummary, MobilityBlocker, MobilityFileData,
    MobilityPromptAttachmentData, MobilitySessionCandidate, WorkspaceMobilityArchiveData,
    WorkspaceMobilityPreflightResult, WorkspaceMobilitySessionBundleData,
};
use crate::sessions::links::model::SessionLinkRecord;
use crate::sessions::model::{
    parse_action_capabilities, PendingConfigChangeRecord, PendingPromptRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord, SessionRecord,
};
use crate::sessions::subagents::model::{SubagentCompletionRecord, SubagentWakeScheduleRecord};

pub(super) fn to_contract_preflight(
    result: WorkspaceMobilityPreflightResult,
) -> WorkspaceMobilityPreflightResponse {
    WorkspaceMobilityPreflightResponse {
        workspace_id: result.workspace_id,
        can_move: result.can_move,
        runtime_state: result.runtime_state.to_contract(),
        branch_name: result.branch_name,
        base_commit_sha: result.base_commit_sha,
        archive_estimated_bytes: result.archive_estimated_bytes,
        blockers: result
            .blockers
            .into_iter()
            .map(to_contract_blocker)
            .collect(),
        sessions: result
            .sessions
            .into_iter()
            .map(to_contract_session_candidate)
            .collect(),
        warnings: result.warnings,
    }
}

fn to_contract_blocker(blocker: MobilityBlocker) -> WorkspaceMobilityBlocker {
    WorkspaceMobilityBlocker {
        code: blocker.code,
        message: blocker.message,
        session_id: blocker.session_id,
    }
}

fn to_contract_session_candidate(
    candidate: MobilitySessionCandidate,
) -> WorkspaceMobilitySessionCandidate {
    WorkspaceMobilitySessionCandidate {
        session_id: candidate.session.id,
        agent_kind: candidate.session.agent_kind,
        native_session_id: candidate.session.native_session_id,
        supported: candidate.supported,
        reason: candidate.reason,
    }
}

pub(super) fn to_contract_install_summary(
    summary: ImportedWorkspaceArchiveSummary,
) -> InstallWorkspaceMobilityArchiveResponse {
    InstallWorkspaceMobilityArchiveResponse {
        workspace_id: summary.workspace_id,
        source_workspace_path: summary.source_workspace_path,
        base_commit_sha: summary.base_commit_sha,
        imported_session_ids: summary.imported_session_ids,
        applied_file_count: summary.applied_file_count,
        deleted_file_count: summary.deleted_file_count,
        imported_agent_artifact_count: summary.imported_agent_artifact_count,
    }
}

pub(super) fn to_contract_archive(
    archive: WorkspaceMobilityArchiveData,
) -> WorkspaceMobilityArchive {
    WorkspaceMobilityArchive {
        source_workspace_id: archive.source_workspace_id,
        source_workspace_path: archive.source_workspace_path,
        repo_root_path: archive.repo_root_path,
        branch_name: archive.branch_name,
        base_commit_sha: archive.base_commit_sha,
        files: archive.files.into_iter().map(to_contract_file).collect(),
        deleted_paths: archive.deleted_paths,
        sessions: archive
            .sessions
            .into_iter()
            .map(to_contract_session_bundle)
            .collect(),
        session_links: archive
            .session_links
            .into_iter()
            .map(to_contract_session_link)
            .collect(),
        session_link_completions: archive
            .session_link_completions
            .into_iter()
            .map(to_contract_session_link_completion)
            .collect(),
        session_link_wake_schedules: archive
            .session_link_wake_schedules
            .into_iter()
            .map(to_contract_session_link_wake_schedule)
            .collect(),
    }
}

fn to_contract_file(file: MobilityFileData) -> WorkspaceMobilityFileEntry {
    WorkspaceMobilityFileEntry {
        relative_path: file.relative_path,
        mode: file.mode,
        content_base64: STANDARD.encode(file.content),
    }
}

fn to_contract_agent_artifact(file: AgentArtifactFileData) -> WorkspaceMobilityFileEntry {
    WorkspaceMobilityFileEntry {
        relative_path: file.relative_path,
        mode: file.mode,
        content_base64: STANDARD.encode(file.content),
    }
}

fn to_contract_session_bundle(
    bundle: WorkspaceMobilitySessionBundleData,
) -> WorkspaceMobilitySessionBundle {
    WorkspaceMobilitySessionBundle {
        session: to_contract_session_record(bundle.session),
        live_config_snapshot: bundle
            .live_config_snapshot
            .map(to_contract_live_config_snapshot),
        pending_config_changes: bundle
            .pending_config_changes
            .into_iter()
            .map(to_contract_pending_config_change)
            .collect(),
        pending_prompts: bundle
            .pending_prompts
            .into_iter()
            .map(to_contract_pending_prompt)
            .collect(),
        prompt_attachments: bundle
            .prompt_attachments
            .into_iter()
            .map(to_contract_prompt_attachment)
            .collect(),
        events: bundle.events.into_iter().map(to_contract_event).collect(),
        raw_notifications: bundle
            .raw_notifications
            .into_iter()
            .map(to_contract_raw_notification)
            .collect(),
        agent_artifacts: bundle
            .agent_artifacts
            .into_iter()
            .map(to_contract_agent_artifact)
            .collect(),
    }
}

fn to_contract_session_record(record: SessionRecord) -> MobilitySessionRecord {
    MobilitySessionRecord {
        id: record.id,
        agent_kind: record.agent_kind,
        native_session_id: record.native_session_id,
        requested_model_id: record.requested_model_id,
        current_model_id: record.current_model_id,
        requested_mode_id: record.requested_mode_id,
        current_mode_id: record.current_mode_id,
        title: record.title,
        thinking_level_id: record.thinking_level_id,
        thinking_budget_tokens: record.thinking_budget_tokens,
        status: record.status,
        created_at: record.created_at,
        updated_at: record.updated_at,
        last_prompt_at: record.last_prompt_at,
        closed_at: record.closed_at,
        dismissed_at: record.dismissed_at,
        system_prompt_append: record.system_prompt_append,
        subagents_enabled: record.subagents_enabled,
        action_capabilities: parse_action_capabilities(record.action_capabilities_json.as_deref()),
        origin: record
            .origin
            .as_ref()
            .map(crate::origin::OriginContext::to_contract),
    }
}

fn to_contract_session_link(record: SessionLinkRecord) -> MobilitySessionLinkRecord {
    MobilitySessionLinkRecord {
        id: record.id,
        public_id: record.public_id,
        relation: record.relation.as_str().to_string(),
        parent_session_id: record.parent_session_id,
        child_session_id: record.child_session_id,
        workspace_relation: record.workspace_relation.as_str().to_string(),
        label: record.label,
        created_by_turn_id: record.created_by_turn_id,
        created_by_tool_call_id: record.created_by_tool_call_id,
        created_at: record.created_at,
        closed_at: record.closed_at,
    }
}

fn to_contract_session_link_completion(
    record: SubagentCompletionRecord,
) -> MobilitySessionLinkCompletionRecord {
    MobilitySessionLinkCompletionRecord {
        completion_id: record.completion_id,
        session_link_id: record.session_link_id,
        child_turn_id: record.child_turn_id,
        child_last_event_seq: record.child_last_event_seq,
        outcome: record.outcome.as_str().to_string(),
        parent_event_seq: record.parent_event_seq,
        parent_prompt_seq: record.parent_prompt_seq,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn to_contract_session_link_wake_schedule(
    record: SubagentWakeScheduleRecord,
) -> MobilitySessionLinkWakeScheduleRecord {
    MobilitySessionLinkWakeScheduleRecord {
        session_link_id: record.session_link_id,
    }
}

fn to_contract_live_config_snapshot(
    record: SessionLiveConfigSnapshotRecord,
) -> MobilitySessionLiveConfigSnapshotRecord {
    MobilitySessionLiveConfigSnapshotRecord {
        session_id: record.session_id,
        source_seq: record.source_seq,
        raw_config_options_json: record.raw_config_options_json,
        normalized_controls_json: record.normalized_controls_json,
        prompt_capabilities_json: record.prompt_capabilities_json,
        updated_at: record.updated_at,
    }
}

fn to_contract_pending_config_change(
    record: PendingConfigChangeRecord,
) -> MobilityPendingConfigChangeRecord {
    MobilityPendingConfigChangeRecord {
        session_id: record.session_id,
        config_id: record.config_id,
        value: record.value,
        queued_at: record.queued_at,
    }
}

fn to_contract_pending_prompt(record: PendingPromptRecord) -> MobilityPendingPromptRecord {
    let content_parts = record.prompt_payload().content_parts();
    MobilityPendingPromptRecord {
        session_id: record.session_id,
        seq: record.seq,
        prompt_id: record.prompt_id,
        text: record.text,
        content_parts,
        blocks_json: record.blocks_json,
        queued_at: record.queued_at,
    }
}

fn to_contract_prompt_attachment(
    data: MobilityPromptAttachmentData,
) -> MobilityPromptAttachmentRecord {
    let record = data.record;
    MobilityPromptAttachmentRecord {
        attachment_id: record.attachment_id,
        session_id: record.session_id,
        state: record.state.as_str().to_string(),
        kind: record.kind.as_str().to_string(),
        source: record.source.as_str().to_string(),
        mime_type: record.mime_type,
        display_name: record.display_name,
        source_uri: record.source_uri,
        size_bytes: record.size_bytes.max(0) as u64,
        sha256: record.sha256,
        content_base64: STANDARD.encode(data.content),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn to_contract_event(record: SessionEventRecord) -> MobilitySessionEventRecord {
    MobilitySessionEventRecord {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        event_type: record.event_type,
        turn_id: record.turn_id,
        item_id: record.item_id,
        payload_json: record.payload_json,
    }
}

fn to_contract_raw_notification(
    record: SessionRawNotificationRecord,
) -> MobilitySessionRawNotificationRecord {
    MobilitySessionRawNotificationRecord {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        notification_kind: record.notification_kind,
        payload_json: record.payload_json,
    }
}
