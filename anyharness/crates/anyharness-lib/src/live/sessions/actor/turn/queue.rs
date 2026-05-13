use crate::live::sessions::actor::*;
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
