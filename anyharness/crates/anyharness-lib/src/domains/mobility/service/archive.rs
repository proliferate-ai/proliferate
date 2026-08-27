use std::collections::HashSet;

use crate::domains::agents::portability::AgentArtifactFileData;
use crate::domains::mobility::model::{
    MobilityFileData, WorkspaceMobilityArchiveData, WorkspaceMobilitySessionBundleData,
};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::MAX_PENDING_PROMPT_SEQ;
use crate::domains::sessions::store::completion_deliveries::CompletionDeliveryState;

use super::MobilityError;

pub(in crate::domains::mobility) fn session_pending_prompt_cursor_lower_bound(
    archive: &WorkspaceMobilityArchiveData,
    bundle: &WorkspaceMobilitySessionBundleData,
) -> Result<i64, MobilityError> {
    let session_id = bundle.session.id.as_str();
    let mut lower_bound = bundle.pending_prompt_seq_cursor.unwrap_or(0);
    if !(0..=MAX_PENDING_PROMPT_SEQ).contains(&lower_bound) {
        return Err(MobilityError::Invalid(format!(
            "archive session {session_id} has an invalid pending-prompt sequence cursor {lower_bound}"
        )));
    }

    for pending in &bundle.pending_prompts {
        if pending.session_id != session_id {
            return Err(MobilityError::Invalid(format!(
                "archive session {session_id} contains pending prompt owned by {}",
                pending.session_id
            )));
        }
        lower_bound = lower_bound.max(valid_prompt_seq(session_id, pending.seq)?);
    }

    for event in &bundle.events {
        if event.session_id != session_id {
            return Err(MobilityError::Invalid(format!(
                "archive session {session_id} contains event owned by {}",
                event.session_id
            )));
        }
        let payload: serde_json::Value =
            serde_json::from_str(&event.payload_json).map_err(|error| {
                MobilityError::Invalid(format!(
                    "archive session {session_id} has invalid {} event payload: {error}",
                    event.event_type
                ))
            })?;
        if payload.get("type").and_then(serde_json::Value::as_str)
            != Some(event.event_type.as_str())
        {
            return Err(MobilityError::Invalid(format!(
                "archive session {session_id} event type {} disagrees with its payload",
                event.event_type
            )));
        }
        if matches!(
            event.event_type.as_str(),
            "pending_prompt_added"
                | "pending_prompt_updated"
                | "pending_prompt_removed"
                | "pending_prompts_reordered"
        ) {
            if event.event_type == "pending_prompts_reordered" {
                let pending_prompts = payload
                    .get("pendingPrompts")
                    .and_then(serde_json::Value::as_array)
                    .ok_or_else(|| {
                        MobilityError::Invalid(format!(
                            "archive session {session_id} has an invalid reordered-prompt event"
                        ))
                    })?;
                for pending in pending_prompts {
                    let seq = pending
                        .get("seq")
                        .and_then(serde_json::Value::as_i64)
                        .ok_or_else(|| {
                            MobilityError::Invalid(format!(
                                "archive session {session_id} has a reordered prompt without an integer sequence"
                            ))
                        })?;
                    lower_bound = lower_bound.max(valid_prompt_seq(session_id, seq)?);
                }
            } else {
                let seq = payload
                    .get("seq")
                    .and_then(serde_json::Value::as_i64)
                    .ok_or_else(|| {
                        MobilityError::Invalid(format!(
                            "archive session {session_id} has a pending-prompt event without an integer sequence"
                        ))
                    })?;
                lower_bound = lower_bound.max(valid_prompt_seq(session_id, seq)?);
            }
        }
    }

    for delivery in archive
        .session_link_completion_deliveries
        .iter()
        .filter(|delivery| delivery.parent_session_id == session_id)
    {
        for seq in [delivery.parent_prompt_seq, delivery.retired_prompt_seq]
            .into_iter()
            .flatten()
        {
            lower_bound = lower_bound.max(valid_prompt_seq(session_id, seq)?);
        }
    }
    for completion in &archive.session_link_completions {
        let belongs_to_session = archive.session_links.iter().any(|link| {
            link.id == completion.session_link_id && link.parent_session_id == session_id
        });
        if belongs_to_session {
            if let Some(seq) = completion.parent_prompt_seq {
                lower_bound = lower_bound.max(valid_prompt_seq(session_id, seq)?);
            }
        }
    }
    Ok(lower_bound)
}

fn valid_prompt_seq(session_id: &str, seq: i64) -> Result<i64, MobilityError> {
    if !(1..=MAX_PENDING_PROMPT_SEQ).contains(&seq) {
        return Err(MobilityError::Invalid(format!(
            "archive session {session_id} contains invalid pending-prompt sequence {seq}"
        )));
    }
    Ok(seq)
}

pub(super) fn validate_completion_deliveries(
    archive: &WorkspaceMobilityArchiveData,
    session_ids: &HashSet<&str>,
) -> Result<(), MobilityError> {
    let mut delivery_ids = HashSet::new();
    let mut completion_ids = HashSet::new();
    let mut child_turns = HashSet::new();
    for delivery in &archive.session_link_completion_deliveries {
        if delivery.delivery_id.is_empty() {
            return Err(MobilityError::Invalid(
                "archive completion delivery has an empty delivery id".to_string(),
            ));
        }
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
        validate_retired_wake_intent(archive, delivery)?;
    }
    Ok(())
}

fn validate_retired_wake_intent(
    archive: &WorkspaceMobilityArchiveData,
    delivery: &crate::domains::sessions::subagents::delivery::CompletionDeliveryRecord,
) -> Result<(), MobilityError> {
    let (retired_seq, retired_id) = match (
        delivery.retired_prompt_seq,
        delivery.retired_prompt_id.as_deref(),
    ) {
        (None, None) => return Ok(()),
        (Some(seq), Some(prompt_id)) => (seq, prompt_id),
        _ => {
            return Err(MobilityError::Invalid(format!(
                "archive completion delivery {} has an incomplete retired wake identity",
                delivery.delivery_id
            )));
        }
    };

    let canonical_prompt_id = delivery.prompt_id();
    let producer_invariant_matches = delivery.state == CompletionDeliveryState::Delivered
        && delivery.outcome == SessionTurnOutcome::Completed
        && delivery.parent_prompt_seq.is_none()
        && delivery.parent_turn_id.is_none()
        && retired_id == canonical_prompt_id.as_str();
    if !producer_invariant_matches {
        return Err(MobilityError::Invalid(format!(
            "archive completion delivery {} has an invalid retired wake intent",
            delivery.delivery_id
        )));
    }

    let active_row_collides = archive.sessions.iter().any(|bundle| {
        bundle.session.id == delivery.parent_session_id
            && bundle
                .pending_prompts
                .iter()
                .any(|pending| pending.seq == retired_seq)
    });
    if active_row_collides {
        return Err(MobilityError::Invalid(format!(
            "archive completion delivery {} retired wake sequence {retired_seq} collides with an active pending prompt",
            delivery.delivery_id
        )));
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
        .saturating_add(
            archive
                .deleted_paths
                .iter()
                .map(|path| string_size(path))
                .sum::<u64>(),
        )
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
        + integer_size(record.child_last_event_seq)
        + option_integer_size(record.parent_prompt_seq)
        + option_integer_size(record.retired_prompt_seq)
        + option_string_size(&record.retired_prompt_id)
        + integer_size(record.attempt_count)
        + string_size(&record.next_attempt_at)
        + option_string_size(&record.last_error_code)
        + string_size(&record.created_at)
        + string_size(&record.updated_at)
        + option_string_size(&record.enqueued_at)
        + option_string_size(&record.delivered_at)
}

fn session_bundle_size_bytes(bundle: &WorkspaceMobilitySessionBundleData) -> u64 {
    encoded_session_size_bytes(&bundle.session)
        .saturating_add(option_integer_size(bundle.pending_prompt_seq_cursor))
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
                        + integer_size(record.seq)
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
                        + integer_size(record.seq)
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
                        + integer_size(record.seq)
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
        + option_integer_size(session.thinking_budget_tokens)
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
        + integer_size(record.source_seq)
        + string_size(&record.raw_config_options_json)
        + string_size(&record.normalized_controls_json)
        + string_size(&record.updated_at)
}

fn encoded_file_size_bytes(file: &MobilityFileData) -> u64 {
    string_size(&file.relative_path) + integer_size(file.mode) + base64_size(file.content.len())
}

fn encoded_agent_artifact_size_bytes(file: &AgentArtifactFileData) -> u64 {
    string_size(&file.relative_path) + integer_size(file.mode) + base64_size(file.content.len())
}

fn base64_size(byte_len: usize) -> u64 {
    byte_len.div_ceil(3) as u64 * 4
}

fn string_size(value: &str) -> u64 {
    value.len() as u64
}

fn str_size(value: &str) -> u64 {
    value.len() as u64
}

fn option_string_size(value: &Option<String>) -> u64 {
    value.as_ref().map(|value| value.len() as u64).unwrap_or(0)
}

fn integer_size(value: impl std::fmt::Display) -> u64 {
    value.to_string().len() as u64
}

fn option_integer_size(value: Option<impl std::fmt::Display>) -> u64 {
    value.map(integer_size).unwrap_or(0)
}

#[cfg(test)]
mod tests;
