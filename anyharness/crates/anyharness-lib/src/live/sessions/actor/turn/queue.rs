use std::sync::Arc;

use anyharness_contract::v1::{
    PendingPromptAddedPayload, PendingPromptRemovalReason, PendingPromptRemovedPayload,
    PendingPromptUpdatedPayload,
};
use tokio::sync::Mutex;

use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::model::{PromptAttachmentRecord, PromptAttachmentState};
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::command::{
    PromptAcceptError, PromptAcceptance, QueueMutationError,
};
use crate::live::sessions::sink::SessionEventSink;

pub(in crate::live::sessions::actor) async fn handle_busy_prompt_queue(
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    payload: PromptPayload,
    prompt_id: Option<String>,
    from_queue_seq: Option<i64>,
) -> Result<PromptAcceptance, PromptAcceptError> {
    if let Some(seq) = from_queue_seq {
        emit_prequeued_pending_prompt_added(store, event_sink, session_id, seq).await;
        return Ok(PromptAcceptance::Queued { seq });
    }

    // Busy-path enqueue invariant: insert durably, emit PendingPromptAdded,
    // then respond Queued. This mirrors the idle path's durable-before-visible
    // ordering without starting a turn while another prompt is running.
    match store.insert_pending_prompt_payload(session_id, &payload, prompt_id.as_deref()) {
        Ok(record) => {
            let mut sink = event_sink.lock().await;
            sink.pending_prompt_added(PendingPromptAddedPayload {
                seq: record.seq,
                prompt_id: record.prompt_id.clone(),
                text: record.text.clone(),
                content_parts: record.prompt_payload().content_parts(),
                queued_at: record.queued_at.clone(),
                prompt_provenance: record.prompt_payload().public_provenance(),
            });
            Ok(PromptAcceptance::Queued { seq: record.seq })
        }
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to enqueue pending prompt",
            );
            Err(PromptAcceptError::EnqueueFailed(error.to_string()))
        }
    }
}

pub(in crate::live::sessions::actor) async fn emit_prequeued_pending_prompt_added(
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    seq: i64,
) {
    match store.find_pending_prompt(session_id, seq) {
        Ok(Some(record)) => {
            let mut sink = event_sink.lock().await;
            sink.pending_prompt_added(PendingPromptAddedPayload {
                seq: record.seq,
                prompt_id: record.prompt_id.clone(),
                text: record.text.clone(),
                content_parts: record.prompt_payload().content_parts(),
                queued_at: record.queued_at.clone(),
                prompt_provenance: record.prompt_payload().public_provenance(),
            });
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                seq,
                error = %error,
                "failed to load prequeued prompt for pending prompt event",
            );
        }
    }
}

pub(in crate::live::sessions::actor) fn next_pending_prompt_for_drain(
    store: &SessionStore,
    session_id: &str,
) -> Option<(PromptPayload, Option<String>, i64)> {
    match store.peek_head_pending_prompt(session_id) {
        Ok(Some(next)) => Some((next.prompt_payload(), next.prompt_id, next.seq)),
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to peek pending prompt queue after turn end",
            );
            None
        }
    }
}

pub(in crate::live::sessions::actor) async fn handle_edit_pending_prompt(
    store: &SessionStore,
    attachment_storage: &PromptAttachmentStorage,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    seq: i64,
    payload: PromptPayload,
) -> Result<(), QueueMutationError> {
    let old_attachment_ids = match store.find_pending_prompt(session_id, seq) {
        Ok(Some(record)) => record.attachment_ids(),
        _ => Vec::new(),
    };
    match store.update_pending_prompt_payload(session_id, seq, &payload) {
        Ok(true) => {
            let updated_record = store.find_pending_prompt(session_id, seq).ok().flatten();
            let new_attachment_ids = payload.attachment_ids();
            let removed = old_attachment_ids
                .iter()
                .filter(|old_id| !new_attachment_ids.contains(old_id))
                .map(String::as_str)
                .collect::<Vec<_>>();
            let removed_records = pending_attachment_records(store, session_id, &removed);
            if let Err(error) = store.delete_prompt_attachments(session_id, &removed) {
                tracing::warn!(
                    session_id = %session_id,
                    seq,
                    error = %error,
                    "failed to delete removed pending prompt attachments",
                );
            }
            delete_pending_attachment_files(attachment_storage, &removed_records);
            let mut sink = event_sink.lock().await;
            let content_parts = payload.content_parts();
            sink.pending_prompt_updated(PendingPromptUpdatedPayload {
                seq,
                prompt_id: updated_record
                    .as_ref()
                    .and_then(|record| record.prompt_id.clone()),
                text: payload.text_summary,
                content_parts,
                prompt_provenance: updated_record
                    .and_then(|record| record.prompt_payload().public_provenance()),
            });
            Ok(())
        }
        Ok(false) => Err(QueueMutationError::NotFound),
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                seq,
                error = %error,
                "failed to update pending prompt",
            );
            Err(QueueMutationError::NotFound)
        }
    }
}

pub(in crate::live::sessions::actor) async fn handle_delete_pending_prompt(
    store: &SessionStore,
    attachment_storage: &PromptAttachmentStorage,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    seq: i64,
) -> Result<(), QueueMutationError> {
    match store.delete_pending_prompt_record(session_id, seq) {
        Ok(Some(record)) => {
            let attachment_ids = record.attachment_ids();
            let attachment_refs = attachment_ids
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            let removed_records = pending_attachment_records(store, session_id, &attachment_refs);
            if let Err(error) = store.delete_prompt_attachments(session_id, &attachment_refs) {
                tracing::warn!(
                    session_id = %session_id,
                    seq,
                    error = %error,
                    "failed to delete pending prompt attachments",
                );
            }
            delete_pending_attachment_files(attachment_storage, &removed_records);
            let mut sink = event_sink.lock().await;
            sink.pending_prompt_removed(PendingPromptRemovedPayload {
                seq,
                prompt_id: record.prompt_id.clone(),
                reason: PendingPromptRemovalReason::Deleted,
            });
            Ok(())
        }
        Ok(None) => Err(QueueMutationError::NotFound),
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                seq,
                error = %error,
                "failed to delete pending prompt",
            );
            Err(QueueMutationError::NotFound)
        }
    }
}

pub(in crate::live::sessions::actor) fn pending_attachment_records(
    store: &SessionStore,
    session_id: &str,
    attachment_ids: &[&str],
) -> Vec<PromptAttachmentRecord> {
    attachment_ids
        .iter()
        .filter_map(|attachment_id| {
            store
                .find_prompt_attachment(session_id, attachment_id)
                .ok()
                .flatten()
                .filter(|record| record.state == PromptAttachmentState::Pending)
        })
        .collect()
}

pub(in crate::live::sessions::actor) fn delete_pending_attachment_files(
    attachment_storage: &PromptAttachmentStorage,
    records: &[PromptAttachmentRecord],
) {
    for record in records {
        if let Err(error) = attachment_storage.delete_record(record) {
            tracing::warn!(
                session_id = %record.session_id,
                attachment_id = %record.attachment_id,
                error = %error,
                "failed to delete pending prompt attachment file"
            );
        }
    }
}
