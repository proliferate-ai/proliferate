use std::collections::HashSet;

use crate::domains::agents::portability::AgentArtifactFileData;
use crate::domains::mobility::model::{
    MobilityFileData, WorkspaceMobilityArchiveData, WorkspaceMobilitySessionBundleData,
};

use super::MobilityError;

pub(super) fn validate_completion_deliveries(
    archive: &WorkspaceMobilityArchiveData,
    session_ids: &HashSet<&str>,
) -> Result<(), MobilityError> {
    let mut delivery_ids = HashSet::new();
    let mut completion_ids = HashSet::new();
    let mut child_turns = HashSet::new();
    for delivery in &archive.session_link_completion_deliveries {
        if !session_ids.contains(delivery.parent_session_id.as_str()) {
            return Err(MobilityError::Invalid(format!(
                "archive completion delivery {} references missing parent session {}",
                delivery.delivery_id, delivery.parent_session_id
            )));
        }
        if !delivery_ids.insert(delivery.delivery_id.as_str())
            || !completion_ids.insert(delivery.completion_id.as_str())
            || !child_turns.insert((
                delivery.child_session_id.as_str(),
                delivery.child_turn_id.as_str(),
            ))
        {
            return Err(MobilityError::Invalid(format!(
                "archive contains duplicate completion delivery {}",
                delivery.delivery_id
            )));
        }
        if let Some(link) = archive
            .session_links
            .iter()
            .find(|link| link.id == delivery.session_link_id)
        {
            if link.parent_session_id != delivery.parent_session_id
                || link.child_session_id != delivery.child_session_id
            {
                return Err(MobilityError::Invalid(format!(
                    "archive completion delivery {} disagrees with session link {}",
                    delivery.delivery_id, delivery.session_link_id
                )));
            }
        }
        if let Some(completion) = archive.session_link_completions.iter().find(|completion| {
            completion.completion_id == delivery.completion_id
                || (completion.session_link_id == delivery.session_link_id
                    && completion.child_turn_id == delivery.child_turn_id)
        }) {
            if completion.session_link_id != delivery.session_link_id
                || completion.child_turn_id != delivery.child_turn_id
                || completion.child_last_event_seq != delivery.child_last_event_seq
                || completion.outcome != delivery.outcome
            {
                return Err(MobilityError::Invalid(format!(
                    "archive completion delivery {} disagrees with completion {}",
                    delivery.delivery_id, delivery.completion_id
                )));
            }
        }
    }
    Ok(())
}

pub(in crate::domains::mobility) fn archive_estimated_size_bytes(
    archive: &WorkspaceMobilityArchiveData,
) -> u64 {
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
        .saturating_add(
            archive
                .session_link_completion_deliveries
                .iter()
                .map(completion_delivery_size_bytes)
                .sum::<u64>(),
        )
}

fn completion_delivery_size_bytes(
    record: &crate::domains::sessions::subagents::delivery::CompletionDeliveryRecord,
) -> u64 {
    string_size(&record.delivery_id)
        + string_size(&record.completion_id)
        + string_size(&record.session_link_id)
        + string_size(&record.parent_session_id)
        + string_size(&record.child_session_id)
        + option_string_size(&record.subagent_public_id)
        + option_string_size(&record.label)
        + string_size(&record.child_turn_id)
        + option_string_size(&record.assistant_text)
        + string_size(&record.notification_text)
        + str_size(record.outcome.as_str())
        + str_size(record.state.as_str())
        + record.child_last_event_seq.max(0) as u64
        + record.parent_prompt_seq.unwrap_or_default().max(0) as u64
        + record.retired_prompt_seq.unwrap_or_default().max(0) as u64
        + option_string_size(&record.retired_prompt_id)
        + record.attempt_count.max(0) as u64
        + string_size(&record.next_attempt_at)
        + option_string_size(&record.last_error_code)
        + string_size(&record.created_at)
        + string_size(&record.updated_at)
        + option_string_size(&record.enqueued_at)
        + option_string_size(&record.delivered_at)
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
                        + option_string_size(&record.provenance_json)
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
