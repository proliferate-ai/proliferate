use agent_client_protocol as acp;
use anyharness_contract::v1::{
    PendingPromptAddedPayload, PendingPromptRemovalReason, PendingPromptRemovedPayload,
    PendingPromptUpdatedPayload, PendingPromptsReorderedPayload,
};

use crate::domains::sessions::model::{
    PendingPromptReorderOutcome, PromptAttachmentRecord, PromptAttachmentState,
};
use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::actor::command::{
    PromptAcceptError, PromptAcceptance, QueueMutationError, Resolution,
};
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::model::AttachmentSource;

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn handle_busy_prompt_queue(
        &self,
        payload: PromptPayload,
        prompt_id: Option<String>,
        from_queue_seq: Option<i64>,
    ) -> Result<PromptAcceptance, PromptAcceptError> {
        if let Some(seq) = from_queue_seq {
            self.emit_prequeued_pending_prompt_added(seq).await;
            return Ok(PromptAcceptance::Queued { seq });
        }

        // Busy-path enqueue invariant: insert durably, emit PendingPromptAdded,
        // then respond Queued. This mirrors the idle path's durable-before-visible
        // ordering without starting a turn while another prompt is running.
        match self.caps.queue.insert_pending_prompt_payload(
            &self.session_id,
            &payload,
            prompt_id.as_deref(),
        ) {
            Ok(record) => {
                let mut sink = self.event_sink.lock().await;
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
                    session_id = %self.session_id,
                    error = %error,
                    "failed to enqueue pending prompt",
                );
                Err(PromptAcceptError::EnqueueFailed(error.to_string()))
            }
        }
    }

    pub(in crate::live::sessions::actor) async fn emit_prequeued_pending_prompt_added(
        &self,
        seq: i64,
    ) {
        match self.caps.queue.find_pending_prompt(&self.session_id, seq) {
            Ok(Some(record)) => {
                let mut sink = self.event_sink.lock().await;
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
                    session_id = %self.session_id,
                    seq,
                    error = %error,
                    "failed to load prequeued prompt for pending prompt event",
                );
            }
        }
    }

    pub(in crate::live::sessions::actor) fn next_pending_prompt_for_drain(
        &self,
    ) -> Option<(PromptPayload, Option<String>, i64)> {
        match self.caps.queue.peek_head_pending_prompt(&self.session_id) {
            Ok(Some(next)) => Some((next.prompt_payload(), next.prompt_id, next.seq)),
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    error = %error,
                    "failed to peek pending prompt queue after turn end",
                );
                None
            }
        }
    }

    pub(in crate::live::sessions::actor) async fn handle_edit_pending_prompt(
        &self,
        seq: i64,
        payload: PromptPayload,
    ) -> Result<(), QueueMutationError> {
        let old_attachment_ids = match self.caps.queue.find_pending_prompt(&self.session_id, seq) {
            Ok(Some(record)) => record.attachment_ids(),
            _ => Vec::new(),
        };
        match self
            .caps
            .queue
            .update_pending_prompt_payload(&self.session_id, seq, &payload)
        {
            Ok(true) => {
                let updated_record = self
                    .caps
                    .queue
                    .find_pending_prompt(&self.session_id, seq)
                    .ok()
                    .flatten();
                let new_attachment_ids = payload.attachment_ids();
                let removed = old_attachment_ids
                    .iter()
                    .filter(|old_id| !new_attachment_ids.contains(old_id))
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                let removed_records = pending_attachment_records(
                    self.caps.attachments.as_ref(),
                    &self.session_id,
                    &removed,
                );
                if let Err(error) = self
                    .caps
                    .attachments
                    .delete_prompt_attachments(&self.session_id, &removed)
                {
                    tracing::warn!(
                        session_id = %self.session_id,
                        seq,
                        error = %error,
                        "failed to delete removed pending prompt attachments",
                    );
                }
                delete_pending_attachment_files(self.caps.attachments.as_ref(), &removed_records);
                let mut sink = self.event_sink.lock().await;
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
                    session_id = %self.session_id,
                    seq,
                    error = %error,
                    "failed to update pending prompt",
                );
                Err(QueueMutationError::NotFound)
            }
        }
    }

    pub(in crate::live::sessions::actor) async fn handle_delete_pending_prompt(
        &self,
        seq: i64,
    ) -> Result<(), QueueMutationError> {
        match self
            .caps
            .queue
            .delete_pending_prompt_record(&self.session_id, seq)
        {
            Ok(Some(record)) => {
                let attachment_ids = record.attachment_ids();
                let attachment_refs = attachment_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                let removed_records = pending_attachment_records(
                    self.caps.attachments.as_ref(),
                    &self.session_id,
                    &attachment_refs,
                );
                if let Err(error) = self
                    .caps
                    .attachments
                    .delete_prompt_attachments(&self.session_id, &attachment_refs)
                {
                    tracing::warn!(
                        session_id = %self.session_id,
                        seq,
                        error = %error,
                        "failed to delete pending prompt attachments",
                    );
                }
                delete_pending_attachment_files(self.caps.attachments.as_ref(), &removed_records);
                let mut sink = self.event_sink.lock().await;
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
                    session_id = %self.session_id,
                    seq,
                    error = %error,
                    "failed to delete pending prompt",
                );
                Err(QueueMutationError::NotFound)
            }
        }
    }

    pub(in crate::live::sessions::actor) async fn handle_reorder_pending_prompts(
        &self,
        expected_seqs: Vec<i64>,
        desired_seqs: Vec<i64>,
    ) -> Result<(), QueueMutationError> {
        self.persist_pending_prompt_order(&expected_seqs, &desired_seqs)
            .await
    }

    /// Promote one queued prompt to the head, then interrupt the active turn
    /// so the existing durable queue-drain path executes it next.
    pub(in crate::live::sessions::actor) async fn handle_steer_pending_prompt(
        &self,
        seq: i64,
        is_busy: bool,
    ) -> Result<(), QueueMutationError> {
        let current = self
            .caps
            .queue
            .list_pending_prompts(&self.session_id)
            .map_err(|error| {
                tracing::warn!(
                    session_id = %self.session_id,
                    seq,
                    error = %error,
                    "failed to load pending prompts before steer",
                );
                QueueMutationError::Internal(error.to_string())
            })?;
        if !current.iter().any(|record| record.seq == seq) {
            return Err(QueueMutationError::NotFound);
        }

        let expected_seqs = current.iter().map(|record| record.seq).collect::<Vec<_>>();
        let mut desired_seqs = Vec::with_capacity(current.len());
        desired_seqs.push(seq);
        desired_seqs.extend(
            current
                .iter()
                .map(|record| record.seq)
                .filter(|current_seq| *current_seq != seq),
        );
        self.persist_pending_prompt_order(&expected_seqs, &desired_seqs)
            .await?;

        if is_busy {
            // Steering has the same interaction-cleanup contract as Cancel:
            // an interrupted permission/input rendezvous cannot remain parked
            // after the current turn is asked to stop.
            self.resolve_pending_interactions(Resolution::Cancelled)
                .await;
            let _ = self
                .conn
                .send_notification(acp::schema::CancelNotification::new(
                    self.native_session_id.clone(),
                ));
        }
        Ok(())
    }

    async fn persist_pending_prompt_order(
        &self,
        expected_seqs: &[i64],
        desired_seqs: &[i64],
    ) -> Result<(), QueueMutationError> {
        let outcome = self
            .caps
            .queue
            .reorder_pending_prompts(&self.session_id, expected_seqs, desired_seqs)
            .map_err(|error| {
                tracing::warn!(
                    session_id = %self.session_id,
                    error = %error,
                    "failed to reorder pending prompts",
                );
                QueueMutationError::Internal(error.to_string())
            })?;
        let records = match outcome {
            PendingPromptReorderOutcome::Reordered(records) => records,
            PendingPromptReorderOutcome::Stale { current_seqs } => {
                return Err(QueueMutationError::StaleOrder { current_seqs });
            }
            PendingPromptReorderOutcome::Invalid { reason } => {
                return Err(QueueMutationError::InvalidReorder(reason));
            }
        };
        let pending_prompts = records.iter().map(|record| record.to_contract()).collect();
        let mut sink = self.event_sink.lock().await;
        sink.pending_prompts_reordered(PendingPromptsReorderedPayload { pending_prompts });
        Ok(())
    }
}

pub(in crate::live::sessions::actor) fn pending_attachment_records(
    attachments: &dyn AttachmentSource,
    session_id: &str,
    attachment_ids: &[&str],
) -> Vec<PromptAttachmentRecord> {
    attachment_ids
        .iter()
        .filter_map(|attachment_id| {
            attachments
                .find_prompt_attachment(session_id, attachment_id)
                .ok()
                .flatten()
                .filter(|record| record.state == PromptAttachmentState::Pending)
        })
        .collect()
}

pub(in crate::live::sessions::actor) fn delete_pending_attachment_files(
    attachments: &dyn AttachmentSource,
    records: &[PromptAttachmentRecord],
) {
    for record in records {
        if let Err(error) = attachments.delete_record(record) {
            tracing::warn!(
                session_id = %record.session_id,
                attachment_id = %record.attachment_id,
                error = %error,
                "failed to delete pending prompt attachment file"
            );
        }
    }
}
