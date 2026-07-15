use anyharness_contract::v1::PromptInputBlock;

use crate::domains::sessions::model::{PromptAttachmentState, SessionRecord};
use crate::domains::sessions::prompt::capabilities::capabilities_from_live_config;
use crate::domains::sessions::prompt::prepare::prepare_prompt;
use crate::domains::sessions::prompt::PromptPrepareContext;
use crate::live::sessions::{LiveSessionCommandError, QueueMutationError};

use super::{
    PendingPromptMutationError, PendingPromptQueueError, SessionLifecycleError, SessionRuntime,
};

impl SessionRuntime {
    pub async fn edit_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
        blocks: Vec<PromptInputBlock>,
    ) -> Result<SessionRecord, PendingPromptMutationError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(id) => {
                    PendingPromptMutationError::SessionNotFound(id)
                }
                SessionLifecycleError::Internal(error) => {
                    PendingPromptMutationError::Internal(error)
                }
            })?;
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "failed to ensure live session handle: {error:?}"
                ))
            })?;
        let live_config = self
            .session_service
            .get_live_config_snapshot(session_id)
            .map_err(PendingPromptMutationError::Internal)?;
        let prepared = prepare_prompt(
            PromptPrepareContext {
                store: self.session_service.store(),
                attachment_storage: self.session_service.attachment_storage(),
                session_id,
                workspace_id: &record.workspace_id,
                capabilities: capabilities_from_live_config(live_config.as_ref()),
                attachment_state: PromptAttachmentState::Pending,
                plan_resolver: self.plan_reference_resolver.as_ref(),
            },
            blocks,
        )
        .map_err(PendingPromptMutationError::InvalidPrompt)?;
        prepared
            .persist_attachments(
                self.session_service.store(),
                self.session_service.attachment_storage(),
            )
            .map_err(PendingPromptMutationError::Internal)?;

        handle
            .edit_pending_prompt(seq, prepared.payload.clone())
            .await
            .map_err(|error| match error {
                LiveSessionCommandError::ActorUnavailable => {
                    let _ = prepared.cleanup_attachments(
                        self.session_service.store(),
                        self.session_service.attachment_storage(),
                        session_id,
                    );
                    PendingPromptMutationError::Internal(anyhow::anyhow!(
                        "session actor channel closed"
                    ))
                }
                LiveSessionCommandError::ResponseDropped => PendingPromptMutationError::Internal(
                    anyhow::anyhow!("session actor dropped edit-pending-prompt response"),
                ),
                LiveSessionCommandError::Rejected(QueueMutationError::NotFound) => {
                    let _ = prepared.cleanup_attachments(
                        self.session_service.store(),
                        self.session_service.attachment_storage(),
                        session_id,
                    );
                    PendingPromptMutationError::NotFound
                }
                LiveSessionCommandError::Rejected(QueueMutationError::StaleOrder { .. }) => {
                    PendingPromptMutationError::Internal(anyhow::anyhow!(
                        "unexpected reorder conflict while editing a pending prompt"
                    ))
                }
                LiveSessionCommandError::Rejected(QueueMutationError::InvalidReorder(_)) => {
                    PendingPromptMutationError::Internal(anyhow::anyhow!(
                        "unexpected reorder rejection while editing a pending prompt"
                    ))
                }
                LiveSessionCommandError::Rejected(QueueMutationError::Internal(error)) => {
                    PendingPromptMutationError::Internal(anyhow::anyhow!(error))
                }
            })?;

        self.session_service
            .get_session(session_id)
            .map_err(PendingPromptMutationError::Internal)?
            .ok_or_else(|| PendingPromptMutationError::SessionNotFound(session_id.to_string()))
    }

    pub async fn delete_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
    ) -> Result<SessionRecord, PendingPromptMutationError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(id) => {
                    PendingPromptMutationError::SessionNotFound(id)
                }
                SessionLifecycleError::Internal(error) => {
                    PendingPromptMutationError::Internal(error)
                }
            })?;
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "failed to ensure live session handle: {error:?}"
                ))
            })?;

        handle
            .delete_pending_prompt(seq)
            .await
            .map_err(|error| match error {
                LiveSessionCommandError::ActorUnavailable => PendingPromptMutationError::Internal(
                    anyhow::anyhow!("session actor channel closed"),
                ),
                LiveSessionCommandError::ResponseDropped => PendingPromptMutationError::Internal(
                    anyhow::anyhow!("session actor dropped delete-pending-prompt response"),
                ),
                LiveSessionCommandError::Rejected(QueueMutationError::NotFound) => {
                    PendingPromptMutationError::NotFound
                }
                LiveSessionCommandError::Rejected(QueueMutationError::StaleOrder { .. }) => {
                    PendingPromptMutationError::Internal(anyhow::anyhow!(
                        "unexpected reorder conflict while deleting a pending prompt"
                    ))
                }
                LiveSessionCommandError::Rejected(QueueMutationError::InvalidReorder(_)) => {
                    PendingPromptMutationError::Internal(anyhow::anyhow!(
                        "unexpected reorder rejection while deleting a pending prompt"
                    ))
                }
                LiveSessionCommandError::Rejected(QueueMutationError::Internal(error)) => {
                    PendingPromptMutationError::Internal(anyhow::anyhow!(error))
                }
            })?;

        self.session_service
            .get_session(session_id)
            .map_err(PendingPromptMutationError::Internal)?
            .ok_or_else(|| PendingPromptMutationError::SessionNotFound(session_id.to_string()))
    }

    pub async fn reorder_pending_prompts(
        &self,
        session_id: &str,
        expected_seqs: Vec<i64>,
        desired_seqs: Vec<i64>,
    ) -> Result<SessionRecord, PendingPromptQueueError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                PendingPromptQueueError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_queue_lifecycle_error)?;
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(|error| {
                PendingPromptQueueError::Internal(anyhow::anyhow!(
                    "failed to ensure live session handle: {error:?}"
                ))
            })?;

        handle
            .reorder_pending_prompts(expected_seqs, desired_seqs)
            .await
            .map_err(map_queue_command_error)?;

        self.session_service
            .get_session(session_id)
            .map_err(PendingPromptQueueError::Internal)?
            .ok_or_else(|| PendingPromptQueueError::SessionNotFound(session_id.to_string()))
    }

    pub async fn steer_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
    ) -> Result<SessionRecord, PendingPromptQueueError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                PendingPromptQueueError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_queue_lifecycle_error)?;
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(|error| {
                PendingPromptQueueError::Internal(anyhow::anyhow!(
                    "failed to ensure live session handle: {error:?}"
                ))
            })?;

        handle
            .steer_pending_prompt(seq)
            .await
            .map_err(map_queue_command_error)?;

        self.session_service
            .get_session(session_id)
            .map_err(PendingPromptQueueError::Internal)?
            .ok_or_else(|| PendingPromptQueueError::SessionNotFound(session_id.to_string()))
    }
}

fn map_queue_lifecycle_error(error: SessionLifecycleError) -> PendingPromptQueueError {
    match error {
        SessionLifecycleError::SessionNotFound(id) => PendingPromptQueueError::SessionNotFound(id),
        SessionLifecycleError::Internal(error) => PendingPromptQueueError::Internal(error),
    }
}

fn map_queue_command_error(
    error: LiveSessionCommandError<QueueMutationError>,
) -> PendingPromptQueueError {
    match error {
        LiveSessionCommandError::ActorUnavailable => {
            PendingPromptQueueError::Internal(anyhow::anyhow!("session actor channel closed"))
        }
        LiveSessionCommandError::ResponseDropped => PendingPromptQueueError::Internal(
            anyhow::anyhow!("session actor dropped pending-prompt queue response"),
        ),
        LiveSessionCommandError::Rejected(QueueMutationError::NotFound) => {
            PendingPromptQueueError::NotFound
        }
        LiveSessionCommandError::Rejected(QueueMutationError::StaleOrder { current_seqs }) => {
            PendingPromptQueueError::StaleOrder { current_seqs }
        }
        LiveSessionCommandError::Rejected(QueueMutationError::InvalidReorder(detail)) => {
            PendingPromptQueueError::InvalidReorder(detail)
        }
        LiveSessionCommandError::Rejected(QueueMutationError::Internal(error)) => {
            PendingPromptQueueError::Internal(anyhow::anyhow!(error))
        }
    }
}
