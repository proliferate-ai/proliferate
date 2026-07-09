use anyharness_contract::v1::{
    MobilityPendingConfigChangeRecord, MobilityPendingPromptRecord, MobilityPromptAttachmentRecord,
    MobilitySessionEventRecord, MobilitySessionLinkCompletionRecord, MobilitySessionLinkRecord,
    MobilitySessionLinkWakeScheduleRecord, MobilitySessionLiveConfigSnapshotRecord,
    MobilitySessionRawNotificationRecord, MobilitySessionRecord, WorkspaceMobilityArchive,
    WorkspaceMobilityFileEntry, WorkspaceMobilitySessionBundle,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sha2::{Digest, Sha256};

use super::error::ApiError;
use crate::domains::agents::portability::AgentArtifactFileData;
use crate::domains::mobility::model::{
    MobilityFileData, MobilityPromptAttachmentData, WorkspaceMobilityArchiveData,
    WorkspaceMobilitySessionBundleData, MAX_MOBILITY_FILE_BYTES,
};
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::model::{
    serialize_action_capabilities, PendingConfigChangeRecord, PendingPromptRecord,
    PromptAttachmentKind, PromptAttachmentRecord, PromptAttachmentState, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord, SessionRecord,
};
use crate::domains::sessions::subagents::model::{
    SubagentCompletionRecord, SubagentWakeScheduleRecord,
};

pub(super) fn from_contract_archive(
    archive: WorkspaceMobilityArchive,
    workspace_id: &str,
    attachment_storage: &PromptAttachmentStorage,
) -> Result<WorkspaceMobilityArchiveData, ApiError> {
    Ok(WorkspaceMobilityArchiveData {
        source_workspace_id: archive.source_workspace_id,
        source_workspace_path: archive.source_workspace_path,
        repo_root_path: archive.repo_root_path,
        branch_name: archive.branch_name,
        base_commit_sha: archive.base_commit_sha,
        files: archive
            .files
            .into_iter()
            .map(from_contract_file)
            .collect::<Result<Vec<_>, _>>()?,
        deleted_paths: archive.deleted_paths,
        sessions: archive
            .sessions
            .into_iter()
            .map(|bundle| from_contract_session_bundle(bundle, workspace_id, attachment_storage))
            .collect::<Result<Vec<_>, _>>()?,
        session_links: archive
            .session_links
            .into_iter()
            .map(from_contract_session_link)
            .collect::<Result<Vec<_>, _>>()?,
        session_link_completions: archive
            .session_link_completions
            .into_iter()
            .map(from_contract_session_link_completion)
            .collect::<Result<Vec<_>, _>>()?,
        session_link_wake_schedules: archive
            .session_link_wake_schedules
            .into_iter()
            .map(from_contract_session_link_wake_schedule)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn from_contract_file(file: WorkspaceMobilityFileEntry) -> Result<MobilityFileData, ApiError> {
    let content = STANDARD.decode(file.content_base64).map_err(|error| {
        ApiError::bad_request(
            format!(
                "Invalid base64 archive content for {}: {error}",
                file.relative_path
            ),
            "MOBILITY_INVALID_ARCHIVE",
        )
    })?;
    if content.len() > MAX_MOBILITY_FILE_BYTES {
        return Err(ApiError::bad_request(
            format!(
                "Archive file {} exceeded the {} byte limit",
                file.relative_path, MAX_MOBILITY_FILE_BYTES
            ),
            "MOBILITY_INVALID_ARCHIVE",
        ));
    }
    Ok(MobilityFileData {
        relative_path: file.relative_path,
        mode: file.mode,
        content,
    })
}

fn from_contract_agent_artifact(
    file: WorkspaceMobilityFileEntry,
) -> Result<AgentArtifactFileData, ApiError> {
    let file = from_contract_file(file)?;
    Ok(AgentArtifactFileData {
        relative_path: file.relative_path,
        mode: file.mode,
        content: file.content,
    })
}

fn from_contract_session_bundle(
    bundle: WorkspaceMobilitySessionBundle,
    workspace_id: &str,
    attachment_storage: &PromptAttachmentStorage,
) -> Result<WorkspaceMobilitySessionBundleData, ApiError> {
    let session = from_contract_session_record(bundle.session, workspace_id);
    let session_id = session.id.clone();
    Ok(WorkspaceMobilitySessionBundleData {
        session,
        live_config_snapshot: bundle
            .live_config_snapshot
            .map(from_contract_live_config_snapshot),
        pending_config_changes: bundle
            .pending_config_changes
            .into_iter()
            .map(from_contract_pending_config_change)
            .collect(),
        pending_prompts: bundle
            .pending_prompts
            .into_iter()
            .map(from_contract_pending_prompt)
            .collect(),
        prompt_attachments: bundle
            .prompt_attachments
            .into_iter()
            .map(|record| from_contract_prompt_attachment(record, &session_id, attachment_storage))
            .collect::<Result<Vec<_>, _>>()?,
        events: bundle.events.into_iter().map(from_contract_event).collect(),
        raw_notifications: bundle
            .raw_notifications
            .into_iter()
            .map(from_contract_raw_notification)
            .collect(),
        agent_artifacts: bundle
            .agent_artifacts
            .into_iter()
            .map(from_contract_agent_artifact)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn from_contract_session_record(
    record: MobilitySessionRecord,
    workspace_id: &str,
) -> SessionRecord {
    let action_capabilities_json = match serialize_action_capabilities(record.action_capabilities) {
        Ok(json) => Some(json),
        Err(error) => {
            tracing::warn!(
                session_id = %record.id,
                error = %error,
                "failed to serialize imported session action capabilities"
            );
            None
        }
    };

    SessionRecord {
        id: record.id,
        workspace_id: workspace_id.to_string(),
        agent_kind: record.agent_kind,
        native_session_id: record.native_session_id,
        agent_auth_contexts: None,
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
        // MCP bindings are workspace-local encrypted state; sessions rebind after handoff.
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy:
            crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: record.system_prompt_append,
        subagents_enabled: record.subagents_enabled,
        action_capabilities_json,
        origin: record
            .origin
            .map(crate::origin::OriginContext::from_contract),
    }
}

fn from_contract_session_link(
    record: MobilitySessionLinkRecord,
) -> Result<SessionLinkRecord, ApiError> {
    Ok(SessionLinkRecord {
        id: record.id,
        public_id: record.public_id,
        relation: SessionLinkRelation::parse(&record.relation).map_err(|error| {
            ApiError::bad_request(error.to_string(), "MOBILITY_INVALID_ARCHIVE")
        })?,
        parent_session_id: record.parent_session_id,
        child_session_id: record.child_session_id,
        workspace_relation: SessionLinkWorkspaceRelation::parse(&record.workspace_relation)
            .map_err(|error| {
                ApiError::bad_request(error.to_string(), "MOBILITY_INVALID_ARCHIVE")
            })?,
        label: record.label,
        created_by_turn_id: record.created_by_turn_id,
        created_by_tool_call_id: record.created_by_tool_call_id,
        created_at: record.created_at,
        closed_at: record.closed_at,
    })
}

fn from_contract_session_link_completion(
    record: MobilitySessionLinkCompletionRecord,
) -> Result<SubagentCompletionRecord, ApiError> {
    Ok(SubagentCompletionRecord {
        completion_id: record.completion_id,
        session_link_id: record.session_link_id,
        child_turn_id: record.child_turn_id,
        child_last_event_seq: record.child_last_event_seq,
        outcome: parse_mobility_completion_outcome(&record.outcome)?,
        parent_event_seq: record.parent_event_seq,
        parent_prompt_seq: record.parent_prompt_seq,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

fn from_contract_session_link_wake_schedule(
    record: MobilitySessionLinkWakeScheduleRecord,
) -> Result<SubagentWakeScheduleRecord, ApiError> {
    Ok(SubagentWakeScheduleRecord {
        session_link_id: record.session_link_id,
    })
}

fn parse_mobility_completion_outcome(value: &str) -> Result<SessionTurnOutcome, ApiError> {
    match value {
        "completed" => Ok(SessionTurnOutcome::Completed),
        "failed" => Ok(SessionTurnOutcome::Failed),
        "cancelled" => Ok(SessionTurnOutcome::Cancelled),
        other => Err(ApiError::bad_request(
            format!("Invalid subagent wake outcome: {other}"),
            "MOBILITY_INVALID_ARCHIVE",
        )),
    }
}

fn from_contract_live_config_snapshot(
    record: MobilitySessionLiveConfigSnapshotRecord,
) -> SessionLiveConfigSnapshotRecord {
    SessionLiveConfigSnapshotRecord {
        session_id: record.session_id,
        source_seq: record.source_seq,
        raw_config_options_json: record.raw_config_options_json,
        normalized_controls_json: record.normalized_controls_json,
        prompt_capabilities_json: record.prompt_capabilities_json,
        updated_at: record.updated_at,
    }
}

fn from_contract_pending_config_change(
    record: MobilityPendingConfigChangeRecord,
) -> PendingConfigChangeRecord {
    PendingConfigChangeRecord {
        session_id: record.session_id,
        config_id: record.config_id,
        value: record.value,
        queued_at: record.queued_at,
    }
}

fn from_contract_pending_prompt(record: MobilityPendingPromptRecord) -> PendingPromptRecord {
    PendingPromptRecord {
        session_id: record.session_id,
        seq: record.seq,
        prompt_id: record.prompt_id,
        text: record.text,
        blocks_json: record.blocks_json,
        provenance_json: None,
        queued_at: record.queued_at,
    }
}

fn from_contract_prompt_attachment(
    record: MobilityPromptAttachmentRecord,
    expected_session_id: &str,
    attachment_storage: &PromptAttachmentStorage,
) -> Result<MobilityPromptAttachmentData, ApiError> {
    if record.session_id != expected_session_id {
        return Err(ApiError::bad_request(
            "Prompt attachment sessionId does not match containing session",
            "INVALID_ARCHIVE",
        ));
    }
    let content = STANDARD.decode(record.content_base64).map_err(|_| {
        ApiError::bad_request("Invalid prompt attachment content", "INVALID_ARCHIVE")
    })?;
    if record.size_bytes != content.len() as u64 {
        return Err(ApiError::bad_request(
            "Prompt attachment size does not match decoded content",
            "INVALID_ARCHIVE",
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let digest = format!("{:x}", hasher.finalize());
    if digest != record.sha256 {
        return Err(ApiError::bad_request(
            "Prompt attachment sha256 does not match decoded content",
            "INVALID_ARCHIVE",
        ));
    }
    let storage_path = attachment_storage.storage_path(&record.session_id, &record.attachment_id);
    Ok(MobilityPromptAttachmentData {
        record: PromptAttachmentRecord {
            attachment_id: record.attachment_id,
            session_id: record.session_id,
            state: PromptAttachmentState::parse(&record.state),
            kind: PromptAttachmentKind::parse(&record.kind),
            source: crate::domains::sessions::model::PromptAttachmentSource::parse(&record.source),
            mime_type: record.mime_type,
            display_name: record.display_name,
            source_uri: record.source_uri,
            storage_path,
            size_bytes: record.size_bytes.try_into().unwrap_or(i64::MAX),
            sha256: record.sha256,
            created_at: record.created_at,
            updated_at: record.updated_at,
        },
        content,
    })
}

fn from_contract_event(record: MobilitySessionEventRecord) -> SessionEventRecord {
    SessionEventRecord {
        id: 0,
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        event_type: record.event_type,
        turn_id: record.turn_id,
        item_id: record.item_id,
        payload_json: record.payload_json,
    }
}

fn from_contract_raw_notification(
    record: MobilitySessionRawNotificationRecord,
) -> SessionRawNotificationRecord {
    SessionRawNotificationRecord {
        id: 0,
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        notification_kind: record.notification_kind,
        payload_json: record.payload_json,
    }
}
