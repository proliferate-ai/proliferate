use anyharness_contract::v1::PromptInputBlock;

use crate::acp::session_actor::{QueueMutationError, SessionCommand};
use crate::sessions::model::{PromptAttachmentState, SessionRecord};
use crate::sessions::prompt::{
    capabilities_from_live_config, prepare_prompt, PromptPrepareContext,
};

use super::{PendingPromptMutationError, SessionLifecycleError, SessionRuntime};

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
            .ensure_live_session_handle(&record, None, None)
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
                plan_resolver: self.plan_service.as_ref(),
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

        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::EditPendingPrompt {
                seq,
                payload: prepared.payload.clone(),
                respond_to: tx,
            })
            .await
            .is_err()
        {
            let _ = prepared.cleanup_attachments(
                self.session_service.store(),
                self.session_service.attachment_storage(),
                session_id,
            );
            return Err(PendingPromptMutationError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }
        rx.await
            .map_err(|_| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "session actor dropped edit-pending-prompt response"
                ))
            })?
            .map_err(|error| match error {
                QueueMutationError::NotFound => {
                    let _ = prepared.cleanup_attachments(
                        self.session_service.store(),
                        self.session_service.attachment_storage(),
                        session_id,
                    );
                    PendingPromptMutationError::NotFound
                }
                QueueMutationError::ActorDead => PendingPromptMutationError::Internal(
                    anyhow::anyhow!("session actor is not responding"),
                ),
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
            .ensure_live_session_handle(&record, None, None)
            .await
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "failed to ensure live session handle: {error:?}"
                ))
            })?;

        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::DeletePendingPrompt {
                seq,
                respond_to: tx,
            })
            .await
            .is_err()
        {
            return Err(PendingPromptMutationError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }
        rx.await
            .map_err(|_| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "session actor dropped delete-pending-prompt response"
                ))
            })?
            .map_err(|error| match error {
                QueueMutationError::NotFound => PendingPromptMutationError::NotFound,
                QueueMutationError::ActorDead => PendingPromptMutationError::Internal(
                    anyhow::anyhow!("session actor is not responding"),
                ),
            })?;

        self.session_service
            .get_session(session_id)
            .map_err(PendingPromptMutationError::Internal)?
            .ok_or_else(|| PendingPromptMutationError::SessionNotFound(session_id.to_string()))
    }
}
