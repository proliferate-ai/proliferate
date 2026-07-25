use anyharness_contract::v1::{
    PendingPromptAddedPayload, PendingPromptRemovalReason, PendingPromptRemovedPayload,
    PendingPromptUpdatedPayload,
};

use crate::domains::sessions::model::{PromptAttachmentRecord, PromptAttachmentState};
use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::actor::command::{
    PromptAcceptError, PromptAcceptance, QueueMutationError,
};
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::{AttachmentSource, QueueDurable};

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn handle_busy_prompt_queue(
        &self,
        payload: PromptPayload,
        prompt_id: Option<String>,
        from_queue_seq: Option<i64>,
    ) -> Result<PromptAcceptance, PromptAcceptError> {
        if self.handle.is_closing() {
            return Err(PromptAcceptError::Closing);
        }
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
        next_pending_prompt_for_drain(
            self.handle.as_ref(),
            self.caps.queue.as_ref(),
            &self.session_id,
        )
    }
}

fn next_pending_prompt_for_drain(
    handle: &LiveSessionHandle,
    queue: &dyn QueueDurable,
    session_id: &str,
) -> Option<(PromptPayload, Option<String>, i64)> {
    if handle.is_closing() {
        return None;
    }
    match queue.peek_head_pending_prompt(session_id) {
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

impl SessionActor {
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

#[cfg(test)]
mod closing_tests {
    use std::sync::Arc;

    use anyharness_contract::v1::{SessionEventEnvelope, SessionExecutionPhase};
    use tokio::sync::{broadcast, mpsc, Barrier};

    use super::next_pending_prompt_for_drain;
    use crate::app::test_support;
    use crate::domains::sessions::prompt::PromptPayload;
    use crate::domains::sessions::store::SessionStore;
    use crate::live::sessions::actor::command::SessionCommand;
    use crate::live::sessions::handle::LiveSessionHandle;
    use crate::persistence::Db;

    #[tokio::test]
    async fn close_intent_wins_provider_completion_before_queue_drain() {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at
                 ) VALUES ('session-1', 'workspace-1', 'claude', 'running', 'now', 'now')",
                [],
            )?;
            Ok(())
        })
        .expect("seed session");
        let queue = Arc::new(SessionStore::new(db));
        let queued = queue
            .insert_pending_prompt_payload(
                "session-1",
                &PromptPayload::text("queued work".to_string()),
                Some("queued-prompt"),
            )
            .expect("queue prompt");

        let (command_tx, _command_rx) = mpsc::channel::<SessionCommand>(4);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            "session-1",
            command_tx,
            event_tx,
            Some("native-1".to_string()),
            SessionExecutionPhase::Running,
        ));

        // This is the exact lost-race ordering: provider completion is ready,
        // close intent is established, and the Close mailbox command has not
        // yet been consumed when queue drain decides whether to hand off work.
        let provider_completed = Arc::new(Barrier::new(2));
        let close_fenced = Arc::new(Barrier::new(2));
        let closing_handle = handle.clone();
        let closing_provider_completed = provider_completed.clone();
        let closing_close_fenced = close_fenced.clone();
        let close_task = tokio::spawn(async move {
            closing_provider_completed.wait().await;
            closing_handle.begin_closing().await;
            closing_close_fenced.wait().await;
        });

        provider_completed.wait().await;
        close_fenced.wait().await;
        assert!(next_pending_prompt_for_drain(&handle, queue.as_ref(), "session-1").is_none());
        close_task.await.expect("close fence task");

        let still_queued = queue
            .find_pending_prompt("session-1", queued.seq)
            .expect("read queue row");
        assert!(still_queued.is_some(), "queued row must remain unstarted");
        assert_eq!(
            handle.execution_snapshot().await.phase,
            SessionExecutionPhase::Closing
        );
    }
}
